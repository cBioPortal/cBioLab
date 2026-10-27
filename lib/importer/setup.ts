// Creates the local database: cBioPortal's own ClickHouse schema and seed tables (genes,
// aliases, reference genomes, cancer types), the columns and stores this app reads beyond them,
// and the datahub gene panels. Everything is fetched once, from pinned upstream files, into the
// local data folder; a database that is already set up is left as it is.
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { exec, execScript, insertRaw, query, type WriteConn } from "./ch-write.ts";
import { GeneResolver } from "./genes.ts";
import { importGenePanel } from "./panels.ts";

// cBioPortal/cbioportal master on 2026-10-27; the schema, seeds and derived-table SQL are read
// from this commit so the local database is exactly the one that SQL was written for
export const CBIOPORTAL_COMMIT = "4b27f48e2f8d714ca105555263ae11a726878900";
const UPSTREAM = "https://raw.githubusercontent.com/cBioPortal/cbioportal/" + CBIOPORTAL_COMMIT + "/src/main/resources/db-scripts/clickhouse/";
const SEEDS = ["gene", "gene_alias", "geneset", "geneset_gene", "genetic_entity", "reference_genome", "reference_genome_gene", "type_of_cancer"];
const DATAHUB_MEDIA = "https://media.githubusercontent.com/media/cBioPortal/datahub/master/";

/** Downloads `url` into `file` unless it is already there. */
async function fetchOnce(url: string, file: string): Promise<Buffer> {
  try { if ((await stat(file)).size > 0) return await readFile(file); } catch { /* not yet fetched */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download " + url + " (HTTP " + res.status + ")");
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  return buf;
}

/** The derived-table SQL, which every import re-runs. */
export async function derivedTablesSql(dataDir: string): Promise<string> {
  return (await fetchOnce(UPSTREAM + "populate_derived_tables.sql", path.join(dataDir, "upstream", "populate_derived_tables.sql"))).toString("utf8");
}

// Columns the public warehouse adds to cancer_study (precomputed counts; lib/datasets.ts reads
// them). Filled per study by `refreshStudyCounts`.
const STUDY_COUNT_COLUMNS = ["sample_count", "mutation_sample_count", "cna_sample_count", "structural_variant_sample_count",
  "rna_seq_sample_count", "mrna_microarray_sample_count", "mrna_expression_sample_count", "rppa_sample_count",
  "mass_spectrometry_sample_count", "mirna_sample_count", "treatment_patient_count"];

// The OncoKB annotation store the app reads (lib/annotation.ts). Local mode has no OncoKB
// licence, so it is created empty: OncoKB-dependent filters then match nothing instead of failing.
const ONCOKB_DDL = [
  "CREATE DATABASE IF NOT EXISTS oncokb_annotation",
  "CREATE TABLE IF NOT EXISTS oncokb_annotation.sync_run (run_id String, started_at DateTime, finished_at Nullable(DateTime), " +
    "oncokb_version LowCardinality(String), study LowCardinality(String), variants_total UInt32, already_stored UInt32, " +
    "annotated_new UInt32, failed UInt32, note String) ENGINE = MergeTree ORDER BY started_at",
  "CREATE TABLE IF NOT EXISTS oncokb_annotation.variant_annotation (oncokb_version LowCardinality(String), " +
    "alteration_type Enum8('MUTATION' = 1, 'CNA' = 2, 'SV' = 3), hugo_gene_symbol LowCardinality(String), alteration String, " +
    "oncogenicity LowCardinality(String), mutation_effect LowCardinality(String), highest_sensitive_level LowCardinality(String), " +
    "highest_resistance_level LowCardinality(String), is_driver Bool MATERIALIZED oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'), " +
    "api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) " +
    "PARTITION BY oncokb_version ORDER BY (oncokb_version, alteration_type, hugo_gene_symbol, alteration)"
];

export type Log = (msg: string) => void;

async function isSetUp(conn: WriteConn): Promise<boolean> {
  const r = await query<{ n: number }>(conn,
    "SELECT count() AS n FROM system.tables WHERE database = currentDatabase() AND name = 'cbiolab_setup'");
  return Number(r[0]?.n) > 0;
}

export async function setupDatabase(conn: WriteConn, dataDir: string, log: Log): Promise<void> {
  await exec({ ...conn, db: "default" }, "CREATE DATABASE IF NOT EXISTS " + conn.db);
  if (await isSetUp(conn)) return;
  log("Creating the cBioPortal schema");
  const schema = (await fetchOnce(UPSTREAM + "init/schema.sql", path.join(dataDir, "upstream", "schema.sql"))).toString("utf8");
  await execScript(conn, schema);
  for (const t of SEEDS) {
    log("Loading reference table " + t);
    const buf = await fetchOnce(UPSTREAM + "init/seed_table_" + t + ".parquet", path.join(dataDir, "upstream", "seed_table_" + t + ".parquet"));
    await insertRaw(conn, t, "Parquet", new Uint8Array(buf));
  }
  for (const c of STUDY_COUNT_COLUMNS) await exec(conn, "ALTER TABLE cancer_study ADD COLUMN IF NOT EXISTS " + c + " UInt32 DEFAULT 0");
  await exec(conn, "ALTER TABLE cancer_study ADD COLUMN IF NOT EXISTS resource_sample_counts Map(String, UInt32)");
  for (const st of ONCOKB_DDL) await exec(conn, st);
  await loadReferencePanels(conn, dataDir, log);
  await exec(conn, "CREATE TABLE cbiolab_setup (commit String, at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY tuple()");
  await exec(conn, "INSERT INTO cbiolab_setup (commit) VALUES ('" + CBIOPORTAL_COMMIT + "')");
  log("Database ready");
}

/** datahub's shared gene panel definitions (reference_data/gene_panels), which studies name by id. */
async function loadReferencePanels(conn: WriteConn, dataDir: string, log: Log): Promise<void> {
  const listFile = path.join(dataDir, "upstream", "gene_panels.json");
  const list = JSON.parse((await fetchOnce("https://api.github.com/repos/cBioPortal/datahub/contents/reference_data/gene_panels", listFile)).toString("utf8")) as { name: string }[];
  const genes = await GeneResolver.load(conn);
  log("Loading " + list.length + " datahub gene panels");
  for (const { name } of list.filter((f) => f.name.startsWith("data_gene_panel_"))) {
    const text = (await fetchOnce(DATAHUB_MEDIA + "reference_data/gene_panels/" + name, path.join(dataDir, "upstream", "gene_panels", name))).toString("utf8");
    const r = await importGenePanel(conn, genes, text);
    if (r.warning) log(name + ": " + r.warning);
  }
}
