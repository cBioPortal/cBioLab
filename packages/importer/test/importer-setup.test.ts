// Creating the local database (lib/importer/setup.ts): cBioPortal's own schema and seed tables from
// a pinned upstream commit, the columns and stores the app reads beyond them, datahub's gene
// panels, each upstream file fetched once into the data folder; and moving the database between
// schema modes (docs/LOCAL.md, "Schema modes"). ClickHouse is the stand-in of test/support/fake-ch.ts;
// the upstream files come from a stubbed fetch, so nothing leaves the machine.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeCh, type FakeCh } from "./support.ts";
import { CBIOPORTAL_COMMIT, applySchemaMode, derivedTablesSql, schemaMode, setupDatabase } from "../src/setup.ts";
import { LAB_TABLES, LEGACY_BASE_TABLES } from "../src/lab-schema.ts";

const realFetch = globalThis.fetch;
let ch: FakeCh | null = null;
afterEach(() => { ch?.restore(); ch = null; globalThis.fetch = realFetch; });

const UPSTREAM = "https://raw.githubusercontent.com/cBioPortal/cbioportal/" + CBIOPORTAL_COMMIT + "/src/main/resources/db-scripts/clickhouse/";
const SEEDS = ["gene", "gene_alias", "geneset", "geneset_gene", "genetic_entity", "reference_genome", "reference_genome_gene", "type_of_cancer"];
const PANEL_LIST = "https://api.github.com/repos/cBioPortal/datahub/contents/reference_data/gene_panels";
const PANEL_MEDIA = "https://media.githubusercontent.com/media/cBioPortal/datahub/master/reference_data/gene_panels/";

/** The upstream files, by URL. A seed "parquet" here is a JSON line, so the fake ClickHouse can read back what reached each table. */
function upstream(): Record<string, string> {
  return {
    [UPSTREAM + "init/schema.sql"]: "-- cBioPortal schema\nCREATE TABLE cancer_study (x Int32);\nCREATE TABLE gene (y Int32);\n",
    ...Object.fromEntries(SEEDS.map((t) => [UPSTREAM + "init/seed_table_" + t + ".parquet", JSON.stringify({ seed: t }) + "\n"])),
    [UPSTREAM + "populate_derived_tables.sql"]: "-- derived\n",
    [PANEL_LIST]: JSON.stringify([{ name: "data_gene_panel_impact.txt" }, { name: "data_gene_panel_bad.txt" }, { name: "README.md" }]),
    [PANEL_MEDIA + "data_gene_panel_impact.txt"]: "stable_id: IMPACT2\ndescription: two genes\ngene_list: TP53\tKRAS\n",
    [PANEL_MEDIA + "data_gene_panel_bad.txt"]: "stable_id: BAD\ngene_list: TP53\tNOTAGENE\n",
  };
}

/** fetch serving `files` (404 for anything else), recording each URL asked for; installed before fakeCh, which passes other URLs on to it */
function serve(files: Record<string, string>): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    return url in files ? new Response(files[url]) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return asked;
}

/** the fake ClickHouse, answering as a database that is (or is not) set up, with two genes */
function database(opts: { setUp?: boolean } = {}): FakeCh {
  const c = fakeCh();
  c.answer(/name = 'cbiolab_setup'/, [{ n: opts.setUp ? 1 : 0 }]);
  c.answer(/FROM gene_alias/, [{ e: 3845, a: "KRAS2" }]);
  c.answer(/FROM gene$/m, [{ e: 7157, h: "TP53", t: "protein-coding", g: 1 }, { e: 3845, h: "KRAS", t: "protein-coding", g: 2 }]);
  c.answer(/max\(internal_id\)/, [{ m: 0 }]);
  return c;
}

const dataDir = () => mkdtempSync(path.join(tmpdir(), "importer-setup-"));

test("a new database gets cBioPortal's schema and seeds, the app's columns and stores, and the panels", async () => {
  const asked = serve(upstream());
  ch = database();
  const dir = dataDir(), logs: string[] = [];
  await setupDatabase(ch.conn, dir, (m) => logs.push(m));
  const st = ch.statements;

  assert.equal(st[0], "CREATE DATABASE IF NOT EXISTS fake");
  assert.ok(st.includes("CREATE TABLE cancer_study (x Int32)") && st.includes("CREATE TABLE gene (y Int32)"), "schema.sql run statement by statement");
  for (const t of SEEDS) assert.deepEqual(ch.rows(t), [{ seed: t }], "seed table " + t);
  assert.ok(asked.every((u) => u.startsWith(UPSTREAM) || u.startsWith(PANEL_MEDIA) || u === PANEL_LIST));
  assert.ok(asked.filter((u) => u.startsWith(UPSTREAM)).every((u) => u.includes(CBIOPORTAL_COMMIT)), "upstream files are read at the pinned commit");

  // the precomputed counts lib/datasets.ts reads
  for (const c of ["sample_count", "mutation_sample_count", "cna_sample_count", "rna_seq_sample_count", "treatment_patient_count"])
    assert.ok(st.some((s) => s.startsWith("ALTER TABLE cancer_study ADD COLUMN IF NOT EXISTS " + c + " ")), c);
  // an empty OncoKB store: local mode has no licence
  assert.ok(st.includes("CREATE DATABASE IF NOT EXISTS annotation"));
  assert.ok(st.some((s) => s.startsWith("CREATE TABLE IF NOT EXISTS annotation.sync_run")));
  assert.ok(st.some((s) => s.startsWith("CREATE TABLE IF NOT EXISTS annotation.oncokb")));
  assert.ok(!ch.tables().some((t) => t.startsWith("oncokb")), "and nothing put in it");

  // datahub's gene panels: the one whose genes resolve is imported, the other named in the log
  assert.deepEqual(ch.rows("gene_panel").map((r) => r.stable_id), ["IMPACT2"]);
  assert.deepEqual(ch.rows("gene_panel_list").map((r) => r.gene_id).sort(), [3845, 7157]);
  assert.ok(logs.some((l) => l.startsWith("data_gene_panel_bad.txt: ") && l.includes("NOTAGENE")), logs.join("\n"));
  assert.ok(!asked.some((u) => u.endsWith("README.md")), "only data_gene_panel_ files are fetched");

  // marked as set up, with the commit, last
  const marker = st.findIndex((s) => s.startsWith("CREATE TABLE cbiolab_setup"));
  assert.ok(marker > st.findIndex((s) => s.startsWith("ALTER TABLE cancer_study")));
  assert.equal(st[marker + 1], "INSERT INTO cbiolab_setup (commit) VALUES ('" + CBIOPORTAL_COMMIT + "')");
  assert.equal(logs[0], "Creating the cBioPortal schema");
  assert.equal(logs.at(-1), "Database ready");
});

test("a database already set up is left as it is", async () => {
  const asked = serve(upstream());
  ch = database({ setUp: true });
  const logs: string[] = [];
  await setupDatabase(ch.conn, dataDir(), (m) => logs.push(m));
  assert.equal(ch.statements.length, 2, ch.statements.join("\n---\n"));
  assert.equal(ch.statements[0], "CREATE DATABASE IF NOT EXISTS fake");
  assert.deepEqual(ch.tables(), []);
  assert.deepEqual(asked, [], "nothing is downloaded");
  assert.deepEqual(logs, []);
});

test("each upstream file is fetched once: a second setup reads them from the data folder", async () => {
  const dir = dataDir();
  serve(upstream());
  ch = database();
  await setupDatabase(ch.conn, dir, () => {});
  ch.restore();
  assert.equal(readFileSync(path.join(dir, "upstream", "schema.sql"), "utf8"), upstream()[UPSTREAM + "init/schema.sql"]);

  const asked = serve({});
  ch = database();
  await setupDatabase(ch.conn, dir, () => {});
  assert.deepEqual(asked, []);
  assert.deepEqual(ch.rows("gene"), [{ seed: "gene" }]);
});

test("a file upstream does not have is named with its HTTP status, and nothing is marked set up", async () => {
  const files = upstream();
  delete files[UPSTREAM + "init/seed_table_geneset.parquet"];
  serve(files);
  ch = database();
  await assert.rejects(setupDatabase(ch.conn, dataDir(), () => {}),
    new RegExp("Could not download " + UPSTREAM.replace(/[.]/g, "\\.") + "init/seed_table_geneset\\.parquet \\(HTTP 404\\)"));
  assert.ok(!ch.statements.some((s) => s.includes("cbiolab_setup (commit)")));
});

test("the derived-table SQL is upstream's populate_derived_tables.sql, kept in the data folder", async () => {
  const dir = dataDir();
  const asked = serve({ [UPSTREAM + "populate_derived_tables.sql"]: "INSERT INTO x_temp SELECT 1;\n" });
  assert.equal(await derivedTablesSql(dir), "INSERT INTO x_temp SELECT 1;\n");
  assert.equal(await derivedTablesSql(dir), "INSERT INTO x_temp SELECT 1;\n");
  assert.equal(asked.length, 1);
});

/** the fake ClickHouse holding a database in schema mode `mode` (null: set up before modes existed) */
function inMode(mode: string | null): FakeCh {
  const c = fakeCh();
  c.answer(/name = 'cbiolab_schema'/, [{ n: mode == null ? 0 : 1 }]);
  c.answer(/argMax\(mode, at\)/, mode == null ? [] : [{ m: mode }]);
  // one column per derived table, as system.columns and DESCRIBE describe it
  c.answer(/FROM system\.columns WHERE/, (sql) => {
    const prefix = /LIKE '(\w*?)%/.exec(sql)?.[1] ?? "";
    return DERIVED.map((t) => ({ t: prefix + t, n: "id", ty: "String" }));
  });
  c.answer(/^DESCRIBE TABLE/, [{ name: "c0", type: "String" }]);
  return c;
}
const DERIVED = ["sample_to_gene_panel_derived", "gene_panel_to_gene_derived", "sample_derived", "genomic_event_derived", "clinical_data_derived",
  "clinical_event_derived", "clinical_event_data_derived", "genetic_alteration_derived", "generic_assay_data_derived", "mutation_derived",
  "generic_assay_profile_entity_derived", "generic_assay_meta_derived"];

/** a data folder whose derived-table SQL is already there (no INSERTs: the views come from the native selects alone) */
function folderWithDerivedSql(): string {
  const dir = dataDir();
  mkdirSync(path.join(dir, "upstream"), { recursive: true });
  writeFileSync(path.join(dir, "upstream", "populate_derived_tables.sql"), "-- nothing\n");
  return dir;
}

test("a database's schema mode is its latest recorded one; one set up before modes existed is legacy", async () => {
  ch = inMode(null);
  assert.equal(await schemaMode(ch.conn), "legacy");
  ch.restore();
  ch = inMode("both");
  assert.equal(await schemaMode(ch.conn), "both");
  ch.restore();
  ch = fakeCh();
  ch.answer(/name = 'cbiolab_schema'/, [{ n: 1 }]);
  ch.answer(/argMax\(mode, at\)/, [{ m: "" }]);
  assert.equal(await schemaMode(ch.conn), "legacy", "an empty record reads as legacy");
});

test("a database in the new schema cannot go back: that needs a fresh data folder", async () => {
  for (const target of ["legacy", "both"] as const) {
    ch = inMode("new");
    await assert.rejects(applySchemaMode(ch.conn, dataDir(), target, () => {}), /new schema only; going back to .* needs a fresh data folder \(CBIOLAB_DATA\)/);
    assert.ok(!ch.statements.some((s) => /^(DROP|CREATE|INSERT)/.test(s)), "nothing changed");
    ch.restore();
  }
});

test("legacy to legacy changes nothing and records nothing", async () => {
  ch = inMode(null);
  const logs: string[] = [];
  await applySchemaMode(ch.conn, dataDir(), "legacy", (m) => logs.push(m));
  assert.ok(!ch.statements.some((s) => /^(DROP|CREATE|INSERT)/.test(s)), ch.statements.join("\n"));
  assert.deepEqual(logs, []);
});

test("legacy to both adds the lab_ tables and labv_ views beside cBioPortal's tables, and records the mode", async () => {
  ch = inMode("legacy");
  const logs: string[] = [];
  await applySchemaMode(ch.conn, folderWithDerivedSql(), "both", (m) => logs.push(m));
  const st = ch.statements;
  for (const t of Object.keys(LAB_TABLES)) assert.ok(st.some((s) => new RegExp("^CREATE TABLE (IF NOT EXISTS )?" + t + "\\b").test(s)), "creates " + t);
  const views = st.filter((s) => s.startsWith("CREATE OR REPLACE VIEW "));
  assert.ok(views.length > 0);
  assert.ok(views.every((s) => s.startsWith("CREATE OR REPLACE VIEW labv_")), "every view is labv_-named");
  assert.ok(!st.some((s) => /^DROP TABLE IF EXISTS (?!lab_)/.test(s)), "cBioPortal's tables are kept");
  assert.equal(st.at(-1), "INSERT INTO cbiolab_schema (mode) VALUES ('both')");
  assert.equal(logs.at(-1), "Schema mode: both");
});

test("to new drops cBioPortal's study tables and puts views with their names in their place", async () => {
  ch = inMode("legacy");
  const logs: string[] = [];
  await applySchemaMode(ch.conn, folderWithDerivedSql(), "new", (m) => logs.push(m));
  const st = ch.statements;
  for (const t of [...LEGACY_BASE_TABLES, ...DERIVED]) {
    const drop = st.indexOf("DROP TABLE IF EXISTS " + t);
    assert.ok(drop >= 0, "drops " + t);
  }
  const lastDrop = Math.max(...st.map((s, i) => s.startsWith("DROP TABLE IF EXISTS") ? i : -1));
  const firstView = st.findIndex((s) => s.startsWith("CREATE OR REPLACE VIEW "));
  assert.ok(firstView > lastDrop, "the views are created after the tables are gone");
  assert.ok(st.some((s) => s.startsWith("CREATE OR REPLACE VIEW sample_derived AS")), "views carry cBioPortal's own names");
  assert.ok(!st.some((s) => s.startsWith("CREATE OR REPLACE VIEW labv_")));
  assert.ok(logs.includes("Replacing cBioPortal's study tables with views over the lab_ tables"));
  assert.equal(st.at(-1), "INSERT INTO cbiolab_schema (mode) VALUES ('new')");
});

test("new to new rebuilds the views but drops nothing and records nothing new", async () => {
  ch = inMode("new");
  await applySchemaMode(ch.conn, folderWithDerivedSql(), "new", () => {});
  assert.ok(!ch.statements.some((s) => s.startsWith("DROP TABLE")));
  assert.ok(ch.statements.some((s) => s.startsWith("CREATE OR REPLACE VIEW sample_derived AS")));
  assert.ok(!ch.statements.some((s) => s.startsWith("INSERT INTO cbiolab_schema")));
});

test("both to legacy drops the lab_ tables and the labv_ views, keeping cBioPortal's tables", async () => {
  ch = inMode("both");
  await applySchemaMode(ch.conn, dataDir(), "legacy", () => {});
  const st = ch.statements;
  for (const t of Object.keys(LAB_TABLES)) assert.ok(st.includes("DROP TABLE IF EXISTS " + t), t);
  for (const t of [...LEGACY_BASE_TABLES, ...DERIVED]) assert.ok(st.includes("DROP VIEW IF EXISTS labv_" + t), t);
  assert.ok(!st.some((s) => /^DROP TABLE IF EXISTS (?!lab_)/.test(s)));
  assert.equal(st.at(-1), "INSERT INTO cbiolab_schema (mode) VALUES ('legacy')");
});
