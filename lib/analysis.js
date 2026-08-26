// Analysis-document engine: evaluate named cohorts (DSL v2) and produce view results.
// Document: { study: "<default>", cohorts: {name: def}, views: [{kind, ...}] }
// A cohort may override with "study" or "studies": [...] — it is evaluated per study
// (compilers stay single-study) and members are unioned as fully-qualified patient ids
// ("<study>_<patient>"). Views fetch data per involved study and join on those ids.
// Deliberately deferred: cross-study patient dedup and attribute harmonization.
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

const _profileCache = new Map(); // per-study
export async function studyProfiles(study) {
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

export async function resolveStudy(requested, fallback) {
  const study = String(requested || fallback || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
  const set = await validStudies();
  if (!set.has(study)) throw new Error("unknown study '" + study.slice(0, 60) + "'");
  return study;
}

function cohortStudies(def, docStudy) {
  if (def && Array.isArray(def.studies) && def.studies.length) return def.studies.slice(0, 8);
  if (def && def.study) return [def.study];
  return [docStudy];
}

export async function runAnalysis(doc) {
  const t0 = Date.now();
  const docStudy = await resolveStudy(doc.study);
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const names = Object.keys(doc.cohorts || {}).slice(0, 6);
  if (!names.length) throw new Error("document has no cohorts");

  // ---- evaluate cohorts: per study, union fully-qualified members ---------
  const cohorts = {};
  for (const name of names) {
    const def = doc.cohorts[name];
    const studies = [];
    for (const s of cohortStudies(def, docStudy)) studies.push(await resolveStudy(s, docStudy));
    const members = new Set(); // "<study>_<pid>"
    const perStudy = {};       // study -> {sql, count}
    for (const s of studies) {
      const { profiles, gaProfiles } = await studyProfiles(s);
      const sql = compileCohortDef(def, { oncokbPin: pin, profiles, gaProfiles, study: s });
      const r = await chQuery("SELECT pid FROM (\n" + sql + "\n)");
      for (const x of r.data) members.add(s + "_" + x.pid);
      perStudy[s] = { sql, count: r.data.length };
    }
    cohorts[name] = {
      studies, members, perStudy,
      count: members.size,
      text: describeCohortDef(def) +
        (studies.length > 1 ? " — across " + studies.length + " studies" :
         studies[0] !== docStudy ? " — in " + studies[0] : "")
    };
  }
  const involved = [...new Set(Object.values(cohorts).flatMap(c => c.studies))];

  // ---- views --------------------------------------------------------------
  const views = [];
  for (const view of (doc.views || []).slice(0, 6)) {
    const vNames = (view.cohorts && view.cohorts.length ? view.cohorts : names).filter(n => cohorts[n]);
    const vStudies = [...new Set(vNames.flatMap(n => cohorts[n].studies))];

    if (view.kind === "compare") {
      const genes = (view.genes || []).map(g => String(g).toUpperCase().trim()).filter(g => GENE_RE.test(g)).slice(0, 20);
      if (!genes.length) { views.push({ kind: "compare", error: "compare view needs genes" }); continue; }
      // fetch events + coverage per involved study; key everything by full member id
      const evRows = [];
      const covPairs = new Map(); // gene -> Set(member)
      for (const g of genes) covPairs.set(g, new Set());
      for (const s of vStudies) {
        const ev = await chQuery(genomicEventsSql(genes, s));
        for (const r of ev.data) evRows.push({ ...r, member: s + "_" + r.pid });
        const cov = await chQuery(coverageSql(genes, s));
        for (const r of cov.data) covPairs.get(r.gene)?.add(s + "_" + r.pid);
      }
      const ann = await buildAnnotationIndex(evRows, genes, vStudies.length === 1 ? vStudies[0] : vStudies.join("+"));
      const per = new Map(); // gene -> Map(member -> {any, driver})
      for (const g of genes) per.set(g, new Map());
      for (const r of evRows) {
        const m = per.get(r.gene); if (!m) continue;
        if (r.vt === "cna" && Math.abs(Number(r.cna)) < 2) continue;
        const e = m.get(r.member) || { any: false, driver: false };
        e.any = true;
        if (ann.isDriver(r)) e.driver = true;
        m.set(r.member, e);
      }
      const rows = genes.map(g => {
        const m = per.get(g), covSet = covPairs.get(g);
        const cells = vNames.map(n => {
          let profiled = 0, any = 0, driver = 0;
          for (const member of cohorts[n].members) {
            const isCov = covSet.has(member), e = m.get(member);
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
      views.push({ kind: "compare", cohorts: vNames, annotation: ann.source, rows,
        ...(vStudies.length > 1 ? { note: "cross-study comparison (" + vStudies.join(", ") + "): denominators are per-study panel-aware; patient overlap across studies is NOT deduplicated" } : {}) });

    } else if (view.kind === "survival") {
      const osMap = new Map(); // member -> {t, event}
      for (const s of vStudies) {
        const os = await chQuery(
          "SELECT replaceOne(patient_unique_id, " + sq(s + "_") + ", '') AS pid,\n" +
          "       anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,\n" +
          "       anyIf(attribute_value, attribute_name='OS_STATUS') AS status\n" +
          "FROM " + DB + ".clinical_data_derived\n" +
          "WHERE cancer_study_identifier = " + sq(s) + " AND type='patient' AND attribute_name IN ('OS_MONTHS','OS_STATUS')\n" +
          "GROUP BY pid");
        for (const r of os.data) osMap.set(s + "_" + r.pid, { t: parseFloat(r.months), event: String(r.status).startsWith("1") ? 1 : 0 });
      }
      const curves = vNames.map(n => {
        const data = [...cohorts[n].members].map(m => osMap.get(m)).filter(Boolean);
        return { cohort: n, ...kaplanMeier(data), missing: cohorts[n].count - data.length };
      });
      views.push({ kind: "survival", cohorts: vNames, curves,
        caveat: "OS from each study's own baseline (left truncation applies" +
          (vStudies.length > 1 ? "; baselines are NOT harmonized across studies" : "") + "); status '0:...' treated as censored." });

    } else if (view.kind === "oncoprint") {
      const multi = vStudies.length > 1;
      const genes = (view.genes || []).slice(0, 12);
      // federated: each group carries a {study: sql} map; each cohort contributes
      // only the studies it was actually evaluated in
      const contract = await buildContract({
        study: vStudies[0],
        studies: vStudies,
        genes,
        clinical: view.clinical || [],
        derivedEvents: [],
        layout: { groupBy: { kind: "cohorts", groups: vNames.map(n => ({ name: n, dsl: {
          [PIDS_SQL]: multi
            ? Object.fromEntries(vStudies.filter(s => cohorts[n].perStudy[s]).map(s => [s, cohorts[n].perStudy[s].sql]))
            : cohorts[n].perStudy[vStudies[0]].sql
        } })) } },
        conventions: { lineGap: 90 }
      });
      views.push({ kind: "oncoprint", cohorts: vNames, svg: contractToSvg(contract, 1200),
        genes: contract.tracks.filter(t => t.kind === "gene").map(t => ({ gene: t.label, driverPct: t.driverPct, anyPct: t.freqPct })),
        nColumns: contract.stats.nColumns, annotation: contract.conventions.annotation,
        ...(multi ? { note: "cross-study oncoprint (" + vStudies.join(", ") + "): duplicate patients across studies appear as separate columns; clinical tracks merge attribute values by name without harmonization; the Study track shows each column's origin" } : {}) });
    } else {
      views.push({ kind: view.kind, error: "unknown view kind" });
    }
  }

  return {
    study: docStudy, involvedStudies: involved, oncokbPin: pin,
    cohorts: Object.fromEntries(names.map(n => [n, {
      count: cohorts[n].count, text: cohorts[n].text,
      studies: cohorts[n].studies,
      sql: Object.entries(cohorts[n].perStudy).map(([s, x]) => "-- " + s + "\n" + x.sql).join("\n\n-- UNION (federated at the analysis layer)\n\n")
    }])),
    views,
    stats: { ms: Date.now() - t0 }
  };
}
