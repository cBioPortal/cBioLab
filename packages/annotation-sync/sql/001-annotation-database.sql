-- 001: one annotation database (docs/ANNOTATION.md). Run once, as a ClickHouse administrator, on
-- the warehouse that holds `oncokb_annotation`; every statement is safe to repeat except the copies
-- (step 2), which check first that their target is empty.
--
-- OncoKB moves from its own database (`oncokb_annotation.variant_annotation` and `.sync_run`) into
-- `annotation`, beside the shared table later sources fill. Its licence moves from a GRANT on the
-- database to a GRANT on its table. Nothing is renamed: the old database stays, read by the code
-- deployed now, until the code that reads `annotation` is deployed (step 5).
--
-- test/annotation-store.test.ts holds the CREATE statements below to the code's
-- (packages/annotation-sync/src/store.ts and sources/oncokb.ts).

-- 1. the database, the shared audit log, OncoKB's table
CREATE DATABASE IF NOT EXISTS annotation;

CREATE TABLE IF NOT EXISTS annotation.sync_run (run_id String, started_at DateTime, finished_at Nullable(DateTime), source LowCardinality(String), version LowCardinality(String), study LowCardinality(String), variants_total UInt32, already_stored UInt32, annotated_new UInt32, failed UInt32, note String) ENGINE = MergeTree ORDER BY (source, started_at);

CREATE TABLE IF NOT EXISTS annotation.oncokb (oncokb_version LowCardinality(String), alteration_type Enum8('MUTATION' = 1, 'CNA' = 2, 'SV' = 3), hugo_gene_symbol LowCardinality(String), alteration String, oncogenicity LowCardinality(String), mutation_effect LowCardinality(String), highest_sensitive_level LowCardinality(String), highest_resistance_level LowCardinality(String), is_driver Bool MATERIALIZED oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'), api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) PARTITION BY oncokb_version ORDER BY (oncokb_version, alteration_type, hugo_gene_symbol, alteration);

-- 2. the copies, each only into an empty table (a second run copies nothing). resolved_at is copied,
--    so the newest release (what the app pins by default) is the same one.
INSERT INTO annotation.oncokb (oncokb_version, alteration_type, hugo_gene_symbol, alteration, oncogenicity, mutation_effect,
    highest_sensitive_level, highest_resistance_level, api_version, resolved_at)
  SELECT oncokb_version, alteration_type, hugo_gene_symbol, alteration, oncogenicity, mutation_effect,
    highest_sensitive_level, highest_resistance_level, api_version, resolved_at
  FROM oncokb_annotation.variant_annotation
  WHERE (SELECT count() FROM annotation.oncokb) = 0;

INSERT INTO annotation.sync_run (run_id, started_at, finished_at, source, version, study, variants_total, already_stored,
    annotated_new, failed, note)
  SELECT run_id, started_at, finished_at, 'oncokb', oncokb_version, study, variants_total, already_stored, annotated_new, failed, note
  FROM oncokb_annotation.sync_run
  WHERE (SELECT count() FROM annotation.sync_run WHERE source = 'oncokb') = 0;

-- 3. the check: every count must match its pair before going on (FINAL: a ReplacingMergeTree may
--    hold a row twice until it merges)
SELECT 'oncokb rows' AS what,
  (SELECT count() FROM oncokb_annotation.variant_annotation FINAL) AS before,
  (SELECT count() FROM annotation.oncokb FINAL) AS after
UNION ALL SELECT 'oncokb releases', (SELECT uniqExact(oncokb_version) FROM oncokb_annotation.variant_annotation),
  (SELECT uniqExact(oncokb_version) FROM annotation.oncokb)
UNION ALL SELECT 'drivers', (SELECT countIf(is_driver) FROM oncokb_annotation.variant_annotation FINAL),
  (SELECT countIf(is_driver) FROM annotation.oncokb FINAL)
UNION ALL SELECT 'sync runs', (SELECT count() FROM oncokb_annotation.sync_run),
  (SELECT count() FROM annotation.sync_run WHERE source = 'oncokb');

-- 4. who may do what. The licence is the GRANT on annotation.oncokb; the audit log is not licensed.
--    The writer reads the warehouse to list its keys and writes OncoKB's table and the log, nothing else.
GRANT SELECT, INSERT ON annotation.oncokb TO oncokb_writer;
GRANT SELECT, INSERT ON annotation.sync_run TO oncokb_writer;
-- the app (licensed): the same reads it has today, at the new address
GRANT SELECT ON annotation.oncokb TO cohort_lab_ro;
GRANT SELECT ON annotation.sync_run TO cohort_lab_ro;

-- 5. AFTER the code that reads `annotation` is deployed, and not before: the old database goes.
-- REVOKE ALL ON oncokb_annotation.* FROM oncokb_writer;
-- DROP DATABASE oncokb_annotation;
