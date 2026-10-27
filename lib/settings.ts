// Deployment settings an administrator can see and change at run time (/admin). A setting is an
// environment variable; a row in app_setting (db/migrations/0010_app_settings.sql) overrides it for
// every server process of the deployment, and removing the row returns to the variable.
//
// `setting(name)` is what code reads instead of `process.env[name]` for the settings listed here.
// It is synchronous, so the 40-odd places federation consults one keep their shape: it answers from
// this process's copy of the overrides, which `refreshSettings()` reloads at most every few seconds.
// The request paths that decide federation await that refresh first — the study routing, every
// cached result's key (lib/next-cache.ts) and the federation API route — so a process answers by a change
// within REFRESH_MS of it, and a cold one never answers by the environment alone.
//
// Overrides apply only under the Next server, which turns them on in instrumentation.ts. The CLI,
// the stdio MCP server and the tests read the environment as before.
//
// When the overrides cannot be read:
//   - no store (Vercel production without DATABASE_URL), or app_setting not migrated yet: there can
//     be no overrides, so the environment is the whole answer and /admin says why it cannot edit;
//   - the store fails: the last overrides read keep applying; a process that never read them
//     answers by the environment, says so on /admin, and tries again on the next refresh. A store
//     outage must not take analyses down with it, though an override that tightened federation is
//     then not applied by that process until the store answers.
//
// Database addresses and credentials are not settings here: /admin shows the connections as
// lib/ch.ts describes them (the one module that reads them), and nothing changes them. Nor are
// LOOPBACK_PEER_URL and LOOPBACK_PEER_TOKEN editable: the app sends that token to that address, so
// the pair is a credential.
import { createHash } from "node:crypto";
import { dbQuery, databaseUrl } from "./db.ts";
import { parseRules } from "./disclosure.ts";
import { describeConnections } from "./ch.ts";

export type SettingGroup = "databases" | "peers" | "patient-level" | "access";

export interface SettingSpec {
  name: string;
  group: SettingGroup;
  /** what it does, for /admin */
  help: string;
  /** changeable from /admin */
  editable: boolean;
  /** its value is never shown, only whether it is set */
  secret?: boolean;
  /** throws, naming the problem, on a value the app could not use */
  check?: (v: string) => void;
}

const list = (v: string) => v.split(/[,\s]+/).filter(Boolean);
const label = (v: string) => { if (v.length > 120) throw new Error("a label is at most 120 characters"); };

export const SETTINGS: readonly SettingSpec[] = [
  { name: "CLICKHOUSE_LABEL", group: "databases", editable: true, check: label, help: "how results and captions name the primary warehouse (connection a)" },
  { name: "CLICKHOUSE2_LABEL", group: "databases", editable: true, check: label, help: "how results and captions name the second warehouse (connection b)" },
  {
    name: "FEDERATION_PEERS", group: "peers", editable: true,
    help: "studies held by peer cbio-lab instances, as study=URL pairs (the peer's /api/federation/v1); this instance asks them for aggregates",
    check: (v) => {
      for (const e of list(v)) {
        const i = e.indexOf("=");
        if (i < 1) throw new Error("'" + e.slice(0, 80) + "' is not study=URL");
        let u: URL;
        try { u = new URL(e.slice(i + 1)); } catch { throw new Error("'" + e.slice(i + 1, i + 81) + "' is not a URL"); }
        if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("a peer is reached over http(s), not " + u.protocol);
      }
    },
  },
  { name: "PEER_LABEL", group: "peers", editable: true, check: label, help: "how results and captions name a FEDERATION_PEERS peer" },
  {
    name: "LOOPBACK_PEER", group: "peers", editable: true,
    help: "a connection id (e.g. b, the second warehouse) this app serves to itself through its own federation API as a simulated peer",
    check: (v) => { if (v.trim() && !/^[ab]$/.test(v.trim())) throw new Error("LOOPBACK_PEER names a connection: a or b"); },
  },
  { name: "LOOPBACK_PEER_LABEL", group: "peers", editable: true, check: label, help: "how results and captions name the simulated peer" },
  { name: "LOOPBACK_PEER_URL", group: "peers", editable: false, help: "this app's own /api/federation/v1, where the simulated peer is reached (else 127.0.0.1 on PORT); not editable, as the loopback token is sent to it" },
  { name: "LOOPBACK_PEER_TOKEN", group: "peers", editable: false, secret: true, help: "what tells this app's calls to itself from anyone else's, where several processes serve it" },
  {
    name: "FEDERATION_ACCEPT_PATIENT_LEVEL", group: "patient-level", editable: true,
    help: "as the coordinator: the kinds of patient-level data accepted from the peer serving each study (e.g. genie_public:timeline+alterations, *:timeline)",
    check: (v) => { parseRules(v, "FEDERATION_ACCEPT_PATIENT_LEVEL"); },
  },
  {
    name: "FEDERATION_DISCLOSE_PATIENTS", group: "patient-level", editable: true,
    help: "as a peer: the kinds of patient-level data this instance sends to any caller of its /api/federation/v1, per study. There is no caller authentication yet (docs/DATA-BOUNDARY.md)",
    check: (v) => { parseRules(v, "FEDERATION_DISCLOSE_PATIENTS"); },
  },
  {
    name: "FEDERATION_HIDE_SQL", group: "peers", editable: true,
    help: "1 keeps this instance's compiled SQL out of what it answers peers",
    check: (v) => { if (v !== "" && v !== "1") throw new Error("FEDERATION_HIDE_SQL is 1 or empty"); },
  },
  {
    name: "AGGREGATE_ONLY_INSTANCES", group: "access", editable: true,
    help: "connection ids (a, b) treated as aggregate-only: never asked for a patient id",
    check: (v) => { for (const id of list(v)) if (!/^[ab]$/.test(id)) throw new Error("'" + id.slice(0, 40) + "' is not a connection id (a or b)"); },
  },
  {
    name: "AGGREGATE_ONLY_STUDIES", group: "access", editable: true,
    help: "study ids treated as aggregate-only whichever connection holds them",
    check: (v) => { for (const id of list(v)) if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("'" + id.slice(0, 80) + "' is not a study id"); },
  },
  {
    name: "STUDY_DENY", group: "access", editable: true,
    help: "study ids never routed, so unreachable from every surface",
    check: (v) => { for (const id of list(v)) if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("'" + id.slice(0, 80) + "' is not a study id"); },
  },
  {
    name: "STUDY_ALLOW_RESTRICTED", group: "access", editable: true,
    help: "1 routes consortium- and institution-restricted studies, which are otherwise unreachable",
    check: (v) => { if (v !== "" && v !== "1") throw new Error("STUDY_ALLOW_RESTRICTED is 1 or empty"); },
  },
];

const SPEC = new Map(SETTINGS.map((s) => [s.name, s]));
export const settingSpec = (name: string): SettingSpec | undefined => SPEC.get(name);

/** When an administrator last cleared the result cache: a row of app_setting, never a variable. */
export const CACHE_CLEARED = "result_cache_cleared_at";

const REFRESH_MS = 5_000;
const READ_TIMEOUT_MS = 3_000;

type Overrides = Map<string, { value: string; at: string; by: string | null }>;
interface State {
  enabled: boolean;
  overrides: Overrides | null;
  /** why the overrides are not in use, when they are not */
  unavailable: string | null;
  at: number;
  loading: Promise<void> | null;
  fingerprint: string;
  listeners: Map<string, () => void>;
}
// one copy per process: Next may load this module once per route bundle
const g = globalThis as unknown as { __cbioSettings?: State };
const state = g.__cbioSettings ??= { enabled: false, overrides: null, unavailable: null, at: 0, loading: null, fingerprint: "", listeners: new Map() };

/** Turn the overrides on for this process; the Next server does, at startup (instrumentation.ts). */
export function enableSettingOverrides(): void { state.enabled = true; }

/** The setting's value: the administrator's override, else the environment variable. */
export function setting(name: string): string | undefined {
  if (state.enabled && Date.now() - state.at > REFRESH_MS) void refreshSettings().catch(() => {});
  const o = SPEC.get(name)?.editable ? state.overrides?.get(name) : undefined;
  return o ? o.value : process.env[name];
}

/**
 * Run `fn` whenever the overrides change in this process (after the first read). Keyed, so a module
 * loaded again replaces its listener rather than adding another.
 */
export function onSettingsChange(key: string, fn: () => void): void { state.listeners.set(key, fn); }

/** What every cached result's key carries: the overrides in force and when the cache was cleared. */
export function settingsFingerprint(): string { return state.fingerprint; }

const storeMissing = (): string | null =>
  !databaseUrl() && process.env.VERCEL_ENV === "production" ? "this deployment has no DATABASE_URL, so nothing can override its environment" : null;
const notMigrated = (e: unknown) => /app_setting.*does not exist/i.test(String((e as Error)?.message || e));

/** Reload the overrides if they are older than REFRESH_MS; one load at a time per process. */
export function refreshSettings(force = false): Promise<void> {
  if (!state.enabled) return Promise.resolve();
  if (!force && Date.now() - state.at <= REFRESH_MS) return Promise.resolve();
  return state.loading ??= load().finally(() => { state.loading = null; });
}

async function load(): Promise<void> {
  let next: Overrides | null = null, why = storeMissing();
  if (!why) {
    try {
      // requests wait on this read, so a store that hangs costs them READ_TIMEOUT_MS at most
      let timer: ReturnType<typeof setTimeout> | undefined;
      const rows = await Promise.race([
        dbQuery<{ name: string; value: string; updated_at: Date | string; updated_by: string | null }>(
          "select name, value, updated_at, updated_by from app_setting order by name"),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("no answer in " + READ_TIMEOUT_MS + " ms")), READ_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
      next = new Map(rows.map((r) => [r.name, { value: r.value, at: new Date(r.updated_at).toISOString(), by: r.updated_by }]));
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (!notMigrated(e)) {
        console.warn("[settings] could not read the overrides:", msg);
        // the last overrides read stand until the store answers again
        if (state.overrides) { state.at = Date.now(); return; }
      }
      why = notMigrated(e) ? "the settings table has not been created; run `npm run db:migrate`"
        : "the settings database could not be reached (" + msg.slice(0, 200) + "), so the environment's values are in force";
    }
  }
  const fp = next && next.size ? createHash("sha256").update(JSON.stringify([...next].map(([k, v]) => [k, v.value]))).digest("hex").slice(0, 16) : "";
  const changed = fp !== state.fingerprint;
  Object.assign(state, { overrides: next, unavailable: why, at: Date.now(), fingerprint: fp });
  if (changed) for (const fn of state.listeners.values()) fn();
}

export interface SettingRow {
  name: string; group: SettingGroup; help: string; editable: boolean; secret: boolean;
  /** the environment's value (null for a secret: `envSet` says whether there is one) */
  env: string | null; envSet: boolean;
  /** the administrator's override, when there is one */
  override: { value: string; at: string; by: string | null } | null;
}
export interface SettingsReport {
  /** the warehouses this instance queries, read-only */
  databases: ReturnType<typeof describeConnections>;
  rows: SettingRow[];
  /** why overrides cannot be made here, when they cannot */
  unavailable: string | null;
  cacheCleared: { at: string; by: string | null } | null;
  log: { name: string; old: string | null; new: string | null; at: string; by: string | null }[];
}

/** Every setting as /admin shows it, with its recent changes. Secrets are never included. */
export async function settingsReport(): Promise<SettingsReport> {
  await refreshSettings(true);
  const o = state.overrides;
  const rows = SETTINGS.map((s): SettingRow => {
    const env = process.env[s.name];
    const ov = s.editable ? o?.get(s.name) ?? null : null;
    return { name: s.name, group: s.group, help: s.help, editable: s.editable && !state.unavailable, secret: !!s.secret,
      env: s.secret ? null : env ?? null, envSet: !!env, override: ov };
  });
  const cleared = o?.get(CACHE_CLEARED);
  let log: SettingsReport["log"] = [];
  if (!state.unavailable) {
    log = (await dbQuery<{ name: string; old_value: string | null; new_value: string | null; changed_at: Date | string; email: string | null }>(
      "select l.name, l.old_value, l.new_value, l.changed_at, u.email from app_setting_log l left join app_user u on u.id = l.changed_by" +
      " order by l.id desc limit 50")).map((r) => ({ name: r.name, old: r.old_value, new: r.new_value, at: new Date(r.changed_at).toISOString(), by: r.email }));
  }
  const by = cleared?.by ? log.find((l) => l.name === CACHE_CLEARED)?.by ?? null : null;
  return { databases: describeConnections(), rows, unavailable: state.unavailable, cacheCleared: cleared ? { at: cleared.value, by } : null, log };
}

async function write(name: string, value: string | null, by: string): Promise<void> {
  await refreshSettings(true);
  if (state.unavailable) throw new Error("settings cannot be changed here: " + state.unavailable);
  const [old] = await dbQuery<{ value: string }>("select value from app_setting where name = $1", [name]);
  if (value == null) await dbQuery("delete from app_setting where name = $1", [name]);
  else await dbQuery("insert into app_setting (name, value, updated_by) values ($1, $2, $3)" +
    " on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by", [name, value, by]);
  await dbQuery("insert into app_setting_log (name, old_value, new_value, changed_by) values ($1, $2, $3, $4)", [name, old?.value ?? null, value, by]);
  await refreshSettings(true);
}

/**
 * Override a setting for the whole deployment (`value`), or return it to its environment variable
 * (null). Refused for a setting that is not editable and for a value the app could not use.
 */
export async function setSetting(name: string, value: string | null, by: string): Promise<void> {
  const spec = SPEC.get(name);
  if (!spec && /^CLICKHOUSE/.test(name)) throw new Error(name + " is part of a database connection's address or credentials, which cannot be changed here");
  if (!spec) throw new Error("no setting " + name.slice(0, 80) + "; the settings are " + SETTINGS.map((s) => s.name).join(", "));
  if (!spec.editable) throw new Error(name + " cannot be changed here");
  if (value != null) {
    value = value.trim();
    spec.check?.(value);
  }
  await write(name, value, by);
}

/** Mark the result cache cleared now: every cached entry's key changes, in every process. */
export async function markResultCacheCleared(by: string): Promise<void> {
  await write(CACHE_CLEARED, new Date().toISOString(), by);
}
