// The file-shaped schema's rules (packages/importer/src/lab-schema.ts): every row of every lab_ table names
// its study, which is what per-study access control filters on, and the compatibility views are
// built from cBioPortal's own derived-table SQL by renaming tables, never by editing it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LAB_TABLES, baseViews, columnsOf, convert, derivedSelects, labTableDdl, nativeDerived, renameTables } from "@cbiolab/importer/lab-schema";
import { copyColumns, isReviewId, reviewId } from "@cbiolab/importer/lab-review";
import { rng } from "@cbiolab/importer/lab-edits";
import { LAB_STUDY_TABLES, studyScope } from "../lib/ch.ts";

test("every lab_ table has a study_id column and sorts by it first", () => {
  for (const [name, t] of Object.entries(LAB_TABLES)) {
    assert.ok(name.startsWith("lab_"), name);
    assert.match(t.columns, /^study_id String,/, name + " must begin with study_id String");
    assert.match(t.order, /^study_id\b/, name + " must sort by study_id first");
    assert.match(labTableDdl(name), /ReplacingMergeTree\(version, is_deleted\) PARTITION BY study_id /, name + " must be partitioned by study");
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
    for (const { exprs, from } of parts) {
      const sql = exprs.join(", ") + " " + from;
      assert.doesNotMatch(sql, /\bJOIN\b/, name);
      for (const m of sql.matchAll(/\bFROM\s+(\w+)\b/g)) assert.ok(m[1].startsWith("lab_"), `${name} reads ${m[1]}`);
    }
  }
});

test("a view converts a column only where the conversion changes a value", () => {
  const t = (type: string, name = "x") => ({ name, type });
  assert.equal(convert("s.study_id", "String", t("LowCardinality(String)")), "s.study_id");
  assert.equal(convert("s.study_id", "LowCardinality(String)", t("String")), "s.study_id");
  assert.equal(convert("NULL", "Nullable(Nothing)", t("LowCardinality(String)")), "''");
  assert.equal(convert("m.chr", "Nullable(String)", t("LowCardinality(String)")), "ifNull(m.chr, '')");
  assert.equal(convert("m.n", "Nullable(Int64)", t("Int64")), "CAST(ifNull(m.n, defaultValueOfTypeName('Int64')) AS Int64)");
  assert.equal(convert("m.entrez_gene_id", "Int64", t("Int32")), "CAST(ifNull(m.entrez_gene_id, defaultValueOfTypeName('Int32')) AS Int32)");
  assert.equal(convert("id", "Int64", t("Int32", "internal_id")), "id");
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

test("a review copy rewrites the study id and the ids built on it, and copying back undoes it", () => {
  const to = Object.fromEntries(copyColumns("lab_mutation", "s1", "s1__review", 7).map((e) => [e.split(" AS ").pop(), e]));
  assert.equal(to.study_id, "'s1__review' AS study_id");
  assert.match(to.profile_id, /startsWith\(profile_id, 's1_'\), concat\('s1__review_', substring\(profile_id, 4\)\)/);
  assert.equal(to.sample_id, "sample_id", "sample ids are the files' own, not the study's");
  assert.equal(to.version, "7 AS version");
  assert.match(copyColumns("lab_case_list", "s1", "s1__review", 1).join(), /startsWith\(list_id, 's1_'\)/);
  const name = (from: string, t: string) => copyColumns("lab_study", from, t, 1).find((e) => e.endsWith(" AS name"));
  assert.match(name("s1", "s1__review")!, /concat\(name, ' \(review\)'\)/);
  assert.match(name("s1__review", "s1")!, /endsWith\(name, ' \(review\)'\)/);
  assert.equal(copyColumns("lab_mutation", "s1", "s2", 1).length, columnsOf("lab_mutation").length + 2);
  assert.ok(isReviewId(reviewId("s1")) && !isReviewId("s1"));
});

test("generated updates are the same for the same seed", () => {
  const a = rng(5), b = rng(5), c = rng(6);
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test("a resolver's statements are held to its study in every lab_ table, its id quoted", () => {
  assert.deepEqual([...LAB_STUDY_TABLES].sort(), Object.keys(LAB_TABLES).sort());
  const conn = { id: "t", url: "", user: "", password: "", db: "cbio", label: "" };
  assert.equal(studyScope(conn), "");
  const filters = decodeURIComponent(studyScope({ ...conn, study: "o'brien" }).replace(/^additional_table_filters=/, ""));
  assert.equal((filters.match(/study_id = /g) || []).length, LAB_STUDY_TABLES.length);
  assert.ok(filters.startsWith("{'cbio.lab_study': 'study_id = \\'o\\\\\\'brien\\''"), filters.slice(0, 80));
});
