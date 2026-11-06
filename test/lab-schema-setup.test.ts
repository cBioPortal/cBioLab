// Creating and maintaining the lab_ schema (lib/importer/lab-schema.ts; docs/LOCAL.md "Schema
// modes"): the compatibility views for a schema mode, typed as cBioPortal's derived tables; the
// lab_ tables, with older layouts copied into the current one and older column sets refused; the
// stored ids added to tables that lack them; merging a study's partitions; and dropping staging
// tables an interrupted import left. ClickHouse is test/support/fake-ch.ts.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCh, type FakeCh } from "./support/fake-ch.ts";
import {
  LAB_TABLES, TABLE_IDS, baseViews, columnsOf, compactStudy, createLabTables, createViews, derivedTypes, dropStaleStages, nativeDerived, studyParts,
} from "../lib/importer/lab-schema.ts";

let ch: FakeCh | null = null;
afterEach(() => { ch?.restore(); ch = null; });
const db = () => (ch = fakeCh());

type Col = { name: string; type: string };
/** column types for every native derived view: one String column per expression */
const nativeTypes = () => new Map<string, Col[]>(Object.entries(nativeDerived()).map(([n, parts]) => [n, parts[0].exprs.map((_, i) => ({ name: "col" + i, type: "String" }))]));

const SCRIPT = [
  "DROP TABLE IF EXISTS extra_derived_temp;",
  "INSERT INTO extra_derived_temp",
  "SELECT s.stable_id AS a, s.internal_id AS b FROM sample s JOIN other_derived_temp o ON o.x = s.internal_id;",
].join("\n");

/** a database whose DESCRIBE answers: positional columns as String for the native views, two for the script's */
function describing(c: FakeCh, scriptCols: Col[] = [{ name: "a", type: "Nullable(String)" }, { name: "b", type: "Int64" }]): void {
  c.answer(/^DESCRIBE TABLE \(SELECT/, (sql) => {
    const positional = [...sql.matchAll(/ AS c(\d+)\b/g)];
    return positional.length ? positional.map((_, i) => ({ name: "c" + i, type: "String" })) : scriptCols;
  });
}

test("'new' mode views take cBioPortal's names: base views, native derived views, and the script's derived views typed as its tables", async () => {
  const c = db();
  describing(c);
  const types = nativeTypes();
  types.set("extra_derived", [{ name: "a", type: "String" }, { name: "internal_id", type: "Int32" }]);
  await createViews(c.conn, "new", SCRIPT, types);
  const views = c.statements.filter((s) => s.startsWith("CREATE OR REPLACE VIEW "));
  for (const name of Object.keys(baseViews())) assert.ok(views.some((v) => v.startsWith(`CREATE OR REPLACE VIEW ${name} AS `)), name);
  for (const [name, parts] of Object.entries(nativeDerived())) {
    const v = views.find((s) => s.startsWith(`CREATE OR REPLACE VIEW ${name} AS `))!;
    assert.equal(v.split("\nUNION ALL\n").length, parts.length, name + ": one SELECT per branch");
    assert.match(v, /AS `col0`/);
  }
  const extra = views.find((s) => s.startsWith("CREATE OR REPLACE VIEW extra_derived AS "))!;
  // a Nullable(String) into a String column is NULL → ''; an Int64 id into the widened internal_id is left alone
  assert.ok(extra.includes("SELECT ifNull(`a`, '') AS `a`, `b` AS `internal_id` FROM ("));
  // the script's *_temp names are the derived tables themselves; in 'new' mode nothing is prefixed
  assert.ok(extra.includes("FROM sample s JOIN other_derived o"));
});

test("'both' mode prefixes every view labv_ and points the script's SQL at the prefixed views", async () => {
  const c = db();
  describing(c);
  const types = nativeTypes();
  types.set("extra_derived", [{ name: "a", type: "Nullable(String)" }, { name: "b", type: "Int64" }]);
  await createViews(c.conn, "both", SCRIPT, types);
  const views = c.statements.filter((s) => s.startsWith("CREATE OR REPLACE VIEW "));
  assert.ok(views.every((v) => v.startsWith("CREATE OR REPLACE VIEW labv_")));
  const extra = views.find((s) => s.startsWith("CREATE OR REPLACE VIEW labv_extra_derived AS "))!;
  assert.ok(extra.includes("FROM labv_sample s JOIN other_derived o"), "base and derived names known to the views are prefixed; others are not");
  assert.ok(extra.includes("SELECT `a` AS `a`, `b` AS `b`"), "types that already match are not converted");
});

test("a derived view is refused when its table's types are unknown, or its SELECT yields another number of columns", async () => {
  const c = db();
  describing(c);
  const missing = nativeTypes();
  await assert.rejects(createViews(c.conn, "new", SCRIPT, missing), /no column types for extra_derived/);
  const native = new Map(nativeTypes());
  const [first] = native.keys();
  native.delete(first);
  await assert.rejects(createViews(c.conn, "new", "", native), new RegExp("no column types for " + first));
  const wrong = nativeTypes();
  wrong.set("extra_derived", [{ name: "a", type: "String" }]);
  await assert.rejects(createViews(c.conn, "new", SCRIPT, wrong), /extra_derived: 2 columns from the script, 1 in the table/);
});

test("derived table types are read per table, in column order, without the prefix", async () => {
  const c = db();
  c.answer(/FROM system\.columns WHERE database = currentDatabase\(\) AND table LIKE 'labv_%\\_derived'/, [
    { t: "labv_sample_derived", n: "sample_unique_id", ty: "String" }, { t: "labv_sample_derived", n: "internal_id", ty: "Int64" },
    { t: "labv_mutation_derived", n: "hugo_gene_symbol", ty: "String" },
  ]);
  const t = await derivedTypes(c.conn, "labv_");
  assert.deepEqual([...t], [
    ["sample_derived", [{ name: "sample_unique_id", type: "String" }, { name: "internal_id", type: "Int64" }]],
    ["mutation_derived", [{ name: "hugo_gene_symbol", type: "String" }]],
  ]);
});

/** a database whose lab_ tables are `existing` (name → [columns, sorting key, partition key]), with `names` in system.tables and `have` columns/indexes */
function labDatabase(existing: Record<string, [string, string, string]>, names: string[] = [], have: string[] = []): FakeCh {
  const c = db();
  c.answer(/FROM system\.tables t JOIN system\.columns c/, Object.entries(existing).map(([t, [cols, k, p]]) => ({ t, c: cols, k, p })));
  c.answer(/^SELECT name AS t FROM system\.tables WHERE database = currentDatabase\(\)\s+FORMAT/, names.map((t) => ({ t })));
  c.answer(/FROM system\.data_skipping_indices/, have.map((x) => ({ x })));
  c.answer(/^SELECT DISTINCT study_id AS s FROM/, [{ s: "a" }, { s: "b" }]);
  return c;
}
const current = (t: string) => [...columnsOf(t), "version", "is_deleted"].join(",");
/** every stored id and index, as system.columns / data_skipping_indices would list them */
const allIds = (tables: string[]) => tables.flatMap((t) => {
  const ids = TABLE_IDS[t.replace(/_previous$/, "")];
  return [...ids.ids.map((c) => `${t}.${c}`), ...(ids.indexed ?? []).map((c) => `${t}.${c}_idx`)];
});

test("a fresh database gets every lab_ table, with its stored ids and indexes in the DDL", async () => {
  const c = labDatabase({});
  await createLabTables(c.conn);
  const creates = c.statements.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS lab_"));
  assert.equal(creates.length, Object.keys(LAB_TABLES).length);
  const sample = creates.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS lab_sample ("))!;
  assert.match(sample, /sample_int Int64 MATERIALIZED toInt64\(bitAnd\(sipHash64\('sample', study_id, sample_id\)/);
  assert.match(sample, /INDEX patient_int_idx patient_int TYPE bloom_filter GRANULARITY 1/);
  assert.match(sample, /ENGINE = ReplacingMergeTree\(version, is_deleted\) PARTITION BY study_id ORDER BY \(study_id, sample_id\)/);
  assert.match(creates.find((s) => s.includes(" lab_mutation ("))!, /mutation_event_int Nullable\(Int64\) MATERIALIZED/);
});

test("tables already holding every id and index get no ALTERs", async () => {
  const tables = Object.keys(LAB_TABLES);
  const c = labDatabase(Object.fromEntries(tables.map((t) => [t, [current(t), "(" + LAB_TABLES[t].order + ")", "study_id"]])), tables, allIds(tables));
  const log: string[] = [];
  await createLabTables(c.conn, (m) => log.push(m));
  assert.deepEqual(log, []);
  assert.ok(!c.statements.some((s) => s.startsWith("ALTER TABLE")));
});

test("a table missing stored ids gets them added and filled, its _previous copy too", async () => {
  const tables = Object.keys(LAB_TABLES);
  const have = allIds(tables).filter((x) => !x.startsWith("lab_sample."));
  const c = labDatabase({}, [...tables, "lab_sample_previous"], have);
  const log: string[] = [];
  await createLabTables(c.conn, (m) => log.push(m));
  assert.deepEqual(log, ["Storing the ids of lab_sample", "Storing the ids of lab_sample_previous"]);
  for (const t of ["lab_sample", "lab_sample_previous"]) {
    assert.ok(c.statements.some((s) => s.startsWith(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS sample_int Int64 MATERIALIZED`)), t);
    assert.ok(c.statements.includes(`ALTER TABLE ${t} MATERIALIZE COLUMN sample_int`), t);
    assert.ok(c.statements.includes(`ALTER TABLE ${t} ADD INDEX IF NOT EXISTS patient_int_idx patient_int TYPE bloom_filter GRANULARITY 1`), t);
    assert.ok(c.statements.includes(`ALTER TABLE ${t} MATERIALIZE INDEX patient_int_idx`), t);
  }
});

test("a table with the right columns but an older partitioning or sort key is copied into the current layout, a study at a time", async () => {
  const c = labDatabase({
    lab_patient: [current("lab_patient"), "study_id, patient_id", "tuple()"],
    lab_sample: [current("lab_sample"), "(study_id, patient_id)", "study_id"],
    lab_clinical: [current("lab_clinical"), LAB_TABLES.lab_clinical.order, "study_id"],
  }, ["lab_patient", "lab_patient_previous", "lab_sample", "lab_clinical"]);
  const log: string[] = [];
  await createLabTables(c.conn, (m) => log.push(m));
  assert.deepEqual(log.filter((m) => m.startsWith("Copying")), [
    "Copying lab_patient into its current layout (partitioned by study, sorted by study_id, patient_id)",
    "Copying lab_patient_previous into its current layout (partitioned by study, sorted by study_id, patient_id)",
    "Copying lab_sample into its current layout (partitioned by study, sorted by study_id, sample_id)",
  ]);
  const st = c.statements;
  const at = (s: string) => st.indexOf(s);
  assert.ok(at("DROP TABLE IF EXISTS lab_patient_relayout") >= 0);
  assert.ok(st.some((s) => s.startsWith("CREATE TABLE IF NOT EXISTS lab_patient_relayout (")));
  assert.ok(at("INSERT INTO lab_patient_relayout SELECT * FROM lab_patient FINAL WHERE study_id = 'a' AND is_deleted = 0") >= 0);
  assert.ok(at("OPTIMIZE TABLE lab_patient_relayout PARTITION 'b' FINAL") > at("INSERT INTO lab_patient_relayout SELECT * FROM lab_patient FINAL WHERE study_id = 'b' AND is_deleted = 0"));
  assert.ok(at("EXCHANGE TABLES lab_patient AND lab_patient_relayout") < at("DROP TABLE lab_patient_relayout"));
  assert.ok(at("EXCHANGE TABLES lab_patient_previous AND lab_patient_previous_relayout") >= 0);
  assert.ok(!st.some((s) => /lab_clinical_relayout/.test(s)), "a table already in the current layout is left alone");
});

test("a table with other columns is refused: its studies need importing again", async () => {
  const c = labDatabase({ lab_sample: ["study_id,sample_id,version,is_deleted", "(study_id, sample_id)", "study_id"] });
  await assert.rejects(createLabTables(c.conn), /lab_sample has an older layout than this importer writes; drop the lab_ tables/);
  assert.ok(!c.statements.some((s) => s.startsWith("CREATE TABLE")));
});

test("a study's parts are listed per table, and only partitions of more than one part are merged", async () => {
  const c = db();
  c.answer(/FROM system\.parts\s+WHERE active AND database = currentDatabase\(\) AND partition = 'st'/, [
    { table: "lab_patient", parts: 1, rows: 10, bytes: 100 }, { table: "lab_sample", parts: "3", rows: "30", bytes: "300" },
  ]);
  assert.deepEqual(await studyParts(c.conn, "st"), [{ table: "lab_patient", parts: 1, rows: 10, bytes: 100 }, { table: "lab_sample", parts: 3, rows: 30, bytes: 300 }]);
  c.clear();
  assert.deepEqual(await compactStudy(c.conn, "st"), ["lab_sample"]);
  assert.deepEqual(c.statements.filter((s) => s.startsWith("OPTIMIZE")), ["OPTIMIZE TABLE lab_sample PARTITION 'st' FINAL"]);
});

test("staging tables of a process that is gone are dropped; a running import's are kept", async () => {
  const c = db();
  const dead = 2 ** 22 + 12345; // above Linux's pid_max ceiling, so no such process
  c.answer(/name LIKE 'lab\\_%\\_stage\\_%'/, [{ n: `lab_sample_stage_${process.pid}_1` }, { n: `lab_mutation_stage_${dead}_2` }]);
  await dropStaleStages(c.conn);
  assert.deepEqual(c.statements.filter((s) => s.startsWith("DROP")), [`DROP TABLE IF EXISTS lab_mutation_stage_${dead}_2`]);
});
