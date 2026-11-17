// The plot view's method record (lib/views/plot/method.ts): what each shape says it computed, and
// what its script must reproduce. scripts/check-method-scripts.ts runs the scripts themselves.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { plotMethod } from "../lib/views/plot/method.ts";
import type { PlotData } from "../lib/plot.ts";

const scatter: PlotData = { shape: "scatter", n: 590, x: { label: "AGE", kind: "num" }, y: { label: "FGA", kind: "num" },
  stats: { pearson: -0.03816, spearman: -0.05509, slope: -0.001, intercept: 0.3, pPearson: 0.359, pSpearman: 0.185 } };
const box: PlotData = { shape: "box", n: 7, x: { label: "CNA", kind: "cat" }, y: { label: "mRNA", kind: "num" },
  groups: [{ g: "Amplification", n: 6, lo: 1762.3, hi: 3509.25, q1: 2398.32, median: 2668.88, q3: 2842.69, loWhisker: 1762.3, hiWhisker: 3509.25 },
    { g: "Deep \"deletion\"", n: 1, lo: 468.29, hi: 468.29, q1: 468.29, median: 468.29, q3: 468.29, loWhisker: 468.29, hiWhisker: 468.29 }] };

describe("plot: the method record", () => {
  test("one study's scatter says Spearman's ties share their average rank, and its script reproduces both p-values", () => {
    const m = plotMethod({ cohort: "All", studies: ["coadread"], unit: "sample", data: scatter });
    const fetch = m.steps.find((s) => s.kind === "fetch")!;
    assert.match(fetch.params!.find(([k]) => k === "Spearman ties")![1], /average rank/);
    assert.deepEqual(Object.keys(m.check!).sort(), ["plot:pPearson", "plot:pSpearman"]);
    assert.equal(m.check!["plot:pSpearman"].v, 0.185);
    assert.match(m.python!, /pearson, spearman = -0\.03816, -0\.05509/);
    assert.match(m.python!, /^n = 590$/m);
  });

  test("a pooled scatter recomputes r and the line from each study's sums, and says why there is no Spearman", () => {
    const moments = [{ study: "a", n: 3, sx: 6, sy: 6, sxy: 14, sxx: 14, syy: 14 }, { study: "b", n: 2, sx: 9, sy: 9, sxy: 41, sxx: 41, syy: 41 }];
    const m = plotMethod({ cohort: "Lung", studies: ["a", "b"], unit: "patient",
      data: { ...scatter, stats: { ...scatter.stats!, spearman: null, pSpearman: null } }, moments });
    assert.ok(m.steps.some((s) => s.title === "No Spearman"));
    assert.deepEqual(Object.keys(m.check!).sort(), ["plot:intercept", "plot:pPearson", "plot:pearson", "plot:slope"]);
    assert.equal(m.check!["plot:pearson"].abs, 1e-9, "r is reported unrounded");
    assert.match(m.python!, /dict\(study="b", n=2, sx=9, sy=9, sxy=41, sxx=41, syy=41\)/);
    assert.equal(m.implementation.file, "lib/stats.ts");
  });

  test("a box states the portal's quartile rule and checks each group's whiskers, a quoted group name included", () => {
    const m = plotMethod({ cohort: "All", studies: ["coadread"], unit: "sample", data: box });
    const params = new Map(m.steps.find((s) => s.kind === "fetch")!.params);
    assert.match(params.get("quartiles")!, /round\(n\/4\)-th and q3 the round\(3n\/4\)-th, halves rounded up, no interpolation/);
    assert.match(params.get("median")!, /mean of the two middle values/);
    assert.deepEqual(Object.keys(m.check!).sort(), ["plot:Amplification:hiWhisker", "plot:Amplification:loWhisker",
      "plot:Deep \"deletion\":hiWhisker", "plot:Deep \"deletion\":loWhisker"]);
    assert.match(m.python!, /dict\(g="Deep \\"deletion\\"", n=1/);
    assert.ok(!m.steps.some((s) => s.kind === "transform"), "one study: nothing pooled");
  });

  test("a box over several studies says its quartiles are an approximation", () => {
    const m = plotMethod({ cohort: "All", studies: ["a", "b"], unit: "sample", data: box });
    assert.match(m.steps.find((s) => s.kind === "transform")!.detail, /approximation/);
  });

  test("a contingency table is counts only: no script", () => {
    const m = plotMethod({ cohort: "All", studies: ["a"], unit: "sample",
      data: { shape: "table", n: 3, x: { label: "A", kind: "cat" }, y: { label: "B", kind: "cat" }, cells: [{ cx: "a", cy: "b", n: 3 }] } });
    assert.equal(m.python, undefined);
    assert.match(m.steps[0].detail, /Counts only/);
  });
});
