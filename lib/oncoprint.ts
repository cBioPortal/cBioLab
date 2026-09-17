// OncoprintSpec -> render contract engine.
// Spec (v1 subset): { cohort: {dsl}|null, genes: [..], clinical: [..],
//   derivedEvents: [{label, expression}], layout: {groupBy: {kind:'cohorts', groups:[{name,dsl}]}|null},
//   conventions: {lineGap} }
// Contract: sorted columns, typed cells (bitmask for gene tracks, NOT_PROFILED = -1),
//   panel-aware track frequencies, group ranges. The renderer does zero data logic.
import { chQuery, chQueryRows, DB, STUDY, PRIMARY, type ChConn } from "./ch.ts";
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
import { buildAnnotationIndex, oncokbPin } from "./annotation.ts";
import { compileCohortDef } from "./cohort2.ts";
import { wardOrder, CLUSTER_LIMIT } from "./oncoprint-cluster.ts";

import { assembleContract, normalizeDisplay, normalizeSort, type AssembleInput, type EventRow } from "./oncoprint-assemble.ts";
import { normalizeGeneTracks, toGeneList } from "./gene-tracks.ts";
export { normalizeDisplay, normalizeSort } from "./oncoprint-assemble.ts";

const GENE_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

/**
 * Columns for a cohort. A cohort is always a set of PATIENTS — that is what the DSL selects —
 * so sample mode wraps it: the columns are every sample of those patients, including samples
 * on which the cohort's own criterion was never measured. The portal does the same, and the
 * contract says so in its conventions.
 */
export function cohortColumnsSql(dsl: PidsCarrier | null | undefined, study: string, db: string, unit: Unit, pin?: string | null): string {
  const pids = cohortPatientsSql(dsl, study, db, pin);
  if (unit === "patient") return pids;
  const prefix = study + "_";
  return "SELECT DISTINCT replaceOne(sd.sample_unique_id, " + sq(prefix) + ", '') AS pid\n" +
    "FROM " + db + ".sample_derived sd\n" +
    "WHERE sd.cancer_study_identifier = " + sq(study) + "\n" +
    "  AND replaceOne(sd.patient_unique_id, " + sq(prefix) + ", '') IN (\n" + pids + "\n)\n" +
    "ORDER BY pid";
}

/**
 * A cohort's columns as SQL. `pin` is the OncoKB release an `OQL ... DRIVER` clause joins
 * against: the analysis layer resolves it once and passes it down, and so must this engine —
 * a spec that travels to a client and comes back carries the DEFINITION, not the compiled SQL,
 * so it is recompiled here and would otherwise be refused for want of a pin.
 */
export function cohortPatientsSql(dsl: PidsCarrier | null | undefined, study: string = STUDY, db: string = DB, pin?: string | null): string {
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
  if (dsl && Array.isArray((dsl as { all?: unknown }).all)) return compileCohortDef(dsl as CohortDef, { study, db, oncokbPin: pin });
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
  log?: ContractOpts["log"], label = "oncoprint:columns", db: string = DB, unit: Unit = "patient", pin?: string | null,
  conn: ChConn = PRIMARY): Promise<string[]> {
  const sql = cohortColumnsSql(dsl, study, db, unit, pin);
  const entry = { label, sql, study } as { label: string; sql: string; ms?: number; study?: string };
  if (log) log.push(entry);
  const r = await chQueryRows(sql, conn);
  entry.ms = r._ms;
  return r.rows.map((x) => x[0] as string);
}

/**
 * `unit` decides what a column is. Everything below is stored per SAMPLE; patient mode is the
 * one that has to collapse — which is why sample mode removes joins rather than adding them.
 */
export type Unit = "patient" | "sample";
/** the id column for a unit, stripped of the study prefix that qualifies it in the warehouse */
const idCol = (unit: Unit, prefix: string, alias = ""): string =>
  "replaceOne(" + alias + (unit === "sample" ? "sample_unique_id" : "patient_unique_id") + ", " + sq(prefix) + ", '')";

export function genomicEventsSql(genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient"): string {
  const puidPrefix = study + "_";
  return "SELECT " + idCol(unit, puidPrefix) + " AS pid,\n" +
    "       hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt,\n" +
    "       mutation_variant AS mv, cna_alteration AS cna\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")";
}

/**
 * One row per patient: a bitmask over the queried gene list, bit i set when some panel of
 * that patient covers genes[i]. An integer per patient instead of an array of gene names —
 * at 400k patients that is the difference between a few megabytes and a few hundred kilobytes.
 */
export function coverageSql(genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient"): string {
  const puidPrefix = study + "_";
  const list = "[" + genes.map(sq).join(",") + "]";
  // panels are recorded per sample; patient mode joins out to the patient, sample mode does not
  return "SELECT " + (unit === "sample" ? idCol(unit, puidPrefix, "sp.") : idCol(unit, puidPrefix, "sd.")) + " AS pid,\n" +
    "       toUInt32(groupBitOr(bitShiftLeft(toUInt32(1), toUInt8(indexOf(" + list + ", pg.gene) - 1)))) AS mask\n" +
    "FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + genes.map(sq).join(",") + ")\n" +
    (unit === "sample" ? "" : "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n") +
    "WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "GROUP BY pid";
}

export function clinicalSql(attrs: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient"): string {
  const puidPrefix = study + "_";
  const inAttrs = "attribute_name IN (" + attrs.map(sq).join(",") + ") AND attribute_value != ''";
  if (unit === "sample")
    // sample-level rows are exact; patient-level rows broadcast to each of that patient's
    // samples (a patient's stage is the stage of every sample of theirs)
    return "SELECT replaceOne(sd.sample_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
      "       cd.attribute_name AS k, argMax(cd.attribute_value, cd.type = 'sample') AS v\n" +
      "FROM " + db + ".clinical_data_derived cd\n" +
      "JOIN " + db + ".sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id\n" +
      "  AND (cd.type = 'patient' OR cd.sample_unique_id = sd.sample_unique_id)\n" +
      "WHERE cd.cancer_study_identifier = " + sq(study) + " AND cd." + inAttrs + "\n" +
      "GROUP BY pid, k";
  // patient-level rows win; sample-level attributes (e.g. CANCER_TYPE in MSK studies)
  // fall back to one of the patient's sample values via argMax
  return "SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       attribute_name AS k, argMax(attribute_value, type = 'patient') AS v\n" +
    "FROM " + db + ".clinical_data_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "  AND " + inAttrs + "\n" +
    "GROUP BY pid, k";
}

// per-study molecular-profile inventory (validation for heatmap tracks)
const _profCache = new Map<string, Set<string>>();
async function studyProfileTypes(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<Set<string>> {
  const key = conn.id + "." + db + "." + study;
  if (_profCache.has(key)) return _profCache.get(key)!;
  const r = await chQuery("SELECT DISTINCT profile_type FROM " + db + ".genetic_alteration_derived WHERE cancer_study_identifier = " + sq(study), conn);
  const set = new Set((r.data as ChRow[]).map((x) => x.profile_type));
  _profCache.set(key, set);
  return set;
}

// synthetic "VAF" heatmap profile: variant allele fraction from mutation allele
// counts (the portal's "Variant Allele Frequency in Selected Mutations Profile").
// Patient-level value = max across the patient's mutations in the gene.
const _vafCache = new Map<string, boolean>();
async function vafAvailable(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<boolean> {
  const key = conn.id + "." + db + "." + study;
  if (_vafCache.has(key)) return _vafCache.get(key)!;
  const r = await chQuery("SELECT 1 FROM " + db + ".mutation_derived WHERE studyId = " + sq(study) + " AND tumorAltCount > 0 LIMIT 1", conn);
  const ok = r.data.length > 0;
  _vafCache.set(key, ok);
  return ok;
}
export function vafSql(genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient"): string {
  return "SELECT " + (unit === "sample" ? "sampleId" : "patientId") + " AS pid, `GENE.hugoGeneSymbol` AS gene,\n" +
    "       max(tumorAltCount / (tumorAltCount + tumorRefCount)) AS v\n" +
    "FROM " + db + ".mutation_derived\n" +
    "WHERE studyId = " + sq(study) + " AND `GENE.hugoGeneSymbol` IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND tumorAltCount > 0 AND tumorRefCount >= 0\n" +
    "GROUP BY pid, gene";
}

// patient-level continuous values for heatmap tracks (columns are patients, so
// multi-sample patients get the mean across their samples — stated in the label)
export function heatmapSql(profileType: string, genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient"): string {
  // values are stored per sample; only patient mode has to average them
  return "SELECT " + (unit === "sample" ? "replaceOne(ga.sample_unique_id, " + sq(study + "_") + ", '')" : "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')") + " AS pid,\n" +
    "       ga.hugo_gene_symbol AS gene, avg(toFloat64OrNull(ga.alteration_value)) AS v\n" +
    "FROM " + db + ".genetic_alteration_derived ga\n" +
    (unit === "sample" ? "" : "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n") +
    "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "  AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND toFloat64OrNull(ga.alteration_value) IS NOT NULL\n" +
    "GROUP BY pid, gene";
}

export function normalizeSpec(spec: OncoprintSpec) {
  // `geneList` is the rows (a symbol, or a merged group); `genes` is the flat symbol list every
  // query and the coverage mask are built from. One normalizer owns both, and the assembler runs
  // the same one on `geneList`, so the mask's bit order cannot disagree with the SQL's.
  const { tracks: geneTracks, symbols: genes } = normalizeGeneTracks(spec.genes || []);
  if (!genes.length) throw new Error("at least one valid gene symbol required");
  const geneList = toGeneList(geneTracks);
  const clinical = (spec.clinical || []).map(String).slice(0, 8);
  const derivedEvents = (spec.derivedEvents || []).slice(0, 3);
  const lineGap = spec.conventions && spec.conventions.lineGap ? Number(spec.conventions.lineGap) : 90;
  // sort: ordered track keys — "genomic" (staircase), a clinical/derived/heatmap
  // track label, or "-label" for descending. Default is the genomic staircase.
  const sort = normalizeSort(spec.sort);
  // heatmap: continuous per-gene molecular-profile tracks (portal-style).
  // [{profileType, genes?}] — genes default to the spec's gene tracks.
  const heatmap = (Array.isArray(spec.heatmap) ? spec.heatmap : []).slice(0, 4).map((h: HeatmapSpec) => ({
    profileType: String(h && h.profileType || ""),
    reference: h && h.reference === "federation" ? "federation" as const : "cohort" as const,
    genes: (Array.isArray(h?.genes) && h.genes!.length ? h.genes! : genes)
      .map((g: string) => String(g).toUpperCase().trim()).filter((g: string) => GENE_RE.test(g)).slice(0, 12)
  })).filter((h) => h.profileType);
  const unit: Unit = spec.unit === "sample" ? "sample" : "patient";
  // overlays: thresholded molecular evidence drawn into the gene cells (mRNA outline,
  // protein bars) rather than as tracks of their own — the portal's ±2 z-score rule
  const overlays = (Array.isArray(spec.overlays) ? spec.overlays : []).slice(0, 2).map((o) => {
    const kind = o && o.kind === "protein" ? "protein" as const : "mrna" as const;
    const profileType = String((o && o.profileType) || "");
    const threshold = Number(o && o.threshold);
    return { kind, profileType, threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 2 };
  }).filter((o) => o.profileType);
  return { genes, geneList, clinical, derivedEvents, lineGap, sort, heatmap, unit, overlays, display: normalizeDisplay(spec.display) };
}

// Provenance: the exact SQL a spec compiles to, without executing anything.
export function specToQueries(spec: OncoprintSpec, pin?: string | null) {
  const study = (spec.study || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
  const { genes, clinical, derivedEvents, lineGap, unit } = normalizeSpec(spec);
  const queries: { label: string; sql: string }[] = [];
  const gb = spec.layout && spec.layout.groupBy;
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    for (const g of gb.groups.slice(0, 4))
      queries.push({ label: "column group \u201c" + (g.name || "group") + "\u201d \u2014 cohort " + unit + "s", sql: cohortColumnsSql({ ...g.dsl, lineGap }, study, DB, unit, pin) });
  } else {
    const listN = spec.cohort && spec.cohort.dsl && Array.isArray(spec.cohort.dsl.patients) ? spec.cohort.dsl.patients.length : 0;
    queries.push({ label: listN ? "explicit patient list (" + listN + " ids, intersected with the study)" : (spec.cohort ? "cohort " + unit + "s" : "all study " + unit + "s"),
      sql: cohortColumnsSql(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null, study, DB, unit, pin) });
  }
  queries.push({ label: "genomic events (mutations, CNA, SV) for the gene tracks", sql: genomicEventsSql(genes, study, DB, unit) });
  queries.push({ label: "panel coverage \u2014 the NOT_PROFILED cell source and frequency denominators", sql: coverageSql(genes, study, DB, unit) });
  if (clinical.length) queries.push({ label: "clinical attribute tracks", sql: clinicalSql(clinical, study, DB, unit) });
  for (const de of derivedEvents)
    queries.push({ label: "derived-event track \u201c" + (de.label || "derived event") + "\u201d \u2014 cohort-DSL patients", sql: cohortColumnsSql({ ...de.expression, lineGap }, study, DB, unit, pin) });
  return { genes, clinical, lineGap, queries };
}

/** Optional per-call sink so the analysis layer can report what this view ran. */
export interface ContractOpts {
  log?: { label: string; sql: string; ms?: number; study?: string }[];
  /** copy the query log into the contract, for callers that receive it directly */
  provenance?: boolean;
}

export async function buildContract(spec: OncoprintSpec, opts: ContractOpts = {}): Promise<Contract> {
  const t0 = Date.now();
  // Record a query the same way the resolvers do: pushed before the await and
  // stamped after, so concurrent fetches each update their own entry.
  // the four hot fetches read columns by index: no object per row, ~45% fewer bytes
  // A study's queries go to the instance that holds it, not merely to its database name: the
  // two differ the moment a peer lives on another host.
  const lqRows = async (label: string, sql: string, study?: string) => {
    const entry = { label, sql, ...(study ? { study } : {}) } as { label: string; sql: string; ms?: number; study?: string };
    if (opts.log) opts.log.push(entry);
    const r = await chQueryRows(sql, study ? connOf(study) : PRIMARY);
    entry.ms = r._ms;
    return r;
  };
  const lq = async <R = ChRow>(label: string, sql: string, study?: string) => {
    const entry = { label, sql, ...(study ? { study } : {}) } as { label: string; sql: string; ms?: number; study?: string };
    if (opts.log) opts.log.push(entry);
    const r = await chQuery<R>(sql, study ? connOf(study) : PRIMARY);
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
  // Resolved before any cohort compiles. A spec that travelled to a client and came back
  // carries the cohort DEFINITION, not compiled SQL, so an `OQL ... DRIVER` clause is compiled
  // here — and without the pin it would be refused for want of an annotation store.
  const pin = await oncokbPin();
  // Where each study actually lives. `spec.dbs` stays as an explicit override, but nothing ever
  // populated it, so every study fell back to the app's default database — and a study held by
  // another instance (GENIE beside the public portal) then matched no rows at all and surfaced
  // as "cohort is empty". Ask federation instead, which is the one place that knows.
  //
  // Imported dynamically on purpose: federation.ts imports this module's SQL builders, so a
  // static import here would close a cycle.
  const { studyRouting } = await import("./federation.ts");
  const routing = await studyRouting();
  const connOf = (s: string): ChConn => routing.get(s) || PRIMARY;
  const dbOf = (s: string): string =>
    String((spec.dbs || {})[s] || "").replace(/[^A-Za-z0-9_]/g, "") || connOf(s).db;
  const { genes, geneList, clinical, derivedEvents, lineGap, sort, heatmap, display, unit, overlays } = normalizeSpec(spec);
  if (multi && derivedEvents.length) throw new Error("derived-event tracks are single-study; drop them or the extra studies");
  if (unit === "sample" && derivedEvents.length)
    throw new Error("cohort rows are patient-level: a cohort selects patients, so drawing one per sample would repeat a patient's answer across their samples. Drop the rows or switch columns back to patients.");

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
          ({ s, r: await lqRows("oncoprint:columns", "SELECT pid FROM (\n" + (v as Record<string, string>)[s] + "\n)", s) })));
        for (const { s, r } of fetched)
          for (const x of r.rows) { const id = qual(s, x[0] as string); raw.push(id); studyOf.set(id, s); }
      } else {
        // no pre-compiled SQL: compile the definition against each study in turn
        const per = await Promise.all(studies.map(async (s) =>
          ({ s, pids: await cohortPatients({ ...g.dsl, lineGap }, s, opts.log, "oncoprint:columns", dbOf(s), unit, pin, connOf(s)) })));
        for (const { s, pids } of per) for (const p of pids) { const id = qual(s, p); raw.push(id); studyOf.set(id, s); }
      }
      const pids = raw.filter(p => !seen.has(p));
      pids.forEach(p => seen.add(p));
      groups.push({ name: g.name || "group " + (groups.length + 1), pids });
    }
  } else if (multi) {
    // no groups: every patient of every study, one column group, study order
    if (spec.cohort) throw new Error("multi-study oncoprint with a cohort requires cohort groups (layout.groupBy)");
    const fetched = await Promise.all(studies.map(async (s) =>
      ({ s, r: await lqRows("oncoprint:columns", cohortColumnsSql(null, s, dbOf(s), unit, pin), s) })));
    const pids: string[] = [];
    for (const { s, r } of fetched) for (const x of r.rows) { const id = qual(s, x[0] as string); pids.push(id); studyOf.set(id, s); }
    groups = [{ name: "all patients", pids }];
  } else {
    const pids = await cohortPatients(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null, study, opts.log, "oncoprint:columns", dbOf(study), unit, pin, connOf(study));
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
    Promise.all([lqRows("oncoprint:alterations", genomicEventsSql(genes, s, dbOf(s), unit), s),
                 lqRows("oncoprint:coverage", coverageSql(genes, s, dbOf(s), unit), s)]).then(([e, c]) => ({ s, e, c }))));
  for (const { s, e, c } of evFetched) {
    const pref = multi ? s + "_" : "";
    // column order is the SELECT's: pid, gene, vt, mt, mv, cna
    for (const r of e.rows) events.push({ pid: pref + (r[0] as string), gene: r[1] as string, vt: r[2] as string, mt: r[3] as string, mv: r[4] as string, cna: r[5] as string });
    for (const r of c.rows) coverage.push({ pid: pref + (r[0] as string), mask: Number(r[1]) });
  }
  // "annotate: none" is a deliberate choice to draw without driver calls; say so rather than
  // letting the figure look as though nothing was annotated
  const annotation = display.annotate === "none"
    ? { isDriver: () => false, source: "none — driver annotation turned off for this figure" }
    : await buildAnnotationIndex(events as Parameters<typeof buildAnnotationIndex>[0], genes, multi ? studies : study);

  // ---- clinical values per attribute -------------------------------------
  const clinicalIn: AssembleInput["clinical"] = [];
  if (clinical.length) {
    const byAttr = new Map<string, Map<string, string>>(clinical.map((a) => [a, new Map<string, string>()]));
    const cdFetched = await Promise.all(studies.map(async (s) =>
      ({ s, r: await lqRows("oncoprint:clinicalTracks", clinicalSql(clinical, s, dbOf(s), unit), s) })));
    // rows are (pid, k, v); bucket straight into per-attribute maps, no intermediate array
    for (const { s, r } of cdFetched) {
      const pref = multi ? s + "_" : "";
      for (const x of r.rows) { const m = byAttr.get(x[1] as string); if (m) m.set(pref + (x[0] as string), x[2] as string); }
    }
    for (const attr of clinical) clinicalIn.push({ attr, values: byAttr.get(attr)! });
  }

  // ---- heatmap values per profile (validated against each study's inventory) ----
  const heatmapIn: AssembleInput["heatmap"] = [];
  for (const h of heatmap) {
    const isVaf = /^vaf$/i.test(h.profileType);
    const avail = await Promise.all(studies.map(async (s) =>
      (isVaf ? await vafAvailable(s, dbOf(s), connOf(s)) : (await studyProfileTypes(s, dbOf(s), connOf(s))).has(h.profileType)) ? s : null));
    const okStudies = avail.filter((s): s is string => s !== null);
    if (!okStudies.length)
      throw new Error(isVaf
        ? "heatmap: 'VAF' needs mutation allele counts, which " + studies.join("/") + " did not load"
        : "heatmap: profile '" + h.profileType + "' not in " + studies.join("/") +
          " (available: " + ([...(await studyProfileTypes(studies[0], dbOf(studies[0]), connOf(studies[0])))].join(", ") || "none") + ", VAF)");
    const values = new Map<string, number>(); // columnId|gene -> value
    const hFetched = await Promise.all(okStudies.map(async (s) =>
      ({ s, r: await lqRows(isVaf ? "oncoprint:vaf" : "oncoprint:heatmap", isVaf ? vafSql(h.genes, s, dbOf(s), unit) : heatmapSql(h.profileType, h.genes, s, dbOf(s), unit), s) })));
    for (const { s, r } of hFetched)
      for (const row of r.rows) values.set(qual(s, row[0] as string) + "|" + (row[1] as string), Number(row[2]));
    heatmapIn.push({ profileType: h.profileType, genes: h.genes, isVaf, values });
  }

  // ---- clustering: an order computed here, once, from the molecular values ----
  // "cluster:<profileType>" orders columns by a Ward dendrogram over that profile's genes.
  // It runs where the values already are, so the SVG, the canvas, the CLI and Python all draw
  // the same order, and the order travels in the contract beside the numbers it describes.
  let clusterRank: Map<string, number> | undefined;
  const clusterKey = sort.find((k) => k.track.startsWith("cluster:"));
  if (clusterKey) {
    const profileType = clusterKey.track.slice("cluster:".length);
    const h = heatmapIn.find((x) => x.profileType === profileType);
    if (!h) throw new Error("sort: cluster needs '" + profileType + "' as a heatmap profile on this oncoprint" +
      (heatmapIn.length ? " (it has " + heatmapIn.map((x) => x.profileType).join(", ") + ")" : " (it has none)"));
    if (allPids.length > CLUSTER_LIMIT)
      throw new Error("clustering " + allPids.length.toLocaleString() + " columns is a quadratic computation; the limit is " +
        CLUSTER_LIMIT.toLocaleString() + ". Narrow the cohort, or sort by one of the profile's gene tracks instead.");
    const columns = h.genes.map((g) => {
      const col = new Float64Array(allPids.length);
      for (let i = 0; i < allPids.length; i++) {
        const v = h.values.get(allPids[i] + "|" + g);
        col[i] = v === undefined ? NaN : v;
      }
      return col;
    });
    const order = wardOrder({ columns, n: allPids.length });
    clusterRank = new Map<string, number>();
    order.forEach((idx, rank) => clusterRank!.set(allPids[idx], rank));
    clusterKey.track = "cluster";
  }

  // ---- molecular overlays: values thresholded into the gene cells ---------
  const overlaysIn: AssembleInput["overlays"] = [];
  for (const ov of overlays) {
    const avail = await Promise.all(studies.map(async (s) => (await studyProfileTypes(s, dbOf(s))).has(ov.profileType) ? s : null));
    const okStudies = avail.filter((s): s is string => s !== null);
    if (!okStudies.length)
      throw new Error("overlay: profile '" + ov.profileType + "' not in " + studies.join("/") +
        " (available: " + ([...(await studyProfileTypes(studies[0], dbOf(studies[0])))].join(", ") || "none") + ")");
    const values = new Map<string, number>();
    const fetched = await Promise.all(okStudies.map(async (s) =>
      ({ s, r: await lqRows("oncoprint:overlay " + ov.kind, heatmapSql(ov.profileType, genes, s, dbOf(s), unit), s) })));
    for (const { s, r } of fetched)
      for (const row of r.rows) values.set(qual(s, row[0] as string) + "|" + (row[1] as string), Number(row[2]));
    overlaysIn.push({ kind: ov.kind, profileType: ov.profileType, threshold: ov.threshold, values });
  }

  // ---- derived-event rows (cohort-DSL expressions as phenotypes) ---------
  const derivedIn: AssembleInput["derived"] = [];
  for (const de of derivedEvents)
    derivedIn.push({ label: de.label, pids: new Set<string>(await cohortPatients({ ...de.expression, lineGap }, study, opts.log, "oncoprint:derivedEvent", dbOf(study), unit, pin)) });

  const queryMs = Date.now() - t0;
  const tAsm = Date.now();
  const contract = assembleContract({
    genes: geneList, groups, studies, studyOf, events, coverage,
    isDriver: (r) => annotation.isDriver(r as Parameters<typeof annotation.isDriver>[0]), annotationSource: annotation.source,
    clinical: clinicalIn, heatmap: heatmapIn, overlays: overlaysIn, zReference: spec.zReference, derived: derivedIn, sort, lineGap, display, unit, clusterRank
  });
  contract.stats.ms = Date.now() - t0;
  contract.stats.queryMs = queryMs;
  contract.stats.assembleMs = Date.now() - tAsm;
  if (opts.provenance && opts.log) contract.queries = opts.log.map((q) => ({ ...q, study: q.study || study }));
  return contract;
}
