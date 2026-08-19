import { chQuery, DB, STUDY, PORTAL } from "../../../lib/ch";
import { catalogSqls, lineCatalogSqls, LINE_TYPE } from "../../../lib/compiler";

let cache = null; // module-level, per server process

export async function GET() {
  try {
    if (!cache) {
      const sqls = catalogSqls(DB, STUDY);
      const chk = await chQuery(sqls.studyCheck);
      if (Number(chk.data[0].n) !== 1) throw new Error("Study '" + STUDY + "' not found");
      const [tRes, vRes, kRes] = [await chQuery(sqls.types), await chQuery(sqls.values), await chQuery(sqls.keys)];
      const values = {}, keys = {};
      vRes.data.forEach(r => { (values[r.t] = values[r.t] || {}); (values[r.t][r.k] = values[r.t][r.k] || []).push(r.v); });
      kRes.data.forEach(r => { (keys[r.t] = keys[r.t] || []).push(r.k); });
      const totalPatients = tRes.data.reduce((m, t) => Math.max(m, Number(t.n_pat)), 0);
      const hasPriorMedFlag = Object.keys(values["Treatment"] || {}).includes("PRIOR_MED_TO_MSK");
      // synthetic event type: derived treatment lines (default gap 90d), queryable like any other event
      const lSqls = lineCatalogSqls(DB, STUDY);
      const [lStats, lCombos] = [await chQuery(lSqls.stats), await chQuery(lSqls.combos)];
      const types = [...tRes.data, { t: LINE_TYPE, n_pat: lStats.data[0].n_pat, n_ev: lStats.data[0].n_ev }];
      values[LINE_TYPE] = {
        LINE_NO: ["1", "2", "3", "4", "5"],
        COMPOSITION: lCombos.data.map(r => r.combo),
        GAP: ["30", "60", "90", "180"]
      };
      keys[LINE_TYPE] = ["LINE_NO", "COMPOSITION", "GAP"];
      cache = { study: STUDY, portal: PORTAL, totalPatients, hasPriorMedFlag, types, values, keys };
    }
    return Response.json(cache);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
