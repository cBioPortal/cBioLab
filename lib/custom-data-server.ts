// The request boundary for custom data: which connections may receive the uploaded rows.
//
// Kept apart from lib/custom-data.ts because it needs the federation routing, and
// lib/custom-data.ts is imported by lib/ch.ts, which federation itself imports.
import { validateCustomData, withCustomData, tsvField, type CustomCtx, type CustomDataset } from "./custom-data.ts";
import { requirePrincipal } from "./auth.ts";
import { loadVersionForRequest } from "./custom-store.ts";
import { chQueryRows, registerChExternal, withChContext, type ChConn } from "./ch.ts";
import { sq } from "./compiler.ts";
import { studyRouting, instanceForStudy, patientLevelConn, resolverFor, isPatientLevel } from "./federation.ts";
import { studyProfiles } from "./analysis.ts";
import { oncokbPin } from "./annotation.ts";
import type { CohortDef } from "./types.ts";
import { peerForStudy } from "./federation-remote.ts";

/**
 * Validate a request's `customData` and decide where it may go. Every study it names must be
 * held by a patient-level instance of this deployment: the rows are patient-level data, so a
 * remote peer or an aggregate-only instance is refused outright rather than silently skipped.
 */
export async function customContext(raw: unknown, server?: ServerRefs): Promise<Omit<CustomCtx, "enc">> {
  const fromServer = server ? await loadServerRefs(server) : [];
  const local = Array.isArray(raw) ? raw : raw == null ? [] : raw;
  // one validation over both, so the limits, the id rules and "appears twice" hold across them
  const datasets = validateCustomData(Array.isArray(local) ? [...local, ...fromServer] : local);
  const allowedConns = new Set<string>(), allowedDbs = new Set<string>();
  if (!datasets.length) return { datasets, allowedConns, allowedDbs };
  const studies = new Set(datasets.flatMap((d) => d.rows.map((r) => r.study)));
  const routing = await studyRouting();
  for (const study of studies) {
    if (peerForStudy(study))
      throw new Error("custom data for " + study + " cannot be used: that study is held by a remote peer, which may not receive patient-level data");
    if (!routing.has(study)) throw new Error("custom data names study '" + study + "', which is not available here");
    const inst = await instanceForStudy(study);
    if (inst.mode !== "patient-level")
      throw new Error("custom data for " + study + " cannot be used: " + inst.label + " is not entitled to patient-level data");
    allowedConns.add(inst.conn.id);
    allowedDbs.add(inst.conn.db);
  }
  return { datasets, allowedConns, allowedDbs };
}

/** Run `fn` with the request's custom data in effect (a no-op when it carries none). */
export async function withRequestCustomData<T>(raw: unknown, fn: () => Promise<T>, server?: ServerRefs): Promise<T> {
  return withCustomData(await customContext(raw, server), fn);
}

/**
 * Server-stored datasets a request names instead of carrying: `customRefs` beside its body,
 * each `{ as, dataset, version }` — the name the document uses, the stored dataset, and the
 * version it is pinned to. Read as the request's principal (lib/auth.ts).
 */
export interface ServerRefs { refs: unknown; req: Request }
export const MAX_REFS = 10;

async function loadServerRefs({ refs, req }: ServerRefs): Promise<CustomDataset[]> {
  if (refs == null) return [];
  if (!Array.isArray(refs)) throw new Error("customRefs must be an array of { as, dataset, version }");
  if (!refs.length) return [];
  if (refs.length > MAX_REFS) throw new Error("a request names at most " + MAX_REFS + " server datasets; this one names " + refs.length);
  const principal = requirePrincipal(req);
  return Promise.all(refs.map(async (r) => {
    const { as, dataset, version } = (r ?? {}) as { as?: unknown; dataset?: unknown; version?: unknown };
    if (typeof as !== "string" || typeof dataset !== "string" || !Number.isInteger(version) || (version as number) < 1)
      throw new Error("each customRefs entry is { as, dataset, version } with a whole-number version");
    const { meta, rows } = await loadVersionForRequest(principal, dataset, version as number);
    const v = meta.versions.find((x) => x.version === version)!;
    return { id: as, name: meta.name, level: meta.level, columns: v.columns, rows };
  }));
}

/** a frozen feature resolves every column of a figure, so this matches FEATURE_PATIENT_LIMIT */
export const RESOLVE_LIMIT = 250_000;

export interface ResolvedCase { study: string; patient: string; sample?: string }
export interface ResolveResult {
  /** per input id, in input order: the cases it names (empty = unmatched) */
  matches: ResolvedCase[][];
  unmatched: number;
  /** bare ids found in more than one of the studies: each is applied to every one, and said so */
  multiStudy: number;
  /** studies ids were not matched against, and why */
  refused: { study: string; reason: string }[];
}

/**
 * Match uploaded case ids to the studies' own patients or samples. An id is `study:id` or a bare
 * id; a bare id is looked up in every study given. Only patient-level studies can be resolved —
 * the answer names patients.
 */
export async function resolveCaseIds(studies: string[], level: "patient" | "sample", ids: string[]): Promise<ResolveResult> {
  if (!studies.length) throw new Error("studies must name at least one study");
  if (ids.length > RESOLVE_LIMIT)
    throw new Error("an upload takes at most " + RESOLVE_LIMIT.toLocaleString("en-US") + " rows; this one has " + ids.length.toLocaleString("en-US"));
  const routing = await studyRouting();
  const byConn = new Map<string, { conn: ChConn; studies: string[] }>();
  const refused: { study: string; reason: string }[] = [];
  for (const s of studies) {
    if (peerForStudy(s) || !routing.has(s)) { refused.push({ study: s, reason: "not available here" }); continue; }
    const inst = await instanceForStudy(s);
    if (inst.mode !== "patient-level") { refused.push({ study: s, reason: inst.label + " is not entitled to patient-level data" }); continue; }
    const e = byConn.get(inst.conn.id) ?? { conn: inst.conn, studies: [] };
    e.studies.push(s);
    byConn.set(inst.conn.id, e);
  }
  if (!byConn.size)
    throw new Error("custom data cannot be matched against " + refused.map((r) => r.study + " (" + r.reason + ")").join(", "));
  const usable = [...byConn.values()].flatMap((e) => e.studies);
  const parsed = ids.map((raw) => {
    const t = String(raw ?? "").trim();
    const i = t.indexOf(":");
    return i > 0 && studies.includes(t.slice(0, i)) ? { study: t.slice(0, i), id: t.slice(i + 1).trim() } : { study: null as string | null, id: t };
  });
  const wanted = [...new Set(parsed.map((p) => p.id).filter((x) => x && !/[\t\n\r\\]/.test(x) && x.length <= 100))];
  const col = level === "sample" ? "sample_stable_id" : "patient_stable_id";
  // key: study + "\t" + stable id -> the cases it names
  const found = new Map<string, ResolvedCase[]>();
  for (const { conn, studies: ss } of byConn.values()) {
    if (!wanted.length) break;
    const r = await withChContext({}, async () => {
      registerChExternal({ name: "_upload_ids", structure: "id String", data: wanted.map(tsvField).join("\n") + "\n" });
      return chQueryRows(
        "SELECT DISTINCT cancer_study_identifier, patient_stable_id, sample_stable_id\n" +
        "FROM " + conn.db + ".sample_derived\n" +
        "WHERE cancer_study_identifier IN (" + ss.map(sq).join(",") + ")\n" +
        "  AND " + col + " IN (SELECT id FROM _upload_ids)", conn);
    });
    for (const [study, patient, sample] of r.rows as string[][]) {
      const key = study + "\t" + (level === "sample" ? sample : patient);
      const list = found.get(key) ?? [];
      if (level === "sample") list.push({ study, patient, sample });
      else if (!list.length) list.push({ study, patient });
      found.set(key, list);
    }
  }
  let unmatched = 0, multiStudy = 0;
  const matches = parsed.map((p) => {
    const hits = (p.study ? [p.study] : usable).flatMap((s) => found.get(s + "\t" + p.id) ?? []);
    if (!hits.length) unmatched++;
    else if (!p.study && new Set(hits.map((h) => h.study)).size > 1) multiStudy++;
    return hits;
  });
  return { matches, unmatched, multiStudy, refused };
}

/** how many patients the upload panel's example data names */
export const EXAMPLE_PATIENTS = 8;

/**
 * A few of a study's own patient ids, for the upload panel's example data: an example built from
 * them matches the study, so it can be added as it stands. Patient-level studies only.
 */
export async function exampleCaseIds(study: string): Promise<string[]> {
  if (peerForStudy(study)) throw new Error("example data cannot name patients of " + study + ": it is held by a remote peer");
  const conn = await patientLevelConn(study, "example data names patients");
  const r = await chQueryRows(
    "SELECT DISTINCT patient_stable_id FROM " + conn.db + ".sample_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "ORDER BY patient_stable_id LIMIT " + EXAMPLE_PATIENTS, conn);
  return (r.rows as string[][]).map((x) => x[0]);
}

/** a frozen feature marks every patient of the study, so it is bounded by what one upload may hold */
export const FEATURE_PATIENT_LIMIT = 250_000;

/**
 * Who is in a cohort and who is not, per study — what "save as feature" freezes. Patient-level
 * studies only: the answer is a list of patients.
 */
export async function cohortMembership(def: CohortDef, studies: string[]): Promise<{ study: string; members: string[]; others: string[] }[]> {
  if (!studies.length) throw new Error("name at least one study");
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const out: { study: string; members: string[]; others: string[] }[] = [];
  for (const study of studies) {
    const r = await resolverFor(study, { oncokbPin: pin, ...(await studyProfiles(study)) });
    if (!isPatientLevel(r)) throw new Error("a feature lists patients, and " + r.instance.label + " is not entitled to patient-level data (" + study + ")");
    const [inCohort, everyone] = await Promise.all([r.members(def), r.members(null)]);
    if (everyone.length > FEATURE_PATIENT_LIMIT)
      throw new Error("a feature marks every patient of its study, and " + study + " has " + everyone.length.toLocaleString("en-US") +
        "; the limit is " + FEATURE_PATIENT_LIMIT.toLocaleString("en-US"));
    const m = new Set(inCohort);
    out.push({ study, members: [...m], others: everyone.filter((p) => !m.has(p)) });
  }
  return out;
}
