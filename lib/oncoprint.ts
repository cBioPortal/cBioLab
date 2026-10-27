// OncoprintSpec -> render contract engine.
// Spec (v1 subset): { cohort: {dsl}|null, genes: [..], clinical: [..],
//   derivedEvents: [{label, expression}], layout: {groupBy: {kind:'cohorts', groups:[{name,dsl}]}|null},
//   conventions: {lineGap} }
// Contract: sorted columns, typed cells (bitmask for gene tracks, NOT_PROFILED = -1),
//   panel-aware track frequencies, group ranges. The renderer does zero data logic.
import { chQuery, chQueryRows, DB, STUDY, PRIMARY, type ChConn, type ChRows } from "./ch.ts";
import { compileCohort, sq } from "./compiler.ts";
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
export type PidsCarrier = CohortDef & { [PIDS_SQL]?: string | Record<string, string> };
import { buildAnnotationIndex, oncokbPin } from "./annotation.ts";
import { compileCohortDef } from "./cohort2.ts";
import { wardOrder, CLUSTER_LIMIT } from "./oncoprint-cluster.ts";

import { PROFILED_TYPES, type ProfiledType } from "./profile-names.ts";
import { assembleIndexed, normalizeDisplay, normalizeSort, type EventFacts, type IndexedInput } from "./oncoprint-assemble.ts";
import { normalizeGeneTracks, toGeneList } from "./gene-tracks.ts";
import { clinicalTable, assertCustomDataPresent } from "./custom-data.ts";
import { finiteSql } from "./sql-number.ts";
import { ENTITY_RE, isCategoricalAssay } from "./generic-assay.ts";
import type { OncoprintSpec, HeatmapSpec } from "./views/oncoprint/types.ts";
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
  // DSL v2 definition ({all: [...]}) — the analysis document's cohort language,
  // including an explicit sample/patient list ({kind:"sampleList"|"patientList"}).
  if (dsl && Array.isArray((dsl as { all?: unknown }).all)) return compileCohortDef(dsl as CohortDef, { study, db, oncokbPin: pin });
  if (!dsl) return "SELECT pid FROM (\n" + allColumnsSql([study], db) + "\n) ORDER BY pid";
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
/**
 * The id column for a unit, stripped of the prefix that qualifies it in the warehouse: each row's
 * own study's, so one statement can read several studies.
 */
const idCol = (unit: Unit, alias = ""): string =>
  "replaceOne(" + alias + (unit === "sample" ? "sample_unique_id" : "patient_unique_id") + ", concat(" + alias + "cancer_study_identifier, '_'), '')";
/** a study filter over a list: the builders below read every study of one database in one statement */
const inStudies = (col: string, studies: string[]): string => col + " IN (" + studies.map(sq).join(",") + ")";

/**
 * Every column of each study, `(s, pid)`, ordered by study then id: the columns when there is no
 * cohort. A patient column is a patient with a sample; a sample column, each of their samples.
 */
export function allColumnsSql(studies: string[], db: string = DB, unit: Unit = "patient"): string {
  return "SELECT DISTINCT cancer_study_identifier AS s, " + idCol(unit) + " AS pid\n" +
    "FROM " + db + ".sample_derived WHERE " + inStudies("cancer_study_identifier", studies) + " ORDER BY s, pid";
}

export function genomicEventsSql(genes: string[], studies: string[] = [STUDY], db: string = DB, unit: Unit = "patient"): string {
  return "SELECT cancer_study_identifier AS s, " + idCol(unit) + " AS pid,\n" +
    "       hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt,\n" +
    "       mutation_variant AS mv, cna_alteration AS cna\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE " + inStudies("cancer_study_identifier", studies) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND mutation_status != 'UNCALLED'"; // read support, not a call (lib/oql.ts specCond)
}

/**
 * One row per patient: a bitmask over the queried gene list, bit i set when some mutation, copy
 * number or structural variant panel of that patient covers genes[i] — the three kinds of event
 * a gene cell draws, so a cell is profiled when any of them was assayed (the portal's rule, and
 * the one the other views' denominators use). An integer per patient instead of an array of gene names —
 * at 400k patients that is the difference between a few megabytes and a few hundred kilobytes.
 */
export function coverageSql(genes: string[], studies: string[] = [STUDY], db: string = DB, unit: Unit = "patient"): string {
  const list = "[" + genes.map(sq).join(",") + "]";
  // Each panel's mask is computed once, from the few panels there are, before it meets the
  // samples. Panels are recorded per sample; patient mode joins out to the patient (these
  // studies' samples only), sample mode does not.
  return "WITH pm AS (SELECT gene_panel_id, toUInt32(groupBitOr(bitShiftLeft(toUInt32(1), toUInt8(indexOf(" + list + ", gene) - 1)))) AS m\n" +
    "            FROM " + db + ".gene_panel_to_gene_derived WHERE gene IN (" + genes.map(sq).join(",") + ") GROUP BY gene_panel_id)\n" +
    "SELECT sp.cancer_study_identifier AS s, " + idCol(unit, unit === "sample" ? "sp." : "sd.") + " AS pid,\n" +
    "       toUInt32(groupBitOr(pm.m)) AS mask\n" +
    "FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "JOIN pm ON pm.gene_panel_id = sp.gene_panel_id\n" +
    (unit === "sample" ? "" : "JOIN (SELECT sample_unique_id, patient_unique_id, cancer_study_identifier FROM " + db + ".sample_derived WHERE " +
      inStudies("cancer_study_identifier", studies) + ") sd\n" +
      "  ON sd.sample_unique_id = sp.sample_unique_id\n") +
    "WHERE " + inStudies("sp.cancer_study_identifier", studies) + " AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')\n" +
    "GROUP BY s, pid";
}

/**
 * One row per column: how many samples it has, and a bitmask over PROFILED_TYPES, bit i set when
 * some sample of the column is in a profile of that type whatever its genes — the portal's
 * "# Samples per Patient" and "Profiled for <type>" rows, from one scan.
 */
export function columnFactsSql(studies: string[] = [STUDY], db: string = DB, unit: Unit = "patient"): string {
  const types = PROFILED_TYPES.map(([t]) => sq(t)).join(",");
  return "SELECT sd.cancer_study_identifier AS s, " + idCol(unit, "sd.") + " AS pid,\n" +
    "       uniqExact(sd.sample_unique_id) AS samples,\n" +
    "       toUInt8(groupBitOr(if(sp.alteration_type = '', 0, bitShiftLeft(toUInt8(1), toUInt8(indexOf([" + types + "], sp.alteration_type) - 1))))) AS mask\n" +
    "FROM " + db + ".sample_derived sd\n" +
    "LEFT JOIN (SELECT sample_unique_id, alteration_type FROM " + db + ".sample_to_gene_panel_derived\n" +
    "           WHERE " + inStudies("cancer_study_identifier", studies) + " AND alteration_type IN (" + types + ")) sp ON sp.sample_unique_id = sd.sample_unique_id\n" +
    "WHERE " + inStudies("sd.cancer_study_identifier", studies) + "\n" +
    "GROUP BY s, pid";
}

export function clinicalSql(attrs: string[], studies: string[] = [STUDY], db: string = DB, unit: Unit = "patient"): string {
  const inAttrs = "attribute_name IN (" + attrs.map(sq).join(",") + ") AND attribute_value != ''";
  if (unit === "sample")
    // sample-level rows are exact; patient-level rows broadcast to each of that patient's
    // samples (a patient's stage is the stage of every sample of theirs)
    return "SELECT sd.cancer_study_identifier AS s, " + idCol(unit, "sd.") + " AS pid,\n" +
      "       cd.attribute_name AS k, argMax(cd.attribute_value, cd.type = 'sample') AS v\n" +
      "FROM " + clinicalTable(db, attrs) + " cd\n" +
      "JOIN " + db + ".sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id\n" +
      "  AND (cd.type = 'patient' OR cd.sample_unique_id = sd.sample_unique_id)\n" +
      "WHERE " + inStudies("cd.cancer_study_identifier", studies) + " AND cd." + inAttrs + "\n" +
      "GROUP BY s, pid, k";
  // patient-level rows win; sample-level attributes (e.g. CANCER_TYPE in MSK studies)
  // fall back to one of the patient's sample values via argMax
  return "SELECT cancer_study_identifier AS s, " + idCol(unit) + " AS pid,\n" +
    "       attribute_name AS k, argMax(attribute_value, type = 'patient') AS v\n" +
    "FROM " + clinicalTable(db, attrs) + "\n" +
    "WHERE " + inStudies("cancer_study_identifier", studies) + "\n" +
    "  AND " + inAttrs + "\n" +
    "GROUP BY s, pid, k";
}

/**
 * Each study's sample count, per connection: how the whole-study fetches are batched into
 * statements, and nothing else. It never enters an answer, so a stale count costs only speed.
 */
const _sizeCache = new Map<string, Promise<Map<string, number>>>();
function studySizes(conn: ChConn): Promise<Map<string, number>> {
  const key = conn.id + "." + conn.db;
  let p = _sizeCache.get(key);
  if (!p) {
    p = chQueryRows("SELECT cancer_study_identifier, count() FROM " + conn.db + ".sample_derived GROUP BY cancer_study_identifier", conn)
      .then((r) => new Map(r.rows.map((x) => [x[0] as string, Number(x[1])])));
    _sizeCache.set(key, p);
    p.catch(() => _sizeCache.delete(key));
  }
  return p;
}
/**
 * Samples one statement reads at most, unless a single study is larger. Many small studies share
 * a statement — at 312 studies, one statement each is 1,560 queued queries — while a large study
 * keeps its own, which the database runs beside the others: one statement over six of the largest
 * was measured slower than six.
 */
const BATCH_SAMPLES = 25_000;
/** studies in batches of up to BATCH_SAMPLES samples, each batch on one connection */
export function batchStudies(studies: string[], connId: (s: string) => string, size: (s: string) => number, limit = BATCH_SAMPLES): string[][] {
  const out: string[][] = [];
  const open = new Map<string, { studies: string[]; n: number }>();
  for (const s of studies) {
    const k = connId(s), n = size(s);
    if (n >= limit) { out.push([s]); continue; }
    let b = open.get(k);
    if (b && b.n + n > limit) { out.push(b.studies); b = undefined; }
    if (!b) { b = { studies: [], n: 0 }; open.set(k, b); }
    b.studies.push(s); b.n += n;
  }
  for (const b of open.values()) out.push(b.studies);
  return out;
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
    "  AND tumorAltCount > 0 AND tumorRefCount >= 0 AND molecularProfileId NOT LIKE '%uncalled%'\n" +
    "GROUP BY pid, gene";
}

// patient-level continuous values for heatmap tracks (columns are patients, so
// multi-sample patients get the mean across their samples — stated in the label)
export function heatmapSql(profileType: string, genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient"): string {
  // values are stored per sample; only patient mode has to average them
  return "SELECT " + (unit === "sample" ? "replaceOne(ga.sample_unique_id, " + sq(study + "_") + ", '')" : "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')") + " AS pid,\n" +
    "       ga.hugo_gene_symbol AS gene, avg(" + finiteSql("ga.alteration_value") + ") AS v\n" +
    "FROM " + db + ".genetic_alteration_derived ga\n" +
    (unit === "sample" ? "" : "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n") +
    "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "  AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND " + finiteSql("ga.alteration_value") + " IS NOT NULL\n" +
    "GROUP BY pid, gene";
}

// A generic-assay profile's values for heatmap tracks, one row per (column, entity): a column's
// samples averaged in patient mode, and a patient-level assay's value given to each of the
// patient's samples in sample mode. Values that are not numbers are left out.
export function assayHeatmapSql(profileType: string, entities: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", patientLevel = false): string {
  const strip = (col: string) => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";
  const sampleLevel = unit === "sample" && patientLevel;
  return "SELECT " + (unit === "sample" ? strip(sampleLevel ? "sd.sample_unique_id" : "g.sample_unique_id") : strip("g.patient_unique_id")) + " AS pid,\n" +
    "       g.entity_stable_id AS gene, avg(" + finiteSql("g.value") + ") AS v\n" +
    "FROM " + db + ".generic_assay_data_derived g\n" +
    (sampleLevel ? "JOIN " + db + ".sample_derived sd ON sd.patient_unique_id = g.patient_unique_id\n" : "") +
    "WHERE g.profile_type = " + sq(profileType) + " AND g.profile_stable_id = " + sq(study + "_" + profileType) + "\n" +
    "  AND g.entity_stable_id IN (" + entities.map(sq).join(",") + ")\n" +
    "  AND " + finiteSql("g.value") + " IS NOT NULL\n" +
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
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    for (const g of gb.groups.slice(0, 4))
      queries.push({ label: "column group \u201c" + (g.name || "group") + "\u201d \u2014 cohort " + unit + "s", sql: cohortColumnsSql({ ...g.dsl, lineGap }, study, DB, unit, pin) });
  } else {
    queries.push({ label: spec.cohort ? "cohort " + unit + "s" : "all study " + unit + "s",
      sql: spec.cohort ? cohortColumnsSql({ ...spec.cohort.dsl, lineGap }, study, DB, unit, pin) : allColumnsSql([study], DB, unit) });
  }
  queries.push({ label: "genomic events (mutations, CNA, SV) for the gene tracks", sql: genomicEventsSql(genes, [study], DB, unit) });
  queries.push({ label: "panel coverage (mutation, copy number and structural variant panels) \u2014 the NOT_PROFILED cell source and frequency denominators", sql: coverageSql(genes, [study], DB, unit) });
  queries.push({ label: "samples per column and the alteration types it was profiled for \u2014 the \u201c# Samples per Patient\u201d and \u201cProfiled for\u201d rows", sql: columnFactsSql([study], DB, unit) });
  if (clinical.length) queries.push({ label: "clinical attribute tracks", sql: clinicalSql(clinical, [study], DB, unit) });
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
  assertCustomDataPresent(spec);
  // Record a query the same way the resolvers do: pushed before the await and
  // stamped after, so concurrent fetches each update their own entry.
  // the four hot fetches read columns by index: no object per row, ~45% fewer bytes
  // A study's queries go to the instance that holds it, not merely to its database name: the
  // two differ the moment a peer lives on another host.
  const lqRows = async (label: string, sql: string, study?: string | string[]) => {
    const where = Array.isArray(study) ? study.join(", ") : study;
    const entry = { label, sql, ...(where ? { study: where } : {}) } as { label: string; sql: string; ms?: number; study?: string };
    if (opts.log) opts.log.push(entry);
    const r = await chQueryRows(sql, study ? connOf(Array.isArray(study) ? study[0] : study) : PRIMARY);
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
  const { patientLevelConn } = await import("./federation.ts");
  const conns = new Map(await Promise.all(studies.map(async (s) =>
    [s, await patientLevelConn(s, "an oncoprint's columns are patients")] as const)));
  const connOf = (s: string): ChConn => conns.get(s)!;
  const dbOf = (s: string): string => connOf(s).db;
  const { genes, geneList, clinical, derivedEvents, lineGap, sort, heatmap, display, unit, overlays } = normalizeSpec(spec);
  if (multi && derivedEvents.length) throw new Error("derived-event tracks are single-study; drop them or the extra studies");
  if (unit === "sample" && derivedEvents.length)
    throw new Error("cohort rows are patient-level: a cohort selects patients, so drawing one per sample would repeat a patient's answer across their samples. Drop the rows or switch columns back to patients.");

  const gb = spec.layout && spec.layout.groupBy;
  const grouped = !!(gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length);
  if (multi && !grouped && spec.cohort) throw new Error("multi-study oncoprint with a cohort requires cohort groups (layout.groupBy)");

  // Every fetch below reads one study's rows for the whole study and none waits on another's
  // answer, so they all start here, beside the columns. Each is awaited before the contract is
  // built; a figure refused on the way (an empty cohort) leaves the rest to settle unread.
  const started = <T>(p: Promise<T>): Promise<T> => { p.catch(() => {}); return p; };
  // A fetch that reads whole studies is one statement per batch of them (batchStudies), its rows
  // led by their study (s, pid, ...).
  const sizes = new Map(await Promise.all([...new Set(studies.map(connOf))].map(async (c) => [c.id, await studySizes(c)] as const)));
  const dbStudies = batchStudies(studies, (s) => connOf(s).id, (s) => sizes.get(connOf(s).id)?.get(s) ?? 0);
  const evFetchedP = started(Promise.all(dbStudies.map((ss) =>
    Promise.all([lqRows("oncoprint:alterations", genomicEventsSql(genes, ss, dbOf(ss[0]), unit), ss),
                 lqRows("oncoprint:coverage", coverageSql(genes, ss, dbOf(ss[0]), unit), ss),
                 lqRows("oncoprint:profiledTypes", columnFactsSql(ss, dbOf(ss[0]), unit), ss)]).then(([e, c, p]) => ({ e, c, p })))));
  // every event of each study, cohort or not: the rule-based stand-in for a missing annotation
  // store counts recurrence over all of them. Each is given its column once the columns are known.
  type Placed = EventFacts & { col: number };
  const eventsP = started(evFetchedP.then((fetched) => fetched.map(({ e }) => ({ rows: e.rows,
    // column order is the SELECT's: s, pid, gene, vt, mt, mv, cna
    events: e.rows.map((r): Placed => ({ col: -1, gene: r[2] as string, vt: r[3] as string, mt: r[4] as string, mv: r[5] as string, cna: r[6] as string })) }))));
  // "annotate: none" is a deliberate choice to draw without driver calls; say so rather than
  // letting the figure look as though nothing was annotated
  const annotationP = started(display.annotate === "none"
    ? Promise.resolve({ isDriver: () => false, source: "none — driver annotation turned off for this figure" })
    : buildAnnotationIndex(eventsP.then((per) => per.flatMap((x) => x.events)), genes, multi ? studies : study));
  const cdFetchedP = started(Promise.all((clinical.length ? dbStudies : []).map((ss) =>
    lqRows("oncoprint:clinicalTracks", clinicalSql(clinical, ss, dbOf(ss[0]), unit), ss))));

  // ---- heatmap values per profile (validated against each study's inventory) ----
  type Fetched = { s: string; r: ChRows }[];
  const heatmapRows = async (h: (typeof heatmap)[number]): Promise<{ profileType: string; genes: string[]; isVaf: boolean; assay?: boolean; fetched: Fetched }> => {
    const isVaf = /^vaf$/i.test(h.profileType);
    const assays = await Promise.all(studies.map(async (s) => (await studyAssayProfiles(s, dbOf(s), connOf(s))).get(h.profileType)));
    if (!isVaf && assays.some((a) => a)) {
      if (!h.assay) throw new Error("heatmap: '" + h.profileType + "' is a generic assay; name the entities to draw (entities: [...]) rather than genes");
      if (assays.some((a) => a && isCategoricalAssay(a.datatype)))
        throw new Error("heatmap: '" + h.profileType + "' is categorical; a heatmap track draws numbers");
      if (h.reference === "federation") throw new Error("heatmap: a federation reference z-scores a gene's values; '" + h.profileType + "' is a generic assay");
      const okStudies = studies.filter((_, i) => assays[i]);
      const fetched = await Promise.all(okStudies.map(async (s) =>
        ({ s, r: await lqRows("oncoprint:assay heatmap", assayHeatmapSql(h.profileType, h.genes, s, dbOf(s), unit, !!assays[studies.indexOf(s)]!.patientLevel), s) })));
      return { profileType: h.profileType, genes: h.genes, isVaf: false, assay: true, fetched };
    }
    if (h.assay) throw new Error("heatmap: entities name a generic assay's tracks; '" + h.profileType + "' is not a generic-assay profile of " + studies.join("/"));
    const avail = await Promise.all(studies.map(async (s) =>
      (isVaf ? await vafAvailable(s, dbOf(s), connOf(s)) : (await studyProfileTypes(s, dbOf(s), connOf(s))).has(h.profileType)) ? s : null));
    const okStudies = avail.filter((s): s is string => s !== null);
    if (!okStudies.length)
      throw new Error(isVaf
        ? "heatmap: 'VAF' needs mutation allele counts, which " + studies.join("/") + " did not load"
        : "heatmap: profile '" + h.profileType + "' not in " + studies.join("/") +
          " (available: " + ([...(await studyProfileTypes(studies[0], dbOf(studies[0]), connOf(studies[0])))].join(", ") || "none") + ", VAF" +
          [...(await studyAssayProfiles(studies[0], dbOf(studies[0]), connOf(studies[0]))).entries()].filter(([, a]) => !isCategoricalAssay(a.datatype))
            .map(([pt]) => ", " + pt + " (generic assay: name its entities)").join("") + ")");
    const fetched = await Promise.all(okStudies.map(async (s) =>
      ({ s, r: await lqRows(isVaf ? "oncoprint:vaf" : "oncoprint:heatmap", isVaf ? vafSql(h.genes, s, dbOf(s), unit) : heatmapSql(h.profileType, h.genes, s, dbOf(s), unit), s) })));
    return { profileType: h.profileType, genes: h.genes, isVaf, fetched };
  };
  const heatmapP = started(Promise.allSettled(heatmap.map(heatmapRows)));

  // ---- molecular overlays: values thresholded into the gene cells ---------
  const overlayRows = async (ov: (typeof overlays)[number]) => {
    const avail = await Promise.all(studies.map(async (s) => (await studyProfileTypes(s, dbOf(s), connOf(s))).has(ov.profileType) ? s : null));
    const okStudies = avail.filter((s): s is string => s !== null);
    if (!okStudies.length)
      throw new Error("overlay: profile '" + ov.profileType + "' not in " + studies.join("/") +
        " (available: " + ([...(await studyProfileTypes(studies[0], dbOf(studies[0]), connOf(studies[0])))].join(", ") || "none") + ")");
    const fetched: Fetched = await Promise.all(okStudies.map(async (s) =>
      ({ s, r: await lqRows("oncoprint:overlay " + ov.kind, heatmapSql(ov.profileType, genes, s, dbOf(s), unit), s) })));
    return { kind: ov.kind, profileType: ov.profileType, threshold: ov.threshold, fetched };
  };
  const overlaysP = started(Promise.allSettled(overlays.map(overlayRows)));

  // ---- derived-event rows (cohort-DSL expressions as phenotypes) ---------
  const derivedP = started(Promise.allSettled(derivedEvents.map(async (de) => {
    const derivedConn = conns.get(study) || await patientLevelConn(study, "derived-event rows list patients");
    return { label: de.label, pids: await cohortPatients({ ...de.expression, lineGap }, study, opts.log, "oncoprint:derivedEvent", derivedConn.db, unit, pin, derivedConn) };
  })));

  // ---- columns: groups of patients --------------------------------------
  // Each group's patients as (study, id) pairs, in fetch order; a patient lands in the first group
  // that has them.
  let fetchedGroups: { name: string; members: { s: string; ids: string[] }[] }[];
  if (grouped) {
    fetchedGroups = await Promise.all(gb!.groups!.slice(0, 4).map(async (g, gi) => {
      const v = (g.dsl as PidsCarrier | undefined)?.[PIDS_SQL];
      const name = g.name || "group " + (gi + 1);
      if (v && typeof v === "object") {
        // federated group: {study: sql} map from analysis.js — fetch per study in
        // parallel, merge in study order (deterministic column order)
        const fetched = await Promise.all(studies.filter((s) => typeof (v as Record<string, string>)[s] === "string").map(async (s) =>
          ({ s, r: await lqRows("oncoprint:columns", "SELECT pid FROM (\n" + (v as Record<string, string>)[s] + "\n)", s) })));
        return { name, members: fetched.map(({ s, r }) => ({ s, ids: r.rows.map((x) => x[0] as string) })) };
      }
      // no pre-compiled SQL: compile the definition against each study in turn
      return { name, members: await Promise.all(studies.map(async (s) =>
        ({ s, ids: await cohortPatients({ ...g.dsl, lineGap }, s, opts.log, "oncoprint:columns", dbOf(s), unit, pin, connOf(s)) }))) };
    }));
  } else if (!spec.cohort) {
    // no cohort: every column of every study, one group, in study order
    const idsOf = new Map(studies.map((s) => [s, [] as string[]]));
    for (const r of await Promise.all(dbStudies.map((ss) => lqRows("oncoprint:columns", allColumnsSql(ss, dbOf(ss[0]), unit), ss))))
      for (const x of r.rows) idsOf.get(x[0] as string)?.push(x[1] as string);
    fetchedGroups = [{ name: multi ? "all patients" : "cohort", members: studies.map((s) => ({ s, ids: idsOf.get(s)! })) }];
  } else {
    fetchedGroups = [{ name: "cohort", members: [{ s: study, ids: await cohortPatients({ ...spec.cohort.dsl, lineGap }, study, opts.log,
      "oncoprint:columns", dbOf(study), unit, pin, connOf(study)) }] }];
  }
  // each study's own ids -> column position: the one lookup a row from that study costs
  const colOf = new Map(studies.map((s) => [s, new Map<string, number>()]));
  const studyIndex = new Map(studies.map((s, i) => [s, i]));
  const columns: string[] = [];
  const columnStudy: number[] = [];
  const groups: IndexedInput["groups"] = [];
  for (const { name, members } of fetchedGroups) {
    const start = columns.length;
    for (const { s, ids } of members) {
      const at = colOf.get(s)!, si = studyIndex.get(s)!;
      for (const id of ids) {
        if (at.has(id)) continue;
        at.set(id, columns.length);
        columns.push(qual(s, id));
        columnStudy.push(si);
      }
    }
    groups.push({ name, count: columns.length - start });
  }
  if (!columns.length) throw new Error("cohort is empty");
  const n = columns.length;

  // ---- genomic events + panel coverage, per study --------------------
  const [evFetched, eventsPer, annotation, cdFetched] = await Promise.all([evFetchedP, eventsP, annotationP, cdFetchedP]);
  // A row's column, from its study (column 0) and id (column 1); undefined when it is not drawn.
  // A study's rows tend to arrive together, so its map is looked up once per run of them.
  const locate = () => {
    let lastS: unknown, at: Map<string, number> | undefined;
    return (r: unknown[]): number | undefined => {
      if (r[0] !== lastS) { lastS = r[0]; at = colOf.get(r[0] as string); }
      return at?.get(r[1] as string);
    };
  };
  const events: Placed[] = [];
  for (const { rows, events: evs } of eventsPer) {
    const where = locate();
    for (let i = 0; i < evs.length; i++) { const col = where(rows[i]); if (col !== undefined) { evs[i].col = col; events.push(evs[i]); } }
  }
  const coverage: IndexedInput["coverage"] = [];
  const profiledMasks: { col: number; mask: number }[] = [];
  const samplesPer: { col: number; n: number }[] = [];
  for (const { c, p } of evFetched) {
    let where = locate();
    for (const r of c.rows) { const col = where(r); if (col !== undefined) coverage.push({ col, mask: Number(r[2]) }); }
    // column order is the SELECT's: s, pid, samples, mask
    where = locate();
    for (const r of p.rows) {
      const col = where(r);
      if (col === undefined) continue;
      profiledMasks.push({ col, mask: Number(r[3]) });
      samplesPer.push({ col, n: Number(r[2]) });
    }
  }
  // the alteration types this figure draws: the gene cells' three, and an overlay's
  const profiledTypes: ProfiledType[] = ["MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION", "STRUCTURAL_VARIANT",
    ...overlays.map((o) => (o.kind === "mrna" ? "MRNA_EXPRESSION" : "PROTEIN_LEVEL") as ProfiledType)];

  // ---- clinical values per attribute -------------------------------------
  // rows are (s, pid, k, v), straight into each attribute's per-column array
  const byAttr = new Map(clinical.map((a) => [a, new Array<string | undefined>(n)]));
  for (const r of cdFetched) {
    const where = locate();
    for (const x of r.rows) {
      const vals = byAttr.get(x[2] as string);
      if (!vals) continue;
      const col = where(x);
      if (col !== undefined) vals[col] = x[3] as string;
    }
  }
  const clinicalIn: IndexedInput["clinical"] = clinical.map((attr) => ({ attr, values: byAttr.get(attr)! }));

  // rows are (pid, gene, value): each gene's value per column
  const perGene = (fetched: Fetched, genesOf: string[]): Map<string, (number | undefined)[]> => {
    const values = new Map(genesOf.map((g) => [g, new Array<number | undefined>(n)]));
    for (const { s, r } of fetched) {
      const at = colOf.get(s)!;
      for (const row of r.rows) {
        const vals = values.get(row[1] as string);
        if (!vals) continue;
        const col = at.get(row[0] as string);
        if (col !== undefined) vals[col] = Number(row[2]);
      }
    }
    return values;
  };
  // a track that could not be drawn fails the figure, the first in the spec's order
  const inOrder = <T>(rs: PromiseSettledResult<T>[]): T[] => rs.map((r) => { if (r.status === "rejected") throw r.reason; return r.value; });
  const heatmapIn: IndexedInput["heatmap"] = inOrder(await heatmapP).map(({ fetched, ...h }) => ({ ...h, values: perGene(fetched, h.genes) }));

  // ---- clustering: an order computed here, once, from the molecular values ----
  // "cluster:<profileType>" orders columns by a Ward dendrogram over that profile's genes.
  // It runs where the values already are, so the SVG, the canvas, the CLI and Python all draw
  // the same order, and the order travels in the contract beside the numbers it describes.
  let clusterRank: number[] | undefined;
  const clusterKey = sort.find((k) => k.track.startsWith("cluster:"));
  if (clusterKey) {
    const profileType = clusterKey.track.slice("cluster:".length);
    const h = heatmapIn.find((x) => x.profileType === profileType);
    if (!h) throw new Error("sort: cluster needs '" + profileType + "' as a heatmap profile on this oncoprint" +
      (heatmapIn.length ? " (it has " + heatmapIn.map((x) => x.profileType).join(", ") + ")" : " (it has none)"));
    if (n > CLUSTER_LIMIT)
      throw new Error("clustering " + n.toLocaleString() + " columns is a quadratic computation; the limit is " +
        CLUSTER_LIMIT.toLocaleString() + ". Narrow the cohort, or sort by one of the profile's gene tracks instead.");
    const byGene = h.genes.map((g) => Float64Array.from(h.values.get(g)!, (v) => v === undefined ? NaN : v));
    const order = wardOrder({ columns: byGene, n });
    clusterRank = new Array<number>(n).fill(Number.MAX_SAFE_INTEGER);
    order.forEach((idx, rank) => { clusterRank![idx] = rank; });
    clusterKey.track = "cluster";
  }

  const overlaysIn: IndexedInput["overlays"] = inOrder(await overlaysP).map(({ fetched, ...ov }) => ({ ...ov, values: perGene(fetched, genes) }));
  const derivedIn: IndexedInput["derived"] = inOrder(await derivedP).map(({ label, pids }) => {
    const cols = new Uint8Array(n), at = colOf.get(study)!;
    for (const p of pids) { const col = at.get(p); if (col !== undefined) cols[col] = 1; }
    return { label, cols };
  });

  const queryMs = Date.now() - t0;
  const tAsm = Date.now();
  const contract = assembleIndexed({
    genes: geneList, columns, groups, studies, ...(multi ? { columnStudy: Int32Array.from(columnStudy) } : {}),
    events, coverage, profiled: { types: profiledTypes, masks: profiledMasks }, samples: samplesPer,
    isDriver: (r) => annotation.isDriver(r), annotationSource: annotation.source,
    clinical: clinicalIn, heatmap: heatmapIn, overlays: overlaysIn, zReference: spec.zReference, derived: derivedIn, sort, lineGap, display, unit, clusterRank
  });
  contract.stats.ms = Date.now() - t0;
  contract.stats.queryMs = queryMs;
  contract.stats.assembleMs = Date.now() - tAsm;
  if (opts.provenance && opts.log) contract.queries = opts.log.map((q) => ({ ...q, study: q.study || study }));
  return contract;
}
