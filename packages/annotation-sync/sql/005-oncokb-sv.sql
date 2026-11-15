-- 005: OncoKB for structural variants, per gene pair and tumour type (docs/ANNOTATION.md). Run once,
-- as a ClickHouse administrator, on the warehouse that holds `annotation`; every statement is safe to
-- repeat.
--
-- cBioPortal asks OncoKB about a structural variant by its two genes, OncoKB's SV type and the
-- sample's tumour type (oncokb-frontend-commons generateAnnotateStructuralVariantQuery), so a fusion's
-- call is the pair's in the sample's cancer. `annotation.oncokb` holds only a gene-level 'Fusion'
-- answer per gene; this table holds the per-pair answers, and `annotation.oncokb` is unchanged.
--
-- The key is what cBioPortal deduplicates its queries on (generateQueryStructuralVariantId): site 1's
-- and site 2's Entrez ids ('' where a site names no gene), the SV type (FUSION for two genes; for one,
-- the variant's class when it is exactly one of OncoKB's types, else UNKNOWN) and the tumour type (''
-- when none). `data` is the answer as JSON. It is licensed like the rest of OncoKB: the GRANT on this
-- table is the licence.
--
-- test/annotation-store.test.ts holds the CREATE statement below to the code's
-- (packages/annotation-sync/src/sources/oncokb-sv.ts).

CREATE TABLE IF NOT EXISTS annotation.oncokb_sv (oncokb_version LowCardinality(String), site1_entrez String, site2_entrez String, sv_type LowCardinality(String), tumor_type LowCardinality(String), oncogenicity LowCardinality(String), mutation_effect LowCardinality(String), highest_sensitive_level LowCardinality(String), highest_resistance_level LowCardinality(String), highest_diagnostic_level LowCardinality(String), highest_prognostic_level LowCardinality(String), data String CODEC(ZSTD(3)), api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) PARTITION BY oncokb_version ORDER BY (oncokb_version, site1_entrez, site2_entrez, sv_type, tumor_type);

-- who may do what: the writer fills it and retires a superseded release (DROP PARTITION, which
-- ClickHouse grants as ALTER DELETE); the app reads it.
GRANT SELECT, INSERT, ALTER DELETE ON annotation.oncokb_sv TO oncokb_writer;
GRANT SELECT ON annotation.oncokb_sv TO cohort_lab_ro;
