// A box plot's category order (lib/views/plot/run.ts categoryOrder), case by case from the portal's
// rule: cbioportal-frontend cd8c6df src/shared/components/plots/PlotsTabUtils.tsx makeBoxScatterPlotData
// (2837-2843: a data type's categoryOrder when it has one, else _.sortBy by label) and the orders it
// uses (2148 cnaCategoryOrder; 2165 mutTypeCategoryOrder; 2176 mutVsWildCategoryOrder; 2181
// mutDriverVsVUSCategoryOrder), with our labels ("Not mutated" for the portal's "No mutation").
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { categoryOrder } from "../lib/views/plot/run.ts";
import { naturalSort } from "../lib/views/plot/natural-sort.ts";
import { viewToSvg } from "../lib/view-svg.ts";

const gene = (by?: string) => ({ source: "alteration", gene: "KRAS", ...(by ? { by } : {}) }) as never;
/** [the rule's case, axis, categories as the counts arrive, order drawn] */
const CASES: [string, unknown, string[], string[]][] = [
  ["O1 no order of its own: alphabetical (Q5)", { source: "clinical", attribute: "CANCER_TYPE_DETAILED" },
    ["Rectal", "Colon", "Mucinous"], ["Colon", "Mucinous", "Rectal"]],
  ["O2 alphabetical compares code units, as lodash sortBy: capitals first", { source: "clinical", attribute: "X" }, ["b", "B", "a"], ["B", "a", "b"]],
  ["O3 copy-number levels, deep deletion to amplification", { source: "molecular", profileType: "cna", gene: "KRAS", discrete: true },
    ["Diploid", "Amplification", "Deep deletion", "Gain", "Shallow deletion"], ["Deep deletion", "Shallow deletion", "Diploid", "Gain", "Amplification"]],
  ["O4 a category outside the type's order follows it", { source: "molecular", profileType: "cna", gene: "KRAS", discrete: true },
    ["Gain", "Weird", "Deep deletion"], ["Deep deletion", "Gain", "Weird"]],
  ["O5 mutation classes, Multiple, then no mutation and not profiled", gene("mutationType"),
    ["Not mutated", "Truncating", "Promoter", "Missense", "Multiple", "Not profiled", "Other", "Splice", "Inframe"],
    ["Missense", "Inframe", "Truncating", "Splice", "Promoter", "Other", "Multiple", "Not mutated", "Not profiled"]],
  ["O6 classes split Driver / VUS: each class's Driver before its VUS", gene("mutationType"),
    ["Missense (VUS)", "Truncating (Driver)", "Not mutated", "Missense (Driver)"], ["Missense (Driver)", "Missense (VUS)", "Truncating (Driver)", "Not mutated"]],
  ["O7 Driver vs VUS", gene("driver"), ["VUS", "Not profiled", "Not mutated", "Driver"], ["Driver", "VUS", "Not mutated", "Not profiled"]],
  ["O8 mutated vs not", gene(), ["Not profiled", "Not mutated", "Mutated"], ["Mutated", "Not mutated", "Not profiled"]],
  ["O9 any of several genes, mutated vs not", { source: "alteration", genes: ["KRAS", "NRAS"] }, ["Not mutated", "Mutated"], ["Mutated", "Not mutated"]],
  ["O10 amplified / deleted (no portal axis): the levels' order", gene("cna"), ["Amplification", "Not profiled", "Neutral", "Deep deletion"],
    ["Deep deletion", "Neutral", "Amplification", "Not profiled"]],
  ["O11 structural variant or not", gene("sv"), ["No structural variant", "Not profiled", "Structural variant"],
    ["Structural variant", "No structural variant", "Not profiled"]],
];

describe("plot: box categories in the portal's order", () => {
  for (const [what, axis, given, want] of CASES) test(what, () => assert.deepEqual(categoryOrder(axis as never)!(given), want));
  test("O12 an OQL axis (no portal counterpart) keeps the order it came in", () => {
    assert.equal(categoryOrder({ source: "alteration", oql: "KRAS: MUT" } as never), null);
    assert.equal(categoryOrder({ source: "alteration", oql: "KRAS: MUT; NRAS: MUT", by: "statement" } as never), null);
  });
});

// TablePlot.tsx (PLT-TB-3): a data type's order, else javascript-natural-sort, whose cases these are
// (outputs of the library itself, cbioportal-frontend's node_modules/javascript-natural-sort 0.7.1)
describe("plot: a contingency table's categories", () => {
  test("N1 numbers inside labels compare as numbers; a number before text; capitals first", () => {
    assert.deepEqual(["T10", "T2", "T1", "Stage IV", "Stage II", "Stage I", "Stage III"].sort(naturalSort),
      ["Stage I", "Stage II", "Stage III", "Stage IV", "T1", "T2", "T10"]);
    assert.deepEqual(["b", "10", "B", "2", "a"].sort(naturalSort), ["2", "10", "B", "a", "b"]);
    assert.deepEqual(["0x1F", "0x0A", "0x10"].sort(naturalSort), ["0x0A", "0x10", "0x1F"], "hex codes by value");
    assert.equal(naturalSort("  x", "x"), 0, "surrounding spaces are ignored");
  });

  test("N2 a table's axes: a data type's order where it has one, natural order otherwise", () => {
    const tumour = categoryOrder({ source: "clinical", attribute: "TUMOR_STAGE" } as never, naturalSort)!;
    assert.deepEqual(tumour(["T10", "T2", "T1"]), ["T1", "T2", "T10"]);
    const cna = categoryOrder({ source: "molecular", profileType: "cna", gene: "KRAS", discrete: true } as never, naturalSort)!;
    assert.deepEqual(cna(["Gain", "Diploid", "Deep deletion"]), ["Deep deletion", "Diploid", "Gain"]);
  });
});

describe("plot: the table figure draws the engine's order", () => {
  test("rows top to bottom and columns left to right as given, not by marginal total", () => {
    const cells = [{ cx: "B", cy: "r2", n: 9 }, { cx: "A", cy: "r1", n: 1 }, { cx: "B", cy: "r1", n: 1 }];
    const svg = viewToSvg({ kind: "plot", plot: { shape: "table", n: 11, x: { label: "X", kind: "cat" }, y: { label: "Y", kind: "cat" }, cells,
      order: { x: ["A", "B"], y: ["r1", "r2"] } } } as never)!;
    const pos = (t: string) => svg.indexOf(">" + t + "<");
    assert.ok(pos("r1") < pos("r2"), "r1 is the first row though r2 holds more");
    assert.ok(pos("A") < pos("B"), "A is the first column though B holds more");
    const byTotal = viewToSvg({ kind: "plot", plot: { shape: "table", n: 11, x: { label: "X", kind: "cat" }, y: { label: "Y", kind: "cat" }, cells } } as never)!;
    assert.ok(byTotal.indexOf(">r2<") < byTotal.indexOf(">r1<"), "without an order, the bigger row first");
  });
});
