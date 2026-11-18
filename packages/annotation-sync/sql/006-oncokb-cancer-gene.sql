-- 006: OncoKB's cancer gene list, per release (docs/ANNOTATION.md). Run once, as a ClickHouse
-- administrator, on the warehouse that holds `annotation`; every statement is safe to repeat.
--
-- cBioPortal reads OncoKB's cancer gene list (GET /utils/cancerGeneList) for whether a gene is an
-- OncoKB cancer gene (the last element of the Mutations and Structural Variants tables' Annotation
-- sort, Study View's gene-table icon) and whether OncoKB curates it. One row per gene of the portal's
-- gene table at each release: `cancer_gene` says whether the list has it, `data` is its entry as JSON.
-- It is licensed like the rest of OncoKB: the GRANT on this table is the licence.
--
-- test/annotation-store.test.ts holds the CREATE statement below to the code's
-- (packages/annotation-sync/src/sources/oncokb-cancer-gene.ts).

CREATE TABLE IF NOT EXISTS annotation.oncokb_cancer_gene (oncokb_version LowCardinality(String), entrez_gene_id String, hugo_symbol String, cancer_gene Bool, oncokb_annotated Bool, is_oncogene Bool, is_tsg Bool, occurrence_count UInt16, data String CODEC(ZSTD(3)), api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) PARTITION BY oncokb_version ORDER BY (oncokb_version, entrez_gene_id);

-- who may do what: the writer fills it and retires a superseded release (DROP PARTITION, which
-- ClickHouse grants as ALTER DELETE); the app reads it.
GRANT SELECT, INSERT, ALTER DELETE ON annotation.oncokb_cancer_gene TO oncokb_writer;
GRANT SELECT ON annotation.oncokb_cancer_gene TO cohort_lab_ro;
