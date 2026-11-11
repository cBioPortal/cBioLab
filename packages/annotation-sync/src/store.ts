// The one database every source's annotations live in, and what all sources share there: the
// database itself and the audit log of every sync run. A source adds its own table (its `ddl`);
// a licensed source's table is read only by those granted SELECT on it (docs/ANNOTATION.md).

export const ANNOTATION_DB = "annotation";
export const SYNC_RUN_TABLE = ANNOTATION_DB + ".sync_run";

export const STORE_DDL = [
  "CREATE DATABASE IF NOT EXISTS " + ANNOTATION_DB,
  "CREATE TABLE IF NOT EXISTS " + SYNC_RUN_TABLE + " (run_id String, started_at DateTime, finished_at Nullable(DateTime), " +
    "source LowCardinality(String), version LowCardinality(String), study LowCardinality(String), variants_total UInt32, " +
    "already_stored UInt32, annotated_new UInt32, failed UInt32, note String) ENGINE = MergeTree ORDER BY (source, started_at)"
];
