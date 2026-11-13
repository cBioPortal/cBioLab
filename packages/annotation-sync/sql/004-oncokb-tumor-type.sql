-- 004: OncoKB as cBioPortal asks it, per tumour type (docs/ANNOTATION.md). Run once, as a ClickHouse
-- administrator, on the warehouse that holds `annotation`; every statement is safe to repeat.
--
-- cBioPortal asks OncoKB about a mutation with the sample's tumour type (CANCER_TYPE_DETAILED,
-- else the study's cancer type) and its mutation type, so the levels it shows (therapeutic
-- sensitive and resistance, diagnostic, prognostic) and the card behind its icon are the ones for
-- that tumour type. `annotation.oncokb` holds one answer per gene and alteration, asked without a
-- tumour type: its level is the highest across every tumour type, which is right for the driver
-- bit it feeds everywhere and wrong in the mutation table's Annotation column. This table holds the
-- per-tumour-type answers; `annotation.oncokb` is unchanged.
--
-- The key is what cBioPortal deduplicates its queries on (oncokb-frontend-commons
-- generateQueryVariantId): gene, alteration, mutation type (sent as OncoKB's `consequence`) and
-- tumour type. `tumor_type` is '' where neither the sample nor the study names one (asked with
-- none). `data` is the answer's card content (treatments, implications, summaries, citations) as
-- JSON. It is licensed like the rest of OncoKB: the GRANT on this table is the licence.
--
-- test/annotation-store.test.ts holds the CREATE statement below to the code's
-- (packages/annotation-sync/src/sources/oncokb-tumor-type.ts).

CREATE TABLE IF NOT EXISTS annotation.oncokb_tumor_type (oncokb_version LowCardinality(String), alteration_type Enum8('MUTATION' = 1, 'CNA' = 2, 'SV' = 3), hugo_gene_symbol LowCardinality(String), alteration String, consequence LowCardinality(String), tumor_type LowCardinality(String), oncogenicity LowCardinality(String), mutation_effect LowCardinality(String), highest_sensitive_level LowCardinality(String), highest_resistance_level LowCardinality(String), highest_diagnostic_level LowCardinality(String), highest_prognostic_level LowCardinality(String), data String CODEC(ZSTD(3)), api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) PARTITION BY oncokb_version ORDER BY (oncokb_version, alteration_type, hugo_gene_symbol, alteration, consequence, tumor_type);

-- who may do what: the writer fills it and retires a superseded release (DROP PARTITION, which
-- ClickHouse grants as ALTER DELETE); the app reads it.
GRANT SELECT, INSERT, ALTER DELETE ON annotation.oncokb_tumor_type TO oncokb_writer;
GRANT SELECT ON annotation.oncokb_tumor_type TO cohort_lab_ro;
