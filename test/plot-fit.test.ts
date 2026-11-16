// The portal's regression line (lib/plot.ts portalFit, lib/chart/format.ts portalEquation) against
// what cbioportal-frontend's regression@2.0.1 `linear` returns for the same points (PLT-STM-7): its
// `equation`, `r2` and `string` for each case, run once with that library and written down here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { portalFit, fitOf, type FitSums } from "../lib/plot.ts";
import { portalEquation } from "../lib/chart/format.ts";

const sums = (pts: number[][]): FitSums => pts.reduce((a, [x, y]) =>
  ({ n: a.n + 1, sx: a.sx + x, sy: a.sy + y, sxy: a.sxy + x * y, sxx: a.sxx + x * x, syy: a.syy + y * y }), { n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 });

/** [what the case is, points, legacy slope, intercept, r2, legacy string] */
const CASES: [string, number[][], number, number, number, string][] = [
  ["a rising line", [[1, 2], [2, 3.1], [3, 4.9], [4, 6.2]], 1.44, 0.45, 0.99, "y = 1.44x + 0.45"],
  ["a negative intercept (the portal prints \"+ -1.9\")", [[1, -1], [2, 0.1], [3, 0.9]], 0.95, -1.9, 0.99, "y = 0.95x + -1.9"],
  ["a slope that rounds to 0: R² from the rounded line goes negative", [[1, 1], [2, 1.004], [3, 0.998], [4, 1.002]], 0, 1, -0.2, "y = 0x + 1"],
  ["a falling line", [[10, -5], [20, -14], [30, -26], [40, -33]], -0.96, 4.5, 0.99, "y = -0.96x + 4.5"],
  ["an exact fit", [[0, 3], [1, 3.5], [2, 4]], 0.5, 3, 1, "y = 0.5x + 3"],
];

describe("plot: the regression line, as cbioportal.org's Plots tab fits and labels it", () => {
  for (const [what, pts, m, b, r2, label] of CASES) test(what, () => {
    const f = portalFit(sums(pts))!;
    assert.deepEqual([f.slope, f.intercept, f.r2], [m, b, r2]);
    assert.ok(!Object.is(f.slope, -0) && !Object.is(f.r2, -0), "no negative zero to print");
    assert.equal(portalEquation(f.slope, f.intercept), b < 0 ? label.replace("+ -", "- ") : label);
  });

  test("an intercept of 0 is left out of the label, as the portal's", () => {
    assert.equal(portalEquation(0.5, 0), "y = 0.5x");
  });

  test("one point has no line; a constant y has a line and no R²; a sum that is not a number, no fit", () => {
    assert.equal(portalFit(sums([[1, 2]])), null);
    assert.deepEqual(portalFit(sums([[1, 2], [2, 2], [3, 2]])), { slope: 0, intercept: 2, r2: null });
    assert.deepEqual(fitOf({ ...sums([[1, 2], [2, 3]]), sxy: NaN }), {});
    assert.deepEqual(fitOf(sums([[1, 2], [2, 3]])).fit?.sums.n, 2);
  });
});

import { viewToSvg } from "../lib/view-svg.ts";
import { plotMethod } from "../lib/views/plot/method.ts";
import type { PlotData } from "../lib/plot.ts";

describe("plot: the regression line on the figure and in the method record", () => {
  const scatter = (fit?: PlotData["fit"]): PlotData => ({ shape: "scatter", n: 4, x: { label: "A", kind: "num" }, y: { label: "B", kind: "num" },
    extent: { x0: 0, x1: 10, y0: 0, y1: 20 }, grid: [10, 10], bins: [{ bx: 1, by: 1, n: 4 }],
    stats: { pearson: 0.9, spearman: 0.9, slope: 1.437, intercept: 0.452, pPearson: 0.1, pSpearman: 0.1 }, ...(fit ? { fit } : {}) });
  const fit = { slope: 1.44, intercept: 0.45, r2: 0.99, sums: sums([[1, 2], [2, 3.1], [3, 4.9], [4, 6.2]]) };

  test("without `regression` no line is drawn and none is described", () => {
    const svg = viewToSvg({ kind: "plot", plot: scatter() } as any)!;
    assert.doesNotMatch(svg, /stroke-dasharray="5 3"/);
    assert.doesNotMatch(svg, /y = |least-squares/);
  });

  test("with it, the dashed line, its swatch and \"y = 1.44x + 0.45   R² = 0.99\"", () => {
    const svg = viewToSvg({ kind: "plot", plot: scatter(fit) } as any)!;
    assert.equal((svg.match(/stroke-dasharray="5 3"/g) || []).length, 2, "the line and its swatch");
    assert.match(svg, />y = 1\.44x \+ 0\.45 {3}R² = 0\.99</);
    assert.match(svg.replace(/<\/text><text [^>]*>/g, " "), /least-squares fit over every case, its slope and intercept rounded to two decimals/);
  });

  test("the method record states the portal's rounding and its script checks all three numbers", () => {
    const m = plotMethod({ cohort: "All", studies: ["s"], unit: "sample", data: scatter(fit) });
    assert.ok(m.steps.some((s) => s.title === "The regression line, as cbioportal.org rounds it"));
    assert.deepEqual(["plot:fit:slope", "plot:fit:intercept", "plot:fit:r2"].map((k) => m.check![k].v), [1.44, 0.45, 0.99]);
    assert.match(m.python!, /f = dict\(n=4, sx=10, sy=16\.2,/);
  });
});
