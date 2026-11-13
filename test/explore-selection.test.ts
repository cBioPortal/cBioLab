// What a click on an Explore chart does to the draft (lib/explore-selection.ts): bars of one
// histogram OR (STS-BAR-5), a selected bar or pie value clicked again leaves the filter
// (STS-PIE-6), and other charts' clauses are left alone.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { binSelected, binsToLeaves, chartSelection, toggleBin, toggleValue, ANY_LEAF_LIMIT } from "../lib/explore-selection.ts";
import type { CohortDef, NumericBin } from "../lib/types.ts";

// AGE as coadread draws it: ≤35, then 5-year bars to 90, then >90
const AGE: NumericBin[] = [
  { special: "<=", end: 35, count: 8 },
  ...[35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85].map((s) => ({ start: s, end: s + 5, count: 10 })),
  { special: ">", start: 90, count: 3 },
];
const at = (s: number) => AGE.findIndex((b) => b.start === s && b.special == null);
const sex = { kind: "clinical" as const, attribute: "SEX", op: "=" as const, value: "Female" };

describe("histogram bars", () => {
  test("a second bar of the same chart ORs with the first instead of ANDing to nothing", () => {
    let d: CohortDef = { all: [sex] };
    d = (toggleBin(d, "AGE", AGE, at(50)) as { draft: CohortDef }).draft;
    assert.deepEqual(d.all, [sex, { kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 55 } }]);
    d = (toggleBin(d, "AGE", AGE, at(70)) as { draft: CohortDef }).draft;
    assert.deepEqual(d.all, [sex, { any: [
      { kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 55 } },
      { kind: "clinical", attribute: "AGE", range: { gt: 70, lte: 75 } }] }]);
  });

  test("neighbouring bars join into one range, and the outlier bars leave that side open", () => {
    const on = AGE.map((_, i) => i <= at(40));
    assert.deepEqual(binsToLeaves("AGE", AGE, on), [{ kind: "clinical", attribute: "AGE", range: { lte: 45 } }]);
    const top = AGE.map((_, i) => i >= at(85));
    assert.deepEqual(binsToLeaves("AGE", AGE, top), [{ kind: "clinical", attribute: "AGE", range: { gt: 85 } }]);
    const all = AGE.map(() => true);
    assert.deepEqual(binsToLeaves("AGE", AGE, all), [
      { kind: "clinical", attribute: "AGE", range: { lte: 35 } }, { kind: "clinical", attribute: "AGE", range: { gt: 35 } }],
      "every bar has no bound; written as two ranges, never an empty one");
  });

  test("a selected bar clicked again leaves the selection; the last one out removes the clause", () => {
    let d: CohortDef = { all: [sex, { kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 60 } }] };
    d = (toggleBin(d, "AGE", AGE, at(50)) as { draft: CohortDef }).draft;
    assert.deepEqual(d.all, [sex, { kind: "clinical", attribute: "AGE", range: { gt: 55, lte: 60 } }], "the range is split at the bar taken out");
    d = (toggleBin(d, "AGE", AGE, at(55)) as { draft: CohortDef }).draft;
    assert.deepEqual(d.all, [sex]);
  });

  test("a bar counts as selected when a range of the chart encloses it", () => {
    const sel = chartSelection({ all: [sex, { kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 60 } }] }, "AGE");
    assert.deepEqual(AGE.map((b) => binSelected(sel, b)), AGE.map((b) => b.start === 50 || b.start === 55));
    const below = chartSelection({ all: [{ kind: "clinical", attribute: "AGE", range: { lt: 45 } }] }, "AGE");
    assert.deepEqual(AGE.filter((b) => binSelected(below, b)).map((b) => b.end), [35, 40], "(40, 45] is not enclosed by < 45");
    assert.equal(binSelected([], AGE[0]), false, "no filter, nothing selected");
  });

  test("one-value bars (a discrete chart) and word bars", () => {
    const bins: NumericBin[] = [...[1, 2, 3, 4].map((v): NumericBin => ({ start: v, end: v, count: 1 })), { value: "Negative", count: 2 }];
    assert.deepEqual(binsToLeaves("N", bins, [true, false, false, false, false]), [{ kind: "clinical", attribute: "N", op: "=", value: 1 }]);
    assert.deepEqual(binsToLeaves("N", bins, [false, true, true, false, true]), [
      { kind: "clinical", attribute: "N", range: { gte: 2, lte: 3 } }, { kind: "clinical", attribute: "N", values: ["Negative"] }]);
    const sel = chartSelection({ all: [{ any: binsToLeaves("N", bins, [false, true, true, false, true]) }] }, "N");
    assert.deepEqual(bins.map((b) => binSelected(sel, b)), [false, true, true, false, true]);
  });

  test("past the leaves one clause can hold the click is refused, saying why", () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ start: i, end: i + 1, count: 1 }));
    let d: CohortDef = { all: [] };
    for (let i = 0; i < 2 * ANY_LEAF_LIMIT; i += 2) d = (toggleBin(d, "X", bars, i) as { draft: CohortDef }).draft;
    const r = toggleBin(d, "X", bars, 2 * ANY_LEAF_LIMIT);
    assert.ok("why" in r && /at most 8 separate ranges/.test(r.why));
  });

  test("a clause that is not the chart's own (a percentile, another attribute) is left as it is", () => {
    const pct = { kind: "clinical" as const, attribute: "AGE", op: ">=" as const, percentile: 0.8 };
    const d = (toggleBin({ all: [pct] }, "AGE", AGE, at(50)) as { draft: CohortDef }).draft;
    assert.deepEqual(d.all, [pct, { kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 55 } }]);
  });
});

describe("pie values", () => {
  test("a click adds the value; a second click on it takes it out again", () => {
    let d = toggleValue({ all: [] }, "SEX", "Female");
    assert.deepEqual(d.all, [sex]);
    d = toggleValue(d, "SEX", "Male");
    assert.deepEqual(d.all, [{ kind: "clinical", attribute: "SEX", values: ["Female", "Male"] }]);
    d = toggleValue(d, "SEX", "female");
    assert.deepEqual(d.all, [{ kind: "clinical", attribute: "SEX", op: "=", value: "Male" }], "matched as the facet folds values");
    d = toggleValue(d, "SEX", "Male");
    assert.deepEqual(d.all, []);
  });

  test("the chart's clause keeps its place among the others", () => {
    const age = { kind: "clinical" as const, attribute: "AGE", range: { gt: 50 } };
    const d = toggleValue({ study: "s", all: [sex, age] }, "SEX", "Male");
    assert.deepEqual(d, { study: "s", all: [{ kind: "clinical", attribute: "SEX", values: ["Female", "Male"] }, age] });
  });
});
