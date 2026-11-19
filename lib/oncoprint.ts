// OncoprintSpec -> render contract engine.
// Spec (v1 subset): { cohort: {dsl}|null, genes: [..], clinical: [..],
//   derivedEvents: [{label, expression}], layout: {groupBy: {kind:'cohorts', groups:[{name,dsl}]}|null},
//   conventions: {lineGap} }
// Contract: sorted columns, typed cells (bitmask for gene tracks, NOT_PROFILED = -1),
//   panel-aware track frequencies, group ranges. The renderer does zero data logic.
import { chQuery, chQueryRows, DB, STUDY, PRIMARY, ensureChContext, registerChExternal, studiesChangeWhileRunning, type ChConn } from "./ch.ts";
import { compileCohort, mutationStudySql, sq, genomicStudySql } from "./compiler.ts";
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
import { oncokbPin, driverAnnotation } from "./annotation.ts";
import { germlineCondSql } from "./driver-sql.ts";
import { forData } from "./driver-settings.ts";
import { compileCohortDef, baseSamplesSql } from "./cohort2.ts";
import { clusterHeatmap } from "./oncoprint-cluster.ts";
import { caseListOf, caseListRanks } from "./oncoprint-case-list.ts";

import { defaultOqlSublabel } from "./oql-match.ts";
import { PROFILED_TYPES, SPECTRUM_TRACK, SPECTRUM_NAME, AUTO_TRACKS, isAutoTrack, type ProfiledType } from "./profile-names.ts";
import { inGeneticAlterationDerived } from "./profile-catalog.ts";
import { assembleContract, normalizeDisplay, normalizeSort, type AssembleInput, type EventRow } from "./oncoprint-assemble.ts";
import { normalizeGeneTracks, toGeneList } from "./gene-tracks.ts";
import { clinicalTable, clinicalMetaTable, assertCustomDataPresent } from "./custom-data.ts";
import { finiteSql, finiteNumber } from "./sql-number.ts";
import { SV_EVENT_KEY } from "./sv-oncokb.ts";
import { expressionProfileFor, type OqlPins } from "./oql.ts";
import { ENTITY_RE, isCategoricalAssay } from "./generic-assay.ts";
import type { OncoprintSpec, HeatmapSpec } from "./views/oncoprint/types.ts";
import { CLINICAL_TRACK_LIMIT } from "./views/oncoprint/types.ts";
import { fmtFloat32 } from "./chart/format.ts";
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

/**
 * The gene rows' alterations: pid, gene, vt, mt, mv, cna, df, dt, germ, ps, pe. `rangeGenes` are
 * genes a row's OQL tests by protein position: their mutations are read from mutation_derived,
 * which holds the same rows with each mutation's own protein start and end (ps, pe; null for the rest).
 */
export function genomicEventsSql(genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null,
  rangeGenes: string[] = []): string {
  const puidPrefix = study + "_";
  const ranged = genes.filter((g) => rangeGenes.includes(g));
  const events = "SELECT " + idCol(unit, puidPrefix) + " AS pid,\n" +
    "       hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt,\n" +
    "       mutation_variant AS mv, cna_alteration AS cna,\n" +
    // the study's own driver call and tier, and whether the mutation is germline (lib/driver-settings.ts)
    "       driver_filter AS df, driver_tiers_filter AS dt, toUInt8(" + germlineCondSql() + ") AS germ,\n" +
    "       CAST(NULL AS Nullable(Int64)) AS ps, CAST(NULL AS Nullable(Int64)) AS pe,\n" +
    // a structural variant's key in the OncoKB pair calls (lib/sv-oncokb.ts svDriverKeysSql)
    "       if(variant_type = 'structural_variant', " + SV_EVENT_KEY + ", '') AS svk\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE " + genomicStudySql(study) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND mutation_status != 'UNCALLED'" + // read support, not a call (lib/oql.ts specCond)
    (ranged.length ? "\n  AND NOT (variant_type = 'mutation' AND hugo_gene_symbol IN (" + ranged.map(sq).join(",") + "))" : "") +
    fromColumnSamples("sample_unique_id", study, samples);
  if (!ranged.length) return events;
  const status = "ifNull(mutationStatus, '')";
  return events + "\nUNION ALL\n" +
    "SELECT " + (unit === "sample" ? "sampleId" : "patientId") + " AS pid,\n" +
    "       `GENE.hugoGeneSymbol` AS gene, 'mutation' AS vt, ifNull(mutationType, '') AS mt,\n" +
    "       ifNull(proteinChange, '') AS mv, CAST(NULL AS Nullable(Int8)) AS cna,\n" +
    "       ifNull(driverFilter, '') AS df, ifNull(driverTiersFilter, '') AS dt, toUInt8(positionCaseInsensitive(" + status + ", 'germline') > 0) AS germ,\n" +
    "       proteinPosStart AS ps, proteinPosEnd AS pe, '' AS svk\n" +
    "FROM " + db + ".mutation_derived\n" +
    "WHERE " + mutationStudySql(study) + " AND `GENE.hugoGeneSymbol` IN (" + ranged.map(sq).join(",") + ")\n" +
    "  AND " + status + " != 'UNCALLED'" +
    fromColumnSamples("concat(studyId, '_', sampleId)", study, samples);
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
 * One row per column: how many queried samples its patient has, and a bitmask over
 * PROFILED_TYPES, bit i set when some sample of the column is in a profile of that type whatever
 * its genes — the portal's "# Samples per Patient" and "Profiled for <type>" rows, from one scan.
 * A sample column carries its patient's count, as the portal's patient attribute does.
 */
export function columnFactsSql(study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  const puidPrefix = study + "_";
  const types = PROFILED_TYPES.map(([t]) => sq(t)).join(",");
  const perPatient = unit === "sample"
    ? "JOIN (SELECT patient_unique_id, uniqExact(sample_unique_id) AS n FROM " + db + ".sample_derived\n" +
      "      WHERE cancer_study_identifier = " + sq(study) + fromColumnSamples("sample_unique_id", study, samples) + "\n" +
      "      GROUP BY patient_unique_id) pn ON pn.patient_unique_id = sd.patient_unique_id\n"
    : "";
  return "SELECT " + idCol(unit, puidPrefix, "sd.") + " AS pid,\n" +
    "       " + (unit === "sample" ? "any(pn.n)" : "uniqExact(sd.sample_unique_id)") + " AS samples,\n" +
    "       toUInt8(groupBitOr(if(sp.alteration_type = '', 0, bitShiftLeft(toUInt8(1), toUInt8(indexOf([" + types + "], sp.alteration_type) - 1))))) AS mask\n" +
    "FROM " + db + ".sample_derived sd\n" +
    "LEFT JOIN (SELECT sample_unique_id, alteration_type FROM " + db + ".sample_to_gene_panel_derived\n" +
    "           WHERE cancer_study_identifier = " + sq(study) + " AND alteration_type IN (" + types + ")) sp ON sp.sample_unique_id = sd.sample_unique_id\n" +
    perPatient +
    "WHERE sd.cancer_study_identifier = " + sq(study) + fromColumnSamples("sd.sample_unique_id", study, samples) + "\n" +
    "GROUP BY pid";
}

/**
 * The mutation spectrum row as clinical rows (pid, MUTATION_SPECTRUM, "C>A,C>G,C>T,T>A,T>C,T>G"
 * counts): every single-base substitution of the study's mutation profiles, all genes, folded to
 * the pyrimidine strand (C>A includes G>T, ...), as the portal's MutationSpectrumService counts
 * them (ONC-STM-6); a patient's, its samples' summed.
 */
export function spectrumSql(study: string, db: string, unit: Unit, samples?: string | null): string {
  const pre = sq(study + "_");
  const pair = (a: string, b: string, ac: string, bc: string) =>
    "countIf((me.reference_allele = '" + a + "' AND me.tumor_seq_allele = '" + b + "') OR (me.reference_allele = '" + ac + "' AND me.tumor_seq_allele = '" + bc + "'))";
  const counts = [pair("C", "A", "G", "T"), pair("C", "G", "G", "C"), pair("C", "T", "G", "A"), pair("T", "A", "A", "T"), pair("T", "C", "A", "G"), pair("T", "G", "A", "C")];
  return "SELECT replaceOne(" + (unit === "sample" ? "sd.sample_unique_id" : "sd.patient_unique_id") + ", " + pre + ", '') AS pid, " + sq(SPECTRUM_TRACK) + " AS k,\n" +
    "       arrayStringConcat([" + counts.map((c) => "toString(" + c + ")").join(", ") + "], ',') AS v\n" +
    "FROM " + db + ".mutation m\n" +
    "JOIN " + db + ".mutation_event me ON me.mutation_event_id = m.mutation_event_id\n" +
    "JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = m.genetic_profile_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "JOIN " + db + ".sample_derived sd ON sd.internal_id = m.sample_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'" +
    (samples ? "\n  AND replaceOne(sd.sample_unique_id, " + pre + ", '') IN (" + samples + ")" : "") + "\n" +
    "GROUP BY pid\n" +
    // a case none of whose mutations is a single-base substitution has no spectrum, as the portal's
    // (MutationSpectrumServiceImpl groups only the snpOnly mutations by sample)
    "HAVING " + counts.join(" + ") + " > 0";
}

export function clinicalSql(attrs: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  if (attrs.includes(SPECTRUM_TRACK)) {
    const rest = attrs.filter((a) => a !== SPECTRUM_TRACK);
    return rest.length ? clinicalSql(rest, study, db, unit, samples) + "\nUNION ALL\n" + spectrumSql(study, db, unit, samples) : spectrumSql(study, db, unit, samples);
  }
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
  // A patient-level row wins. A sample-level attribute (e.g. CANCER_TYPE in MSK studies) is the
  // portal's patient value of its samples in the cohort (fillClinicalTrackDatum; ONC-TT-12,
  // ONC-STM-5), by the attribute's declared datatype: a NUMBER, the mean of the values that are
  // numbers (MUTATION_COUNT their max), no value when none is; anything else, the value when the
  // samples agree, otherwise "Mixed". A NUMBER's value is a number only when the whole text is one:
  // the portal's parseFloat reads Gleason "4+3" as 4, and a case with no MUTATION_COUNT as 0, and
  // both are left as no value here (docs/PORTAL-PARITY.md, ONC-TT-12).
  const smp = "type = 'sample'", num = finiteSql("attribute_value");
  const declaredNumbers = "SELECT cam.attr_id FROM " + clinicalMetaTable(db) + " cam\n" +
    "         JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
    "         WHERE cs.cancer_study_identifier = " + sq(study) + " AND upper(cam.datatype) = 'NUMBER'";
  return "SELECT pid, k, v FROM (\n" +
    "  SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       attribute_name AS k, attribute_name IN (" + declaredNumbers + ") AS declared_number,\n" +
    "       multiIf(countIf(type = 'patient') > 0,\n" +
    "           if(declared_number, toString(anyIf(" + num + ", type = 'patient')), anyIf(attribute_value, type = 'patient')),\n" +
    "         declared_number,\n" +
    "           if(countIf(" + smp + " AND " + num + " IS NOT NULL) = 0, NULL,\n" +
    "             toString(if(attribute_name = 'MUTATION_COUNT', maxIf(" + num + ", " + smp + "), avgIf(" + num + ", " + smp + ")))),\n" +
    "         uniqExactIf(attribute_value, " + smp + ") > 1, 'Mixed', anyIf(attribute_value, " + smp + ")) AS v\n" +
    "  FROM " + clinicalTable(db, attrs) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "    AND " + inAttrs +
    (samples ? "\n    AND (type = 'patient' OR replaceOne(sample_unique_id, " + sq(puidPrefix) + ", '') IN (" + samples + "))" : "") + "\n" +
    "  GROUP BY pid, k\n" +
    ") WHERE v IS NOT NULL";
}

/** the study's molecular profiles: profile type (its stable id less the study), alteration type, datatype */
export function profileInventorySql(study: string = STUDY, db: string = DB): string {
  return "SELECT replaceOne(gp.stable_id, " + sq(study + "_") + ", '') AS pt, gp.genetic_alteration_type AS type, gp.datatype AS datatype\n" +
    "FROM " + db + ".genetic_profile gp JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study);
}

/** each attribute's display name and datatype in the study (attr, name, datatype): the Tabular download's row name, and whether its track is bars or categories */
export function clinicalNamesSql(attrs: string[], study: string = STUDY, db: string = DB): string | null {
  attrs = attrs.filter((a) => a !== SPECTRUM_TRACK);
  if (!attrs.length) return null;
  return "SELECT cam.attr_id AS a, any(cam.display_name) AS n, upper(any(cam.datatype)) AS d FROM " + clinicalMetaTable(db) + " cam\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND cam.attr_id IN (" + attrs.map(sq).join(",") + ")\n" +
    "GROUP BY a";
}

// per-study molecular-profile inventory (validation for heatmap tracks), and each profile's
// alteration type and datatype ("MRNA_EXPRESSION Z-SCORE"), which names its rows in the Tabular download
const _profCache = new Map<string, Set<string>>();
const _kindCache = new Map<string, Map<string, string>>();
async function studyProfileTypes(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<Set<string>> {
  const key = conn.id + "." + db + "." + study;
  if (_profCache.has(key) && !studiesChangeWhileRunning()) return _profCache.get(key)!;
  const r = await chQuery(profileInventorySql(study, db), conn);
  const set = new Set((r.data as ChRow[]).filter((x) => inGeneticAlterationDerived(String(x.type))).map((x) => String(x.pt)));
  _profCache.set(key, set);
  _kindCache.set(key, new Map((r.data as ChRow[]).map((x) => [String(x.pt), String(x.type) + " " + String(x.datatype)])));
  return set;
}
async function studyProfileKinds(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<Map<string, string>> {
  await studyProfileTypes(study, db, conn);
  return _kindCache.get(conn.id + "." + db + "." + study) ?? new Map();
}

// per-study generic-assay profiles, by profile type: their datatype and whether a value is a patient's
type AssayProfile = { datatype: string; patientLevel: boolean; pivot?: number; sortOrder?: "ASC" | "DESC" };
const _assayCache = new Map<string, Map<string, AssayProfile>>();
async function studyAssayProfiles(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<Map<string, AssayProfile>> {
  const key = conn.id + "." + db + "." + study;
  if (_assayCache.has(key) && !studiesChangeWhileRunning()) return _assayCache.get(key)!;
  const r = await chQuery("SELECT replaceOne(gp.stable_id, " + sq(study + "_") + ", '') AS pt, gp.datatype AS datatype, toInt32OrZero(ifNull(toString(gp.patient_level), '')) AS pl,\n" +
    "       toString(gp.pivot_threshold) AS pivot, upper(ifNull(toString(gp.sort_order), '')) AS so\n" +
    "FROM " + db + ".genetic_profile gp JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND gp.genetic_alteration_type = 'GENERIC_ASSAY'", conn);
  // the profile's pivot threshold and sort order shape its heatmap's colours (assayScale)
  const m = new Map((r.data as ChRow[]).map((x): [string, AssayProfile] => {
    // stored as a float32: 0.001 reads back as 0.0010000000474974513, the portal's API sends 0.001
    const pivot = x.pivot == null || x.pivot === "" ? NaN : Number(fmtFloat32(Number(x.pivot)));
    return [String(x.pt), { datatype: String(x.datatype), patientLevel: Number(x.pl) === 1,
      ...(Number.isFinite(pivot) ? { pivot } : {}), ...(x.so === "ASC" || x.so === "DESC" ? { sortOrder: x.so } : {}) }];
  }));
  _assayCache.set(key, m);
  return m;
}

// synthetic "VAF" heatmap profile: variant allele fraction from mutation allele
// counts (the portal's "Variant Allele Frequency in Selected Mutations Profile").
// Patient-level value = max across the patient's mutations in the gene.
const _vafCache = new Map<string, boolean>();
async function vafAvailable(study: string, db: string = DB, conn: ChConn = PRIMARY): Promise<boolean> {
  const key = conn.id + "." + db + "." + study;
  if (_vafCache.has(key) && !studiesChangeWhileRunning()) return _vafCache.get(key)!;
  const r = await chQuery("SELECT 1 FROM " + db + ".mutation_derived WHERE " + mutationStudySql(study) + " AND tumorAltCount > 0 LIMIT 1", conn);
  const ok = r.data.length > 0;
  _vafCache.set(key, ok);
  return ok;
}
export function vafSql(genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  // one row per column profiled for the gene in a mutation profile (the portal's
  // createHeatmapTracksData keeps only those): its largest VAF, or NULL when no mutation of the
  // gene there has usable counts (getVariantAlleleFrequency: alt / (alt + ref), so alt 0 is a VAF of 0)
  const list = genes.map(sq).join(",");
  return "SELECT pid, gene, if(countIf(ok = 1) = 0, NULL, maxIf(vaf, ok = 1)) AS v FROM (\n" +
    "  SELECT " + idCol(unit, study + "_", unit === "sample" ? "sp." : "sd.") + " AS pid, pg.gene AS gene, toNullable(toFloat64(0)) AS vaf, 0 AS ok\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + list + ")\n" +
    (unit === "sample" ? "" : "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n") +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'" +
    fromColumnSamples("sp.sample_unique_id", study, samples) + "\n" +
    "  UNION ALL\n" +
    "  SELECT " + (unit === "sample" ? "sampleId" : "patientId") + ", `GENE.hugoGeneSymbol`, tumorAltCount / (tumorAltCount + tumorRefCount), 1\n" +
    "  FROM " + db + ".mutation_derived\n" +
    "  WHERE " + mutationStudySql(study) + " AND `GENE.hugoGeneSymbol` IN (" + list + ")\n" +
    "    AND tumorAltCount >= 0 AND tumorRefCount >= 0 AND tumorAltCount + tumorRefCount > 0 AND molecularProfileId NOT LIKE '%uncalled%'" +
    (samples ? "\n    AND sampleId IN (" + samples + ")" : "") + "\n" +
    ")\nGROUP BY pid, gene HAVING countIf(ok = 0) > 0";
}

/**
 * A row's EXP / PROT values: one row per SAMPLE (pid, gene, z), never combined, so each sample's
 * value meets the row's OQL on its own as the portal's datum does (DataUtils
 * fillGeneticTrackDatum); a patient column's samples all carry its id. Values that are not
 * numbers are left out.
 */
export function expressionEventsSql(profileType: string, genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  return "SELECT " + (unit === "sample" ? "replaceOne(ga.sample_unique_id, " + sq(study + "_") + ", '')" : "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')") + " AS pid,\n" +
    "       ga.hugo_gene_symbol AS gene, " + finiteSql("ga.alteration_value") + " AS z\n" +
    "FROM " + db + ".genetic_alteration_derived ga\n" +
    (unit === "sample" ? "" : "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n") +
    "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "  AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND " + finiteSql("ga.alteration_value") + " IS NOT NULL" + fromColumnSamples("ga.sample_unique_id", study, samples);
}

/** a group's value furthest from 0, sign kept; of a ± tie the positive one */
const furthestFromZero = (v: string): string => "argMax(" + v + ", (abs(" + v + "), " + v + "))";

// Continuous values for heatmap tracks, one row per (column, gene): in patient mode a patient's
// samples give the one furthest from 0, sign kept, as the portal aggregates a heatmap (ONC-STM-7).
// Of two values equally far from 0 the positive one, so the answer does not depend on the order
// rows arrive in; the portal takes its first sample's (docs/PORTAL-PARITY.md).
export function heatmapSql(profileType: string, genes: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", samples?: string | null): string {
  // values are stored per sample; only patient mode has to combine them
  return "SELECT " + (unit === "sample" ? "replaceOne(ga.sample_unique_id, " + sq(study + "_") + ", '')" : "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')") + " AS pid,\n" +
    "       ga.hugo_gene_symbol AS gene, " + furthestFromZero(finiteSql("ga.alteration_value")) + " AS v\n" +
    "FROM " + db + ".genetic_alteration_derived ga\n" +
    (unit === "sample" ? "" : "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n") +
    "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "  AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND " + finiteSql("ga.alteration_value") + " IS NOT NULL" + fromColumnSamples("ga.sample_unique_id", study, samples) + "\n" +
    "GROUP BY pid, gene";
}

// A generic-assay profile's values for heatmap tracks, one row per (column, entity): in patient
// mode a patient's samples give the one furthest from 0, as heatmapSql, and a patient-level
// assay's value goes to each of the patient's samples in sample mode. Values that are not
// numbers are left out.
/** the portal's threshold value (GenericAssayMolecularDataCache handleValueThreshold): ">" or "<", spaces, then a number */
const THRESHOLD_RE = /^([><]) *(-?\d+(\.\d+)?)$/;
const THRESHOLD_SQL = "'^[<>] *-?[0-9]+([.][0-9]+)?$'";
/**
 * A generic-assay value as the portal reads it: a threshold value (">90", "< 0.0015") is its
 * number with its sign kept; any other number is itself with no sign; anything else is null.
 */
export function parseThresholdValue(text: string): { value: number; threshold: ">" | "<" | "" } | null {
  const m = THRESHOLD_RE.exec(text);
  if (m) return { value: Number(m[2]), threshold: m[1] as ">" | "<" };
  const x = finiteNumber(text);
  return Number.isFinite(x) ? { value: x, threshold: "" } : null;
}

export function assayHeatmapSql(profileType: string, entities: string[], study: string = STUDY, db: string = DB, unit: Unit = "patient", patientLevel = false, samples?: string | null): string {
  const strip = (col: string) => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";
  const sampleLevel = unit === "sample" && patientLevel;
  // a threshold value counts as its number; the representing value is the furthest from 0, of a
  // tie the positive, then the one without a threshold (DataUtils selectRepresentingDataPoint)
  const isThr = "match(g.value, " + THRESHOLD_SQL + ")";
  const num = "if(" + isThr + ", " + finiteSql("replaceRegexpOne(g.value, '^[<>] *', '')") + ", " + finiteSql("g.value") + ")";
  const rank = "(abs(" + num + "), " + num + ", NOT " + isThr + ")";
  return "SELECT " + (unit === "sample" ? strip(sampleLevel ? "sd.sample_unique_id" : "g.sample_unique_id") : strip("g.patient_unique_id")) + " AS pid,\n" +
    "       g.entity_stable_id AS gene, argMax(" + num + ", " + rank + ") AS v,\n" +
    "       argMax(if(" + isThr + ", substring(g.value, 1, 1), ''), " + rank + ") AS t\n" +
    "FROM " + db + ".generic_assay_data_derived g\n" +
    (sampleLevel ? "JOIN " + db + ".sample_derived sd ON sd.patient_unique_id = g.patient_unique_id\n" : "") +
    "WHERE g.profile_type = " + sq(profileType) + " AND g.profile_stable_id = " + sq(study + "_" + profileType) + "\n" +
    "  AND g.entity_stable_id IN (" + entities.map(sq).join(",") + ")\n" +
    "  AND " + num + " IS NOT NULL" +
    // a patient-level row (the patient in both id columns) has no sample to test
    (samples && !patientLevel ? fromColumnSamples("g.sample_unique_id", study, samples) : "") + "\n" +
    "GROUP BY pid, gene";
}

/**
 * The profiles the query's default OQL line is built from, in the portal's order (its
 * selectedMolecularProfiles: each study's profiles by id, studies in turn): every mutation,
 * discrete copy-number and structural-variant profile a study holds, and the mRNA / protein
 * profile the query's EXP / PROT read. A peer's study, whose profile kinds are not known here,
 * adds the types its columns were profiled for after the rest.
 */
export async function defaultOqlProfiles(studies: string[], peers: { has(s: string): boolean }, masks: { mask: number }[],
  spec: Pick<OncoprintSpec, "exp" | "prot">, kindsOf: (s: string) => Promise<Map<string, string>>): Promise<{ id: string; type: string }[]> {
  const out: { id: string; type: string }[] = [];
  for (const s of studies) {
    if (peers.has(s)) continue;
    const mine: { id: string; type: string }[] = [];
    for (const [id, kind] of await kindsOf(s)) {
      const [type, datatype] = kind.split(" ");
      if (type === "MUTATION_EXTENDED" || type === "STRUCTURAL_VARIANT" || (type === "COPY_NUMBER_ALTERATION" && datatype === "DISCRETE")
        || (type === "MRNA_EXPRESSION" && id === spec.exp) || (type === "PROTEIN_LEVEL" && id === spec.prot)) mine.push({ id, type });
    }
    out.push(...mine.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }
  if (studies.some((s) => peers.has(s))) {
    const any = masks.reduce((m, r) => m | r.mask, 0);
    const asked = (type: string) => type === "MRNA_EXPRESSION" ? !!spec.exp : type === "PROTEIN_LEVEL" ? !!spec.prot : true;
    PROFILED_TYPES.forEach(([type], i) => { if (any & (1 << i) && asked(type)) out.push({ id: "", type }); });
  }
  return out;
}

export function normalizeSpec(spec: OncoprintSpec) {
  // `geneList` is the rows (a symbol, or a merged group); `genes` is the flat symbol list every
  // query and the coverage mask are built from. One normalizer owns both, and the assembler runs
  // the same one on `geneList`, so the mask's bit order cannot disagree with the SQL's.
  const { tracks: geneTracks, symbols: genes } = normalizeGeneTracks(spec.genes || []);
  if (!genes.length) throw new Error("at least one valid gene symbol required");
  const geneList = toGeneList(geneTracks);
  // genes a row's OQL tests by protein position, whose mutations are read with their positions
  const rangeGenes = geneTracks.filter((t) => t.oql?.some((x) => x.range)).map((t) => t.members[0]);
  // genes a row's EXP / PROT reads, and the profiles they read (the query page's choice)
  const levelGenes = { EXP: [] as string[], PROT: [] as string[] };
  for (const t of geneTracks) for (const x of t.oql || [])
    if ((x.type === "EXP" || x.type === "PROT") && !levelGenes[x.type].includes(t.members[0])) levelGenes[x.type].push(t.members[0]);
  const levelPins = specLevelPins(spec);
  const clinical = (spec.clinical || []).map(String);
  if (clinical.length > CLINICAL_TRACK_LIMIT)
    throw new Error("clinical: " + clinical.length + " tracks asked for; an oncoprint draws at most " + CLINICAL_TRACK_LIMIT);
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
  return { genes, geneList, rangeGenes, levelGenes, levelPins, clinical, derivedEvents, lineGap, sort, heatmap, unit, overlays,
    hideTracks: specHideTracks(spec.hideTracks),
    // Show OQL filters is on by default only for a query with OQL (ResultsViewOncoprint 528)
    display: normalizeDisplay(spec.display, spec.drivers, geneTracks.some((t) => t.oql)) };
}

/** the automatic rows a view switches off: labels from AUTO_TRACKS, anything else refused */
function specHideTracks(v: unknown): string[] {
  if (v == null) return [];
  const takes = "it takes " + AUTO_TRACKS.map((l) => "\"" + l + "\"").join(", ");
  if (!Array.isArray(v)) throw new Error("hideTracks: a list of automatic rows; " + takes);
  for (const x of v) if (typeof x !== "string" || !isAutoTrack(x))
    throw new Error("hideTracks: \"" + String(x).slice(0, 60) + "\" is not an automatic row; " + takes);
  return [...new Set(v as string[])];
}

/** the profiles a row's EXP / PROT read, as an oql clause names them (ids without the study prefix) */
function specLevelPins(spec: OncoprintSpec): OqlPins {
  const pins: OqlPins = {};
  for (const [k, t] of [["exp", "EXP"], ["prot", "PROT"]] as const) {
    const v = spec[k];
    if (v == null) continue;
    if (typeof v !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(v)) throw new Error("oncoprint: " + k + " names a profile by its id without the study prefix");
    pins[t] = v;
  }
  if (spec.ifHeld != null) {
    if (spec.ifHeld !== true) throw new Error("oncoprint: ifHeld is true or left out");
    pins.ifHeld = true;
  }
  return pins;
}

/** a study's share of a row's EXP / PROT values: each read as (pid, gene, z), labelled with its type */
async function levelRows(levelGenes: { EXP: string[]; PROT: string[] }, pins: OqlPins, profiles: string[],
  read: (label: string, sql: string) => Promise<unknown[][]>, sql: (profile: string, genes: string[]) => string): Promise<unknown[][]> {
  const out: unknown[][] = [];
  for (const type of ["EXP", "PROT"] as const) {
    if (!levelGenes[type].length) continue;
    const profile = expressionProfileFor(type, profiles, pins);
    for (const r of await read("oncoprint:" + (type === "EXP" ? "mRNA" : "protein") + " levels", sql(profile, levelGenes[type])))
      out.push([r[0], r[1], type === "EXP" ? "exp" : "prot", r[2]]);
  }
  return out;
}

/** The study a single-study spec draws: `studies` when it lists exactly one, else `study`. */
function specStudy(spec: OncoprintSpec): string {
  const listed = Array.isArray(spec.studies) && spec.studies.length === 1 ? spec.studies[0] : null;
  return String(listed || spec.study || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
}

// Provenance: the exact SQL a spec compiles to, without executing anything.
export function specToQueries(spec: OncoprintSpec, pin?: string | null) {
  const study = specStudy(spec);
  const { genes, rangeGenes, clinical, derivedEvents, lineGap, unit } = normalizeSpec(spec);
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
  queries.push({ label: "genomic events (mutations, CNA, SV) for the gene tracks", sql: genomicEventsSql(genes, study, DB, unit, samples, rangeGenes) });
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
  /** pid, gene, vt, mt, mv, cna, df, dt, germ, ps, pe */
  events: unknown[][];
  /** pid, mask */
  coverage: unknown[][];
  /** pid, samples, mask */
  facts: unknown[][];
  /** pid, attribute, value */
  clinical: unknown[][];
  /** attribute, display name, datatype */
  clinicalNames?: unknown[][];
  /**
   * per heatmap spec: the study's generic assay of that profile type, if it has one; whether it has
   * the profile as a gene profile (or, for VAF, allele counts); and the values a track would draw
   */
  heatmap: { assay: AssayProfile | null; available: boolean; values: unknown[][];
    /** a gene profile's alteration type and datatype, "MRNA_EXPRESSION Z-SCORE" (absent from an older peer) */
    kind?: string }[];
  /** per overlay spec: whether the study has the profile, and its values */
  overlays: { available: boolean; values: unknown[][] }[];
  /** pid, gene, "exp" | "prot", z: the values a row's EXP / PROT reads, one per sample */
  levels: unknown[][];
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
  exp?: string; prot?: string; ifHeld?: boolean;
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
    const { genes, rangeGenes, levelGenes, levelPins, clinical, heatmap, overlays, unit, lineGap } = normalizeSpec({ genes: req.genes, clinical: req.clinical,
      heatmap: req.heatmap, overlays: req.overlays, unit: req.unit, conventions: { lineGap: req.lineGap },
      ...(req.exp ? { exp: req.exp } : {}), ...(req.prot ? { prot: req.prot } : {}), ...(req.ifHeld ? { ifHeld: req.ifHeld } : {}) });
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
    const [events, coverage, facts, clinicalRows, clinicalNames] = await Promise.all([
      rows("oncoprint:alterations", genomicEventsSql(genes, study, db, unit, samples, rangeGenes)),
      rows("oncoprint:coverage", coverageSql(genes, study, db, unit, samples)),
      rows("oncoprint:profiledTypes", columnFactsSql(study, db, unit, samples)),
      clinical.length ? rows("oncoprint:clinicalTracks", clinicalSql(clinical, study, db, unit, samples)) : Promise.resolve([]),
      ((q) => q ? rows("oncoprint:clinicalNames", q) : Promise.resolve([]))(clinicalNamesSql(clinical, study, db))
    ]);
    const types = await studyProfileTypes(study, db, conn);
    const kinds = await studyProfileKinds(study, db, conn);
    const assayProfiles = await studyAssayProfiles(study, db, conn);
    // each heatmap's values as the contract would take them from this study: an assay's when the
    // spec names entities and the assay is numeric, a gene profile's (or VAF) otherwise
    const heat: StudyInputs["heatmap"] = [];
    for (const h of heatmap) {
      const isVaf = /^vaf$/i.test(h.profileType);
      const a = isVaf ? undefined : assayProfiles.get(h.profileType);
      if (a) {
        heat.push({ assay: { datatype: a.datatype, patientLevel: a.patientLevel, ...(a.pivot != null ? { pivot: a.pivot } : {}), ...(a.sortOrder ? { sortOrder: a.sortOrder } : {}) }, available: false,
          values: h.assay && !isCategoricalAssay(a.datatype)
            ? await rows("oncoprint:assay heatmap", assayHeatmapSql(h.profileType, h.genes, study, db, unit, a.patientLevel, samples)) : [] });
        continue;
      }
      const available = isVaf ? await vafAvailable(study, db, conn) : types.has(h.profileType);
      const kind = isVaf ? undefined : kinds.get(h.profileType);
      heat.push({ assay: null, available, ...(kind ? { kind } : {}), values: available && !h.assay
        ? await rows(isVaf ? "oncoprint:vaf" : "oncoprint:heatmap", isVaf ? vafSql(h.genes, study, db, unit, samples) : heatmapSql(h.profileType, h.genes, study, db, unit, samples))
        : [] });
    }
    const over: StudyInputs["overlays"] = [];
    for (const ov of overlays) {
      const available = types.has(ov.profileType);
      over.push({ available, values: available ? await rows("oncoprint:overlay " + ov.kind, heatmapSql(ov.profileType, genes, study, db, unit, samples)) : [] });
    }
    const levels = await levelRows(levelGenes, levelPins, [...types], rows, (profile, g) => expressionEventsSql(profile, g, study, db, unit, samples));
    return { genes, groups, events, coverage, facts, clinical: clinicalRows, clinicalNames, heatmap: heat, overlays: over, levels,
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
  const table = (v: unknown, width: number | number[], what: string): unknown[][] =>
    Array.isArray(v) && v.every((row) => Array.isArray(row) && (Array.isArray(width) ? width.includes(row.length) : row.length === width) && typeof row[0] === "string") ? v as unknown[][] : bad(what);
  const strings = (v: unknown, what: string): string[] => Array.isArray(v) && v.every((p) => typeof p === "string") ? v as string[] : bad(what);
  if (!r || typeof r !== "object") bad("rows");
  const groups = Array.isArray(r.groups) && r.groups.length === nGroups ? r.groups.map(ids) : bad("column groups");
  const heatmap = (Array.isArray(r.heatmap) ? r.heatmap : bad("heatmap tracks")).map((h: Record<string, unknown>) => {
    const a = h?.assay as Record<string, unknown> | null;
    return { assay: a ? { datatype: String(a.datatype), patientLevel: a.patientLevel === true,
      ...(typeof a.pivot === "number" && Number.isFinite(a.pivot) ? { pivot: a.pivot } : {}),
      ...(a.sortOrder === "ASC" || a.sortOrder === "DESC" ? { sortOrder: a.sortOrder as "ASC" | "DESC" } : {}) } : null,
      available: h?.available === true, values: table(h?.values, [3, 4], "heatmap values"),
      ...(typeof h?.kind === "string" && /^[A-Z_]{1,40} [A-Z0-9_-]{1,40}$/.test(h.kind) ? { kind: h.kind } : {}) };
  });
  const overlays = (Array.isArray(r.overlays) ? r.overlays : bad("overlays")).map((o: Record<string, unknown>) =>
    ({ available: o?.available === true, values: table(o?.values, 3, "overlay values") }));
  return { genes: strings(r.genes, "genes"), groups, events: table(r.events, [11, 12], "alterations"), coverage: table(r.coverage, 2, "panel coverage"),
    facts: table(r.facts, 3, "column facts"), clinical: table(r.clinical, 3, "clinical values"),
    ...(r.clinicalNames === undefined ? {} : { clinicalNames: table(r.clinicalNames, 3, "clinical display names and datatypes") }), heatmap, overlays,
    levels: table(r.levels, 4, "expression levels").map((x) => x[2] === "exp" || x[2] === "prot" ? x : bad("expression levels")),
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
  const { genes, geneList, rangeGenes, levelGenes, levelPins, clinical, derivedEvents, lineGap, sort, heatmap, display, unit, overlays, hideTracks } = normalizeSpec(spec);
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
      overlays: (spec.overlays || []).slice(0, 2), unit, lineGap,
      ...(spec.exp ? { exp: spec.exp } : {}), ...(spec.prot ? { prot: spec.prot } : {}), ...(spec.ifHeld ? { ifHeld: spec.ifHeld } : {}) }).then((r) => {
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
  let caseListRank: Map<string, number> | undefined;
  const studyOf = new Map<string, string>(); // columnId -> study (avoids prefix-ambiguity parsing)
  // each study's cohort rows per column group, in group order: what patient columns are built from
  const rowsByStudy = new Map<string, string[]>(studies.map((s) => [s, []]));
  // each study's samples its patient columns are built from: a column's samples in the group it is drawn in
  const columnSamples = new Map<string, string[]>(studies.map((s) => [s, []]));
  // a peer study's columns in a group, as the peer drew them (their samples stay with the peer)
  const peerColumns = async (s: string, gi: number): Promise<{ s: string; cols: ColumnRows }> =>
    ({ s, cols: { pids: (await peerShare(s)).groups[gi], samples: new Map() } });
  const inStudyOrder = <T extends { s: string }>(xs: T[]): T[] => studies.flatMap((s) => xs.filter((x) => x.s === s));
  // each column's place in the user-defined case list its cohort is chosen by, when it is (ONC-SO-3)
  const rankByCaseList = async (dsl: unknown, s: string, rows: string, cols: ColumnRows): Promise<void> => {
    const list = caseListOf(dsl, s);
    if (!list) return;
    let patientOf: Map<string, string> | undefined;
    if (unit === "sample" && list.level === "patient") {
      const r = await lqRows("oncoprint:caseListPatients", "SELECT DISTINCT sid, pid FROM (\n" + rows + "\n)", s);
      patientOf = new Map(r.rows.map((x) => [x[0] as string, x[1] as string]));
    }
    caseListRank ??= new Map();
    for (const [c, r] of caseListRanks(list, cols.pids, unit, (c) => cols.samples.get(c), patientOf && ((x) => patientOf!.get(x))))
      if (!caseListRank.has(qual(s, c))) caseListRank.set(qual(s, c), r);
  };
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
        per = await Promise.all(held.map(async (s) => {
          const cols = columnRows((await lqRows("oncoprint:columns", columnRowsSql((v as Record<string, string>)[s], unit), s)).rows);
          await rankByCaseList(g.dsl, s, (v as Record<string, string>)[s], cols);
          return { s, cols };
        }));
      } else {
        // no pre-compiled SQL: compile the definition against each study in turn
        per = await Promise.all(studies.filter((s) => !peers.has(s)).map(async (s) => {
          const rows = cohortRowsSql({ ...g.dsl, lineGap }, s, dbOf(s), pin);
          rowsByStudy.get(s)!.push(rows);
          const cols = await cohortColumns(rows, s, opts.log, "oncoprint:columns", unit, connOf(s));
          await rankByCaseList(g.dsl, s, rows, cols);
          return { s, cols };
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
    await rankByCaseList(spec.cohort.dsl, study, rows, cols);
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
    : Promise.all([lqRows("oncoprint:alterations", genomicEventsSql(genes, s, dbOf(s), unit, samplesOf(s), rangeGenes), s),
                 lqRows("oncoprint:coverage", coverageSql(genes, s, dbOf(s), unit, samplesOf(s)), s),
                 lqRows("oncoprint:profiledTypes", columnFactsSql(s, dbOf(s), unit, samplesOf(s)), s)]).then(([e, c, p]) => ({ s, e, c, p }))));
  for (const { s, e, c, p } of evFetched) {
    const pref = multi ? s + "_" : "";
    // column order is the SELECT's: pid, gene, vt, mt, mv, cna, df, dt, germ, ps, pe, svk; a peer's
    // structural variants are not in this instance's database, so their key finds no pair call here
    for (const r of e.rows) events.push({ pid: pref + (r[0] as string), gene: r[1] as string, vt: r[2] as string, mt: r[3] as string, mv: r[4] as string, cna: r[5] as string,
      df: (r[6] as string) ?? null, dt: (r[7] as string) ?? null, germ: Number(r[8] ?? 0) === 1,
      ps: r[9] == null ? null : Number(r[9]), pe: r[10] == null ? null : Number(r[10]), ...(r[11] && !peers.has(s) ? { svk: r[11] as string } : {}) });
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
  // the view's driver settings decide the calls; with no source on, nothing is a driver and the
  // figure says so rather than looking as though nothing was annotated. "Every tier" is a source
  // only where these alterations carry a tier (forData).
  const drivers = forData(display.drivers!, events.some((e) => e.dt));
  if (drivers !== display.drivers) Object.assign(display, { drivers, hideVUS: drivers.hideVus, annotate: drivers.annotated ? "oncokb" : "none" });
  const annotation = await driverAnnotation(drivers, events, genes, multi ? studies : study, (s) => conns.get(s) ?? PRIMARY);

  // ---- a row's EXP / PROT: each sample's value in the profile it reads ----
  if (levelGenes.EXP.length || levelGenes.PROT.length) {
    const read = await Promise.all(studies.map(async (s) => ({ s, rows: peers.has(s) ? (await peerShare(s)).levels
      : await levelRows(levelGenes, levelPins, [...await studyProfileTypes(s, dbOf(s), connOf(s))],
        async (label, sql) => (await lqRows(label, sql, s)).rows, (profile, g) => expressionEventsSql(profile, g, s, dbOf(s), unit, samplesOf(s))) })));
    for (const { s, rows } of read) {
      const pref = multi ? s + "_" : "";
      for (const r of rows) events.push({ pid: pref + (r[0] as string), gene: r[1] as string, vt: r[2] as string, z: Number(r[3]) });
    }
  }

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
    // each attribute's display name, as the first study that declares one names it
    const named = await Promise.all(studies.map(async (s) => peers.has(s) ? (await peerShare(s)).clinicalNames ?? []
      : await ((q) => q ? lqRows("oncoprint:clinicalNames", q, s).then((r) => r.rows) : [])(clinicalNamesSql(clinical, s, dbOf(s)))));
    // and its datatype, as the first study that declares it does (the portal's uniqBy over the studies' attributes)
    const nameOf = new Map<string, string>([[SPECTRUM_TRACK, SPECTRUM_NAME]]), typeOf = new Map<string, string>();
    for (const rs of named) for (const x of rs) {
      if (!nameOf.has(x[0] as string) && x[1]) nameOf.set(x[0] as string, String(x[1]));
      if (!typeOf.has(x[0] as string) && x[2]) typeOf.set(x[0] as string, String(x[2]));
    }
    for (const attr of clinical) clinicalIn.push({ attr, values: byAttr.get(attr)!, ...(nameOf.has(attr) ? { name: nameOf.get(attr)! } : {}),
      ...(typeOf.has(attr) ? { datatype: typeOf.get(attr)! } : {}) });
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
      const values = new Map<string, number>(), thresholds = new Map<string, ">" | "<">();
      const fetched = await Promise.all(okStudies.map(async (s) =>
        ({ s, r: peers.has(s) ? await peerRows(s, (i) => i.heatmap[hi].values)
          : await lqRows("oncoprint:assay heatmap", assayHeatmapSql(h.profileType, h.genes, s, dbOf(s), unit, !!assays[studies.indexOf(s)]!.patientLevel, samplesOf(s)), s) })));
      for (const { s, r } of fetched)
        for (const row of r.rows) {
          const key = qual(s, row[0] as string) + "|" + (row[1] as string);
          values.set(key, Number(row[2]));
          if (row[3] === ">" || row[3] === "<") thresholds.set(key, row[3]);
        }
      // the profile's pivot and sort order, as the first study holding it declares them
      const meta = assays.find((a) => a);
      heatmapIn.push({ profileType: h.profileType, genes: h.genes, isVaf: false, assay: true, values, ...(thresholds.size ? { thresholds } : {}), profileKind: "GENERIC_ASSAY " + meta!.datatype,
        ...(meta?.pivot != null ? { pivot: meta.pivot } : {}), ...(meta?.sortOrder ? { sortOrder: meta.sortOrder } : {}) });
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
      for (const row of r.rows) values.set(qual(s, row[0] as string) + "|" + (row[1] as string), row[2] == null ? NaN : Number(row[2]));
    const kinds = await Promise.all(okStudies.map(async (s) => peers.has(s) ? (await peerShare(s)).heatmap[hi].kind
      : isVaf ? undefined : (await studyProfileKinds(s, dbOf(s), connOf(s))).get(h.profileType)));
    const profileKind = kinds.find((k) => k);
    heatmapIn.push({ profileType: h.profileType, genes: h.genes, isVaf, values, ...(profileKind ? { profileKind } : {}) });
  }

  // ---- clustering: an order computed here, once, from the molecular values ----
  // "cluster:<profileType>" orders the columns, and that profile's rows, by the portal's
  // clustering: average linkage on 1 − Spearman (lib/oncoprint-cluster.ts).
  // It runs where the values already are, so the SVG, the canvas, the CLI and Python all draw
  // the same order, and the order travels in the contract beside the numbers it describes.
  let clusterRank: Map<string, number> | undefined;
  let clusterMethod: AssembleInput["clusterMethod"];
  const clusterKey = sort.find((k) => k.track.startsWith("cluster:"));
  if (clusterKey) {
    const profileType = clusterKey.track.slice("cluster:".length);
    const h = heatmapIn.find((x) => x.profileType === profileType);
    if (!h) throw new Error("sort: cluster needs '" + profileType + "' as a heatmap profile on this oncoprint" +
      (heatmapIn.length ? " (it has " + heatmapIn.map((x) => x.profileType).join(", ") + ")" : " (it has none)"));
    const rows = h.genes.map((g) => {
      const col = new Float64Array(allPids.length);
      for (let i = 0; i < allPids.length; i++) {
        const v = h.values.get(allPids[i] + "|" + g);
        col[i] = v === undefined ? NaN : v;
      }
      return col;
    });
    const { order, rows: rowOrder, method } = clusterHeatmap({ rows, n: allPids.length });
    clusterRank = new Map<string, number>();
    order.forEach((idx, rank) => clusterRank!.set(allPids[idx], rank));
    // the profile's rows take the clustered order too, as the portal reorders a clustered group
    h.genes = rowOrder.map((d) => h.genes[d]);
    clusterMethod = { profileType, ...method };
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

  // ---- the default OQL line a row without OQL is drawn by (the portal's defaultOQLQuery) ----
  const defaultOql = defaultOqlSublabel(await defaultOqlProfiles(studies, peers, profiledMasks, spec,
    (s) => studyProfileKinds(s, dbOf(s), connOf(s))));

  const queryMs = Date.now() - t0;
  const tAsm = Date.now();
  const contract = assembleContract({
    genes: geneList, groups, studies, studyOf, events, coverage, profiled: { types: profiledTypes, masks: profiledMasks }, samples: samplesPer, defaultOql,
    isDriver: (r) => annotation.isDriver(r as Parameters<typeof annotation.isDriver>[0]), annotationSource: annotation.source,
    clinical: clinicalIn, heatmap: heatmapIn, overlays: overlaysIn, zReference: spec.zReference, derived: derivedIn, sort, lineGap, display, unit, clusterRank, clusterMethod, caseListRank,
    ...(hideTracks.length ? { hideTracks } : {})
  });
  contract.stats.ms = Date.now() - t0;
  contract.stats.queryMs = queryMs;
  contract.stats.assembleMs = Date.now() - tAsm;
  if (opts.provenance && opts.log) contract.queries = opts.log.map((q) => ({ ...q, study: q.study || study }));
  return contract;
}
