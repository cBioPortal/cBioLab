// lib/table-query.ts: what every table view shares — the columns shown, search, filters, sort,
// pages — compiled around a table's own row source.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkQuery, cleanQuery, countsSql, csvField, describeQuery, mergeValues, pageSql, shownColumns, valuesSql, whereSql, type RowSource } from "../lib/table-query.ts";

const src: RowSource = {
  with: "WITH rows AS (SELECT 1)\n",
  columns: [
    { id: "name", name: "Name", numeric: false, text: "name" },
    { id: "kind", name: "Kind", numeric: false, text: "kind" },
    { id: "n", name: "Count", numeric: true, text: "toString(n)", num: "toFloat64(n)" },
    { id: "pc", name: "Protein Change", numeric: false, text: "pc", order: "pos" },
  ],
  select: "*",
  defaultOrder: "name",
  tiebreak: "name, ord",
};
const defaults = ["name", "kind"];
const cols = src.columns;

describe("checkQuery", () => {
  test("an empty query is fine", () => assert.equal(checkQuery({}, cols), null));
  test("unknown columns are named with what is accepted", () => {
    assert.match(checkQuery({ columns: ["name", "nope"] }, cols)!, /unknown column nope — columns are name, kind, n, pc/);
    assert.match(checkQuery({ sort: { column: "nope" } }, cols)!, /sort\.column nope is not a column/);
    assert.match(checkQuery({ filters: { nope: { op: "contains", value: "x" } } }, cols)!, /filters\.nope: not a column/);
  });
  test("a filter must suit its column", () => {
    assert.match(checkQuery({ filters: { n: { op: "contains", value: "1" } } }, cols)!, /numeric column takes a range/);
    assert.match(checkQuery({ filters: { name: { min: 1 } } }, cols)!, /range filter needs a numeric column/);
    assert.match(checkQuery({ filters: { n: { min: 5, max: 1 } } }, cols)!, /min is above max/);
    assert.match(checkQuery({ filters: { n: {} as { min?: number } } }, cols)!, /a filter is/);
    assert.match(checkQuery({ filters: { name: { op: "like" as "contains", value: "x" } } }, cols)!, /op is one of contains, notContains/);
    assert.match(checkQuery({ filters: { name: { op: "regex", value: "(" } } }, cols)!, /not a valid regular expression/);
    assert.equal(checkQuery({ filters: { name: { values: ["a", ""] }, n: { max: 3 } } }, cols), null);
  });
  test("search is bounded text", () => {
    assert.match(checkQuery({ search: "x".repeat(201) }, cols)!, /at most 200/);
  });
});

describe("shownColumns", () => {
  test("the query's own list, in its order, else the defaults", () => {
    assert.deepEqual(shownColumns({ columns: ["n", "name"] }, cols, defaults), ["n", "name"]);
    assert.deepEqual(shownColumns({}, cols, defaults), ["name", "kind"]);
  });
});

describe("whereSql", () => {
  test("nothing asked keeps every row", () => assert.equal(whereSql(src, {}, defaults), "1"));
  test("search matches any shown column, case-insensitively, as text", () => {
    assert.equal(whereSql(src, { search: " G12 " }, defaults), "(positionCaseInsensitiveUTF8(name, 'G12') > 0 OR positionCaseInsensitiveUTF8(kind, 'G12') > 0)");
    assert.match(whereSql(src, { search: "7", columns: ["n"] }, defaults), /^\(positionCaseInsensitiveUTF8\(toString\(n\), '7'\) > 0\)$/);
  });
  test("text conditions, value lists and ranges", () => {
    const w = (f: object) => whereSql(src, { filters: f as never }, defaults);
    assert.equal(w({ name: { op: "notContains", value: "x" } }), "(positionCaseInsensitiveUTF8(name, 'x') = 0)");
    assert.equal(w({ name: { op: "equals", value: "Ab" } }), "(lowerUTF8(name) = lowerUTF8('Ab'))");
    assert.equal(w({ name: { op: "endsWith", value: "b" } }), "(endsWith(lowerUTF8(name), lowerUTF8('b')))");
    assert.equal(w({ name: { op: "regex", value: "^G1[23]" } }), "(match(name, '^G1[23]'))");
    assert.equal(w({ kind: { values: ["Missense", ""] } }), "(kind IN ('Missense', ''))");
    assert.equal(w({ kind: { values: [] } }), "(0)");
    assert.equal(w({ n: { min: 2, max: 9 } }), "(toFloat64(n) IS NOT NULL AND toFloat64(n) >= 2 AND toFloat64(n) <= 9)");
    assert.equal(w({ name: { op: "contains", value: "a" }, n: { max: 3 } }), "(positionCaseInsensitiveUTF8(name, 'a') > 0) AND (toFloat64(n) IS NOT NULL AND toFloat64(n) <= 3)");
  });
  test("values are quoted, never spliced", () => {
    assert.equal(whereSql(src, { filters: { name: { op: "contains", value: "x') OR 1=1 --" } } }, defaults), "(positionCaseInsensitiveUTF8(name, 'x\\') OR 1=1 --') > 0)");
  });
  test("a column's own filter can be left out (its value list)", () => {
    assert.equal(whereSql(src, { filters: { kind: { values: ["a"] }, n: { min: 1 } } }, defaults, "kind"), "(toFloat64(n) IS NOT NULL AND toFloat64(n) >= 1)");
  });
});

describe("pageSql, countsSql, valuesSql", () => {
  test("a page: kept rows, the one order, the global offset, the kept total", () => {
    assert.equal(pageSql(src, { sort: { column: "n", desc: true }, filters: { kind: { values: ["a"] } } }, defaults, 25, 50),
      "WITH rows AS (SELECT 1)\nSELECT *, count() OVER () AS total FROM rows\nWHERE (kind IN ('a'))\nORDER BY toFloat64(n) DESC NULLS LAST, name, ord\nLIMIT 25 OFFSET 50");
    assert.match(pageSql(src, { sort: { column: "pc" } }, defaults, 1, 0), /ORDER BY pos ASC NULLS LAST, name, ord/);
    assert.match(pageSql(src, { sort: { column: "kind", desc: true } }, defaults, 1, 0), /ORDER BY \(kind = ''\) ASC, kind DESC, name, ord/);
    assert.match(pageSql(src, {}, defaults, 1, 0), /ORDER BY name, name, ord/);
  });
  test("counts: kept and in all, per cohort and study", () => {
    assert.match(countsSql(src, { search: "a" }, defaults), /SELECT cohort, study, countIf\(\(positionCaseInsensitiveUTF8.*\)\) AS n, count\(\) AS all FROM rows GROUP BY cohort, study$/);
  });
  test("values: a text column's distinct values by frequency; a numeric column's range", () => {
    assert.match(valuesSql(src, { filters: { kind: { values: ["a"] } } }, defaults, "kind"), /SELECT v, count\(\) AS n FROM \(SELECT kind AS v FROM rows WHERE 1\) GROUP BY v ORDER BY n DESC, v LIMIT 500$/);
    assert.match(valuesSql(src, {}, defaults, "n"), /SELECT min\(v\) AS lo, max\(v\) AS hi, count\(\) AS n FROM \(SELECT toFloat64\(n\) AS v FROM rows WHERE 1\) WHERE v IS NOT NULL$/);
    assert.throws(() => valuesSql(src, {}, defaults, "nope"), /unknown column/);
  });
});

describe("mergeValues", () => {
  test("text values add across databases, most frequent first", () => {
    const m = mergeValues("kind", false, [[{ v: "a", n: 2 }, { v: "b", n: 1 }], [{ v: "b", n: 3 }]]);
    assert.deepEqual(m, { column: "kind", numeric: false, values: [{ value: "b", n: 4 }, { value: "a", n: 2 }], truncated: false });
  });
  test("ranges widen; an empty part is skipped", () => {
    assert.deepEqual(mergeValues("n", true, [[{ lo: 2, hi: 5, n: 3 }], [{ lo: null, hi: null, n: 0 }], [{ lo: 1, hi: 4, n: 1 }]]),
      { column: "n", numeric: true, min: 1, max: 5, n: 4 });
  });
});

describe("describeQuery, cleanQuery, csvField", () => {
  test("the query in words", () => {
    assert.equal(describeQuery({}, cols), "");
    assert.equal(describeQuery({ search: "G12", filters: { kind: { values: ["Missense"] }, n: { min: 2 }, name: { op: "startsWith", value: "TCGA" } } }, cols),
      "rows containing “G12” in a shown column; Kind = “Missense”; Count ≥ 2; Name starts with “TCGA”");
  });
  test("cleanQuery drops what is unset", () => {
    assert.deepEqual(cleanQuery({ columns: [], search: "  ", filters: {}, sort: undefined }), {});
  });
  test("csvField quotes only when it must", () => {
    assert.equal(csvField("a"), "a");
    assert.equal(csvField(null), "");
    assert.equal(csvField(0.5), "0.5");
    assert.equal(csvField('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(csvField("two\nlines"), '"two\nlines"');
  });
});
