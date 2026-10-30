// OncoprintSpec -> render contract engine.
// Spec (v1 subset): { cohort: {dsl}|null, genes: [..], clinical: [..],
//   derivedEvents: [{label, expression}], layout: {groupBy: {kind:'cohorts', groups:[{name,dsl}]}|null},
//   conventions: {lineGap} }
// Contract: sorted columns, typed cells (bitmask for gene tracks, NOT_PROFILED = -1),
//   panel-aware track frequencies, group ranges. The renderer does zero data logic.
import { chQuery, chQueryRows, DB, STUDY, PRIMARY, ensureChContext, registerChExternal, type ChConn } from "./ch.ts";
import { compileCohort, mutationStudySql, sq } from "./compiler.ts";
import type { CohortDef, Contract, ChRow } from "./types.ts";

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
export type PidsCarrier = CohortDef & { [PIDS_SQL]?: string | Record<string, string>; [PEER_STUDIES]?: string[] };
/**
 * Beside a {study: sql} map: the federation peers' studies the cohort spans. Their cohorts are not
 * compiled here — the peer evaluates the definition itself (StudyInputsRequest) — so they have no SQL
 * in the map, only their place in this list.
 */
export const PEER_STUDIES: unique symbol = Symbol("peerStudies");
import { buildAnnotationIndex, oncokbPin } from "./annotation.ts";
import { compileCohortDef, baseSamplesSql } from "./cohort2.ts";
import { wardOrder, CLUSTER_LIMIT } from "./oncoprint-cluster.ts";

import { PROFILED_TYPES, type ProfiledType } from "./profile-names.ts";
import { inGeneticAlterationDerived } from "./profile-catalog.ts";
import { assembleContract, normalizeDisplay, normalizeSort, type AssembleInput, type EventRow } from "./oncoprint-assemble.ts";
import { normalizeGeneTracks, toGeneList } from "./gene-tracks.ts";
import { clinicalTable, assertCustomDataPresent } from "./custom-data.ts";
import { finiteSql } from "./sql-number.ts";
import { ENTITY_RE, isCategoricalAssay } from "./generic-assay.ts";
import type { OncoprintSpec, HeatmapSpec } from "./views/oncoprint/types.ts";
export { normalizeDisplay, normalizeSort } from "./oncoprint-assemble.ts";

const GENE_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

/**
 * Columns for a cohort. A cohort is a set of SAMPLES (rows `(pid, sid)`): sample columns are
 * exactly its samples, patient columns their owners. A patient column's cells are built from
 * those samples only (columnSamplesSql), never from the patient's samples outside the cohort.
 */
export function cohortColumnsSql(dsl: PidsCarrier | null | undefined, study: string, db: string, unit: Unit, pin?: string | null): string {
  return columnsOfSql(cohortRowsSql(dsl, study, db, pin), unit);
}
/** a cohort's `(pid, sid)` rows as the column ids of `unit`, in the column `pid` the contract reads */
const columnsOfSql = (rowsSql: string, unit: Unit): string =>
  "SELECT DISTINCT " + (unit === "sample" ? "sid AS pid" : "pid") + " FROM (\n" + rowsSql + "\n) ORDER BY pid";

/**
 * A cohort's `(pid, sid)` rows as SQL. `pin` is the OncoKB release an `OQL ... DRIVER` clause joins
 * against: the analysis layer resolves it once and passes it down, and so must this engine —
 * a spec that travels to a client and comes back carries the DEFINITION, not the compiled SQL,
 * so it is recompiled here and would otherwise be refused for want of a pin.
 */
export function cohortRowsSql(dsl: PidsCarrier | null | undefined, study: string = STUDY, db: string = DB, pin?: string | null): string {
  const pre = dsl?.[PIDS_SQL];
  if (typeof pre === "string") return pre;
  // null dsl = every sample of the study.
  // DSL v2 definition ({all: [...]}) — the analysis document's cohort language,
  // including an explicit sample/patient list ({kind:"sampleList"|"patientList"}).
  if (dsl && Array.isArray((dsl as { all?: unknown }).all)) return compileCohortDef(dsl as CohortDef, { study, db, oncokbPin: pin });
  if (!dsl) return baseSamplesSql(study, db);
  // a v1 timeline expression selects patients: every sample of each
  const { patientsSql } = compileCohort({
    db, study, a: dsl.a!, b: dsl.b, rel: dsl.rel,
    priorGuard: !!dsl.priorGuard, lineGap: dsl.lineGap, patientsLimit: 1000000
  });
  return baseSamplesSql(study, db) + "\n    AND " + "replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM (\n" + patientsSql + "\n))";
}

/**
 * The bare sample ids patient columns are built from, as a subquery: each group's cohort
 * `(pid, sid)` rows, a patient taking the samples of the FIRST group it lands in (the group its
 * column is drawn in). null when every sample of the study counts (no cohort).
 */
function columnSamplesSql(groupRows: string[] | null): string | null {
  if (!groupRows || !groupRows.length) return null;
  return groupRows.map((g, i) => "SELECT sid FROM (\n" + g + "\n)" + (i === 0 ? "" :
    " WHERE pid NOT IN (" + groupRows.slice(0, i).map((e) => "SELECT pid FROM (\n" + e + "\n)").join(" UNION ALL ") + ")"))
    .join("\nUNION ALL\n");
}
/** a row's sample (`col`, a qualified sample id) is one the columns are built from */
const fromColumnSamples = (col: string, study: string, samples?: string | null): string =>
  samples ? "\n  AND replaceOne(" + col + ", " + sq(study + "_") + ", '') IN (" + samples + ")" : "";

/** A cohort's column ids (cohortRowsSql's rows, as `unit`), the query logged as `label`. */
async function cohortColumns(rowsSql: string, study: string,
  log?: ContractOpts["log"], label = "oncoprint:columns", unit: Unit = "patient",
  conn: ChConn = PRIMARY): Promise<ColumnRows> {
  const sql = columnRowsSql(rowsSql, unit);
  const entry = { label, sql, study } as { label: string; sql: string; ms?: number; study?: string };
  if (log) log.push(entry);
  const r = await chQueryRows(sql, conn);
  entry.ms = r._ms;
  return columnRows(r.rows);
}

/** a cohort's columns, in order, and each column's samples in the cohort */
interface ColumnRows { pids: string[]; samples: Map<string, string[]> }
/** a cohort's `(pid, sid)` rows as (column id, sample) pairs, ordered by column: the columns and the samples they are built from, in one read */
const columnRowsSql = (rowsSql: string, unit: Unit): string =>
  "SELECT DISTINCT " + (unit === "sample" ? "sid AS pid" : "pid") + ", sid FROM (\n" + rowsSql + "\n) ORDER BY pid, sid";
function columnRows(rows: unknown[][]): ColumnRows {
  const samples = new Map<string, string[]>();
  for (const [p, sid] of rows) {
    const list = samples.get(p as string);
    if (list) list.push(sid as string); else samples.set(p as string, [sid as string]);
  }
  return { pids: [...samples.keys()], samples };
}

/**
 * `unit` decides what a column is. Everything below is stored per SAMPLE; patient mode is the
 * one that has to collapse — which is why sample mode removes joins rather than adding them.
 * Each builder's optional `samples` (columnSamplesSql) narrows the rows to the samples the
 * columns are built from, so a patient column collapses only its samples in the cohort.
 */
export type Unit = "patient" | "sample";
/** the id column for a unit, stripped of the study prefix that qualifies it in the warehouse */
const idCol = (unit: Unit, prefix: string, alias = ""): string =>
  "replaceOne(" + alias + (unit === "sample" ? "sample_unique_id" : "patient_unique_id") + ", " + sq(prefix) + ", '')";

export function genomicEventsSql(genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  const puidPrefix = study + "_";
  return "SELECT " + idCol(unit, puidPrefix) + " AS pid,\n" +
    "       hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt,\n" +
    "       mutation_variant AS mv, cna_alteration AS cna\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND mutation_status != 'UNCALLED'" + // read support, not a call (lib/oql.ts specCond)
    fromColumnSamples("sample_unique_id", study, samples);
}

/**
 * One row per patient: a bitmask over the queried gene list, bit i set when some mutation, copy
 * number or structural variant panel of that patient covers genes[i] — the three kinds of event
 * a gene cell draws, so a cell is profiled when any of them was assayed (the portal's rule, and
 * the one the other views' denominators use). An integer per patient instead of an array of gene names —
 * at 400k patients that is the difference between a few megabytes and a few hundred kilobytes.
 */
export function coverageSql(genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  const puidPrefix = study + "_";
  const list = "[" + genes.map(sq).join(",") + "]";
  // panels are recorded per sample; patient mode joins out to the patient, sample mode does not
  return "SELECT " + (unit === "sample" ? idCol(unit, puidPrefix, "sp.") : idCol(unit, puidPrefix, "sd.")) + " AS pid,\n" +
    "       toUInt32(groupBitOr(bitShiftLeft(toUInt32(1), toUInt8(indexOf(" + list + ", pg.gene) - 1)))) AS mask\n" +
    "FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + genes.map(sq).join(",") + ")\n" +
    (unit === "sample" ? "" : "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n") +
    "WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')" +
    fromColumnSamples("sp.sample_unique_id", study, samples) + "\n" +
    "GROUP BY pid";
}

/**
 * One row per column: how many samples it has, and a bitmask over PROFILED_TYPES, bit i set when
 * some sample of the column is in a profile of that type whatever its genes — the portal's
 * "# Samples per Patient" and "Profiled for <type>" rows, from one scan.
 */
export function columnFactsSql(study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  const puidPrefix = study + "_";
  const types = PROFILED_TYPES.map(([t]) => sq(t)).join(",");
  return "SELECT " + idCol(unit, puidPrefix, "sd.") + " AS pid,\n" +
    "       uniqExact(sd.sample_unique_id) AS samples,\n" +
    "       toUInt8(groupBitOr(if(sp.alteration_type = '', 0, bitShiftLeft(toUInt8(1), toUInt8(indexOf([" + types + "], sp.alteration_type) - 1))))) AS mask\n" +
    "FROM " + db + ".sample_derived sd\n" +
    "LEFT JOIN (SELECT sample_unique_id, alteration_type FROM " + db + ".sample_to_gene_panel_derived\n" +
    "           WHERE cancer_study_identifier = " + sq(study) + " AND alteration_type IN (" + types + ")) sp ON sp.sample_unique_id = sd.sample_unique_id\n" +
    "WHERE sd.cancer_study_identifier = " + sq(study) + fromColumnSamples("sd.sample_unique_id", study, samples) + "\n" +
    "GROUP BY pid";
}

export function clinicalSql(attrs: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  const puidPrefix = study + "_";
  const inAttrs = "attribute_name IN (" + attrs.map(sq).join(",") + ") AND attribute_value != ''";
  if (unit === "sample")
    // sample-level rows are exact; patient-level rows broadcast to each of that patient's
    // samples (a patient's stage is the stage of every sample of theirs)
    return "SELECT replaceOne(sd.sample_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
      "       cd.attribute_name AS k, argMax(cd.attribute_value, cd.type = 'sample') AS v\n" +
      "FROM " + clinicalTable(db, attrs) + " cd\n" +
      "JOIN " + db + ".sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id\n" +
      "  AND (cd.type = 'patient' OR cd.sample_unique_id = sd.sample_unique_id)\n" +
      "WHERE cd.cancer_study_identifier = " + sq(study) + " AND cd." + inAttrs + "\n" +
      "GROUP BY pid, k";
  // patient-level rows win; sample-level attributes (e.g. CANCER_TYPE in MSK studies)
  // fall back to one of the patient's sample values (of its samples in the cohort) via argMax
  return "SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       attribute_name AS k, argMax(attribute_value, type = 'patient') AS v\n" +
    "FROM " + clinicalTable(db, attrs) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "  AND " + inAttrs +
    (samples ? "\n  AND (type = 'patient' OR replaceOne(sample_unique_id, " + sq(puidPrefix) + ", '') IN (" + samples + "))" : "") + "\n" +
    "GROUP BY pid, k";
}

// per-study molecular-profile inventory (validation for heatmap tracks)
const _profCache = new Map<string, Set<string>>();
async function studyProfileTypes(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<Set<string>> {
  const key = conn.id + "." + db + "." + study;
  if (_profCache.has(key)) return _profCache.get(key)!;
  const r = await chQuery("SELECT replaceOne(gp.stable_id, " + sq(study + "_") + ", '') AS pt, gp.genetic_alteration_type AS type\n" +
    "FROM " + db + ".genetic_profile gp JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study), conn);
  const set = new Set((r.data as ChRow[]).filter((x) => inGeneticAlterationDerived(String(x.type))).map((x) => String(x.pt)));
  _profCache.set(key, set);
  return set;
}

// per-study generic-assay profiles, by profile type: their datatype and whether a value is a patient's
const _assayCache = new Map<string, Map<string, { datatype: string; patientLevel: boolean }>>();
async function studyAssayProfiles(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<Map<string, { datatype: string; patientLevel: boolean }>> {
  const key = conn.id + "." + db + "." + study;
  if (_assayCache.has(key)) return _assayCache.get(key)!;
  const r = await chQuery("SELECT replaceOne(gp.stable_id, " + sq(study + "_") + ", '') AS pt, gp.datatype AS datatype, toInt32OrZero(ifNull(toString(gp.patient_level), '')) AS pl\n" +
    "FROM " + db + ".genetic_profile gp JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'GENERIC_ASSAY'", conn);
  const m = new Map((r.data as ChRow[]).map((x) => [String(x.pt), { datatype: String(x.datatype), patientLevel: Number(x.pl) === 1 }] as const));
  _assayCache.set(key, m);
  return m;
}

// synthetic "VAF" heatmap profile: variant allele fraction from mutation allele
// counts (the portal's "Variant Allele Frequency in Selected Mutations Profile").
// Patient-level value = max across the patient's mutations in the gene.
const _vafCache = new Map<string, boolean>();
async function vafAvailable(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<boolean> {
  const key = conn.id + "." + db + "." + study;
  if (_vafCache.has(key)) return _vafCache.get(key)!;
  const r = await chQuery("SELECT 1 FROM " + db + ".mutation_derived WHERE " + mutationStudySql(study) + " AND tumorAltCount > 0 LIMIT 1", conn);
  const ok = r.data.length > 0;
  _vafCache.set(key, ok);
  return ok;
}
export function vafSql(genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  return "SELECT " + (unit === "sample" ? "sampleId" : "patientId") + " AS pid, `GENE.hugoGeneSymbol` AS gene,\n" +
    "       max(tumorAltCount / (tumorAltCount + tumorRefCount)) AS v\n" +
    "FROM " + db + ".mutation_derived\n" +
    "WHERE " + mutationStudySql(study) + " AND `GENE.hugoGeneSymbol` IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND tumorAltCount > 0 AND tumorRefCount >= 0 AND molecularProfileId NOT LIKE '%uncalled%'\n" +
    (samples ? "  AND sampleId IN (" + samples + ")\n" : "") +
    "GROUP BY pid, gene";
}

// patient-level continuous values for heatmap tracks (columns are patients, so
// multi-sample patients get the mean across their samples — stated in the label)
export function heatmapSql(profileType: string, genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  // values are stored per sample; only patient mode has to average them
  return "SELECT " + (unit === "sample" ? "replaceOne(ga.sample_unique_id, " + sq(study + "_") + ", '')" : "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')") + " AS pid,\n" +
    "       ga.hugo_gene_symbol AS gene, avg(" + finiteSql("ga.alteration_value") + ") AS v\n" +
    "FROM " + db + ".genetic_alteration_derived ga\n" +
    (unit === "sample" ? "" : "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n") +
    "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "  AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND " + finiteSql("ga.alteration_value") + " IS NOT NULL" + fromColumnSamples("ga.sample_unique_id", study, samples) + "\n" +
    "GROUP BY pid, gene";
}

// A generic-assay profile's values for heatmap tracks, one row per (column, entity): a column's
// samples averaged in patient mode, and a patient-level assay's value given to each of the
// patient's samples in sample mode. Values that are not numbers are left out.
export function assayHeatmapSql(profileType: string, entities: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", patientLevel = false, samples?: string | null): string {
  const strip = (col: string) => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";
  const sampleLevel = unit === "sample" && patientLevel;
  return "SELECT " + (unit === "sample" ? strip(sampleLevel ? "sd.sample_unique_id" : "g.sample_unique_id") : strip("g.patient_unique_id")) + " AS pid,\n" +
    "       g.entity_stable_id AS gene, avg(" + finiteSql("g.value") + ") AS v\n" +
    "FROM " + db + ".generic_assay_data_derived g\n" +
    (sampleLevel ? "JOIN " + db + ".sample_derived sd ON sd.patient_unique_id = g.patient_unique_id\n" : "") +
    "WHERE g.profile_type = " + sq(profileType) + " AND g.profile_stable_id = " + sq(study + "_" + profileType) + "\n" +
    "  AND g.entity_stable_id IN (" + entities.map(sq).join(",") + ")\n" +
    "  AND " + finiteSql("g.value") + " IS NOT NULL" +
    // a patient-level row (the patient in both id columns) has no sample to test
    (samples && !patientLevel ? fromColumnSamples("g.sample_unique_id", study, samples) : "") + "\n" +
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
  // [{profileType, genes?}] — genes default to the spec's gene tracks. A generic-assay profile's
  // tracks are its `entities` instead, carried in `genes` from here on; `assay` marks them.
  const heatmap = (Array.isArray(spec.heatmap) ? spec.heatmap : []).slice(0, 4).map((h: HeatmapSpec) => {
    const entities = Array.isArray(h?.entities) ? h.entities.map((e) => String(e).trim()) : [];
    for (const e of entities) if (!ENTITY_RE.test(e)) throw new Error("heatmap: '" + e.slice(0, 60) + "' is not a generic-assay entity");
    if (entities.length > 12) throw new Error("heatmap: a profile draws at most 12 entities; this asks for " + entities.length);
    return {
      profileType: String(h && h.profileType || ""),
      reference: h && h.reference === "federation" ? "federation" as const : "cohort" as const,
      assay: entities.length > 0,
      genes: entities.length ? entities : (Array.isArray(h?.genes) && h.genes!.length ? h.genes! : genes)
        .map((g: string) => String(g).toUpperCase().trim()).filter((g: string) => GENE_RE.test(g)).slice(0, 12)
    };
  }).filter((h) => h.profileType);
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

/** The study a single-study spec draws: `studies` when it lists exactly one, else `study`. */
function specStudy(spec: OncoprintSpec): string {
  const listed = Array.isArray(spec.studies) && spec.studies.length === 1 ? spec.studies[0] : null;
  return String(listed || spec.study || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
}

// Provenance: the exact SQL a spec compiles to, without executing anything.
export function specToQueries(spec: OncoprintSpec, pin?: string | null) {
  const study = specStudy(spec);
  const { genes, clinical, derivedEvents, lineGap, unit } = normalizeSpec(spec);
  const queries: { label: string; sql: string }[] = [];
  const gb = spec.layout && spec.layout.groupBy;
  let groupRows: string[] | null = null;
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    groupRows = gb.groups.slice(0, 4).map((g) => cohortRowsSql({ ...g.dsl, lineGap }, study, DB, pin));
    gb.groups.slice(0, 4).forEach((g, i) =>
      queries.push({ label: "column group \u201c" + (g.name || "group") + "\u201d \u2014 cohort " + unit + "s", sql: columnsOfSql(groupRows![i], unit) }));
  } else {
    if (spec.cohort) groupRows = [cohortRowsSql({ ...spec.cohort.dsl, lineGap }, study, DB, pin)];
    queries.push({ label: spec.cohort ? "cohort " + unit + "s" : "all study " + unit + "s",
      sql: cohortColumnsSql(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null, study, DB, unit, pin) });
  }
  const samples = unit === "patient" ? columnSamplesSql(groupRows) : null;
  queries.push({ label: "genomic events (mutations, CNA, SV) for the gene tracks", sql: genomicEventsSql(genes, study, DB, unit, samples) });
  queries.push({ label: "panel coverage (mutation, copy number and structural variant panels) \u2014 the NOT_PROFILED cell source and frequency denominators", sql: coverageSql(genes, study, DB, unit, samples) });
  queries.push({ label: "samples per column and the alteration types it was profiled for \u2014 the \u201c# Samples per Patient\u201d and \u201cProfiled for\u201d rows", sql: columnFactsSql(study, DB, unit, samples) });
  if (clinical.length) queries.push({ label: "clinical attribute tracks", sql: clinicalSql(clinical, study, DB, unit, samples) });
  for (const de of derivedEvents)
    queries.push({ label: "derived-event track \u201c" + (de.label || "derived event") + "\u201d \u2014 cohort-DSL patients", sql: cohortColumnsSql({ ...de.expression, lineGap }, study, DB, unit, pin) });
  return { genes, clinical, lineGap, queries };
}

/** Optional per-call sink so the analysis layer can report what this view ran. */
export interface ContractOpts {
  log?: { label: string; sql: string; ms?: number; study?: string; remote?: boolean }[];
  /** copy the query log into the contract, for callers that receive it directly */
  provenance?: boolean;
}

/**
 * One study's share of an oncoprint, read where the study is held: its columns, and the rows the
 * contract is assembled from, each an array in its SELECT's column order. A federation peer that
 * shares oncoprint columns answers with this (its `oncoprint-columns` op), and the contract is
 * assembled from it beside this instance's own studies' rows, so the peer's patients are columns of
 * the same figure — sorted, counted and annotated with the rest.
 */
export interface StudyInputs {
  /** the genes the coverage masks' bits stand for, in bit order */
  genes: string[];
  /** each column group's column ids, a column in the first group that holds it ([] for a group the study is not in) */
  groups: string[][];
  /** pid, gene, vt, mt, mv, cna */
  events: unknown[][];
  /** pid, mask */
  coverage: unknown[][];
  /** pid, samples, mask */
  facts: unknown[][];
  /** pid, attribute, value */
  clinical: unknown[][];
  /**
   * per heatmap spec: the study's generic assay of that profile type, if it has one; whether it has
   * the profile as a gene profile (or, for VAF, allele counts); and the values a track would draw
   */
  heatmap: { assay: { datatype: string; patientLevel: boolean } | null; available: boolean; values: unknown[][] }[];
  /** per overlay spec: whether the study has the profile, and its values */
  overlays: { available: boolean; values: unknown[][] }[];
  /** the study's molecular profile types and numeric generic-assay profiles: what a missing profile is named against */
  profileTypes: string[];
  assays: string[];
  /** the queries that read it, unless the peer keeps its SQL to itself */
  queries?: { label: string; sql: string; ms?: number }[] | null;
}

/**
 * What one study's share is read for: the spec's parts that decide its rows, and each column group's
 * cohort definition — false for a group that holds none of the study's patients, and no groups at
 * all for every column of the study in one group.
 */
export interface StudyInputsRequest {
  groups: (CohortDef | false)[] | null;
  genes: OncoprintSpec["genes"]; clinical: string[]; heatmap: HeatmapSpec[]; overlays: NonNullable<OncoprintSpec["overlays"]>;
  unit: Unit; lineGap: number;
}

/** A federation peer that shares oncoprint columns (lib/federation-remote.ts). */
export interface OncoprintPeer { oncoprintInputs(req: StudyInputsRequest): Promise<StudyInputs> }

/**
 * Read one study's share of an oncoprint from `conn`, the instance holding it: the same queries the
 * contract runs for a study of its own, answered as rows instead of assembled.
 */
export function studyOncoprintInputs(study: string, conn: ChConn, req: StudyInputsRequest, pin: string | null): Promise<StudyInputs> {
  return ensureChContext(async () => {
    const { genes, clinical, heatmap, overlays, unit, lineGap } = normalizeSpec({ genes: req.genes, clinical: req.clinical,
      heatmap: req.heatmap, overlays: req.overlays, unit: req.unit, conventions: { lineGap: req.lineGap } });
    const queries: NonNullable<StudyInputs["queries"]> = [];
    const rows = async (label: string, sql: string): Promise<unknown[][]> => {
      const entry: { label: string; sql: string; ms?: number } = { label, sql };
      queries.push(entry);
      const r = await chQueryRows(sql, conn);
      entry.ms = r._ms;
      return r.rows;
    };
    const db = conn.db;
    // columns: each group's, a column in the first group that holds it, as the contract draws them
    const groups: string[][] = [];
    const groupRows: string[] = [], colSamples: string[] = [];
    if (req.groups) {
      const seen = new Set<string>();
      for (const def of req.groups.slice(0, 4)) {
        if (def === false) { groups.push([]); continue; }
        const rowsSql = cohortRowsSql({ ...def, lineGap }, study, db, pin);
        groupRows.push(rowsSql);
        const cols = columnRows(await rows("oncoprint:columns", columnRowsSql(rowsSql, unit)));
        const pids: string[] = [];
        for (const p of cols.pids) {
          if (seen.has(p)) continue;
          seen.add(p); pids.push(p); colSamples.push(...cols.samples.get(p)!);
        }
        groups.push(pids);
      }
    } else groups.push((await rows("oncoprint:columns", cohortColumnsSql(null, study, db, unit, pin))).map((x) => x[0] as string));
    const samples = unit === "patient" && groupRows.length ? columnSamplesIn(study, colSamples, groupRows) : null;
    const [events, coverage, facts, clinicalRows] = await Promise.all([
      rows("oncoprint:alterations", genomicEventsSql(genes, study, db, unit, samples)),
      rows("oncoprint:coverage", coverageSql(genes, study, db, unit, samples)),
      rows("oncoprint:profiledTypes", columnFactsSql(study, db, unit, samples)),
      clinical.length ? rows("oncoprint:clinicalTracks", clinicalSql(clinical, study, db, unit, samples)) : Promise.resolve([])
    ]);
    const types = await studyProfileTypes(study, db, conn);
    const assayProfiles = await studyAssayProfiles(study, db, conn);
    // each heatmap's values as the contract would take them from this study: an assay's when the
    // spec names entities and the assay is numeric, a gene profile's (or VAF) otherwise
    const heat: StudyInputs["heatmap"] = [];
    for (const h of heatmap) {
      const isVaf = /^vaf$/i.test(h.profileType);
      const a = isVaf ? undefined : assayProfiles.get(h.profileType);
      if (a) {
        heat.push({ assay: { datatype: a.datatype, patientLevel: a.patientLevel }, available: false,
          values: h.assay && !isCategoricalAssay(a.datatype)
            ? await rows("oncoprint:assay heatmap", assayHeatmapSql(h.profileType, h.genes, study, db, unit, a.patientLevel, samples)) : [] });
        continue;
      }
      const available = isVaf ? await vafAvailable(study, db, conn) : types.has(h.profileType);
      heat.push({ assay: null, available, values: available && !h.assay
        ? await rows(isVaf ? "oncoprint:vaf" : "oncoprint:heatmap", isVaf ? vafSql(h.genes, study, db, unit, samples) : heatmapSql(h.profileType, h.genes, study, db, unit, samples))
        : [] });
    }
    const over: StudyInputs["overlays"] = [];
    for (const ov of overlays) {
      const available = types.has(ov.profileType);
      over.push({ available, values: available ? await rows("oncoprint:overlay " + ov.kind, heatmapSql(ov.profileType, genes, study, db, unit, samples)) : [] });
    }
    return { genes, groups, events, coverage, facts, clinical: clinicalRows, heatmap: heat, overlays: over,
      profileTypes: [...types], assays: [...assayProfiles].filter(([, a]) => !isCategoricalAssay(a.datatype)).map(([pt]) => pt), queries };
  });
}

/**
 * A peer's StudyInputs as it arrived, checked field by field before any of it is drawn — a peer is
 * another program, not this one — for a request with `nGroups` groups.
 */
export function checkStudyInputs(x: unknown, nGroups: number): StudyInputs {
  const r = x as Record<string, unknown>;
  const bad = (what: string): never => { throw new Error("the peer sent oncoprint " + what + " this instance cannot read"); };
  const ids = (v: unknown): string[] => Array.isArray(v) && v.every((p) => typeof p === "string" && p.length <= 200) ? v as string[] : bad("column ids");
  const table = (v: unknown, width: number, what: string): unknown[][] =>
    Array.isArray(v) && v.every((row) => Array.isArray(row) && row.length === width && typeof row[0] === "string") ? v as unknown[][] : bad(what);
  const strings = (v: unknown, what: string): string[] => Array.isArray(v) && v.every((p) => typeof p === "string") ? v as string[] : bad(what);
  if (!r || typeof r !== "object") bad("rows");
  const groups = Array.isArray(r.groups) && r.groups.length === nGroups ? r.groups.map(ids) : bad("column groups");
  const heatmap = (Array.isArray(r.heatmap) ? r.heatmap : bad("heatmap tracks")).map((h: Record<string, unknown>) => {
    const a = h?.assay as Record<string, unknown> | null;
    return { assay: a ? { datatype: String(a.datatype), patientLevel: a.patientLevel === true } : null,
      available: h?.available === true, values: table(h?.values, 3, "heatmap values") };
  });
  const overlays = (Array.isArray(r.overlays) ? r.overlays : bad("overlays")).map((o: Record<string, unknown>) =>
    ({ available: o?.available === true, values: table(o?.values, 3, "overlay values") }));
  return { genes: strings(r.genes, "genes"), groups, events: table(r.events, 6, "alterations"), coverage: table(r.coverage, 2, "panel coverage"),
    facts: table(r.facts, 3, "column facts"), clinical: table(r.clinical, 3, "clinical values"), heatmap, overlays,
    profileTypes: strings(r.profileTypes, "profile types"), assays: strings(r.assays, "assay profiles") };
}

export function buildContract(spec: OncoprintSpec, opts: ContractOpts = {}): Promise<Contract> {
  // a request context carries the resolved column samples (columnSamplesIn) to every query
  return ensureChContext(() => buildContractIn(spec, opts));
}

/** the most column samples shipped as an external table; past it the queries read the definition */
const COLUMN_SAMPLES_EXTERNAL_LIMIT = 200_000;

/**
 * A study's column samples, already read off the column fetch, shipped with every later query as
 * an external table, so the cohort definitions — a timeline cohort is a heavy query — are evaluated
 * once, not inside each of the contract's data queries. The definition itself (columnSamplesSql)
 * when there is no request context to hold the table, or the list is too large to ship.
 */
function columnSamplesIn(study: string, sids: string[], groupRows: string[]): string | null {
  const table = "_op_samples_" + study.replace(/[^A-Za-z0-9_]/g, "_");
  if (sids.length <= COLUMN_SAMPLES_EXTERNAL_LIMIT && registerChExternal(
    { name: table, structure: "sid String", data: sids.length ? sids.map((x) => x.replace(/[\t\n\\]/g, "")).join("\n") + "\n" : "" }))
    return "SELECT sid FROM " + table;
  return columnSamplesSql(groupRows);
}

async function buildContractIn(spec: OncoprintSpec, opts: ContractOpts): Promise<Contract> {
  const t0 = Date.now();
  assertCustomDataPresent(spec);
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
  const study = specStudy(spec);
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
  // Where each study lives, asked of federation, the one place that knows. The columns are
  // patient (or sample) ids, so a study this deployment holds only in aggregate is refused, and
  // a study it does not route — unknown, or restricted — is refused rather than looked for on
  // the default connection.
  //
  // Imported dynamically on purpose: federation.ts imports this module's SQL builders, so a
  // static import here would close a cycle.
  // A study a federation peer holds is read there, when the peer shares oncoprint columns: one call
  // answers its whole share (StudyInputs), and every step below takes that study's rows from it.
  const { patientLevelConn, oncoprintPeerOf } = await import("./federation.ts");
  const peers = new Map<string, OncoprintPeer>();
  const conns = new Map<string, ChConn>();
  await Promise.all(studies.map(async (s) => {
    const peer = await oncoprintPeerOf(s);
    if (peer) peers.set(s, peer);
    else conns.set(s, await patientLevelConn(s, "an oncoprint's columns are patients"));
  }));
  const connOf = (s: string): ChConn => conns.get(s)!;
  const dbOf = (s: string): string => connOf(s).db;
  const { genes, geneList, clinical, derivedEvents, lineGap, sort, heatmap, display, unit, overlays } = normalizeSpec(spec);
  if (multi && derivedEvents.length) throw new Error("derived-event tracks are single-study; drop them or the extra studies");
  if (unit === "sample" && derivedEvents.length)
    throw new Error("cohort rows are patient-level: a cohort selects patients, so drawing one per sample would repeat a patient's answer across their samples. Drop the rows or switch columns back to patients.");
  if (derivedEvents.length && peers.has(study))
    throw new Error("derived-event rows are evaluated against the study's own database, and " + study + " is a federation peer's; drop the rows");

  const gb = spec.layout && spec.layout.groupBy;
  const gbGroups = gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length ? gb.groups.slice(0, 4) : null;
  const fromPeer = new Map<string, Promise<StudyInputs>>();
  for (const [s, peer] of peers) {
    // each group's definition, for the peer to evaluate; a group whose cohort was evaluated here
    // (a {study: sql} map) holds the peer's patients only when it spans the peer's study
    const groups = gbGroups ? gbGroups.map((g): CohortDef | false => {
      const c = g.dsl as PidsCarrier;
      return c[PIDS_SQL] && typeof c[PIDS_SQL] === "object" && !(c[PEER_STUDIES] || []).includes(s) ? false : c;
    }) : spec.cohort ? [spec.cohort.dsl] : null;
    const p = peer.oncoprintInputs({ groups, genes: spec.genes, clinical, heatmap: (spec.heatmap || []).slice(0, 4),
      overlays: (spec.overlays || []).slice(0, 2), unit, lineGap }).then((r) => {
      // drawn beside this instance's rows, so it must mean what they mean
      if (r.genes.join(",") !== genes.join(",") || r.heatmap.length !== heatmap.length || r.overlays.length !== overlays.length)
        throw new Error("the peer serving " + s + " read a different oncoprint than the one asked for; it is likely on another build");
      for (const q of r.queries || []) opts.log?.push({ label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}), study: s, remote: true });
      return r;
    });
    p.catch(() => { /* awaited below; a refusal fails the figure there */ });
    fromPeer.set(s, p);
  }
  const peerShare = (s: string): Promise<StudyInputs> => fromPeer.get(s)!;
  /** a peer study's rows in the shape a query's result has, so both are read by the same loops */
  const peerRows = async (s: string, pick: (i: StudyInputs) => unknown[][]) => ({ rows: pick(await peerShare(s)) });

  // ---- columns: groups of patients or samples ----------------------------
  let groups: { name: string; pids: string[] }[]; // [{name, pids: [columnId]}] — a column lands in its first matching group
  const studyOf = new Map<string, string>(); // columnId -> study (avoids prefix-ambiguity parsing)
  // each study's cohort rows per column group, in group order: what patient columns are built from
  const rowsByStudy = new Map<string, string[]>(studies.map((s) => [s, []]));
  // each study's samples its patient columns are built from: a column's samples in the group it is drawn in
  const columnSamples = new Map<string, string[]>(studies.map((s) => [s, []]));
  // a peer study's columns in a group, as the peer drew them (their samples stay with the peer)
  const peerColumns = async (s: string, gi: number): Promise<{ s: string; cols: ColumnRows }> =>
    ({ s, cols: { pids: (await peerShare(s)).groups[gi], samples: new Map() } });
  const inStudyOrder = <T extends { s: string }>(xs: T[]): T[] => studies.flatMap((s) => xs.filter((x) => x.s === s));
  if (gbGroups) {
    groups = [];
    const seen = new Set<string>();
    for (const [gi, g] of gbGroups.entries()) {
      const v = (g.dsl as PidsCarrier | undefined)?.[PIDS_SQL];
      let per: { s: string; cols: ColumnRows }[];
      if (v && typeof v === "object") {
        // federated group: {study: sql} map from analysis.js — fetch per study in
        // parallel, merge in study order (deterministic column order)
        const held = studies.filter((s) => typeof (v as Record<string, string>)[s] === "string");
        for (const s of held) rowsByStudy.get(s)!.push((v as Record<string, string>)[s]);
        per = await Promise.all(held.map(async (s) =>
          ({ s, cols: columnRows((await lqRows("oncoprint:columns", columnRowsSql((v as Record<string, string>)[s], unit), s)).rows) })));
      } else {
        // no pre-compiled SQL: compile the definition against each study in turn
        per = await Promise.all(studies.filter((s) => !peers.has(s)).map(async (s) => {
          const rows = cohortRowsSql({ ...g.dsl, lineGap }, s, dbOf(s), pin);
          rowsByStudy.get(s)!.push(rows);
          return { s, cols: await cohortColumns(rows, s, opts.log, "oncoprint:columns", unit, connOf(s)) };
        }));
      }
      per = inStudyOrder([...per, ...await Promise.all([...peers.keys()].map((s) => peerColumns(s, gi)))]);
      const pids: string[] = [];
      for (const { s, cols } of per) for (const p of cols.pids) {
        const id = qual(s, p);
        if (seen.has(id)) continue;
        seen.add(id); pids.push(id); studyOf.set(id, s);
        if (!peers.has(s)) columnSamples.get(s)!.push(...cols.samples.get(p)!);
      }
      groups.push({ name: g.name || "group " + (groups.length + 1), pids });
    }
  } else if (multi) {
    // no groups: every patient of every study, one column group, study order
    if (spec.cohort) throw new Error("multi-study oncoprint with a cohort requires cohort groups (layout.groupBy)");
    const fetched = await Promise.all(studies.map(async (s) =>
      ({ s, r: peers.has(s) ? { rows: (await peerShare(s)).groups[0].map((p) => [p]) }
        : await lqRows("oncoprint:columns", cohortColumnsSql(null, s, dbOf(s), unit, pin), s) })));
    const pids: string[] = [];
    for (const { s, r } of fetched) for (const x of r.rows) { const id = qual(s, x[0] as string); pids.push(id); studyOf.set(id, s); }
    groups = [{ name: "all patients", pids }];
  } else if (peers.has(study)) {
    const pids = (await peerShare(study)).groups[0];
    for (const p of pids) studyOf.set(p, study);
    groups = [{ name: "cohort", pids }];
  } else if (spec.cohort) {
    const rows = cohortRowsSql({ ...spec.cohort.dsl, lineGap }, study, dbOf(study), pin);
    rowsByStudy.get(study)!.push(rows);
    const cols = await cohortColumns(rows, study, opts.log, "oncoprint:columns", unit, connOf(study));
    for (const p of cols.pids) { studyOf.set(p, study); columnSamples.get(study)!.push(...cols.samples.get(p)!); }
    groups = [{ name: "cohort", pids: cols.pids }];
  } else {
    // every column of the study, each built from all of its samples: no sample to carry
    const pids = (await lqRows("oncoprint:columns", cohortColumnsSql(null, study, dbOf(study), unit, pin), study)).rows.map((x) => x[0] as string);
    for (const p of pids) studyOf.set(p, study);
    groups = [{ name: "cohort", pids }];
  }
  // Patient columns collapse their samples IN THE COHORT only; sample columns are those samples
  // already, so their rows need no narrowing. Read off the column fetch, so no cohort is
  // evaluated again; no cohort at all means every sample counts.
  const samplesOf = (s: string): string | null =>
    unit === "patient" && rowsByStudy.get(s)!.length ? columnSamplesIn(s, columnSamples.get(s)!, rowsByStudy.get(s)!) : null;
  const allPids = groups.flatMap(g => g.pids);
  if (!allPids.length) throw new Error("cohort is empty");

  // ---- genomic events + panel coverage, per study --------------------
  const events: EventRow[] = [];
  const coverage: AssembleInput["coverage"] = [];
  const profiledMasks: { pid: string; mask: number }[] = [];
  const samplesPer: { pid: string; n: number }[] = [];
  const evFetched = await Promise.all(studies.map(s => peers.has(s)
    ? peerShare(s).then((i) => ({ s, e: { rows: i.events }, c: { rows: i.coverage }, p: { rows: i.facts } }))
    : Promise.all([lqRows("oncoprint:alterations", genomicEventsSql(genes, s, dbOf(s), unit, samplesOf(s)), s),
                 lqRows("oncoprint:coverage", coverageSql(genes, s, dbOf(s), unit, samplesOf(s)), s),
                 lqRows("oncoprint:profiledTypes", columnFactsSql(s, dbOf(s), unit, samplesOf(s)), s)]).then(([e, c, p]) => ({ s, e, c, p }))));
  for (const { s, e, c, p } of evFetched) {
    const pref = multi ? s + "_" : "";
    // column order is the SELECT's: pid, gene, vt, mt, mv, cna
    for (const r of e.rows) events.push({ pid: pref + (r[0] as string), gene: r[1] as string, vt: r[2] as string, mt: r[3] as string, mv: r[4] as string, cna: r[5] as string });
    for (const r of c.rows) coverage.push({ pid: pref + (r[0] as string), mask: Number(r[1]) });
    // column order is the SELECT's: pid, samples, mask
    for (const r of p.rows) {
      profiledMasks.push({ pid: pref + (r[0] as string), mask: Number(r[2]) });
      samplesPer.push({ pid: pref + (r[0] as string), n: Number(r[1]) });
    }
  }
  // the alteration types this figure draws: the gene cells' three, and an overlay's
  const profiledTypes: ProfiledType[] = ["MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION", "STRUCTURAL_VARIANT",
    ...overlays.map((o) => (o.kind === "mrna" ? "MRNA_EXPRESSION" : "PROTEIN_LEVEL") as ProfiledType)];
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
      ({ s, r: peers.has(s) ? await peerRows(s, (i) => i.clinical) : await lqRows("oncoprint:clinicalTracks", clinicalSql(clinical, s, dbOf(s), unit, samplesOf(s)), s) })));
    // rows are (pid, k, v); bucket straight into per-attribute maps, no intermediate array
    for (const { s, r } of cdFetched) {
      const pref = multi ? s + "_" : "";
      for (const x of r.rows) { const m = byAttr.get(x[1] as string); if (m) m.set(pref + (x[0] as string), x[2] as string); }
    }
    for (const attr of clinical) clinicalIn.push({ attr, values: byAttr.get(attr)! });
  }

  // ---- heatmap values per profile (validated against each study's inventory) ----
  const heatmapIn: AssembleInput["heatmap"] = [];
  // a study's profile inventory: its own database's, or as the peer holding it reported it
  const profileTypesOf = async (s: string): Promise<string[]> =>
    peers.has(s) ? (await peerShare(s)).profileTypes : [...await studyProfileTypes(s, dbOf(s), connOf(s))];
  const numericAssaysOf = async (s: string): Promise<string[]> => peers.has(s) ? (await peerShare(s)).assays
    : [...(await studyAssayProfiles(s, dbOf(s), connOf(s))).entries()].filter(([, a]) => !isCategoricalAssay(a.datatype)).map(([pt]) => pt);
  for (const [hi, h] of heatmap.entries()) {
    const isVaf = /^vaf$/i.test(h.profileType);
    const assays = await Promise.all(studies.map(async (s) => peers.has(s)
      ? (await peerShare(s)).heatmap[hi].assay ?? undefined
      : (await studyAssayProfiles(s, dbOf(s), connOf(s))).get(h.profileType)));
    if (!isVaf && assays.some((a) => a)) {
      if (!h.assay) throw new Error("heatmap: '" + h.profileType + "' is a generic assay; name the entities to draw (entities: [...]) rather than genes");
      if (assays.some((a) => a && isCategoricalAssay(a.datatype)))
        throw new Error("heatmap: '" + h.profileType + "' is categorical; a heatmap track draws numbers");
      if (h.reference === "federation") throw new Error("heatmap: a federation reference z-scores a gene's values; '" + h.profileType + "' is a generic assay");
      const okStudies = studies.filter((_, i) => assays[i]);
      const values = new Map<string, number>();
      const fetched = await Promise.all(okStudies.map(async (s) =>
        ({ s, r: peers.has(s) ? await peerRows(s, (i) => i.heatmap[hi].values)
          : await lqRows("oncoprint:assay heatmap", assayHeatmapSql(h.profileType, h.genes, s, dbOf(s), unit, !!assays[studies.indexOf(s)]!.patientLevel, samplesOf(s)), s) })));
      for (const { s, r } of fetched)
        for (const row of r.rows) values.set(qual(s, row[0] as string) + "|" + (row[1] as string), Number(row[2]));
      heatmapIn.push({ profileType: h.profileType, genes: h.genes, isVaf: false, assay: true, values });
      continue;
    }
    if (h.assay) throw new Error("heatmap: entities name a generic assay's tracks; '" + h.profileType + "' is not a generic-assay profile of " + studies.join("/"));
    const avail = await Promise.all(studies.map(async (s) =>
      (peers.has(s) ? (await peerShare(s)).heatmap[hi].available
        : isVaf ? await vafAvailable(s, dbOf(s), connOf(s)) : (await studyProfileTypes(s, dbOf(s), connOf(s))).has(h.profileType)) ? s : null));
    const okStudies = avail.filter((s): s is string => s !== null);
    if (!okStudies.length)
      throw new Error(isVaf
        ? "heatmap: 'VAF' needs mutation allele counts, which " + studies.join("/") + " did not load"
        : "heatmap: profile '" + h.profileType + "' not in " + studies.join("/") +
          " (available: " + ((await profileTypesOf(studies[0])).join(", ") || "none") + ", VAF" +
          (await numericAssaysOf(studies[0])).map((pt) => ", " + pt + " (generic assay: name its entities)").join("") + ")");
    const values = new Map<string, number>(); // columnId|gene -> value
    const hFetched = await Promise.all(okStudies.map(async (s) =>
      ({ s, r: peers.has(s) ? await peerRows(s, (i) => i.heatmap[hi].values)
        : await lqRows(isVaf ? "oncoprint:vaf" : "oncoprint:heatmap", isVaf ? vafSql(h.genes, s, dbOf(s), unit, samplesOf(s)) : heatmapSql(h.profileType, h.genes, s, dbOf(s), unit, samplesOf(s)), s) })));
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
  for (const [oi, ov] of overlays.entries()) {
    const avail = await Promise.all(studies.map(async (s) => (peers.has(s) ? (await peerShare(s)).overlays[oi].available
      : (await studyProfileTypes(s, dbOf(s), connOf(s))).has(ov.profileType)) ? s : null));
    const okStudies = avail.filter((s): s is string => s !== null);
    if (!okStudies.length)
      throw new Error("overlay: profile '" + ov.profileType + "' not in " + studies.join("/") +
        " (available: " + ((await profileTypesOf(studies[0])).join(", ") || "none") + ")");
    const values = new Map<string, number>();
    const fetched = await Promise.all(okStudies.map(async (s) =>
      ({ s, r: peers.has(s) ? await peerRows(s, (i) => i.overlays[oi].values)
        : await lqRows("oncoprint:overlay " + ov.kind, heatmapSql(ov.profileType, genes, s, dbOf(s), unit, samplesOf(s)), s) })));
    for (const { s, r } of fetched)
      for (const row of r.rows) values.set(qual(s, row[0] as string) + "|" + (row[1] as string), Number(row[2]));
    overlaysIn.push({ kind: ov.kind, profileType: ov.profileType, threshold: ov.threshold, values });
  }

  // ---- derived-event rows (cohort-DSL expressions as phenotypes) ---------
  const derivedIn: AssembleInput["derived"] = [];
  const derivedConn = derivedEvents.length ? conns.get(study) || await patientLevelConn(study, "derived-event rows list patients") : null;
  for (const de of derivedEvents)
    derivedIn.push({ label: de.label, pids: new Set<string>((await cohortColumns(cohortRowsSql({ ...de.expression, lineGap }, study, derivedConn!.db, pin), study, opts.log, "oncoprint:derivedEvent", unit, derivedConn!)).pids) });

  const queryMs = Date.now() - t0;
  const tAsm = Date.now();
  const contract = assembleContract({
    genes: geneList, groups, studies, studyOf, events, coverage, profiled: { types: profiledTypes, masks: profiledMasks }, samples: samplesPer,
    isDriver: (r) => annotation.isDriver(r as Parameters<typeof annotation.isDriver>[0]), annotationSource: annotation.source,
    clinical: clinicalIn, heatmap: heatmapIn, overlays: overlaysIn, zReference: spec.zReference, derived: derivedIn, sort, lineGap, display, unit, clusterRank
  });
  contract.stats.ms = Date.now() - t0;
  contract.stats.queryMs = queryMs;
  contract.stats.assembleMs = Date.now() - tAsm;
  if (opts.provenance && opts.log) contract.queries = opts.log.map((q) => ({ ...q, study: q.study || study }));
  return contract;
}
