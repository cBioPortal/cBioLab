// The scatter's correlation line as cbioportal.org's Plots tab writes it (lib/views/plot/figure.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg } from "../lib/view-svg.ts";
// PLT-SC-2 / PLT-STM-4…6: the audit's Q4 (coadread AGE × FGA), as cbioportal.org writes it
describe("plot: the correlation line as the portal's Plots tab writes it", () => {
  test("Spearman first, each to two decimals, its p by toConditionalPrecision(p, 3, 0.01)", () => {
    const svg = viewToSvg({ kind: "plot", plot: { shape: "scatter", n: 590, x: { label: "AGE", kind: "num" }, y: { label: "FGA", kind: "num" },
      extent: { x0: 0, x1: 10, y0: 0, y1: 10 }, grid: [10, 10], bins: [{ bx: 1, by: 1, n: 590 }],
      stats: { pearson: -0.03816, spearman: -0.05509, slope: 0, intercept: 0, pPearson: 0.35851, pSpearman: 0.1854 } } as any })!;
    assert.match(svg, />Spearman: -0\.06 \(p = 0\.185\) +· +Pearson: -0\.04 \(p = 0\.359\)</);
  });

  test("a p below 0.01 is in exponent form, and a plot pooled across studies has no Spearman", () => {
    const svg = viewToSvg({ kind: "plot", plot: { shape: "scatter", n: 590, x: { label: "A", kind: "num" }, y: { label: "B", kind: "num" },
      extent: { x0: 0, x1: 10, y0: 0, y1: 10 }, grid: [10, 10], bins: [{ bx: 1, by: 1, n: 590 }],
      stats: { pearson: -0.33166, spearman: null, slope: 0, intercept: 0, pPearson: 6.801e-15, pSpearman: null } } as any })!;
    assert.match(svg, />Pearson: -0\.33 \(p = 6\.80e-15\)</);
    assert.doesNotMatch(svg, /Spearman:/);
  });
});
