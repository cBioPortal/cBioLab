// The file-shaped schema ("lab_" tables) and the views that present it under cBioPortal's table
// names, so the app's SQL runs on it unchanged.
//
// Every lab_ table holds one kind of study file in long form, keyed by the files' own identifiers,
// and every row carries its study_id (the sort key's first column). Rows are versioned
// (ReplacingMergeTree on `version`, `is_deleted`) and read through FINAL. Shared reference data —
// genes, aliases, gene panels, cancer types, reference genomes — stays in cBioPortal's own tables.
//
// The views come in two layers. Base views rebuild cBioPortal's base tables (sample, mutation,
// genetic_profile, …), with each integer id computed from the natural key (`labId`) so the joins
// between them line up. Derived views are cBioPortal's own populate_derived_tables.sql SELECTs
// reading those base views, so the *_derived names hold what that SQL would have built; only
// genetic_alteration_derived is written natively, because the base table it would read stores a
// matrix row as one comma-joined string.
//
// A database's schema mode decides where the views live: `new` gives them cBioPortal's names (the
// legacy tables are gone), `both` keeps the legacy tables and names the views `labv_<name>`, for
// comparing the two on the same import.
import { exec, query, splitStatements, type WriteConn } from "./ch-write.ts";

export type SchemaMode = "legacy" | "new" | "both";
export const SCHEMA_MODES: SchemaMode[] = ["legacy", "new", "both"];
export const writesLegacy = (m: SchemaMode) => m !== "new";
export const writesLab = (m: SchemaMode) => m !== "legacy";
/** Prefix of the compatibility views: none when they stand in for the legacy tables. */
export const viewPrefix = (m: SchemaMode) => (m === "both" ? "labv_" : "");

const VERSIONED = "version UInt64, is_deleted UInt8";
const engine = (order: string) => `ENGINE = ReplacingMergeTree(version, is_deleted) ORDER BY (${order})`;

/** name → column list and sort key. study_id first in every one (test/lab-schema.test.ts). */
export const LAB_TABLES: Record<string, { columns: string; order: string }> = {
  lab_study: {
    columns: "study_id String, type_of_cancer_id String, name String, description String, public Int32, pmid Nullable(String), " +
      "citation Nullable(String), groups Nullable(String), status Nullable(Int64), import_date DateTime64(6), reference_genome String, " +
      "sample_count UInt32, mutation_sample_count UInt32, cna_sample_count UInt32, structural_variant_sample_count UInt32, " +
      "rna_seq_sample_count UInt32, mrna_microarray_sample_count UInt32, mrna_expression_sample_count UInt32, rppa_sample_count UInt32, " +
      "mass_spectrometry_sample_count UInt32, mirna_sample_count UInt32, treatment_patient_count UInt32",
    order: "study_id"
  },
  lab_patient: { columns: "study_id String, patient_id String", order: "study_id, patient_id" },
  lab_sample: { columns: "study_id String, sample_id String, patient_id String, sample_type String", order: "study_id, sample_id" },
  lab_clinical: {
    columns: "study_id String, patient_id String, sample_id String, attr_id String, value String",
    order: "study_id, patient_id, sample_id, attr_id"
  },
  lab_clinical_attribute: {
    columns: "study_id String, attr_id String, display_name String, description String, datatype String, patient_attribute Int32, priority String",
    order: "study_id, attr_id"
  },
  lab_profile: {
    columns: "study_id String, profile_id String, alteration_type String, generic_assay_type Nullable(String), datatype String, name String, " +
      "description Nullable(String), show_in_analysis_tab Int32, pivot_threshold Nullable(Float64), sort_order Nullable(String), patient_level Nullable(Int32)",
    order: "study_id, profile_id"
  },
  lab_sample_profile: {
    columns: "study_id String, sample_id String, profile_id String, panel_id String",
    order: "study_id, sample_id, profile_id"
  },
  lab_profile_value: {
    columns: "study_id String, profile_id String, sample_id String, entrez_gene_id Int64, value String",
    order: "study_id, profile_id, entrez_gene_id, sample_id"
  },
  lab_mutation: {
    columns: "study_id String, profile_id String, sample_id String, entrez_gene_id Int64, chr Nullable(String), start_position Nullable(Int64), " +
      "end_position Nullable(Int64), reference_allele Nullable(String), tumor_seq_allele Nullable(String), protein_change Nullable(String), " +
      "mutation_type Nullable(String), ncbi_build Nullable(String), strand Nullable(String), variant_type Nullable(String), db_snp_rs Nullable(String), " +
      "db_snp_val_status Nullable(String), refseq_mrna_id Nullable(String), codon_change Nullable(String), uniprot_accession Nullable(String), " +
      "protein_pos_start Nullable(Int64), protein_pos_end Nullable(Int64), canonical_transcript Nullable(Int32), keyword Nullable(String), " +
      "center Nullable(String), sequencer Nullable(String), mutation_status Nullable(String), validation_status Nullable(String), " +
      "tumor_seq_allele1 Nullable(String), tumor_seq_allele2 Nullable(String), matched_norm_sample_barcode Nullable(String), " +
      "match_norm_seq_allele1 Nullable(String), match_norm_seq_allele2 Nullable(String), tumor_validation_allele1 Nullable(String), " +
      "tumor_validation_allele2 Nullable(String), match_norm_validation_allele1 Nullable(String), match_norm_validation_allele2 Nullable(String), " +
      "verification_status Nullable(String), sequencing_phase Nullable(String), sequence_source String, validation_method Nullable(String), " +
      "score Nullable(String), bam_file Nullable(String), tumor_alt_count Nullable(Int64), tumor_ref_count Nullable(Int64), " +
      "normal_alt_count Nullable(Int64), normal_ref_count Nullable(Int64), amino_acid_change Nullable(String), annotation_json Nullable(String), " +
      "has_driver UInt8, driver_filter Nullable(String), driver_filter_annotation Nullable(String), driver_tiers_filter Nullable(String), " +
      "driver_tiers_filter_annotation Nullable(String)",
    order: "study_id, profile_id, sample_id, entrez_gene_id, assumeNotNull(chr), assumeNotNull(start_position), assumeNotNull(end_position), " +
      "assumeNotNull(protein_change), assumeNotNull(tumor_seq_allele), assumeNotNull(mutation_type)"
  },
  lab_structural_variant: {
    columns: "study_id String, profile_id String, sample_id String, sv_index UInt32, site1_entrez_gene_id Nullable(Int64), " +
      "site1_ensembl_transcript_id Nullable(String), site1_chromosome Nullable(String), site1_region Nullable(String), site1_region_number Nullable(Int64), " +
      "site1_contig Nullable(String), site1_position Nullable(Int64), site1_description Nullable(String), site2_entrez_gene_id Nullable(Int64), " +
      "site2_ensembl_transcript_id Nullable(String), site2_chromosome Nullable(String), site2_region Nullable(String), site2_region_number Nullable(Int64), " +
      "site2_contig Nullable(String), site2_position Nullable(Int64), site2_description Nullable(String), site2_effect_on_frame Nullable(String), " +
      "ncbi_build Nullable(String), dna_support Nullable(String), rna_support Nullable(String), normal_read_count Nullable(Int64), " +
      "tumor_read_count Nullable(Int64), normal_variant_count Nullable(Int64), tumor_variant_count Nullable(Int64), " +
      "normal_paired_end_read_count Nullable(Int64), tumor_paired_end_read_count Nullable(Int64), normal_split_read_count Nullable(Int64), " +
      "tumor_split_read_count Nullable(Int64), annotation Nullable(String), breakpoint_type Nullable(String), connection_type Nullable(String), " +
      "event_info Nullable(String), class Nullable(String), length Nullable(Int64), comments Nullable(String), sv_status String, " +
      "annotation_json Nullable(String), has_driver UInt8, driver_filter Nullable(String), driver_filter_annotation Nullable(String), " +
      "driver_tiers_filter Nullable(String), driver_tiers_filter_annotation Nullable(String)",
    order: "study_id, profile_id, sv_index"
  },
  lab_segment: {
    columns: "study_id String, sample_id String, chr String, start Int64, end Int64, num_probes Int64, segment_mean Float64",
    order: "study_id, sample_id, chr, start, end"
  },
  lab_timeline_event: {
    columns: "study_id String, patient_id String, event_index UInt32, event_type String, start_date Int64, stop_date Nullable(Int64), data Map(String, String)",
    order: "study_id, patient_id, event_index"
  },
  lab_case_list: {
    columns: "study_id String, list_id String, category String, name String, description Nullable(String)",
    order: "study_id, list_id"
  },
  lab_case_list_sample: { columns: "study_id String, list_id String, sample_id String", order: "study_id, list_id, sample_id" }
};

export const labTableDdl = (name: string) =>
  `CREATE TABLE IF NOT EXISTS ${name} (${LAB_TABLES[name].columns}, ${VERSIONED}) ${engine(LAB_TABLES[name].order)}`;

/** A stable Int64 id computed from a natural key; the same key gives the same id in every view. */
export const labId = (kind: string, ...parts: string[]) =>
  `toInt64(bitAnd(sipHash64('${kind}', ${parts.join(", ")}), 9223372036854775807))`;

const F = (t: string, alias = "") => `${t}${alias ? " AS " + alias : ""} FINAL`;
const studyId = labId("study", "study_id");
const patientId = (s = "study_id", p = "patient_id") => labId("patient", s, p);
const sampleId = (s = "study_id", x = "sample_id") => labId("sample", s, x);
const profileId = (s = "study_id", p = "profile_id") => labId("profile", s, p);
const mutationEventId = (t: string) =>
  labId("mutation", `${t}.study_id`, `toString(${t}.entrez_gene_id)`, `lower(ifNull(${t}.chr, ''))`, `toString(${t}.start_position)`,
    `toString(${t}.end_position)`, `lower(ifNull(${t}.protein_change, ''))`, `lower(ifNull(${t}.tumor_seq_allele, ''))`, `lower(ifNull(${t}.mutation_type, ''))`);
const svId = labId("sv", "t.study_id", "t.profile_id", "toString(t.sv_index)");
const cnaEventId = (entrez: string, alt: string) => labId("cna", `toString(${entrez})`, `toString(${alt})`);
const listId = (s = "study_id", l = "list_id") => labId("list", s, l);
const eventId = labId("event", "t.study_id", "t.patient_id", "toString(t.event_index)");

// discrete copy-number cells that are events, and the alteration each stands for
const CNA_ALTERATION = "multiIf(v.value = '2', 2, v.value IN ('-2', '-1.5'), -2, NULL)";
const CNA_EVENT_CELLS = `FROM ${F("lab_profile_value", "v")}
  JOIN ${F("lab_profile", "p")} ON p.study_id = v.study_id AND p.profile_id = v.profile_id
  JOIN gene g ON g.entrez_gene_id = v.entrez_gene_id
  WHERE p.alteration_type = 'COPY_NUMBER_ALTERATION' AND p.datatype = 'DISCRETE' AND p.show_in_analysis_tab = 1
    AND v.value IN ('2', '-2', '-1.5') AND ifNull(g.type, '') != 'miRNA'`;

const MUTATION_COLUMNS = "center, sequencer, mutation_status, validation_status, tumor_seq_allele1, tumor_seq_allele2, matched_norm_sample_barcode, " +
  "match_norm_seq_allele1, match_norm_seq_allele2, tumor_validation_allele1, tumor_validation_allele2, match_norm_validation_allele1, " +
  "match_norm_validation_allele2, verification_status, sequencing_phase, sequence_source, validation_method, score, bam_file, tumor_alt_count, " +
  "tumor_ref_count, normal_alt_count, normal_ref_count, amino_acid_change, annotation_json";
const EVENT_COLUMNS = ["chr", "start_position", "end_position", "reference_allele", "tumor_seq_allele", "protein_change", "mutation_type", "ncbi_build",
  "strand", "variant_type", "db_snp_rs", "db_snp_val_status", "refseq_mrna_id", "codon_change", "uniprot_accession", "protein_pos_start",
  "protein_pos_end", "canonical_transcript", "keyword"];
const SV_COLUMNS = LAB_TABLES.lab_structural_variant.columns.split(", ").map((c) => c.split(" ")[0])
  .filter((c) => !["study_id", "profile_id", "sample_id", "sv_index", "has_driver"].includes(c) && !c.startsWith("driver_"));

/** cBioPortal's base tables, as views over the lab_ tables. */
export function baseViews(): Record<string, string> {
  return {
    cancer_study: `SELECT ${studyId} AS cancer_study_id, study_id AS cancer_study_identifier, type_of_cancer_id, name, description, public, pmid,
      citation, groups, status, import_date, toInt64(ifNull((SELECT any(reference_genome_id) FROM reference_genome r WHERE r.name = reference_genome), 1)) AS reference_genome_id,
      sample_count, mutation_sample_count, cna_sample_count, structural_variant_sample_count, rna_seq_sample_count, mrna_microarray_sample_count,
      mrna_expression_sample_count, rppa_sample_count, mass_spectrometry_sample_count, mirna_sample_count, treatment_patient_count,
      CAST(map(), 'Map(String, UInt32)') AS resource_sample_counts
      FROM ${F("lab_study")}`,
    patient: `SELECT ${patientId()} AS internal_id, patient_id AS stable_id, ${studyId} AS cancer_study_id FROM ${F("lab_patient")}`,
    sample: `SELECT ${sampleId("t.study_id", "t.sample_id")} AS internal_id, t.sample_id AS stable_id, t.sample_type AS sample_type,
      ${patientId("t.study_id", "t.patient_id")} AS patient_id FROM ${F("lab_sample", "t")}`,
    genetic_profile: `SELECT ${profileId()} AS genetic_profile_id, profile_id AS stable_id, ${studyId} AS cancer_study_id,
      alteration_type AS genetic_alteration_type, generic_assay_type, datatype, name, description, show_in_analysis_tab AS show_profile_in_analysis_tab,
      pivot_threshold, sort_order, patient_level FROM ${F("lab_profile")}`,
    // cBioPortal's derived-table script adds samples of a _sequenced list missing from sample_profile
    // as profiled for <study>_mutations; that is part of what sample_profile means here
    sample_profile: `SELECT ${sampleId("sp.study_id", "sp.sample_id")} AS sample_id, ${profileId("sp.study_id", "sp.profile_id")} AS genetic_profile_id,
        if(sp.panel_id = '', NULL, gpn.internal_id) AS panel_id
      FROM ${F("lab_sample_profile", "sp")} LEFT JOIN gene_panel gpn ON gpn.stable_id = sp.panel_id
      UNION ALL
      SELECT ${sampleId("l.study_id", "l.sample_id")}, ${profileId("p.study_id", "p.profile_id")}, NULL
      FROM ${F("lab_case_list_sample", "l")}
      JOIN ${F("lab_profile", "p")} ON p.study_id = l.study_id AND p.profile_id = concat(l.study_id, '_mutations')
      WHERE l.list_id LIKE '%\\_sequenced' AND (l.study_id, l.sample_id) NOT IN (
        SELECT s.study_id, s.sample_id FROM ${F("lab_sample_profile", "s")}
        JOIN ${F("lab_profile", "q")} ON q.study_id = s.study_id AND q.profile_id = s.profile_id WHERE q.alteration_type = 'MUTATION_EXTENDED')`,
    sample_list: `SELECT ${listId("t.study_id", "t.list_id")} AS list_id, t.list_id AS stable_id, t.category AS category, ${studyId} AS cancer_study_id,
      t.name AS name, t.description AS description FROM ${F("lab_case_list", "t")}`,
    sample_list_list: `SELECT ${listId("t.study_id", "t.list_id")} AS list_id, ${sampleId("t.study_id", "t.sample_id")} AS sample_id FROM ${F("lab_case_list_sample", "t")}`,
    clinical_patient: `SELECT ${patientId()} AS internal_id, attr_id, value AS attr_value FROM ${F("lab_clinical")} WHERE sample_id = ''`,
    clinical_sample: `SELECT ${sampleId()} AS internal_id, attr_id, value AS attr_value FROM ${F("lab_clinical")} WHERE sample_id != ''`,
    clinical_attribute_meta: `SELECT attr_id, display_name, description, datatype, patient_attribute, priority, ${studyId} AS cancer_study_id
      FROM ${F("lab_clinical_attribute")}`,
    clinical_event: `SELECT ${eventId} AS clinical_event_id, ${patientId("t.study_id", "t.patient_id")} AS patient_id, t.start_date AS start_date,
      t.stop_date AS stop_date, t.event_type AS event_type FROM ${F("lab_timeline_event", "t")}`,
    clinical_event_data: `SELECT ${eventId} AS clinical_event_id, kv.1 AS key, kv.2 AS value FROM ${F("lab_timeline_event", "t")} ARRAY JOIN CAST(t.data, 'Array(Tuple(String, String))') AS kv`,
    mutation_event: `SELECT ${mutationEventId("m")} AS mutation_event_id, any(m.entrez_gene_id) AS entrez_gene_id,
      ${EVENT_COLUMNS.map((c) => `any(m.${c}) AS ${c}`).join(", ")}
      FROM ${F("lab_mutation", "m")} GROUP BY mutation_event_id`,
    mutation: `SELECT ${mutationEventId("m")} AS mutation_event_id, ${profileId("m.study_id", "m.profile_id")} AS genetic_profile_id,
      ${sampleId("m.study_id", "m.sample_id")} AS sample_id, m.entrez_gene_id, ${MUTATION_COLUMNS} FROM ${F("lab_mutation", "m")}`,
    alteration_driver_annotation: `SELECT ${mutationEventId("m")} AS alteration_event_id, ${profileId("m.study_id", "m.profile_id")} AS genetic_profile_id,
        ${sampleId("m.study_id", "m.sample_id")} AS sample_id, driver_filter, driver_filter_annotation, driver_tiers_filter, driver_tiers_filter_annotation
      FROM ${F("lab_mutation", "m")} WHERE has_driver
      UNION ALL
      SELECT ${svId}, ${profileId("t.study_id", "t.profile_id")}, ${sampleId("t.study_id", "t.sample_id")}, t.driver_filter, t.driver_filter_annotation,
        t.driver_tiers_filter, t.driver_tiers_filter_annotation
      FROM ${F("lab_structural_variant", "t")} WHERE t.has_driver`,
    cna_event: `SELECT DISTINCT ${cnaEventId("v.entrez_gene_id", CNA_ALTERATION)} AS cna_event_id, v.entrez_gene_id AS entrez_gene_id,
      toInt32(${CNA_ALTERATION}) AS alteration ${CNA_EVENT_CELLS}`,
    sample_cna_event: `SELECT ${cnaEventId("v.entrez_gene_id", CNA_ALTERATION)} AS cna_event_id, ${sampleId("v.study_id", "v.sample_id")} AS sample_id,
      ${profileId("v.study_id", "v.profile_id")} AS genetic_profile_id, CAST(NULL, 'Nullable(String)') AS annotation_json ${CNA_EVENT_CELLS}`,
    structural_variant: `SELECT ${svId} AS internal_id, ${profileId("t.study_id", "t.profile_id")} AS genetic_profile_id,
      ${sampleId("t.study_id", "t.sample_id")} AS sample_id, ${SV_COLUMNS.map((c) => "t." + c + " AS " + c).join(", ")}
      FROM ${F("lab_structural_variant", "t")}`,
    copy_number_seg: `SELECT ${labId("seg", "t.study_id", "t.sample_id", "t.chr", "toString(t.start)", "toString(t.end)")} AS seg_id,
      ${labId("study", "t.study_id")} AS cancer_study_id, ${sampleId("t.study_id", "t.sample_id")} AS sample_id, t.chr AS chr, t.start AS start,
      t.end AS end, t.num_probes AS num_probes, t.segment_mean AS segment_mean FROM ${F("lab_segment", "t")}`
  };
}

/** genetic_alteration_derived, read straight from the long-form matrix values. */
const geneticAlterationDerived = () => `SELECT concat(v.study_id, '_', v.sample_id) AS sample_unique_id, v.study_id AS cancer_study_identifier,
    g.hugo_gene_symbol AS hugo_gene_symbol, replaceOne(v.profile_id, concat(v.study_id, '_'), '') AS profile_type,
    if(v.value = '', NULL, v.value) AS alteration_value
  FROM ${F("lab_profile_value", "v")}
  JOIN ${F("lab_profile", "p")} ON p.study_id = v.study_id AND p.profile_id = v.profile_id
  JOIN gene g ON g.entrez_gene_id = v.entrez_gene_id
  WHERE p.alteration_type NOT IN ('GENERIC_ASSAY', 'MUTATION_EXTENDED', 'MUTATION_UNCALLED', 'STRUCTURAL_VARIANT')
    AND v.value != '' AND v.value != 'NA'`;

/** Replaces whole-word table names outside string literals. */
export function renameTables(sql: string, names: string[], prefix: string): string {
  if (!prefix) return sql;
  const re = new RegExp("\\b(" + names.join("|") + ")\\b", "g");
  return sql.split(/('(?:[^'\\]|\\.)*')/).map((part, i) => (i % 2 ? part : part.replace(re, prefix + "$1"))).join("");
}

/**
 * The SELECTs of cBioPortal's derived-table script, grouped by the table each fills: one entry per
 * `INSERT INTO <name>_temp …` statement, keeping the order of the statements.
 */
export function derivedSelects(script: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const st of splitStatements(script)) {
    const m = /^\s*INSERT INTO (?:TABLE )?(\w+?)_temp\b\s*([\s\S]*)$/i.exec(st);
    if (!m) continue;
    const select = m[2].replace(/\bSETTINGS\b[\s\S]*$/i, "").trim();
    out.set(m[1], [...(out.get(m[1]) ?? []), select]);
  }
  return out;
}

const BASE_NAMES = Object.keys(baseViews());

/**
 * Creates (or replaces) the compatibility views for `mode`. `derivedScript` is cBioPortal's
 * populate_derived_tables.sql. A derived view casts each column to the type the derived table has
 * in cBioPortal's schema, read from `typesFrom` (the legacy derived tables, or the views already
 * standing in for them), so a value prints the same either way.
 */
export async function createViews(conn: WriteConn, mode: SchemaMode, derivedScript: string, types: Map<string, { name: string; type: string }[]>): Promise<void> {
  const p = viewPrefix(mode);
  for (const [name, sql] of Object.entries(baseViews())) await exec(conn, `CREATE OR REPLACE VIEW ${p}${name} AS ${sql}`);
  const selects = derivedSelects(derivedScript);
  selects.set("genetic_alteration_derived", [geneticAlterationDerived()]);
  for (const [derived, parts] of selects) {
    const cols = types.get(derived);
    if (!cols) throw new Error("no column types for " + derived);
    const branches: string[] = [];
    for (const part of parts) {
      const sql = renameTables(part.replace(/\b(\w+_derived)_temp\b/g, "$1"), [...BASE_NAMES, ...selects.keys()], p);
      const out = await query<{ name: string }>(conn, `DESCRIBE TABLE (${sql})`);
      if (out.length !== cols.length) throw new Error(`${derived}: ${out.length} columns from the script, ${cols.length} in the table`);
      branches.push(`SELECT ${cols.map((c, i) => `${castTo(out[i].name, c)} AS \`${c.name}\``).join(", ")} FROM (${sql})`);
    }
    await exec(conn, `CREATE OR REPLACE VIEW ${p}${derived} AS ${branches.join("\nUNION ALL\n")}`);
  }
}

// integer ids the derived tables declare as Int32; the views' ids are 63-bit hashes, kept whole
const WIDE_IDS = new Set(["internal_id", "patient_internal_id"]);

/**
 * A derived-table column as the table would hold it: cast to the table's type, and NULL stored as
 * the type's default, as an INSERT into a non-Nullable column stores it.
 */
function castTo(source: string, target: { name: string; type: string }): string {
  const type = WIDE_IDS.has(target.name) ? target.type.replace("Int32", "Int64") : target.type;
  const col = "`" + source + "`";
  return type.startsWith("Nullable(") ? `CAST(${col} AS ${type})` : `CAST(ifNull(${col}, defaultValueOfTypeName('${type}')) AS ${type})`;
}

/** Column names and types of every *_derived table or view in the database. */
export async function derivedTypes(conn: WriteConn, prefix: string): Promise<Map<string, { name: string; type: string }[]>> {
  const rows = await query<{ t: string; n: string; ty: string }>(conn,
    `SELECT table AS t, name AS n, type AS ty FROM system.columns WHERE database = currentDatabase() AND table LIKE '${prefix}%\\_derived' ORDER BY position`);
  const out = new Map<string, { name: string; type: string }[]>();
  for (const r of rows) {
    const key = r.t.slice(prefix.length);
    out.set(key, [...(out.get(key) ?? []), { name: r.n, type: r.ty }]);
  }
  return out;
}

/** The cBioPortal tables the base views stand in for. */
export const LEGACY_BASE_TABLES = BASE_NAMES;

export async function createLabTables(conn: WriteConn): Promise<void> {
  for (const name of Object.keys(LAB_TABLES)) await exec(conn, labTableDdl(name));
}

/** Removes a study from every lab_ table. */
export async function removeLabStudy(conn: WriteConn, studyId: string): Promise<boolean> {
  const lit = "'" + studyId.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  const n = await query<{ n: number }>(conn, `SELECT count() AS n FROM lab_study WHERE study_id = ${lit}`);
  for (const name of Object.keys(LAB_TABLES)) await exec(conn, `DELETE FROM ${name} WHERE study_id = ${lit}`);
  return Number(n[0]?.n) > 0;
}
