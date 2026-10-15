import { chQuery, STUDY, PORTAL, withoutFailedQueries } from "../../../lib/ch";
import { catalogSqls, lineCatalogSqls, LINE_TYPE } from "../../../lib/compiler";
import { survivalEndpointsSql, studyRouting, restrictedStudies } from "../../../lib/federation";
import { cacheLife } from "next/cache";
import { pack, throughCache, dataVersion } from "../../../lib/next-cache.ts";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const study = (url.searchParams.get("study") || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
    // A study lives on whichever instance holds it (AACR GENIE is not on the primary), so ask
    // the same routing the analysis engine uses rather than assuming the default database.
    // A study the routing withholds by policy is unreachable here too, not served from PRIMARY.
    // Checked before the cache: a refusal is an answer to give, not one to keep.
    if (!(await studyRouting()).has(study)) return Response.json({ error: restrictedStudies.has(study)
      ? "Study '" + study + "' is restricted and not available here" : "Study '" + study + "' not found" }, { status: 400 });
    return Response.json(await throughCache(async () => catalogEntry(study, await dataVersion()), () => catalogFor(study)));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

async function catalogEntry(study: string, _version: string): Promise<string> {
  "use cache: remote";
  cacheLife("days");
  return pack(await withoutFailedQueries(() => catalogFor(study)));
}

async function catalogFor(study: string) {
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
