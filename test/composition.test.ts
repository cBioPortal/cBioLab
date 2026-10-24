// The composition view's pure parts: how parts are named, what a source may be, the SQL's guards,
// and the figure's drawing from a result alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partNames, validateSource, compositionCasesSql, partsSql, COMPOSITION_MAX_PARTS } from "../lib/composition.ts";
import { compositionSvg } from "../lib/views/composition/figure.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { DrawnResultOf } from "../lib/types.ts";

test("attribute parts lose the prefix they share, at a word boundary", () => {
  assert.deepEqual(partNames(["custom:sc-tnk/TNK_CD8_T_ISG", "custom:sc-tnk/TNK_CD4_T_naive"]), ["CD8 T ISG", "CD4 T naive"]);
  // a shared prefix that ends inside a word is cut back to the last separator
  assert.deepEqual(partNames(["CELLS_TCELL", "CELLS_TREG"]), ["TCELL", "TREG"]);
  assert.deepEqual(partNames(["T_cell", "B_cell"], new Map([["T_cell", "T cells"]])), ["T cells", "B_cell"]);
});

test("a source is refused, not trimmed, past the parts a figure can tell apart", () => {
  const many = Array.from({ length: COMPOSITION_MAX_PARTS + 1 }, (_, i) => "A" + i);
  assert.throws(() => validateSource({ kind: "clinical", parts: many, unit: "patient", normalize: true }), /at most 16 parts.*asks for 17/);
  assert.throws(() => validateSource({ kind: "clinical", parts: ["A"], unit: "patient", normalize: true }), /at least 2 parts/);
  assert.throws(() => validateSource({ kind: "clinical", parts: ["A", "A"], unit: "patient", normalize: true }), /named twice/);
  assert.throws(() => validateSource({ kind: "clinical", parts: ["A", "B'; DROP"], unit: "patient", normalize: true }), /not an attribute name/);
  assert.throws(() => validateSource({ kind: "genericAssay", profileType: "x", parts: ["T_cell", "a b"], unit: "sample", normalize: true }), /not an entity id/);
});

test("the SQL keeps cases with every part, normalises only when asked, and never returns an id", () => {
  const src = { kind: "genericAssay" as const, profileType: "cell_type_relative_counts", parts: ["T_cell", "B_cell"], unit: "sample" as const, normalize: true };
  const sql = compositionCasesSql(src, "st", "db", "SELECT 'p1' AS pid", 1);
  assert.match(sql, /WHERE k = 2 AND lo >= 0 AND tot > 0/);
  assert.match(sql, /arrayMap\(x -> x \/ tot, vs\) AS ps/);
  assert.match(sql, /SELECT ps, h FROM cases ORDER BY ps\[2\] DESC/);
  assert.match(sql, /LIMIT 2001$/);
  assert.doesNotMatch(compositionCasesSql({ ...src, normalize: false }, "st", "db", "SELECT 'p1' AS pid", 0), /x \/ tot, vs\) AS ps/);
  assert.throws(() => compositionCasesSql(src, "st", "db", "SELECT 1", 2), /sort names no part/);
  // a clinical part reads its value under its own name, so a missing value is never read as the filter's 0
  const clin = partsSql({ kind: "clinical", parts: ["A", "B"], unit: "patient", normalize: true }, "st", "db", "SELECT 'p1' AS pid");
  assert.match(clin, /assumeNotNull\(av\)\) AS v FROM \(SELECT id, v AS av FROM/);
  assert.match(clin, /WHERE isFinite\(ifNull\(av, nan\)\)/);
});

function result(groups: { cohort: string; n: number; cases?: number[][] }[]): DrawnResultOf<"composition"> {
  const parts = [{ id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" }];
  return {
    kind: "composition", cohorts: groups.map((g) => g.cohort), caveat: "test caveat",
    composition: {
      source: "clinical", sourceName: "clinical attributes", unit: "patients", normalize: true, parts, sort: "A",
      groups: groups.map((g) => ({ cohort: g.cohort, n: g.n, incomplete: 0, invalid: 0, entropy: { mean: 1, sd: 0.1 },
        ...(g.cases ? { cases: g.cases } : { casesWhy: "more than 2,000 patients, too many to draw one bar each" }) })),
      cells: groups.flatMap((g) => parts.map((p, j) => ({ cohort: g.cohort, part: p.id, n: g.n, mean: [0.5, 0.3, 0.2][j], sd: 0.1,
        ...(groups.length > 1 ? { log2: 0.4, p: 0.01, q: 0.03 } : {}) }))),
      tested: groups.length > 1 ? groups.length * 3 : 0, significant: groups.length > 1 ? groups.length * 3 : 0
    }
  } as DrawnResultOf<"composition">;
}

test("the figure draws bars, areas and mean-only cohorts without a lint issue at any card width", () => {
  const few = Array.from({ length: 12 }, (_, i) => [0.6 - i * 0.02, 0.3, 0.1 + i * 0.02]);
  const lots = Array.from({ length: 1500 }, (_, i) => [1 - i / 1500, i / 3000, i / 3000]);
  const r = result([{ cohort: "Few", n: 12, cases: few }, { cohort: "Many cases in a cohort with a long name", n: 1500, cases: lots },
    { cohort: "Too many", n: 9000 }]);
  for (const width of [560, 936, 1352]) {
    const svg = compositionSvg(r, { width });
    assert.deepEqual(lintSvg(svg), [], "width " + width);
    assert.match(svg, /<rect [^>]*width="[0-9.]+"[^>]*fill="#/, "per-case bars");
    assert.match(svg, /<polygon /, "stacked areas for the large cohort");
    assert.match(svg, /mean only/, "the mean-only cohort says so");
  }
  // one cohort: no comparison matrix
  assert.doesNotMatch(compositionSvg(result([{ cohort: "Only", n: 3, cases: few.slice(0, 3) }]), { width: 760 }), /against the others/);
});
