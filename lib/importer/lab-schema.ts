// The file-shaped schema ("lab_" tables) and the views that present it under cBioPortal's table
// names, so the app's SQL runs on it unchanged.
//
// Every lab_ table holds one kind of study file in long form, keyed by the files' own identifiers,
// and every row carries its study_id (the sort key's first column and the partition key, so each
// study is a partition of its own). Rows are versioned (ReplacingMergeTree on `version`,
// `is_deleted`) and read through FINAL: a change is an insert of new versions, visible at once, and
// FINAL only has work to do in a study whose partition holds more than one part, until
// `compactStudy` merges it. A study is removed by dropping its partitions. Shared reference data —
// genes, aliases, gene panels, cancer types, reference genomes — stays in cBioPortal's own tables.
//
// The views come in two layers. Base views rebuild cBioPortal's base tables (sample, mutation,
// genetic_profile, …), with each integer id computed from the natural key (`labId`, stored on the rows) so the joins
// between them line up. Derived views are cBioPortal's own populate_derived_tables.sql SELECTs
// reading those base views, so the *_derived names hold what that SQL would have built; only
// genetic_alteration_derived is written natively, because the base table it would read stores a
// matrix row as one comma-joined string.
//
// A database's schema mode decides where the views live: `new` gives them cBioPortal's names (the
// legacy tables are gone), `both` keeps the legacy tables and names the views `labv_<name>`, for
// comparing the two on the same import.
import { exec, query, splitStatements, sq, type WriteConn } from "./ch-write.ts";

export type SchemaMode = "legacy" | "new" | "both";
export const SCHEMA_MODES: SchemaMode[] = ["legacy", "new", "both"];
export const writesLegacy = (m: SchemaMode) => m !== "new";
export const writesLab = (m: SchemaMode) => m !== "legacy";
/** Prefix of the compatibility views: none when they stand in for the legacy tables. */
export const viewPrefix = (m: SchemaMode) => (m === "both" ? "labv_" : "");

const VERSIONED = "version UInt64, is_deleted UInt8";
const engine = (order: string) => `ENGINE = ReplacingMergeTree(version, is_deleted) PARTITION BY study_id ORDER BY (${order})`;

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
    order: "study_id, attr_id, patient_id, sample_id"
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
    columns: "study_id String, sample_id String, profile_id String, alteration_type String, panel_id String",
    order: "study_id, sample_id, profile_id"
  },
  lab_profile_value: {
    columns: "study_id String, profile_id String, sample_id String, entrez_gene_id Int64, hugo_gene_symbol String, value String",
    order: "study_id, hugo_gene_symbol, profile_id, entrez_gene_id, sample_id"
  },
  // the cells of a discrete copy-number file that are events (amplifications, deep deletions), as
  // cBioPortal's importer writes them to sample_cna_event
  lab_cna_event: {
    columns: "study_id String, profile_id String, sample_id String, patient_id String, panel_id String, profiled UInt8, entrez_gene_id Int64, " +
      "hugo_gene_symbol String, cytoband Nullable(String), alteration Int8, off_panel UInt8",
    order: "study_id, hugo_gene_symbol, profile_id, sample_id, entrez_gene_id"
  },
  lab_mutation: {
    columns: "study_id String, profile_id String, sample_id String, patient_id String, panel_id String, profiled UInt8, entrez_gene_id Int64, " +
      "hugo_gene_symbol String, gene_type Nullable(String), off_panel UInt8, chr Nullable(String), start_position Nullable(Int64), " +
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
    order: "study_id, hugo_gene_symbol, profile_id, sample_id, entrez_gene_id, assumeNotNull(chr), assumeNotNull(start_position), assumeNotNull(end_position), " +
      "assumeNotNull(protein_change), assumeNotNull(tumor_seq_allele), assumeNotNull(mutation_type)"
  },
  lab_structural_variant: {
    columns: "study_id String, profile_id String, sample_id String, patient_id String, sv_index UInt32, site1_entrez_gene_id Nullable(Int64), " +
      "site1_hugo_gene_symbol String, site2_hugo_gene_symbol String, panel_id String, profiled UInt8, site1_off_panel UInt8, site2_off_panel UInt8, " +
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

/** A stable Int64 id computed from a natural key; the same key gives the same id in every view. */
export const labId = (kind: string, ...parts: string[]) =>
  `toInt64(bitAnd(sipHash64('${kind}', ${parts.join(", ")}), 9223372036854775807))`;

/**
 * The integer ids the views give cBioPortal's tables, each computed from a row's natural key. They
 * are stored, computed once as a row is written (MATERIALIZED), rather than computed by the views:
 * the app joins and filters on them (`clinical_event.patient_id IN (…)`), and an id computed in a
 * view is computed for every row of every study before it can be compared. The mutation event's
 * is Nullable, as its parts are.
 */
const IDS: Record<string, string> = {
  study_int: labId("study", "study_id"),
  patient_int: labId("patient", "study_id", "patient_id"),
  sample_int: labId("sample", "study_id", "sample_id"),
  profile_int: labId("profile", "study_id", "profile_id"),
  list_int: labId("list", "study_id", "list_id"),
  event_int: labId("event", "study_id", "patient_id", "toString(event_index)"),
  sv_int: labId("sv", "study_id", "profile_id", "toString(sv_index)"),
  cna_event_int: labId("cna", "toString(entrez_gene_id)", "toString(alteration)"),
  seg_int: labId("seg", "study_id", "sample_id", "chr", "toString(start)", "toString(end)"),
  mutation_event_int: labId("mutation", "study_id", "toString(entrez_gene_id)", "lower(ifNull(chr, ''))", "toString(start_position)",
    "toString(end_position)", "lower(ifNull(protein_change, ''))", "lower(ifNull(tumor_seq_allele, ''))", "lower(ifNull(mutation_type, ''))")
};

/** Each lab_ table's stored ids, and the ids filtered with IN (…) that get a bloom-filter index. */
export const TABLE_IDS: Record<string, { ids: string[]; indexed?: string[] }> = {
  lab_study: { ids: ["study_int"] },
  lab_patient: { ids: ["study_int", "patient_int"], indexed: ["patient_int"] },
  lab_sample: { ids: ["study_int", "sample_int", "patient_int"], indexed: ["sample_int", "patient_int"] },
  lab_clinical: { ids: ["study_int", "patient_int", "sample_int"], indexed: ["patient_int", "sample_int"] },
  lab_clinical_attribute: { ids: ["study_int"] },
  lab_profile: { ids: ["study_int", "profile_int"] },
  lab_sample_profile: { ids: ["sample_int", "profile_int"], indexed: ["sample_int"] },
  lab_profile_value: { ids: [] },
  lab_cna_event: { ids: ["sample_int", "profile_int", "cna_event_int"], indexed: ["sample_int"] },
  lab_mutation: { ids: ["sample_int", "profile_int", "mutation_event_int"], indexed: ["sample_int"] },
  lab_structural_variant: { ids: ["sample_int", "profile_int", "sv_int"], indexed: ["sample_int"] },
  lab_segment: { ids: ["study_int", "sample_int", "seg_int"], indexed: ["sample_int"] },
  lab_timeline_event: { ids: ["patient_int", "event_int"], indexed: ["patient_int", "event_int"] },
  lab_case_list: { ids: ["study_int", "list_int"] },
  lab_case_list_sample: { ids: ["list_int", "sample_int"], indexed: ["sample_int"] }
};
const idColumn = (c: string) => `${c} ${c === "mutation_event_int" ? "Nullable(Int64)" : "Int64"} MATERIALIZED ${IDS[c]}`;
const idIndex = (c: string) => `INDEX ${c}_idx ${c} TYPE bloom_filter GRANULARITY 1`;

export const labTableDdl = (name: string) => {
  const t = TABLE_IDS[name];
  return `CREATE TABLE IF NOT EXISTS ${name} (${[LAB_TABLES[name].columns, VERSIONED, ...t.ids.map(idColumn), ...(t.indexed ?? []).map(idIndex)].join(", ")}) ${engine(LAB_TABLES[name].order)}`;
};

const F = (t: string, alias = "") => `${t}${alias ? " AS " + alias : ""} FINAL`;
// the stored ids, read through the alias the first argument carries (`t.study_id` -> `t.patient_int`)
const col = (ref: string, name: string) => (ref.includes(".") ? ref.slice(0, ref.indexOf(".") + 1) : "") + name;
const studyId = "study_int";
const patientId = (s = "study_id") => col(s, "patient_int");
const sampleId = (s = "study_id") => col(s, "sample_int");
const profileId = (s = "study_id") => col(s, "profile_int");
const mutationEventId = (t: string) => `${t}.mutation_event_int`;
const svId = "t.sv_int";
const cnaEventId = (ref: string) => col(ref, "cna_event_int");
const listId = (s = "study_id") => col(s, "list_int");
const eventId = "t.event_int";

const MUTATION_COLUMNS = "center, sequencer, mutation_status, validation_status, tumor_seq_allele1, tumor_seq_allele2, matched_norm_sample_barcode, " +
  "match_norm_seq_allele1, match_norm_seq_allele2, tumor_validation_allele1, tumor_validation_allele2, match_norm_validation_allele1, " +
  "match_norm_validation_allele2, verification_status, sequencing_phase, sequence_source, validation_method, score, bam_file, tumor_alt_count, " +
  "tumor_ref_count, normal_alt_count, normal_ref_count, amino_acid_change, annotation_json";
const EVENT_COLUMNS = ["chr", "start_position", "end_position", "reference_allele", "tumor_seq_allele", "protein_change", "mutation_type", "ncbi_build",
  "strand", "variant_type", "db_snp_rs", "db_snp_val_status", "refseq_mrna_id", "codon_change", "uniprot_accession", "protein_pos_start",
  "protein_pos_end", "canonical_transcript", "keyword"];
const SV_COLUMNS = () => columnsOf("lab_structural_variant")
  .filter((c) => !["study_id", "profile_id", "sample_id", "patient_id", "sv_index", "has_driver", "site1_hugo_gene_symbol", "site2_hugo_gene_symbol",
    "panel_id", "profiled", "site1_off_panel", "site2_off_panel"].includes(c)
    && !c.startsWith("driver_"));

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
    sample: `SELECT ${sampleId("t.study_id")} AS internal_id, t.sample_id AS stable_id, t.sample_type AS sample_type,
      ${patientId("t.study_id")} AS patient_id FROM ${F("lab_sample", "t")}`,
    genetic_profile: `SELECT ${profileId()} AS genetic_profile_id, profile_id AS stable_id, ${studyId} AS cancer_study_id,
      alteration_type AS genetic_alteration_type, generic_assay_type, datatype, name, description, show_in_analysis_tab AS show_profile_in_analysis_tab,
      pivot_threshold, sort_order, patient_level FROM ${F("lab_profile")}`,
    sample_profile: `SELECT ${sampleId("sp.study_id")} AS sample_id, ${profileId("sp.study_id")} AS genetic_profile_id,
        if(sp.panel_id = '', NULL, gpn.internal_id) AS panel_id
      FROM ${F("lab_sample_profile", "sp")} LEFT JOIN gene_panel gpn ON gpn.stable_id = sp.panel_id`,
    sample_list: `SELECT ${listId("t.study_id")} AS list_id, t.list_id AS stable_id, t.category AS category, ${studyId} AS cancer_study_id,
      t.name AS name, t.description AS description FROM ${F("lab_case_list", "t")}`,
    sample_list_list: `SELECT ${listId("t.study_id")} AS list_id, ${sampleId("t.study_id")} AS sample_id FROM ${F("lab_case_list_sample", "t")}`,
    clinical_patient: `SELECT ${patientId()} AS internal_id, attr_id, value AS attr_value FROM ${F("lab_clinical")} WHERE sample_id = '' AND value != ''`,
    clinical_sample: `SELECT ${sampleId()} AS internal_id, attr_id, value AS attr_value FROM ${F("lab_clinical")} WHERE sample_id != '' AND value != ''`,
    clinical_attribute_meta: `SELECT attr_id, display_name, description, datatype, patient_attribute, priority, ${studyId} AS cancer_study_id
      FROM ${F("lab_clinical_attribute")}`,
    clinical_event: `SELECT ${eventId} AS clinical_event_id, ${patientId("t.study_id")} AS patient_id, t.start_date AS start_date,
      t.stop_date AS stop_date, t.event_type AS event_type FROM ${F("lab_timeline_event", "t")}`,
    clinical_event_data: `SELECT ${eventId} AS clinical_event_id, kv.1 AS key, kv.2 AS value FROM ${F("lab_timeline_event", "t")} ARRAY JOIN CAST(t.data, 'Array(Tuple(String, String))') AS kv`,
    mutation_event: `SELECT ${mutationEventId("m")} AS mutation_event_id, any(m.entrez_gene_id) AS entrez_gene_id,
      ${EVENT_COLUMNS.map((c) => `any(m.${c}) AS ${c}`).join(", ")}
      FROM ${F("lab_mutation", "m")} GROUP BY mutation_event_id`,
    mutation: `SELECT ${mutationEventId("m")} AS mutation_event_id, ${profileId("m.study_id")} AS genetic_profile_id,
      ${sampleId("m.study_id")} AS sample_id, m.entrez_gene_id, ${MUTATION_COLUMNS} FROM ${F("lab_mutation", "m")}`,
    alteration_driver_annotation: `SELECT ${mutationEventId("m")} AS alteration_event_id, ${profileId("m.study_id")} AS genetic_profile_id,
        ${sampleId("m.study_id")} AS sample_id, driver_filter, driver_filter_annotation, driver_tiers_filter, driver_tiers_filter_annotation
      FROM ${F("lab_mutation", "m")} WHERE has_driver
      UNION ALL
      SELECT ${svId}, ${profileId("t.study_id")}, ${sampleId("t.study_id")}, t.driver_filter, t.driver_filter_annotation,
        t.driver_tiers_filter, t.driver_tiers_filter_annotation
      FROM ${F("lab_structural_variant", "t")} WHERE t.has_driver`,
    cna_event: `SELECT DISTINCT ${cnaEventId("v.entrez_gene_id")} AS cna_event_id, v.entrez_gene_id AS entrez_gene_id,
      toInt32(v.alteration) AS alteration FROM ${F("lab_cna_event", "v")}`,
    sample_cna_event: `SELECT ${cnaEventId("v.entrez_gene_id")} AS cna_event_id, ${sampleId("v.study_id")} AS sample_id,
      ${profileId("v.study_id")} AS genetic_profile_id, CAST(NULL, 'Nullable(String)') AS annotation_json FROM ${F("lab_cna_event", "v")}`,
    structural_variant: `SELECT ${svId} AS internal_id, ${profileId("t.study_id")} AS genetic_profile_id,
      ${sampleId("t.study_id")} AS sample_id, ${SV_COLUMNS().map((c) => "t." + c + " AS " + c).join(", ")}
      FROM ${F("lab_structural_variant", "t")}`,
    copy_number_seg: `SELECT t.seg_int AS seg_id,
      t.study_int AS cancer_study_id, ${sampleId("t.study_id")} AS sample_id, t.chr AS chr, t.start AS start,
      t.end AS end, t.num_probes AS num_probes, t.segment_mean AS segment_mean FROM ${F("lab_segment", "t")}`
  };
}

/**
 * Profile types whose values genetic_alteration_derived leaves out (cBioPortal's derived SQL);
 * lab_profile_value never holds them (lab-writer.ts refuses them), so the view needs no filter.
 */
export const NOT_IN_PROFILE_VALUES = new Set(["GENERIC_ASSAY", "MUTATION_EXTENDED", "MUTATION_UNCALLED", "STRUCTURAL_VARIANT"]);

/** One SELECT of a derived view: its expressions, in the derived table's column order, and the rest of the statement. */
export type NativeSelect = { exprs: string[]; from: string };

/**
 * The derived tables the app reads most, written over the denormalized lab_ tables directly
 * rather than through the base views, so each reads one table and joins nothing. Each
 * yields the derived table's columns in its order; the result is checked against cBioPortal's own
 * (scripts/check-legacy-diff.ts). With `forStudy`, the ones stored per study (STORED_DERIVED) read
 * only the study a `{study:String}` query parameter names, subqueries included.
 */
export function nativeDerived(forStudy = false): Record<string, NativeSelect[]> {
  const sel = (exprs: string[], from: string): NativeSelect => ({ exprs, from });
  const only = (t: string) => (forStudy ? ` AND ${t}.study_id = {study:String}` : "");
  const panel = (t: string) => `if(${t}.panel_id = '', 'WES', ${t}.panel_id)`;
  const drivers = (t: string) => ["driver_filter", "driver_filter_annotation", "driver_tiers_filter", "driver_tiers_filter_annotation"].map((c) => `${t}.${c}`);
  const sv = (site: 1 | 2, where: string) => sel([`concat(t.study_id, '_', t.sample_id)`, `t.site${site}_hugo_gene_symbol`, `t.site${site}_entrez_gene_id`,
    panel("t"), "t.study_id", "t.profile_id", "'structural_variant'", "'NA'", "'NA'", "t.sv_status", ...drivers("t"), "NULL", "''", "t.event_info",
    "concat(t.study_id, '_', t.patient_id)", `t.site${site}_off_panel`],
  `FROM ${F("lab_structural_variant", "t")} WHERE t.profiled AND ${where}${only("t")}`);
  return {
    genomic_event_derived: [
      sel(["concat(m.study_id, '_', m.sample_id)", "m.hugo_gene_symbol", "m.entrez_gene_id", panel("m"), "m.study_id", "m.profile_id", "'mutation'",
        "m.protein_change", "m.mutation_type", "m.mutation_status", ...drivers("m"), "NULL", "''", "''", "concat(m.study_id, '_', m.patient_id)", "m.off_panel"],
      `FROM ${F("lab_mutation", "m")} WHERE m.profiled${only("m")}`),
      sel(["concat(v.study_id, '_', v.sample_id)", "v.hugo_gene_symbol", "v.entrez_gene_id", panel("v"), "v.study_id", "v.profile_id", "'cna'",
        "'NA'", "'NA'", "'NA'", "NULL", "NULL", "NULL", "NULL", "v.alteration", "v.cytoband", "''", "concat(v.study_id, '_', v.patient_id)", "v.off_panel"],
      `FROM ${F("lab_cna_event", "v")} WHERE v.profiled AND v.cytoband IS NOT NULL${only("v")}`),
      sv(1, "t.site1_entrez_gene_id IS NOT NULL AND t.site1_hugo_gene_symbol != ''"),
      sv(2, "t.site2_entrez_gene_id IS NOT NULL AND t.site2_hugo_gene_symbol != '' AND (t.site2_entrez_gene_id != t.site1_entrez_gene_id OR t.site1_entrez_gene_id IS NULL)")
    ],
    genetic_alteration_derived: [
      sel(["concat(v.study_id, '_', v.sample_id)", "v.study_id", "v.hugo_gene_symbol", "replaceOne(v.profile_id, concat(v.study_id, '_'), '')",
        "if(v.value = '', NULL, v.value)"],
      `FROM ${F("lab_profile_value", "v")} WHERE v.value != '' AND v.value != 'NA'`)
    ],
    mutation_derived: [
      sel(["m.profile_id", "m.sample_id", sampleId("m.study_id"), "m.patient_id", "m.entrez_gene_id", "m.study_id",
        ...["center", "mutation_status", "validation_status", "tumor_alt_count", "tumor_ref_count", "normal_alt_count", "normal_ref_count",
          "amino_acid_change", "chr", "start_position", "end_position", "reference_allele", "tumor_seq_allele", "protein_change", "mutation_type",
          "ncbi_build", "variant_type", "refseq_mrna_id", "protein_pos_start", "protein_pos_end", "keyword", "annotation_json"].map((c) => "m." + c),
        ...drivers("m"), "m.entrez_gene_id", "m.hugo_gene_symbol", "m.gene_type", ...Array(8).fill("NULL")],
      `FROM ${F("lab_mutation", "m")}`)
    ],
    sample_derived: [
      sel(["concat(s.study_id, '_', s.sample_id)", "base64Encode(s.sample_id)", "s.sample_id", "concat(s.study_id, '_', s.patient_id)",
        "base64Encode(s.patient_id)", "s.patient_id", "s.study_id", sampleId("s.study_id"), patientId("s.study_id"),
        "s.sample_type",
        `if((s.study_id, s.sample_id) IN (SELECT study_id, sample_id FROM ${F("lab_case_list_sample")} WHERE list_id = concat(study_id, '_sequenced')${forStudy ? " AND study_id = {study:String}" : ""}), 1, 0)`,
        `if((s.study_id, s.sample_id) IN (SELECT study_id, sample_id FROM ${F("lab_segment")}${forStudy ? " WHERE study_id = {study:String}" : ""}), 1, 0)`],
      `FROM ${F("lab_sample", "s")}${forStudy ? " WHERE s.study_id = {study:String}" : ""}`)
    ],
    sample_to_gene_panel_derived: [
      sel(["concat(sp.study_id, '_', sp.sample_id)", "sp.alteration_type", panel("sp"), "sp.study_id", "sp.profile_id"], `FROM ${F("lab_sample_profile", "sp")}`)
    ],
    clinical_data_derived: [
      sel([`if(c.sample_id = '', ${patientId("c.study_id")}, ${sampleId("c.study_id")})`,
        "if(c.sample_id = '', '', concat(c.study_id, '_', c.sample_id))", "concat(c.study_id, '_', c.patient_id)", "c.attr_id", "c.value", "c.study_id",
        "if(c.sample_id = '', 'patient', 'sample')"],
      `FROM ${F("lab_clinical", "c")}`)
    ]
  };
}

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
 * populate_derived_tables.sql. A derived view converts each column to the type the derived table
 * has in cBioPortal's schema, read from `types` (the legacy derived tables, or the views already
 * standing in for them), so a value prints the same either way. The native views
 * (`nativeDerived`) name and convert their expressions in one SELECT per branch, with no
 * conversion where none changes a value: the planner works through every expression of a view on
 * every query, and a filter on an unconverted column can use the table's sort key.
 */
export async function createViews(conn: WriteConn, mode: SchemaMode, derivedScript: string, types: Map<string, { name: string; type: string }[]>): Promise<void> {
  const p = viewPrefix(mode);
  for (const [name, sql] of Object.entries(baseViews())) await exec(conn, `CREATE OR REPLACE VIEW ${p}${name} AS ${sql}`);
  const selects = derivedSelects(derivedScript);
  const native = nativeDerived();
  for (const derived of Object.keys(native)) selects.delete(derived);
  const columnsOfDerived = (derived: string) => {
    const cols = types.get(derived);
    if (!cols) throw new Error("no column types for " + derived);
    return cols;
  };
  const describe = async (derived: string, sql: string, cols: unknown[]) => {
    const out = await query<{ name: string; type: string }>(conn, `DESCRIBE TABLE (${sql})`);
    if (out.length !== cols.length) throw new Error(`${derived}: ${out.length} columns from the script, ${cols.length} in the table`);
    return out;
  };
  const perStudy = nativeDerived(true);
  for (const [derived, parts] of Object.entries(native)) {
    const cols = columnsOfDerived(derived);
    const stored = STORED_DERIVED[derived];
    const branches: string[] = [];
    for (const { exprs, from } of stored ? perStudy[derived] : parts) {
      // named by position while described, so a NULL or a constant repeated in one SELECT stays distinct;
      // a study parameter is described as any study
      const out = await describe(derived, `SELECT ${exprs.map((e, i) => `${e} AS c${i}`).join(", ")} ${from}`.replaceAll("{study:String}", "''"), cols);
      branches.push(`SELECT ${cols.map((c, i) => `${convert(exprs[i], out[i].type, c)} AS \`${c.name}\``).join(", ")}\n${from}`);
    }
    if (!stored) {
      await exec(conn, `CREATE OR REPLACE VIEW ${p}${derived} AS ${branches.join("\nUNION ALL\n")}`);
      continue;
    }
    await exec(conn, `CREATE OR REPLACE VIEW ${stored.table}_source AS ${branches.join("\nUNION ALL\n")}`);
    const fresh = await createStoredTable(conn, stored);
    await exec(conn, `CREATE OR REPLACE VIEW ${p}${derived} AS SELECT * FROM ${stored.table}`);
    if (fresh) for (const { s } of await query<{ s: string }>(conn, "SELECT DISTINCT study_id AS s FROM lab_study")) await refreshStudyTable(conn, stored.table, s);
  }
  for (const [derived, parts] of selects) {
    const cols = columnsOfDerived(derived);
    const branches: string[] = [];
    for (const part of parts) {
      const sql = renameTables(part.replace(/\b(\w+_derived)_temp\b/g, "$1"), [...BASE_NAMES, ...selects.keys(), ...Object.keys(native)], p);
      const out = await describe(derived, sql, cols);
      branches.push(`SELECT ${cols.map((c, i) => `${convert("`" + out[i].name + "`", out[i].type, c)} AS \`${c.name}\``).join(", ")} FROM (${sql})`);
    }
    await exec(conn, `CREATE OR REPLACE VIEW ${p}${derived} AS ${branches.join("\nUNION ALL\n")}`);
  }
}

/**
 * Derived tables stored per study rather than computed by a view on every read: a view is planned
 * again each time a query names it, and the app's cohort queries name these once per gene and per
 * condition (genomic_event_derived is four UNION branches over three tables; sample_derived has two
 * subqueries), so planning them cost several times reading what they select. Each is written from
 * `<table>_source`, the view that computes it for one study, whenever that study's lab_ rows change
 * (`refreshStoredDerived`); its view then reads the table.
 */
export const STORED_DERIVED: Record<string, { table: string; order: string }> = {
  genomic_event_derived: { table: "lab_genomic_event", order: "cancer_study_identifier, hugo_gene_symbol, variant_type, sample_unique_id" },
  sample_derived: { table: "lab_sample_summary", order: "cancer_study_identifier, sample_unique_id" }
};

/** Creates a stored derived table from its source view's columns, replacing one of other columns; true when it is new. */
async function createStoredTable(conn: WriteConn, t: { table: string; order: string }): Promise<boolean> {
  const cols = async (name: string) => (await query<{ x: string }>(conn, `SELECT concat(name, ' ', type) AS x FROM system.columns
    WHERE database = currentDatabase() AND table = ${sq(name)} ORDER BY position`)).map((r) => r.x).join(", ");
  const existing = await cols(t.table);
  if (existing && existing === await cols(t.table + "_source")) return false;
  if (existing) await exec(conn, `DROP TABLE ${t.table}`);
  await exec(conn, `CREATE TABLE ${t.table} ENGINE = MergeTree PARTITION BY cancer_study_identifier ORDER BY (${t.order})
    EMPTY AS SELECT * FROM ${t.table}_source(study = '')`);
  return true;
}

/** Rewrites one study's partition of a stored derived table from its source view (none, when the study has no rows). */
async function refreshStudyTable(conn: WriteConn, table: string, studyId: string): Promise<void> {
  const side = `${table}_refresh_${process.pid}_${Date.now()}`;
  try {
    await exec(conn, `CREATE TABLE ${side} AS ${table}`);
    await exec(conn, `INSERT INTO ${side} SELECT * FROM ${table}_source(study = ${sq(studyId)})`);
    const n = await query<{ n: number }>(conn, `SELECT count() AS n FROM ${side}`);
    if (Number(n[0]?.n)) await exec(conn, `ALTER TABLE ${table} REPLACE PARTITION ${sq(studyId)} FROM ${side}`);
    else await exec(conn, `ALTER TABLE ${table} DROP PARTITION ${sq(studyId)}`);
  } finally {
    await exec(conn, `DROP TABLE IF EXISTS ${side}`);
  }
}

/**
 * Brings a study's stored derived tables (STORED_DERIVED) up to date with its lab_ rows: called
 * after every write to a study (an import or update, an edit, a review's copy, approval, undo or
 * rejection, a removal). A database without them (legacy mode) has nothing to refresh.
 */
export async function refreshStoredDerived(conn: WriteConn, studyId: string): Promise<void> {
  const have = new Set((await query<{ t: string }>(conn, `SELECT name AS t FROM system.tables WHERE database = currentDatabase()
    AND name IN (${Object.values(STORED_DERIVED).map((t) => sq(t.table)).join(", ")})`)).map((r) => r.t));
  for (const { table } of Object.values(STORED_DERIVED)) if (have.has(table)) await refreshStudyTable(conn, table, studyId);
}

// integer ids the derived tables declare as Int32; the views' ids are 63-bit hashes, kept whole
const WIDE_IDS = new Set(["internal_id", "patient_internal_id"]);

// LowCardinality changes how a column is stored, never a value it holds
const valueType = (t: string) => t.replace(/LowCardinality\((.*)\)/, "$1");

/**
 * `expr`, of type `source`, as the derived table would hold it: converted to the table's type, and
 * NULL stored as the type's default, as an INSERT into a non-Nullable column stores it.
 */
export function convert(expr: string, source: string, target: { name: string; type: string }): string {
  const type = WIDE_IDS.has(target.name) ? target.type.replace("Int32", "Int64") : target.type;
  if (valueType(source) === valueType(type)) return expr;
  if (expr === "NULL" && valueType(type) === "String") return "''";
  if (source === "Nullable(String)" && valueType(type) === "String") return `ifNull(${expr}, '')`;
  return type.startsWith("Nullable(") ? `CAST(${expr} AS ${type})` : `CAST(ifNull(${expr}, defaultValueOfTypeName('${type}')) AS ${type})`;
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

/**
 * Creates the lab_ tables. A table written before the tables were partitioned by study is copied
 * into the partitioned layout, a study at a time, and swapped in; a table of any other layout is
 * refused, since its studies would need importing again.
 */
export async function createLabTables(conn: WriteConn, log: (msg: string) => void = () => undefined): Promise<void> {
  const rows = await query<{ t: string; c: string; k: string; p: string }>(conn, `SELECT t.name AS t,
      arrayStringConcat(arrayMap(x -> x.2, arraySort(groupArray((c.position, c.name)))), ',') AS c, any(t.sorting_key) AS k, any(t.partition_key) AS p
    FROM system.tables t JOIN system.columns c ON c.database = t.database AND c.table = t.name
    WHERE t.database = currentDatabase() AND t.name IN (${Object.keys(LAB_TABLES).map((n) => `'${n}'`).join(", ")}) AND c.default_kind != 'MATERIALIZED'
    GROUP BY t.name`);
  // system.tables writes a one-column key in parentheses
  const key = (k: string) => k.replace(/[\s()]/g, "");
  const unpartitioned: string[] = [];
  for (const r of rows) {
    const want = [...columnsOf(r.t), "version", "is_deleted"].join(",");
    if (r.c !== want || key(r.k) !== key(LAB_TABLES[r.t].order))
      throw new Error(`${r.t} has an older layout than this importer writes; drop the lab_ tables (or use a fresh data folder) and import the studies again`);
    if (key(r.p) !== "study_id") unpartitioned.push(r.t);
  }
  for (const name of unpartitioned) {
    log("Partitioning " + name + " by study");
    const next = name + "_partitioned";
    await exec(conn, "DROP TABLE IF EXISTS " + next);
    await exec(conn, labTableDdl(name).replace(" " + name + " (", " " + next + " ("));
    for (const { s } of await query<{ s: string }>(conn, `SELECT DISTINCT study_id AS s FROM ${name}`))
      await exec(conn, `INSERT INTO ${next} SELECT * FROM ${name} FINAL WHERE study_id = ${sq(s)} AND is_deleted = 0`);
    await exec(conn, `EXCHANGE TABLES ${name} AND ${next}`);
    await exec(conn, "DROP TABLE " + next);
  }
  for (const name of Object.keys(LAB_TABLES)) await exec(conn, labTableDdl(name));
  await addStoredIds(conn, log);
}

/**
 * Adds the stored ids and their indexes (TABLE_IDS) a table written before them lacks, and fills
 * them for its rows; also to the copies kept to undo an approval (`<table>_previous`, lab-review.ts),
 * whose partitions are swapped with the table's and so must have its structure.
 */
async function addStoredIds(conn: WriteConn, log: (msg: string) => void): Promise<void> {
  const have = new Set((await query<{ x: string }>(conn, `SELECT concat(table, '.', name) AS x FROM system.columns WHERE database = currentDatabase()
    UNION ALL SELECT concat(table, '.', name) AS x FROM system.data_skipping_indices WHERE database = currentDatabase()`)).map((r) => r.x));
  const tables = new Set((await query<{ t: string }>(conn, "SELECT name AS t FROM system.tables WHERE database = currentDatabase()")).map((r) => r.t));
  const sync = { mutations_sync: "2" };
  for (const [name, t] of Object.entries(TABLE_IDS).flatMap(([n, ids]) => [[n, ids], ...(tables.has(n + "_previous") ? [[n + "_previous", ids]] : [])] as [string, typeof ids][])) {
    const ids = t.ids.filter((c) => !have.has(`${name}.${c}`)), indexes = (t.indexed ?? []).filter((c) => !have.has(`${name}.${c}_idx`));
    if (!ids.length && !indexes.length) continue;
    log("Storing the ids of " + name);
    for (const c of ids) {
      await exec(conn, `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${idColumn(c)}`);
      await exec(conn, `ALTER TABLE ${name} MATERIALIZE COLUMN ${c}`, sync);
    }
    for (const c of indexes) {
      await exec(conn, `ALTER TABLE ${name} ADD ${idIndex(c).replace("INDEX ", "INDEX IF NOT EXISTS ")}`);
      await exec(conn, `ALTER TABLE ${name} MATERIALIZE INDEX ${c}_idx`, sync);
    }
  }
}

/** The lab_ tables holding a study's rows, with how many parts its partition has in each. */
export async function studyParts(conn: WriteConn, studyId: string): Promise<{ table: string; parts: number; rows: number; bytes: number }[]> {
  const rows = await query<{ table: string; parts: number; rows: number; bytes: number }>(conn, `SELECT table, count() AS parts, sum(rows) AS rows,
      sum(bytes_on_disk) AS bytes FROM system.parts
    WHERE active AND database = currentDatabase() AND partition = ${sq(studyId)} AND table IN (${Object.keys(LAB_TABLES).map(sq).join(", ")})
    GROUP BY table ORDER BY table`);
  return rows.map((r) => ({ table: r.table, parts: Number(r.parts), rows: Number(r.rows), bytes: Number(r.bytes) }));
}

/**
 * Merges each of a study's partitions that holds more than one part into one, keeping each row's
 * latest version: after it, FINAL has nothing to merge when it reads the study. Returns the tables
 * it merged.
 */
export async function compactStudy(conn: WriteConn, studyId: string): Promise<string[]> {
  const merged: string[] = [];
  for (const p of await studyParts(conn, studyId))
    if (p.parts > 1) {
      await exec(conn, `OPTIMIZE TABLE ${p.table} PARTITION ${sq(studyId)} FINAL`);
      merged.push(p.table);
    }
  return merged;
}

export const stageName = (table: string, tag: string) => `${table}_stage_${tag}`;

/** A lab_ table's column names, in order. */
export function columnsOf(table: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  const cols = LAB_TABLES[table].columns;
  for (let i = 0; i <= cols.length; i++) {
    const ch = cols[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if ((ch === "," && depth === 0) || i === cols.length) { out.push(cols.slice(start, i).trim().split(" ")[0]); start = i + 1; }
  }
  return out;
}

/**
 * Merges one import's staged rows into the lab_ tables at `version`: rows that are new or differ
 * from the stored ones are written, and stored rows the import no longer has get a deletion
 * marker. With `only`, stored rows are compared (and marked) only where they belong to the named
 * samples or patients, in the tables and profiles the update supplied data for; study-level rows
 * (study, profiles, attributes, case lists) are only added where the study has none of that key,
 * and those and case-list members are never marked deleted: an update adds to a study rather than replacing it. The staging tables are dropped.
 */
export async function mergeStaged(conn: WriteConn, studyId: string, tag: string, version: number,
  only: { samples: string[]; patients: string[]; profiles: string[]; tables: Set<string> } | null): Promise<void> {
  const lit = (v: string) => "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  const list = (xs: string[]) => "(" + (xs.length ? xs.map(lit).join(", ") : "''") + ")";
  const settings = { transform_null_in: "1" };
  try {
    for (const table of Object.keys(LAB_TABLES)) await mergeTable(table);
  } finally {
    for (const table of Object.keys(LAB_TABLES)) await exec(conn, "DROP TABLE IF EXISTS " + stageName(table, tag));
  }

  async function mergeTable(table: string): Promise<void> {
    const stage = stageName(table, tag);
    const cols = columnsOf(table);
    const row = "sipHash64(toString(tuple(" + cols.map((c) => "`" + c + "`").join(", ") + ")))";
    const key = "tuple(" + LAB_TABLES[table].order + ")";
    const rows = !only ? "1"
      : !only.tables.has(table) ? "0"
      : cols.includes("sample_id") && cols.includes("patient_id") ? `if(sample_id = '', patient_id IN ${list(only.patients)}, sample_id IN ${list(only.samples)})`
        : cols.includes("sample_id") ? `sample_id IN ${list(only.samples)}`
          : cols.includes("patient_id") ? `patient_id IN ${list(only.patients)}` : "0";
    // an update replaces a sample's data only in the profiles it supplied
    const scope = only && cols.includes("profile_id") ? `${rows} AND profile_id IN ${list(only.profiles)}` : rows;
    const study = "study_id = " + lit(studyId);
    if (only && !cols.includes("sample_id") && !cols.includes("patient_id")) {
      await exec(conn, `INSERT INTO ${table} SELECT * FROM ${stage} WHERE ${key} NOT IN (SELECT ${key} FROM ${table} FINAL WHERE ${study})`, settings);
      return;
    }
    const stored = await query<{ n: number }>(conn, `SELECT count() AS n FROM ${table} WHERE ${study}`);
    if (!Number(stored[0]?.n)) {
      await exec(conn, `INSERT INTO ${table} SELECT * FROM ${stage}`);
      return;
    }
    // compared in slices of the key space, so no comparison holds more than ~2M rows' hashes
    const n = await query<{ n: number }>(conn, `SELECT greatest((SELECT count() FROM ${stage}), (SELECT count() FROM ${table} WHERE ${study})) AS n`);
    const slices = Math.max(1, Math.ceil(Number(n[0]?.n ?? 0) / 2_000_000));
    for (let i = 0; i < slices; i++) {
      const slice = slices === 1 ? "1" : `sipHash64(${key}) % ${slices} = ${i}`;
      await exec(conn, `INSERT INTO ${table} (${cols.join(", ")}, version, is_deleted)
        SELECT ${cols.join(", ")}, ${version}, 1 FROM ${table} FINAL
        WHERE ${study} AND ${scope} AND ${slice} AND ${key} NOT IN (SELECT ${key} FROM ${stage} WHERE ${slice})`, settings);
      await exec(conn, `INSERT INTO ${table} SELECT * FROM ${stage}
        WHERE ${slice} AND ${row} NOT IN (SELECT ${row} FROM ${table} FINAL WHERE ${study} AND ${slice})`, settings);
    }
  }
}

/**
 * After an update, the values that depend on the whole study rather than on the samples it named:
 * the study's precomputed counts, and SAMPLE_COUNT of the patients it touched. Written as new
 * versions of those rows.
 */
export async function refreshLabStudy(conn: WriteConn, studyId: string, patients: string[]): Promise<void> {
  const s = "'" + studyId.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  const version = Date.now();
  const profiled = (cond: string) => `(SELECT uniqExact(sp.sample_id) FROM lab_sample_profile AS sp FINAL
    JOIN lab_profile AS p FINAL ON p.study_id = sp.study_id AND p.profile_id = sp.profile_id WHERE sp.study_id = ${s} AND ${cond})`;
  const mrna = "p.alteration_type = 'MRNA_EXPRESSION'";
  const counts: Record<string, string> = {
    sample_count: `(SELECT count() FROM lab_sample FINAL WHERE study_id = ${s})`,
    mutation_sample_count: profiled("p.alteration_type = 'MUTATION_EXTENDED'"),
    cna_sample_count: profiled("p.alteration_type = 'COPY_NUMBER_ALTERATION' AND p.datatype = 'DISCRETE'"),
    structural_variant_sample_count: profiled("p.alteration_type = 'STRUCTURAL_VARIANT'"),
    rna_seq_sample_count: profiled(`${mrna} AND position(p.profile_id, 'rna_seq') > 0`),
    mrna_microarray_sample_count: profiled(`${mrna} AND position(p.profile_id, 'rna_seq') = 0 AND position(p.profile_id, 'mrna') > 0`),
    mrna_expression_sample_count: profiled(mrna),
    rppa_sample_count: profiled("p.alteration_type = 'PROTEIN_LEVEL' AND position(p.profile_id, 'ms_abundance') = 0"),
    mass_spectrometry_sample_count: profiled("p.alteration_type = 'PROTEIN_LEVEL' AND position(p.profile_id, 'ms_abundance') > 0"),
    treatment_patient_count: `(SELECT uniqExact(patient_id) FROM lab_timeline_event FINAL WHERE study_id = ${s} AND upper(event_type) = 'TREATMENT')`
  };
  const cols = columnsOf("lab_study");
  await exec(conn, `INSERT INTO lab_study (${cols.join(", ")}, version, is_deleted)
    SELECT ${cols.map((c) => counts[c] ? `toUInt32(${counts[c]}) AS ${c}` : c).join(", ")}, ${version}, 0 FROM lab_study FINAL WHERE study_id = ${s}`);
  const list = "(" + (patients.length ? patients.map((p) => "'" + p.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'").join(", ") : "''") + ")";
  await exec(conn, `INSERT INTO lab_clinical (study_id, patient_id, sample_id, attr_id, value, version, is_deleted)
    SELECT study_id, patient_id, '', 'SAMPLE_COUNT', toString(count()), ${version}, 0 FROM lab_sample FINAL
    WHERE study_id = ${s} AND patient_id IN ${list} GROUP BY study_id, patient_id`);
}

/** Drops staging tables whose import process is no longer running (an interrupted import's). */
export async function dropStaleStages(conn: WriteConn): Promise<void> {
  const rows = await query<{ n: string }>(conn, "SELECT name AS n FROM system.tables WHERE database = currentDatabase() AND name LIKE 'lab\\_%\\_stage\\_%'");
  for (const { n } of rows) {
    const pid = Number(/_stage_(\d+)_/.exec(n)?.[1]);
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* no such process */ }
    if (!alive) await exec(conn, "DROP TABLE IF EXISTS " + n);
  }
}

/** Removes a study from every lab_ table and stored derived table, and its review records and the copy kept to undo an approval (lab-review.ts). */
export async function removeLabStudy(conn: WriteConn, studyId: string): Promise<boolean> {
  const n = await query<{ n: number }>(conn, `SELECT count() AS n FROM lab_study WHERE study_id = ${sq(studyId)}`);
  const tables = await query<{ t: string }>(conn, `SELECT name AS t FROM system.tables WHERE database = currentDatabase()
    AND (name IN (${[...Object.keys(LAB_TABLES), ...Object.values(STORED_DERIVED).map((t) => t.table)].map(sq).join(", ")}) OR name = 'lab_review'
      OR name LIKE 'lab\\_%\\_previous')`);
  for (const { t } of tables) await exec(conn, `ALTER TABLE ${t} DROP PARTITION ${sq(studyId)}`);
  return Number(n[0]?.n) > 0;
}
