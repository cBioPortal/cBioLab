// Analysis-document engine: evaluate named cohorts (DSL v2) and produce view results.
// Document: { cohorts: {name: def}, views: [{kind, ...}] }  (study fixed by server config)
import { chQuery, DB, STUDY } from "./ch.js";
import { sq } from "./compiler.js";
import { compileCohortDef, describeCohortDef } from "./cohort2.js";
import { genomicEventsSql, coverageSql, buildContract, PIDS_SQL } from "./oncoprint.js";
import { buildAnnotationIndex } from "./annotation.js";
import { fisherExact, kaplanMeier } from "./stats.js";
import { contractToSvg } from "./oncoprint-svg.js";

async function oncokbPin() {
  try {
    const r = await chQuery(
      "SELECT oncokb_version FROM oncokb_annotation.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1");
    return r.data[0]?.oncokb_version || null;
  } catch { return null; }
}

const GENE_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

// Study profile inventory — cached per process. genetic_alteration_derived is
// PK-scoped by study (fast); for generic assays we use the small profile-entity
// mapping table (14.6M rows, PK on profile_stable_id) instead of scanning the
// 3.8B-row data table, deriving profile_type as the study-prefix-stripped suffix.
const _profileCache = new Map(); // per-study
async function studyProfiles(study) {
  if (_profileCache.has(study)) return _profileCache.get(study);
  const profiles = (await chQuery(
    "SELECT DISTINCT profile_type FROM " + DB + ".genetic_alteration_derived WHERE cancer_study_identifier = " + sq(study))).data.map(r => r.profile_type);
  const gaProfiles = (await chQuery(
    "SELECT DISTINCT replaceOne(profile_stable_id, " + sq(study + "_") + ", '') AS pt FROM " + DB + ".generic_assay_profile_entity_derived WHERE profile_stable_id LIKE " + sq(study + "_%"))).data.map(r => r.pt);
  const out = { profiles, gaProfiles };
  _profileCache.set(study, out);
  return out;
}

let _studySet = null;
export async function validStudies() {
  if (_studySet) return _studySet;
  const r = await chQuery("SELECT cancer_study_identifier AS id FROM " + DB + ".cancer_study");
  _studySet = new Set(r.data.map(x => x.id));
  return _studySet;
}

async function resolveStudy(requested) {
  const study = String(requested || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
  const set = await validStudies();
  if (!set.has(study)) throw new Error("unknown study '" + study.slice(0, 60) + "'");
  return study;
}

export async function runAnalysis(doc) {
  const t0 = Date.now();
  const study = await resolveStudy(doc.study);
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const { profiles, gaProfiles } = await studyProfiles(study);
  const names = Object.keys(doc.cohorts || {}).slice(0, 6);
  if (!names.length) throw new Error("document has no cohorts");

  // ---- evaluate cohorts -> pid lists ------------------------------------
  const cohorts = {};
  for (const name of names) {
    const def = doc.cohorts[name];
    const sql = compileCohortDef(def, { oncokbPin: pin, profiles, gaProfiles, study });
    const r = await chQuery("SELECT pid FROM (\n" + sql + "\n)");
    cohorts[name] = {
      pids: r.data.map(x => x.pid),
      count: r.data.length,
      text: describeCohortDef(def),
      sql
    };
  }

  // ---- views -------------------------------------------------------------
  const views = [];
  for (const view of (doc.views || []).slice(0, 6)) {
    const vNames = (view.cohorts && view.cohorts.length ? view.cohorts : names).filter(n => cohorts[n]);
    if (view.kind === "compare") {
      const genes = (view.genes || []).map(g => String(g).toUpperCase().trim()).filter(g => GENE_RE.test(g)).slice(0, 20);
      if (!genes.length) { views.push({ kind: "compare", error: "compare view needs genes" }); continue; }
      const ev = await chQuery(genomicEventsSql(genes, study));
      const cov = await chQuery(coverageSql(genes, study));
      const ann = await buildAnnotationIndex(ev.data, genes, study);
      // per (gene, pid): any / driver
      const per = new Map(); // gene -> Map(pid -> {any, driver})
      for (const g of genes) per.set(g, new Map());
      for (const r of ev.data) {
        const m = per.get(r.gene); if (!m) continue;
        if (r.vt === "cna" && Math.abs(Number(r.cna)) < 2) continue;
        const e = m.get(r.pid) || { any: false, driver: false };
        e.any = true;
        if (ann.isDriver(r)) e.driver = true;
        m.set(r.pid, e);
      }
      const covered = new Map(); // gene -> Set(pid)
      for (const g of genes) covered.set(g, new Set());
      for (const r of cov.data) covered.get(r.gene)?.add(r.pid);
      const rows = genes.map(g => {
        const m = per.get(g), covSet = covered.get(g);
        const cells = vNames.map(n => {
          const set = cohorts[n].pids;
          let profiled = 0, any = 0, driver = 0;
          for (const pid of set) {
            const isCov = covSet.has(pid), e = m.get(pid);
            if (isCov || e) profiled++;
            if (e) { any++; if (e.driver) driver++; }
          }
          return { cohort: n, profiled, any, driver,
            anyPct: profiled ? Math.round(1000 * any / profiled) / 10 : null,
            driverPct: profiled ? Math.round(1000 * driver / profiled) / 10 : null };
        });
        const row = { gene: g, cells };
        if (vNames.length === 2) {
          const [x, y] = cells;
          row.pAny = fisherExact(x.any, x.profiled - x.any, y.any, y.profiled - y.any);
          row.pDriver = fisherExact(x.driver, x.profiled - x.driver, y.driver, y.profiled - y.driver);
        }
        return row;
      });
      if (vNames.length === 2) rows.sort((a, b) => (a.pAny ?? 1) - (b.pAny ?? 1));
      views.push({ kind: "compare", cohorts: vNames, annotation: ann.source, rows });
    } else if (view.kind === "survival") {
      const os = await chQuery(
        "SELECT replaceOne(patient_unique_id, " + sq(study + "_") + ", '') AS pid,\n" +
        "       anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,\n" +
        "       anyIf(attribute_value, attribute_name='OS_STATUS') AS status\n" +
        "FROM " + DB + ".clinical_data_derived\n" +
        "WHERE cancer_study_identifier = " + sq(study) + " AND type='patient' AND attribute_name IN ('OS_MONTHS','OS_STATUS')\n" +
        "GROUP BY pid");
      const osMap = new Map(os.data.map(r => [r.pid, { t: parseFloat(r.months), event: String(r.status).startsWith("1") ? 1 : 0 }]));
      const curves = vNames.map(n => {
        const data = cohorts[n].pids.map(p => osMap.get(p)).filter(Boolean);
        return { cohort: n, ...kaplanMeier(data), missing: cohorts[n].count - data.length };
      });
      views.push({ kind: "survival", cohorts: vNames, curves,
        caveat: "OS from study baseline (sequencing-cohort left truncation applies); status '0:...' treated as censored." });
    } else if (view.kind === "oncoprint") {
      const genes = (view.genes || []).slice(0, 12);
      const contract = await buildContract({
        study,
        genes,
        clinical: view.clinical || [],
        derivedEvents: [],
        layout: { groupBy: { kind: "cohorts", groups: vNames.map(n => ({ name: n, dsl: { [PIDS_SQL]: cohorts[n].sql } })) } },
        conventions: { lineGap: 90 }
      });
      views.push({ kind: "oncoprint", cohorts: vNames, svg: contractToSvg(contract, 1200),
        genes: contract.tracks.filter(t => t.kind === "gene").map(t => ({ gene: t.label, driverPct: t.driverPct, anyPct: t.freqPct })),
        nColumns: contract.stats.nColumns, annotation: contract.conventions.annotation });
    } else {
      views.push({ kind: view.kind, error: "unknown view kind" });
    }
  }

  return {
    study, oncokbPin: pin,
    cohorts: Object.fromEntries(names.map(n => [n, {
      count: cohorts[n].count, text: cohorts[n].text, sql: cohorts[n].sql,
      pids: undefined // pid lists stay server-side except inside oncoprint contracts
    }])),
    views,
    stats: { ms: Date.now() - t0 }
  };
}
