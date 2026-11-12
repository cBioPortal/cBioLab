// The one database every source's annotations live in, and what all sources share there: the
// database itself, the audit log of every sync run, and the table public sources fill. A licensed
// source adds a table of its own (its `ddl`), read only by those granted SELECT on it (docs/ANNOTATION.md).

export const ANNOTATION_DB = "annotation";
export const SYNC_RUN_TABLE = ANNOTATION_DB + ".sync_run";

export const STORE_DDL = [
  "CREATE DATABASE IF NOT EXISTS " + ANNOTATION_DB,
  "CREATE TABLE IF NOT EXISTS " + SYNC_RUN_TABLE + " (run_id String, started_at DateTime, finished_at Nullable(DateTime), " +
    "source LowCardinality(String), version LowCardinality(String), study LowCardinality(String), variants_total UInt32, " +
    "already_stored UInt32, annotated_new UInt32, failed UInt32, note String) ENGINE = MergeTree ORDER BY (source, started_at)"
];

/** The table every public source fills: one row per (source, release, variant), the source's annotation as JSON in `data`. */
export const VARIANT_TABLE = ANNOTATION_DB + ".variant";
export const VARIANT_DDL =
  "CREATE TABLE IF NOT EXISTS " + VARIANT_TABLE + " (source LowCardinality(String), version LowCardinality(String), " +
  "chr LowCardinality(String), start_position Int64, end_position Int64, reference_allele String, variant_allele String, " +
  "data String CODEC(ZSTD(3)), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) " +
  "PARTITION BY (source, version) ORDER BY (source, version, chr, start_position, end_position, reference_allele, variant_allele)";
