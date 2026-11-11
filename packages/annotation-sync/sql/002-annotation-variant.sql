-- 002: the shared table public sources fill, `annotation.variant`, and the writer they share
-- (docs/ANNOTATION.md). Run once, as a ClickHouse administrator, on the warehouse that holds the
-- `annotation` database (001). Every statement is safe to repeat.
--
-- The first public sources are Genome Nexus's two services, `genome_nexus` (GRCh37) and
-- `genome_nexus_grch38`: one row per (source, release, variant), the annotation as JSON in `data`.
-- Nothing here is licensed, so the app reads the whole table.
--
-- test/annotation-store.test.ts holds the CREATE TABLE below to the code's
-- (packages/annotation-sync/src/sources/genome-nexus.ts).

-- 1. the table
CREATE TABLE IF NOT EXISTS annotation.variant (source LowCardinality(String), version LowCardinality(String), chr LowCardinality(String), start_position Int64, end_position Int64, reference_allele String, variant_allele String, data String CODEC(ZSTD(3)), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) PARTITION BY (source, version) ORDER BY (source, version, chr, start_position, end_position, reference_allele, variant_allele);

-- 2. the public sources' writer: `npm run annotate -- genome_nexus` writes as it, with
--    ANNOTATION_WRITER_USER / ANNOTATION_WRITER_PASSWORD. Choose its password here; it is never
--    committed anywhere.
-- CREATE USER IF NOT EXISTS annotation_writer IDENTIFIED BY '<a strong password>';

-- 3. who may do what. The writer reads the warehouse to list its keys and writes the shared table
--    and the log, nothing else; it never reaches the licensed annotation.oncokb.
GRANT SELECT, INSERT ON annotation.variant TO annotation_writer;
GRANT SELECT, INSERT ON annotation.sync_run TO annotation_writer;
GRANT SELECT ON cbioportal_public_librechat_blue.* TO annotation_writer;
-- the app reads every public source
GRANT SELECT ON annotation.variant TO cohort_lab_ro;

-- 4. the check: the table exists, empty until the first sync, and the writer holds exactly these grants
SELECT count() AS rows FROM annotation.variant;
SHOW GRANTS FOR annotation_writer;
