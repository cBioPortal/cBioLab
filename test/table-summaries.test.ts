// A table's column summaries taken in its counts statement (lib/table-query.ts): countsSql's
// `summarize`, one part's summaries from its counts row (summaryOf), their merge across parts and
// databases (mergeSummaries), and a summary from a column's values (summaryOfValues). The SQL itself
// is run on the fixture in test/table-summaries-fixture.test.ts; here the rules that need no database.
//   S3  a numeric column with no value in a part: min and max null
//   S5  an unknown column in `summarize` throws; none (or an empty list) leaves the statement as it was
//   S6  mergeSummaries: numeric min of mins / max of maxes, nulls ignored, all null → null; text the
//       union without duplicates, truncated when a part was or the union passes VALUES_MAX (capped);
//       a part without a column contributes nothing
//   S7  summaryOfValues: numeric → its min/max; text → its values' strings and its truncated flag
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tq from "../lib/table-query.ts";
import type { RowSource, TableQuery } from "../lib/table-query.ts";

type Summary =
  | { column: string; numeric: true; min: number | null; max: number | null }
  | { column: string; numeric: false; values: string[]; truncated: boolean };
type Ask = { column: string; numeric: boolean };
const T = tq as unknown as {
  countsSql: (src: RowSource, q: TableQuery, defaults: string[], summarize?: Ask[]) => unknown;
  summaryOf?: (summarize: Ask[], row: Record<string, unknown>) => Summary[];
  mergeSummaries?: (summarize: Ask[], parts: Summary[][]) => Summary[];
  summaryOfValues?: (v: unknown) => Summary;
  VALUES_MAX: number;
};
const need = <K extends keyof typeof T>(k: K) => {
  assert.equal(typeof T[k], "function", "lib/table-query.ts exports " + String(k));
  return T[k] as NonNullable<(typeof T)[K]>;
};

const SRC: RowSource = {
  with: "WITH rows AS (SELECT 'c' AS cohort, 's' AS study, 1.5 AS x, 'a' AS t)\n",
  columns: [
    { id: "x", name: "X", numeric: true, text: "toString(x)", num: "x" },
    { id: "t", name: "T", numeric: false, text: "t" },
  ],
  select: "*", defaultOrder: "x", tiebreak: "t",
};
const ASK: Ask[] = [{ column: "x", numeric: true }, { column: "t", numeric: false }];
const num = (column: string, min: number | null, max: number | null): Summary => ({ column, numeric: true, min, max });
const txt = (column: string, values: string[], truncated = false): Summary => ({ column, numeric: false, values, truncated });
const sortedText = (s: Summary | undefined) => {
  assert.ok(s && !s.numeric, "a text summary: " + JSON.stringify(s));
  return { ...s, values: [...s.values].sort() };
};

// ---- S5 ------------------------------------------------------------------------------------------

test("S5 an unknown column in summarize throws", () => {
  assert.throws(() => T.countsSql(SRC, {}, [], [{ column: "nope", numeric: true }]));
  assert.throws(() => T.countsSql(SRC, {}, [], [{ column: "t", numeric: false }, { column: "nope", numeric: false }]));
});

test("S5 no summarize, or an empty one, gives the statement countsSql gave without the argument", () => {
  const plain = String(T.countsSql(SRC, { search: "a" }, ["x", "t"]));
  assert.equal(String(T.countsSql(SRC, { search: "a" }, ["x", "t"], [])), plain);
  assert.equal(String(T.countsSql(SRC, { search: "a" }, ["x", "t"], undefined)), plain);
  assert.notEqual(String(T.countsSql(SRC, { search: "a" }, ["x", "t"], ASK)), plain, "a summarize adds to the statement");
});

// ---- S3: summaryOf -------------------------------------------------------------------------------

test("S3 summaryOf on a counts row without the summary columns: numeric min and max null, text no values", () => {
  const summaryOf = need("summaryOf");
  const got = summaryOf(ASK, { cohort: "c", study: "s", n: 3, all: 3 });
  assert.equal(got.length, 2);
  assert.deepEqual(got[0], num("x", null, null));
  assert.equal(got[1].column, "t");
  assert.equal(got[1].numeric, false);
  assert.deepEqual((got[1] as { values: string[] }).values, []);
});

test("S3 summaryOf with no summarize asked: no summaries", () => {
  assert.deepEqual(need("summaryOf")([], { cohort: "c", study: "s", n: 1, all: 1 }), []);
});

// ---- S6: mergeSummaries --------------------------------------------------------------------------

test("S6 numeric: the min of the parts' mins and the max of their maxes", () => {
  const merge = need("mergeSummaries");
  const got = merge([{ column: "x", numeric: true }], [[num("x", 0.2, 0.5)], [num("x", 0.1, 0.3)], [num("x", 0.4, 0.9)]]);
  assert.deepEqual(got, [num("x", 0.1, 0.9)]);
});

test("S6 numeric: a part with null is ignored; every part null → null", () => {
  const merge = need("mergeSummaries");
  assert.deepEqual(merge([{ column: "x", numeric: true }], [[num("x", null, null)], [num("x", 0, 0.003)]]), [num("x", 0, 0.003)]);
  assert.deepEqual(merge([{ column: "x", numeric: true }], [[num("x", 0.7, 0.8)], [num("x", null, null)]]), [num("x", 0.7, 0.8)]);
  assert.deepEqual(merge([{ column: "x", numeric: true }], [[num("x", null, null)], [num("x", null, null)]]), [num("x", null, null)]);
  assert.deepEqual(merge([{ column: "x", numeric: true }], []), [num("x", null, null)], "no parts at all");
});

test("S6 numeric: negative and zero values merge as numbers, not by truthiness", () => {
  const merge = need("mergeSummaries");
  assert.deepEqual(merge([{ column: "x", numeric: true }], [[num("x", 0, 0)], [num("x", -2, -1)]]), [num("x", -2, 0)]);
});

test("S6 text: the union of the parts' values without duplicates, '' kept as a value", () => {
  const merge = need("mergeSummaries");
  const got = merge([{ column: "t", numeric: false }], [[txt("t", ["Colon", ""])], [txt("t", ["Rectal", "Colon"])], [txt("t", [])]]);
  assert.equal(got.length, 1);
  assert.deepEqual(sortedText(got[0]), txt("t", ["", "Colon", "Rectal"]));
});

test("S6 text: truncated when any part was truncated", () => {
  const merge = need("mergeSummaries");
  const got = merge([{ column: "t", numeric: false }], [[txt("t", ["a"], true)], [txt("t", ["b"])]]);
  assert.equal((got[0] as { truncated: boolean }).truncated, true);
  const none = merge([{ column: "t", numeric: false }], [[txt("t", ["a"])], [txt("t", ["b"])]]);
  assert.equal((none[0] as { truncated: boolean }).truncated, false);
});

test("S6 text: a union past VALUES_MAX is capped at VALUES_MAX and truncated; exactly VALUES_MAX is not", () => {
  const merge = need("mergeSummaries");
  const M = T.VALUES_MAX;
  assert.equal(M, 500);
  const vals = (from: number, k: number) => Array.from({ length: k }, (_, i) => "v" + (from + i));
  const over = merge([{ column: "t", numeric: false }], [[txt("t", vals(0, 300))], [txt("t", vals(250, 300))]]); // 550 distinct
  const o = over[0] as { values: string[]; truncated: boolean };
  assert.equal(o.values.length, M);
  assert.equal(new Set(o.values).size, M, "no duplicates");
  assert.equal(o.truncated, true);
  const at = merge([{ column: "t", numeric: false }], [[txt("t", vals(0, 300))], [txt("t", vals(100, 400))]]); // 500 distinct
  const a = at[0] as { values: string[]; truncated: boolean };
  assert.equal(a.values.length, M);
  assert.equal(a.truncated, false);
});

test("S6 a part missing a column contributes nothing to it", async (t) => {
  const merge = need("mergeSummaries");
  await t.test("a part missing the last column, or every column", () => {
    const got = merge(ASK, [[num("x", 1, 2), txt("t", ["a"])], [num("x", 0.5, 1)], []]);
    assert.deepEqual(got[0], num("x", 0.5, 2));
    assert.deepEqual(sortedText(got[1]), txt("t", ["a"]));
  });
  await t.test("a part missing the first column still contributes its other columns", () => {
    const got = merge(ASK, [[num("x", 1, 2), txt("t", ["a"])], [txt("t", ["b"])]]);
    assert.deepEqual(got[0], num("x", 1, 2));
    assert.deepEqual(sortedText(got[1]), txt("t", ["a", "b"]));
  });
  await t.test("a part listing the columns in another order is read by column", () => {
    const got = merge(ASK, [[num("x", 1, 2), txt("t", ["a"])], [txt("t", ["b"]), num("x", 0, 5)]]);
    assert.deepEqual(got[0], num("x", 0, 5));
    assert.deepEqual(sortedText(got[1]), txt("t", ["a", "b"]));
  });
});

test("S6 the merge follows summarize's order, one summary per asked column", () => {
  const merge = need("mergeSummaries");
  const got = merge([{ column: "t", numeric: false }, { column: "x", numeric: true }], [[num("x", 1, 2), txt("t", ["a"])]]);
  assert.deepEqual(got.map((s) => s.column), ["t", "x"]);
});

// ---- S7: summaryOfValues -------------------------------------------------------------------------

test("S7 summaryOfValues: a numeric column's values → its min and max", () => {
  const f = need("summaryOfValues");
  assert.deepEqual(f({ column: "vaf", numeric: true, min: 0.003, max: 0.31, n: 4 }), num("vaf", 0.003, 0.31));
  assert.deepEqual(f({ column: "vaf", numeric: true, min: null, max: null, n: 0 }), num("vaf", null, null));
});

test("S7 summaryOfValues: a text column's values → their strings (counts dropped) and its truncated flag", () => {
  const f = need("summaryOfValues");
  assert.deepEqual(f({ column: "cancerType", numeric: false, values: [{ value: "Colon", n: 3 }, { value: "", n: 2 }], truncated: false }),
    txt("cancerType", ["Colon", ""], false));
  assert.deepEqual(f({ column: "cancerType", numeric: false, values: [{ value: "a", n: 1 }], truncated: true }), txt("cancerType", ["a"], true));
});

test("S7 summaryOfValues agrees with mergeValues' output for the same rows", () => {
  const f = need("summaryOfValues");
  const numeric = tq.mergeValues("vaf", true, [[{ lo: 0.1, hi: 0.2, n: 2 }], [{ lo: 0.05, hi: 0.15, n: 1 }]]);
  assert.deepEqual(f(numeric), num("vaf", 0.05, 0.2));
  const text = tq.mergeValues("cancerType", false, [[{ v: "A", n: 2 }], [{ v: "B", n: 1 }, { v: "A", n: 1 }]]);
  assert.deepEqual(sortedText(f(text)), txt("cancerType", ["A", "B"], false));
});
