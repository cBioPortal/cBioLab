// The administrator's setting overrides (lib/settings.ts) against a stand-in store whose answers
// the test controls, for what the real Postgres (test/settings.db-test.ts) cannot be made to do:
// a store that is not migrated, unreachable, hanging or absent. The header's contract: with no
// store the environment is the whole answer and /admin says why it cannot edit; when the store
// fails the last overrides read keep applying, and a process that never read them answers by the
// environment. Also every value check /admin refuses by, and what /admin is shown.
import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "https://user:pw@warehouse.invalid:8443";
process.env.CLICKHOUSE_PASSWORD = "pw";
process.env.CLICKHOUSE_LABEL = "Main warehouse";
process.env.PEER_LABEL = "env peer";
process.env.LOOPBACK_PEER_URL = "http://env.invalid/api/federation/v1";
process.env.LOOPBACK_PEER_TOKEN = "s".repeat(40);
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "STUDY_DENY", "VERCEL_ENV", "DATABASE_URL", "SUPABASE_DB_URL", "AGGREGATE_ONLY_STUDIES"]) delete process.env[k];

const { setDatabaseForTests } = await import("../lib/db.ts");
const settings = await import("../lib/settings.ts");

type Mode = "ok" | "fail" | "not-migrated" | "hang";
let mode: Mode = "ok";
let reads = 0;
const rows = new Map<string, { value: string; updated_at: string; updated_by: string | null }>();
const log: { name: string; old_value: string | null; new_value: string | null; changed_at: string; email: string | null }[] = [];
setDatabaseForTests(async (sql, params) => {
  if (mode === "fail") throw new Error("connection refused");
  if (mode === "not-migrated") throw new Error("relation \"app_setting\" does not exist");
  if (mode === "hang") return new Promise(() => {});
  const p = params as (string | null)[];
  if (/^select name, value, updated_at, updated_by from app_setting/.test(sql)) {
    reads++;
    return { rows: [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([name, r]) => ({ name, ...r })) };
  }
  if (/^select value from app_setting where name/.test(sql)) return { rows: rows.has(p[0]!) ? [{ value: rows.get(p[0]!)!.value }] : [] };
  if (/^delete from app_setting where/.test(sql)) { rows.delete(p[0]!); return { rows: [] }; }
  if (/^insert into app_setting \(/.test(sql)) { rows.set(p[0]!, { value: p[1]!, updated_at: new Date().toISOString(), updated_by: p[2] }); return { rows: [] }; }
  if (/^insert into app_setting_log/.test(sql)) {
    log.unshift({ name: p[0]!, old_value: p[1], new_value: p[2], changed_at: new Date().toISOString(), email: p[3] && p[3] + "@example.org" });
    return { rows: [] };
  }
  if (/from app_setting_log l left join app_user/.test(sql)) return { rows: log.slice(0, 50) };
  throw new Error("unexpected statement: " + sql);
});
after(() => setDatabaseForTests(null));

const warnings: string[] = [];
mock.method(console, "warn", (...a: unknown[]) => { warnings.push(a.join(" ")); });

describe("the settings /admin offers", () => {
  test("each is described, and the address and token of the simulated peer are not editable", () => {
    assert.equal(settings.settingSpec("PEER_LABEL")?.editable, true);
    assert.equal(settings.settingSpec("LOOPBACK_PEER_URL")?.editable, false);
    assert.equal(settings.settingSpec("LOOPBACK_PEER_TOKEN")?.secret, true);
    assert.equal(settings.settingSpec("CLICKHOUSE_URL"), undefined);
    assert.equal(new Set(settings.SETTINGS.map((s) => s.name)).size, settings.SETTINGS.length);
  });

  test("every check refuses a value the app could not use, and accepts one it can", () => {
    const check = (name: string, v: string) => settings.settingSpec(name)!.check!(v);
    const refused: [string, string, RegExp][] = [
      ["PEER_LABEL", "x".repeat(121), /at most 120/],
      ["CLICKHOUSE_LABEL", "x".repeat(121), /at most 120/],
      ["FEDERATION_PEERS", "=https://p.invalid", /not study=URL/],
      ["FEDERATION_PEERS", "s1=not a url", /'not' is not a URL|is not a URL/],
      ["FEDERATION_PEERS", "s1=ftp://p.invalid/x", /http\(s\), not ftp:/],
      ["LOOPBACK_PEER", "c", /a or b/],
      ["FEDERATION_HIDE_SQL", "yes", /1 or empty/],
      ["STUDY_ALLOW_RESTRICTED", "0", /1 or empty/],
      ["AGGREGATE_ONLY_INSTANCES", "a, c", /'c' is not a connection id/],
      ["AGGREGATE_ONLY_STUDIES", "ok_study bad;study", /'bad;study' is not a study id/],
      ["STUDY_DENY", "x".repeat(121), /is not a study id/],
      ["FEDERATION_ACCEPT_PATIENT_LEVEL", "s:everything", /everything/],
      ["FEDERATION_DISCLOSE_PATIENTS", "s:everything", /everything/],
    ];
    for (const [name, v, re] of refused) assert.throws(() => check(name, v), re, name + "=" + v);
    const accepted: [string, string][] = [
      ["PEER_LABEL", "x".repeat(120)],
      ["FEDERATION_PEERS", "s1=https://p.invalid/api/federation/v1, s2=http://q.invalid"],
      ["LOOPBACK_PEER", " b "], ["LOOPBACK_PEER", ""],
      ["FEDERATION_HIDE_SQL", "1"], ["FEDERATION_HIDE_SQL", ""],
      ["AGGREGATE_ONLY_INSTANCES", "a,b"], ["AGGREGATE_ONLY_STUDIES", "luad_tcga brca-1.2"], ["STUDY_DENY", ""],
      ["FEDERATION_ACCEPT_PATIENT_LEVEL", "*:timeline"],
    ];
    for (const [name, v] of accepted) assert.doesNotThrow(() => check(name, v), name + "=" + v);
  });
});

describe("outside the Next server", () => {
  test("refreshing never asks the store, and setting() is the environment", async () => {
    await settings.refreshSettings(true);
    assert.equal(reads, 0);
    assert.equal(settings.setting("PEER_LABEL"), "env peer");
    assert.equal(settings.setting("NOT_A_SETTING"), undefined);
  });
});

describe("with overrides on", () => {
  before(() => settings.enableSettingOverrides());

  test("app_setting not migrated: the environment answers, /admin says to migrate, and changes are refused", async () => {
    mode = "not-migrated";
    const r = await settings.settingsReport();
    assert.match(r.unavailable!, /has not been created; run `npm run db:migrate`/);
    assert.ok(r.rows.every((x) => !x.editable), "nothing is editable");
    assert.deepEqual(r.log, []);
    assert.equal(settings.setting("PEER_LABEL"), "env peer");
    await assert.rejects(settings.setSetting("PEER_LABEL", "x", "u1"), /cannot be changed here: the settings table has not been created/);
  });

  test("a store never reached: the environment answers, and /admin says why", async () => {
    mode = "fail";
    await settings.refreshSettings(true);
    assert.equal(settings.setting("PEER_LABEL"), "env peer");
    assert.equal(settings.settingsFingerprint(), "");
    const r = await settings.settingsReport();
    assert.match(r.unavailable!, /could not be reached \(connection refused\), so the environment's values are in force/);
    assert.ok(warnings.some((w) => /could not read the overrides: connection refused/.test(w)));
  });

  test("a store that answers: overrides apply, listeners run on a change, and one load serves concurrent callers", async () => {
    mode = "ok";
    let changed = 0;
    settings.onSettingsChange("t", () => { changed++; });
    const before = reads;
    const [a, b] = [settings.refreshSettings(true), settings.refreshSettings(true)];
    await Promise.all([a, b]);
    assert.equal(reads - before, 1, "one read for both callers");
    assert.equal(changed, 0, "nothing changed: there were no overrides and still are none");

    await settings.setSetting("PEER_LABEL", "  Site B  ", "u1");
    assert.equal(settings.setting("PEER_LABEL"), "Site B");
    assert.equal(changed, 1);
    assert.match(settings.settingsFingerprint(), /^[0-9a-f]{16}$/);
  });

  test("a row for a setting that is not editable never overrides its variable", async () => {
    rows.set("LOOPBACK_PEER_URL", { value: "http://evil.invalid", updated_at: new Date().toISOString(), updated_by: null });
    await settings.refreshSettings(true);
    assert.equal(settings.setting("LOOPBACK_PEER_URL"), "http://env.invalid/api/federation/v1");
    const r = await settings.settingsReport();
    assert.equal(r.rows.find((x) => x.name === "LOOPBACK_PEER_URL")!.override, null);
    rows.delete("LOOPBACK_PEER_URL");
    await settings.refreshSettings(true);
  });

  test("a store outage after a read keeps the last overrides in force", async () => {
    const fp = settings.settingsFingerprint();
    mode = "fail";
    await settings.refreshSettings(true);
    assert.equal(settings.setting("PEER_LABEL"), "Site B");
    assert.equal(settings.settingsFingerprint(), fp);
    mode = "ok";
  });

  test("a store that hangs is given up on after its timeout, the last overrides still standing", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      mode = "hang";
      const p = settings.refreshSettings(true);
      mock.timers.tick(3_000);
      await p;
      assert.ok(warnings.some((w) => /no answer in 3000 ms/.test(w)));
      assert.equal(settings.setting("PEER_LABEL"), "Site B");
    } finally {
      mock.timers.reset();
      mode = "ok";
    }
  });

  test("setting() reloads stale overrides in the background", async () => {
    rows.set("PEER_LABEL", { value: "changed elsewhere", updated_at: new Date().toISOString(), updated_by: null });
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 6_000 });
    try {
      assert.equal(settings.setting("PEER_LABEL"), "Site B", "answers at once from this process's copy");
      await settings.refreshSettings(); // the reload setting() started
      assert.equal(settings.setting("PEER_LABEL"), "changed elsewhere");
      const before = reads;
      await settings.refreshSettings();
      assert.equal(reads, before, "fresh overrides are not read again");
    } finally {
      mock.timers.reset();
    }
    await settings.setSetting("PEER_LABEL", "Site B", "u1");
  });

  test("/admin's report: overrides, environment values (never a secret's), connection choices under their labels, the log and the cache clear", async () => {
    await settings.setSetting("STUDY_DENY", "x_study", "u2");
    await settings.markResultCacheCleared("u3");
    const r = await settings.settingsReport();
    assert.equal(r.unavailable, null);
    const row = (n: string) => r.rows.find((x) => x.name === n)!;
    assert.equal(row("PEER_LABEL").env, "env peer");
    assert.equal(row("PEER_LABEL").override?.value, "Site B");
    assert.equal(row("PEER_LABEL").editable, true);
    assert.equal(row("LOOPBACK_PEER_TOKEN").env, null);
    assert.equal(row("LOOPBACK_PEER_TOKEN").envSet, true);
    assert.equal(row("FEDERATION_PEERS").envSet, false);
    assert.equal(row("FEDERATION_PEERS").choices, null);
    assert.deepEqual(row("LOOPBACK_PEER").choices!.map((c) => c.label), ["none", "a, Main warehouse", "b, the second warehouse"]);
    assert.equal(row("AGGREGATE_ONLY_INSTANCES").multi, true);
    assert.ok(!JSON.stringify(r).includes("s".repeat(40)) && !JSON.stringify(r.databases).includes("pw"));
    assert.deepEqual(r.log[0] && [r.log[0].name, r.log[0].by], [settings.CACHE_CLEARED, "u3@example.org"]);
    assert.deepEqual([r.log[1].name, r.log[1].old, r.log[1].new, r.log[1].by], ["STUDY_DENY", null, "x_study", "u2@example.org"]);
    assert.equal(r.cacheCleared?.by, "u3@example.org");
    assert.ok(!Number.isNaN(Date.parse(r.cacheCleared!.at)));
  });

  test("reverting an override deletes it and logs the old value", async () => {
    await settings.setSetting("STUDY_DENY", null, "u2");
    assert.equal(rows.has("STUDY_DENY"), false);
    assert.deepEqual([log[0].name, log[0].old_value, log[0].new_value], ["STUDY_DENY", "x_study", null]);
    assert.equal(settings.setting("STUDY_DENY"), undefined);
  });

  test("credentials, unknown and read-only settings are refused before the store is touched", async () => {
    const n = log.length;
    await assert.rejects(settings.setSetting("CLICKHOUSE_URL", "http://x.invalid", "u1"), /address or credentials/);
    await assert.rejects(settings.setSetting("NOPE", "1", "u1"), /no setting NOPE; the settings are CLICKHOUSE_LABEL, /);
    await assert.rejects(settings.setSetting("LOOPBACK_PEER_TOKEN", "t", "u1"), /cannot be changed here/);
    await assert.rejects(settings.setSetting("LOOPBACK_PEER", " c ", "u1"), /a or b/);
    assert.equal(log.length, n);
  });

  test("a production deployment with no store: the environment is the whole answer", async () => {
    process.env.VERCEL_ENV = "production";
    try {
      const r = await settings.settingsReport();
      assert.match(r.unavailable!, /no DATABASE_URL, so nothing can override its environment/);
      assert.equal(settings.setting("PEER_LABEL"), "env peer");
      assert.equal(r.cacheCleared, null);
      assert.equal(settings.settingsFingerprint(), "");
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});
