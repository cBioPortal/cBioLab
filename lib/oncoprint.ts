// OncoprintSpec -> render contract engine.
// Spec (v1 subset): { cohort: {dsl}|null, genes: [..], clinical: [..],
//   derivedEvents: [{label, expression}], layout: {groupBy: {kind:'cohorts', groups:[{name,dsl}]}|null},
//   conventions: {lineGap} }
// Contract: sorted columns, typed cells (bitmask for gene tracks, NOT_PROFILED = -1),
//   panel-aware track frequencies, group ranges. The renderer does zero data logic.
import { chQuery, DB, STUDY } from "./ch.ts";
import { compileCohort, sq } from "./compiler.ts";
import { heatmapTrackLabel } from "./profile-names.ts";
import type { CohortDef, Contract, Track, GroupRange, OncoprintSpec, HeatmapSpec, ChRow } from "./types.ts";

// Internal-only: analysis.js passes an evaluated cohort's SQL as a subquery via this
// Symbol key. JSON.parse cannot produce Symbol keys, so client specs can never inject
// SQL through this path — and pid lists never get inlined as giant IN-lists (which
// exceeded max_query_size at ~48k patients).
export const PIDS_SQL: unique symbol = Symbol("pidsSql");
/**
 * A cohort reference carrying pre-compiled SQL under the PIDS_SQL symbol:
 * one string (single study) or a {study: sql} map (federated). JSON.parse
 * cannot produce symbol keys, so client specs can never inject through it.
 */
export type PidsCarrier = CohortDef & { [PIDS_SQL]?: string | Record<string, string> };
import { buildAnnotationIndex } from "./annotation.ts";
import { compileCohortDef } from "./cohort2.ts";

import { assembleContract, type AssembleInput, type EventRow } from "./oncoprint-assemble.ts";

const GENE_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

export function cohortPatientsSql(dsl: PidsCarrier | null | undefined, study: string = STUDY, db: string = DB): string {
  const pre = dsl?.[PIDS_SQL];
  if (typeof pre === "string") return pre;
  // SQL for a cohort's stable_ids (null dsl = every patient with a sample).
  // dsl.patients = explicit patient list (e.g. imported from a portal custom case
  // list / session); membership is intersected with the study so unknown ids drop out.
  if (dsl && Array.isArray(dsl.patients)) {
    const ids = dsl.patients.map(String).filter((p: string) => /^[A-Za-z0-9._-]{1,64}$/.test(p)).slice(0, 50000);
    if (!ids.length) throw new Error("patient list is empty or invalid");
    return "SELECT DISTINCT replaceOne(patient_unique_id, " + sq(study + "_") + ", '') AS pid\n" +
      "FROM " + db + ".sample_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + "\n" +
      "  AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (" + ids.map(sq).join(",") + ")\n" +
      "ORDER BY pid";
  }
  // DSL v2 definition ({all: [...]}) — the analysis document's cohort language
  if (dsl && Array.isArray((dsl as { all?: unknown }).all)) return compileCohortDef(dsl as CohortDef, { study, db });
  if (!dsl) {
    return "SELECT DISTINCT replaceOne(patient_unique_id, " + sq(study + "_") + ", '') AS pid\n" +
      "FROM " + db + ".sample_derived WHERE cancer_study_identifier = " + sq(study) + " ORDER BY pid";
  }
  const { patientsSql } = compileCohort({
    db, study, a: dsl.a!, b: dsl.b, rel: dsl.rel,
    priorGuard: !!dsl.priorGuard, lineGap: dsl.lineGap, patientsLimit: 1000000
  });
  return patientsSql;
}

async function cohortPatients(dsl: PidsCarrier | null | undefined, study: string,
  log?: ContractOpts["log"], label = "oncoprint:columns", db: string = DB): Promise<string[]> {
  const sql = cohortPatientsSql(dsl, study, db);
  const entry = { label, sql, study } as { label: string; sql: string; ms?: number; study?: string };
  if (log) log.push(entry);
  const r = await chQuery<ChRow>(sql);
  entry.ms = r._ms;
  return r.data.map((x) => x.pid);
}

export function genomicEventsSql(genes: string[], study: string = STUDY, db: string = DB): string {
  const puidPrefix = study + "_";
  return "SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt,\n" +
    "       mutation_variant AS mv, cna_alteration AS cna\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")";
}

// one row per patient: the queried genes any of the patient's panels cover
export function coverageSql(genes: string[], study: string = STUDY, db: string = DB): string {
  const puidPrefix = study + "_";
  return "SELECT replaceOne(sd.patient_unique_id, " + sq(puidPrefix) + ", '') AS pid, groupUniqArray(pg.gene) AS genes\n" +
    "FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + genes.map(sq).join(",") + ")\n" +
    "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "GROUP BY pid";
}

export function clinicalSql(attrs: string[], study: string = STUDY, db: string = DB): string {
  const puidPrefix = study + "_";
  // patient-level rows win; sample-level attributes (e.g. CANCER_TYPE in MSK studies)
  // fall back to one of the patient's sample values via argMax
  return "SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       attribute_name AS k, argMax(attribute_value, type = 'patient') AS v\n" +
    "FROM " + db + ".clinical_data_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "  AND attribute_name IN (" + attrs.map(sq).join(",") + ") AND attribute_value != ''\n" +
    "GROUP BY pid, k";
}

// per-study molecular-profile inventory (validation for heatmap tracks)
const _profCache = new Map<string, Set<string>>();
async function studyProfileTypes(study: string, db: string = DB): Promise<Set<string>> {
  const key = db + "." + study;
  if (_profCache.has(key)) return _profCache.get(key)!;
  const r = await chQuery("SELECT DISTINCT profile_type FROM " + db + ".genetic_alteration_derived WHERE cancer_study_identifier = " + sq(study));
  const set = new Set((r.data as ChRow[]).map((x) => x.profile_type));
  _profCache.set(key, set);
  return set;
}

// synthetic "VAF" heatmap profile: variant allele fraction from mutation allele
// counts (the portal's "Variant Allele Frequency in Selected Mutations Profile").
// Patient-level value = max across the patient's mutations in the gene.
const _vafCache = new Map<string, boolean>();
async function vafAvailable(study: string, db: string = DB): Promise<boolean> {
  const key = db + "." + study;
  if (_vafCache.has(key)) return _vafCache.get(key)!;
  const r = await chQuery("SELECT 1 FROM " + db + ".mutation_derived WHERE studyId = " + sq(study) + " AND tumorAltCount > 0 LIMIT 1");
  const ok = r.data.length > 0;
  _vafCache.set(key, ok);
  return ok;
}
export function vafSql(genes: string[], study: string = STUDY, db: string = DB): string {
  return "SELECT patientId AS pid, `GENE.hugoGeneSymbol` AS gene,\n" +
    "       max(tumorAltCount / (tumorAltCount + tumorRefCount)) AS v\n" +
    "FROM " + db + ".mutation_derived\n" +
    "WHERE studyId = " + sq(study) + " AND `GENE.hugoGeneSymbol` IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND tumorAltCount > 0 AND tumorRefCount >= 0\n" +
    "GROUP BY pid, gene";
}

// patient-level continuous values for heatmap tracks (columns are patients, so
// multi-sample patients get the mean across their samples — stated in the label)
export function heatmapSql(profileType: string, genes: string[], study: string = STUDY, db: string = DB): string {
  return "SELECT replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '') AS pid,\n" +
    "       ga.hugo_gene_symbol AS gene, avg(toFloat64OrNull(ga.alteration_value)) AS v\n" +
    "FROM " + db + ".genetic_alteration_derived ga\n" +
    "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "  AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND toFloat64OrNull(ga.alteration_value) IS NOT NULL\n" +
    "GROUP BY pid, gene";
}

export function normalizeSpec(spec: OncoprintSpec) {
  const genes = (spec.genes || []).map(g => String(g).toUpperCase().trim())
    .filter(g => GENE_RE.test(g)).slice(0, 12);
  if (!genes.length) throw new Error("at least one valid gene symbol required");
  const clinical = (spec.clinical || []).map(String).slice(0, 8);
  const derivedEvents = (spec.derivedEvents || []).slice(0, 3);
  const lineGap = spec.conventions && spec.conventions.lineGap ? Number(spec.conventions.lineGap) : 90;
  // sort: ordered track keys — "genomic" (staircase), a clinical/derived/heatmap
  // track label, or "-label" for descending. Default is the genomic staircase.
  const sort: { track: string; dir: "asc" | "desc" }[] = (Array.isArray(spec.sort) && spec.sort.length ? spec.sort : ["genomic"]).slice(0, 4).map((s: any) => {
    if (typeof s === "string") return s.startsWith("-") ? { track: s.slice(1), dir: "desc" as const } : { track: s, dir: "asc" as const };
    return { track: String(s && s.track || ""), dir: (s && s.dir === "desc" ? "desc" : "asc") as "asc" | "desc" };
  });
  // heatmap: continuous per-gene molecular-profile tracks (portal-style).
  // [{profileType, genes?}] — genes default to the spec's gene tracks.
  const heatmap = (Array.isArray(spec.heatmap) ? spec.heatmap : []).slice(0, 4).map((h: HeatmapSpec) => ({
    profileType: String(h && h.profileType || ""),
    reference: h && h.reference === "federation" ? "federation" as const : "cohort" as const,
    genes: (Array.isArray(h?.genes) && h.genes!.length ? h.genes! : genes)
      .map((g: string) => String(g).toUpperCase().trim()).filter((g: string) => GENE_RE.test(g)).slice(0, 12)
  })).filter((h) => h.profileType);
  return { genes, clinical, derivedEvents, lineGap, sort, heatmap };
}

// Provenance: the exact SQL a spec compiles to, without executing anything.
export function specToQueries(spec: OncoprintSpec) {
  const study = (spec.study || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
  const { genes, clinical, derivedEvents, lineGap } = normalizeSpec(spec);
  const queries: { label: string; sql: string }[] = [];
  const gb = spec.layout && spec.layout.groupBy;
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    for (const g of gb.groups.slice(0, 4))
      queries.push({ label: "column group \u201c" + (g.name || "group") + "\u201d \u2014 cohort patients", sql: cohortPatientsSql({ ...g.dsl, lineGap }, study) });
  } else {
    const listN = spec.cohort && spec.cohort.dsl && Array.isArray(spec.cohort.dsl.patients) ? spec.cohort.dsl.patients.length : 0;
    queries.push({ label: listN ? "explicit patient list (" + listN + " ids, intersected with the study)" : (spec.cohort ? "cohort patients" : "all study patients"),
      sql: cohortPatientsSql(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null, study) });
  }
  queries.push({ label: "genomic events (mutations, CNA, SV) for the gene tracks", sql: genomicEventsSql(genes, study) });
  queries.push({ label: "panel coverage \u2014 the NOT_PROFILED cell source and frequency denominators", sql: coverageSql(genes, study) });
  if (clinical.length) queries.push({ label: "clinical attribute tracks", sql: clinicalSql(clinical, study) });
  for (const de of derivedEvents)
    queries.push({ label: "derived-event track \u201c" + (de.label || "derived event") + "\u201d \u2014 cohort-DSL patients", sql: cohortPatientsSql({ ...de.expression, lineGap }, study) });
  return { genes, clinical, lineGap, queries };
}

/** Optional per-call sink so the analysis layer can report what this view ran. */
export interface ContractOpts { log?: { label: string; sql: string; ms?: number; study?: string }[] }

export async function buildContract(spec: OncoprintSpec, opts: ContractOpts = {}): Promise<Contract> {
  const t0 = Date.now();
  // Record a query the same way the resolvers do: pushed before the await and
  // stamped after, so concurrent fetches each update their own entry.
  const lq = async <R = ChRow>(label: string, sql: string, study?: string) => {
    const entry = { label, sql, ...(study ? { study } : {}) } as { label: string; sql: string; ms?: number; study?: string };
    if (opts.log) opts.log.push(entry);
    const r = await chQuery<R>(sql);
    entry.ms = r._ms;
    return r;
  };
  const study = (spec.study || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
  // Federation: spec.studies = [..] makes this a multi-study contract. Columns are
  // then keyed by qualified ids ("<study>_<pid>") so id collisions across studies
  // stay distinct columns (overlap is deliberately NOT deduplicated), and every
  // per-study fetch below loops the study list. Single-study behavior is unchanged.
  const studies = (Array.isArray(spec.studies) && spec.studies.length ? spec.studies : [study])
    .map(s => String(s).replace(/[^A-Za-z0-9._-]/g, ""));
  const multi = studies.length > 1;
  const qual = (s: string, pid: string): string => multi ? s + "_" + pid : pid;
  // per-study database on the same instance (e.g. a GENIE release next to the public portal);
  // studies not listed live in the app's default database
  const dbOf = (s: string): string => String((spec.dbs || {})[s] || "").replace(/[^A-Za-z0-9_]/g, "") || DB;
  const { genes, clinical, derivedEvents, lineGap, sort, heatmap } = normalizeSpec(spec);
  if (multi && derivedEvents.length) throw new Error("derived-event tracks are single-study; drop them or the extra studies");

  // ---- columns: groups of patients --------------------------------------
  let groups: { name: string; pids: string[] }[]; // [{name, pids: [columnId]}] — a patient lands in its first matching group
  const studyOf = new Map<string, string>(); // columnId -> study (avoids prefix-ambiguity parsing)
  const gb = spec.layout && spec.layout.groupBy;
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    groups = [];
    const seen = new Set<string>();
    for (const g of gb.groups.slice(0, 4)) {
      const v = (g.dsl as PidsCarrier | undefined)?.[PIDS_SQL];
      const raw: string[] = [];
      if (v && typeof v === "object") {
        // federated group: {study: sql} map from analysis.js — fetch per study in
        // parallel, merge in study order (deterministic column order)
        const fetched = await Promise.all(studies.filter((s) => typeof (v as Record<string, string>)[s] === "string").map(async (s) =>
          ({ s, r: await lq<ChRow>("oncoprint:columns", "SELECT pid FROM (\n" + (v as Record<string, string>)[s] + "\n)", s) })));
        for (const { s, r } of fetched)
          for (const x of r.data) { const id = qual(s, x.pid); raw.push(id); studyOf.set(id, s); }
      } else {
        for (const p of await cohortPatients({ ...g.dsl, lineGap }, studies[0], opts.log, "oncoprint:columns", dbOf(studies[0]))) {
          const id = qual(studies[0], p); raw.push(id); studyOf.set(id, studies[0]);
        }
      }
      const pids = raw.filter(p => !seen.has(p));
      pids.forEach(p => seen.add(p));
      groups.push({ name: g.name || "group " + (groups.length + 1), pids });
    }
  } else if (multi) {
    // no groups: every patient of every study, one column group, study order
    if (spec.cohort) throw new Error("multi-study oncoprint with a cohort requires cohort groups (layout.groupBy)");
    const fetched = await Promise.all(studies.map(async (s) =>
      ({ s, r: await lq<ChRow>("oncoprint:columns", cohortPatientsSql(null, s, dbOf(s)), s) })));
    const pids: string[] = [];
    for (const { s, r } of fetched) for (const x of r.data) { const id = qual(s, x.pid); pids.push(id); studyOf.set(id, s); }
    groups = [{ name: "all patients", pids }];
  } else {
    const pids = await cohortPatients(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null, study, opts.log, "oncoprint:columns", dbOf(study));
    for (const p of pids) studyOf.set(p, study);
    groups = [{ name: "cohort", pids }];
  }
  const allPids = groups.flatMap(g => g.pids);
  if (!allPids.length) throw new Error("cohort is empty");
const pidIndex = new Map<string, number>(allPids.map((p, i) => [p, i])); // provisional index

  // ---- genomic events + panel coverage, per study --------------------
  const events: EventRow[] = [];
  const coverage: AssembleInput["coverage"] = [];
  const evFetched = await Promise.all(studies.map(s =>
    Promise.all([lq<EventRow>("oncoprint:alterations", genomicEventsSql(genes, s, dbOf(s)), s),
                 lq<{ pid: string; genes: string[] }>("oncoprint:coverage", coverageSql(genes, s, dbOf(s)), s)]).then(([e, c]) => ({ s, e, c }))));
  for (const { s, e, c } of evFetched) {
    const pref = multi ? s + "_" : "";
    for (const r of e.data) { if (multi) r.pid = pref + r.pid; events.push(r); }
    for (const r of c.data) { if (multi) r.pid = pref + r.pid; coverage.push(r); }
  }
  const annotation = await buildAnnotationIndex(events as Parameters<typeof buildAnnotationIndex>[0], genes, multi ? studies : study);

  // ---- clinical values per attribute -------------------------------------
  const clinicalIn: AssembleInput["clinical"] = [];
  if (clinical.length) {
    const cd: { pid: string; k: string; v: string }[] = [];
    const cdFetched = await Promise.all(studies.map(async (s) =>
      ({ s, r: await lq<{ pid: string; k: string; v: string }>("oncoprint:clinicalTracks", clinicalSql(clinical, s, dbOf(s)), s) })));
    for (const { s, r } of cdFetched) { const pref = multi ? s + "_" : ""; for (const x of r.data) { if (multi) x.pid = pref + x.pid; cd.push(x); } }
    for (const attr of clinical) {
      const values = new Map<string, string>();
      for (const r of cd) if (r.k === attr) values.set(r.pid, r.v);
      clinicalIn.push({ attr, values });
    }
  }

  // ---- heatmap values per profile (validated against each study's inventory) ----
  const heatmapIn: AssembleInput["heatmap"] = [];
  for (const h of heatmap) {
    const isVaf = /^vaf$/i.test(h.profileType);
    const avail = await Promise.all(studies.map(async (s) =>
      (isVaf ? await vafAvailable(s, dbOf(s)) : (await studyProfileTypes(s, dbOf(s))).has(h.profileType)) ? s : null));
    const okStudies = avail.filter((s): s is string => s !== null);
    if (!okStudies.length)
      throw new Error(isVaf
        ? "heatmap: 'VAF' needs mutation allele counts, which " + studies.join("/") + " did not load"
        : "heatmap: profile '" + h.profileType + "' not in " + studies.join("/") +
          " (available: " + ([...(await studyProfileTypes(studies[0], dbOf(studies[0])))].join(", ") || "none") + ", VAF)");
    const values = new Map<string, number>(); // columnId|gene -> value
    const hFetched = await Promise.all(okStudies.map(async (s) =>
      ({ s, r: await lq(isVaf ? "oncoprint:vaf" : "oncoprint:heatmap", isVaf ? vafSql(h.genes, s, dbOf(s)) : heatmapSql(h.profileType, h.genes, s, dbOf(s)), s) })));
    for (const { s, r } of hFetched)
      for (const row of r.data) values.set(qual(s, row.pid) + "|" + row.gene, Number(row.v));
    heatmapIn.push({ profileType: h.profileType, genes: h.genes, isVaf, values });
  }

  // ---- derived-event rows (cohort-DSL expressions as phenotypes) ---------
  const derivedIn: AssembleInput["derived"] = [];
  for (const de of derivedEvents)
    derivedIn.push({ label: de.label, pids: new Set<string>(await cohortPatients({ ...de.expression, lineGap }, study, opts.log, "oncoprint:derivedEvent", dbOf(study))) });

  const contract = assembleContract({
    genes, groups, studies, studyOf, events, coverage,
    isDriver: (r) => annotation.isDriver(r as Parameters<typeof annotation.isDriver>[0]), annotationSource: annotation.source,
    clinical: clinicalIn, heatmap: heatmapIn, zReference: spec.zReference, derived: derivedIn, sort, lineGap
  });
  contract.stats.ms = Date.now() - t0;
  return contract;
}
