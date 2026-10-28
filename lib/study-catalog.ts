// The catalog of one study: its timeline event types with their attribute keys and values, its
// survival endpoints and the derived treatment lines — what the cohort builder offers. Vocabulary
// and counts only; it names no patient. A peer serves it for its studies through the federation
// API's `catalog` op.
import { chQuery, PORTAL } from "./ch.ts";
import { catalogSqls, lineCatalogSqls, LINE_TYPE } from "./compiler.ts";
import { studyRouting } from "./federation.ts";
import { survivalEndpointsSql } from "./survival-queries.ts";

export type StudyCatalog = Awaited<ReturnType<typeof catalogFor>>;

/** The catalog of a study this instance holds in one of its own databases. */
export async function catalogFor(study: string) {
  const conn = (await studyRouting()).get(study);
  if (!conn) throw new Error("Study '" + study + "' is not routed");
  const DB = conn.db;
  const sqls = catalogSqls(DB, study);
  const chk = await chQuery(sqls.studyCheck, conn);
  if (Number(chk.data[0].n) !== 1) throw new Error("Study '" + study + "' not found");
  const lSqls = lineCatalogSqls(DB, study);
  // independent queries, run together
  const [tRes, vRes, kRes, epRes, lStats, lCombos] = await Promise.all([
    chQuery(sqls.types, conn), chQuery(sqls.values, conn), chQuery(sqls.keys, conn),
    chQuery(survivalEndpointsSql(study, DB), conn).catch(() => null),
    chQuery(lSqls.stats, conn), chQuery(lSqls.combos, conn)]);
  const values: Record<string, Record<string, string[]>> = {}, keys: Record<string, string[]> = {};
  vRes.data.forEach((r) => { (values[r.t] = values[r.t] || {}); (values[r.t][r.k] = values[r.t][r.k] || []).push(r.v); });
  kRes.data.forEach((r) => { (keys[r.t] = keys[r.t] || []).push(r.k); });
  let totalPatients = tRes.data.reduce((m: number, t) => Math.max(m, Number(t.n_pat)), 0);
  if (!totalPatients) {
    const pc = await chQuery(sqls.patientCount, conn);
    totalPatients = Number(pc.data[0].n);
  }
  // which time-to-event endpoints this study declares, so the survival
  // control can offer only what exists rather than a fixed OS/PFS list
  // null, not [], when the lookup fails: [] means "this study has none" and greys out the
  // survival/cox buttons, which a transient query error must not do
  const survivalEndpoints = epRes ? (epRes.data as { endpoint: string }[]).map((r) => String(r.endpoint)) : null;
  const hasPriorMedFlag = Object.keys(values["Treatment"] || {}).includes("PRIOR_MED_TO_MSK");
  // synthetic event type: derived treatment lines (default gap 90d), queryable like any other event
  const types = [...tRes.data, { t: LINE_TYPE, n_pat: lStats.data[0].n_pat, n_ev: lStats.data[0].n_ev }];
  values[LINE_TYPE] = {
    LINE_NO: ["1", "2", "3", "4", "5"],
    COMPOSITION: lCombos.data.map(r => r.combo)
  };
  keys[LINE_TYPE] = ["LINE_NO", "COMPOSITION"];
  return { study, portal: PORTAL, totalPatients, hasPriorMedFlag, types, values, keys, survivalEndpoints };
}
