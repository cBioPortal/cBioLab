// The file-shaped schema's rules (lib/importer/lab-schema.ts): every row of every lab_ table names
// its study, which is what per-study access control filters on, and the compatibility views are
// built from cBioPortal's own derived-table SQL by renaming tables, never by editing it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LAB_TABLES, baseViews, columnsOf, derivedSelects, labTableDdl, nativeDerived, renameTables } from "../lib/importer/lab-schema.ts";

test("every lab_ table has a study_id column and sorts by it first", () => {
  for (const [name, t] of Object.entries(LAB_TABLES)) {
    assert.ok(name.startsWith("lab_"), name);
    assert.match(t.columns, /^study_id String,/, name + " must begin with study_id String");
    assert.match(t.order, /^study_id\b/, name + " must sort by study_id first");
    assert.match(labTableDdl(name), /ReplacingMergeTree\(version, is_deleted\)/, name);
  }
});

test("every base view reads only lab_ tables and the shared reference tables", () => {
  const reference = new Set(["gene", "gene_alias", "gene_panel", "reference_genome", "genetic_entity", "type_of_cancer"]);
  for (const [name, sql] of Object.entries(baseViews())) {
    for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\b(?!\s*\()/g))
      assert.ok(m[1].startsWith("lab_") || reference.has(m[1]), `${name} reads ${m[1]}`);
  }
});

test("the derived views the app reads most join nothing: what they need is on the lab_ rows", () => {
  for (const [name, parts] of Object.entries(nativeDerived())) {
    for (const sql of parts) {
      assert.doesNotMatch(sql, /\bJOIN\b/, name);
      for (const m of sql.matchAll(/\bFROM\s+(\w+)\b/g)) assert.ok(m[1].startsWith("lab_"), `${name} reads ${m[1]}`);
    }
  }
});

test("table names are renamed as whole words, never inside string literals", () => {
  const sql = "SELECT 'mutation' AS t, sample.stable_id, sample_id FROM sample JOIN mutation m ON m.sample_id = sample.internal_id";
  assert.equal(renameTables(sql, ["sample", "mutation"], "labv_"),
    "SELECT 'mutation' AS t, labv_sample.stable_id, sample_id FROM labv_sample JOIN labv_mutation m ON m.sample_id = labv_sample.internal_id");
  assert.equal(renameTables(sql, ["sample"], ""), sql);
});

test("the derived-table script yields each table's SELECTs, in order", () => {
  const script = [
    "DROP TABLE IF EXISTS a_derived_temp;",
    "CREATE TABLE a_derived_temp AS a_derived;",
    "INSERT INTO a_derived_temp",
    "-- first part",
    "SELECT 1;",
    "INSERT INTO TABLE a_derived_temp",
    "SELECT 2",
    "SETTINGS join_algorithm = 'partial_merge';",
    "INSERT INTO sample_profile (sample_id) SELECT 3;",
    "EXCHANGE TABLES a_derived AND a_derived_temp;"
  ].join("\n");
  assert.deepEqual([...derivedSelects(script)], [["a_derived", ["SELECT 1", "SELECT 2"]]]);
});

test("column lists split at top-level commas only, so Map(String, String) stays one column", () => {
  assert.deepEqual(columnsOf("lab_timeline_event"), ["study_id", "patient_id", "event_index", "event_type", "start_date", "stop_date", "data"]);
  for (const name of Object.keys(LAB_TABLES)) assert.ok(columnsOf(name).every((c) => /^\w+$/.test(c)), name);
});
