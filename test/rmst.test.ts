// The RMST view's statistics and figure: the restricted mean and its variance against a hand
// computation, the contrast, the landmark reset, and the drawing.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rmst } from "../lib/stats.ts";
import { fromLandmark, rmstContrast } from "../lib/views/rmst/run.ts";
import { kaplanMeier } from "../lib/stats.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { ViewResult } from "../lib/types.ts";

const close = (a: number, b: number, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, a + " vs " + b);

describe("rmst", () => {
  // events at 1, 3, 4; censored at 2 and 5. KM: 0.8 after 1, 0.8·2/3 after 3, ·1/2 after 4
  const toy = [{ t: 1, event: 1 }, { t: 2, event: 0 }, { t: 3, event: 1 }, { t: 4, event: 1 }, { t: 5, event: 0 }];
  test("area to τ = 4.5 by hand: 1 + 2·0.8 + 1·(8/15) + 0.5·(4/15)", () => {
    close(rmst(toy, 4.5).rmst, 1 + 1.6 + 8 / 15 + 0.5 * 4 / 15);
  });
  test("variance by hand: Σ A_j² d_j / (n_j (n_j − d_j)) over the three events", () => {
    const A4 = 0.5 * 4 / 15, A3 = 8 / 15 + A4, A1 = 1.6 + A3;
    close(rmst(toy, 4.5).se, Math.sqrt(A1 * A1 / 20 + A3 * A3 / 6 + A4 * A4 / 2));
  });
  test("an event at τ adds nothing; before the first event the area is τ itself", () => {
    close(rmst(toy, 4).rmst, 1 + 1.6 + 8 / 15);
    assert.deepEqual([rmst(toy, 0.5).rmst, rmst(toy, 0.5).se], [0.5, 0]);
  });
  test("no censoring: the restricted mean is the mean of min(t, τ)", () => {
    const t = [0.5, 1.5, 2, 3.5, 6, 7];
    close(rmst(t.map((x) => ({ t: x, event: 1 })), 4).rmst, t.reduce((a, x) => a + Math.min(x, 4), 0) / t.length);
  });
  test("delayed entry: a patient is not at risk before entering", () => {
    const r = rmst([{ t: 1, event: 1 }, { t: 3, event: 0, entry: 2 }, { t: 4, event: 0 }], 4);
    close(r.rmst, 1 + 3 * 0.5);
  });
});

describe("rmst contrast and landmark", () => {
  test("difference and ratio with Wald intervals", () => {
    const c = rmstContrast({ rmst: 12, se: 0.6 }, { rmst: 10, se: 0.8 });
    close(c.diff, 2); close(c.diffHi - c.diff, 1.959963984540054);
    close(c.ratio, 1.2); close(Math.log(c.ratioHi / c.ratio), 1.959963984540054 * Math.sqrt(0.05 ** 2 + 0.08 ** 2));
  });
  test("a landmark keeps those followed past it and restarts the clock", () => {
    const recs = [{ t: 2, event: 1 }, { t: 6, event: 0 }, { t: 7, event: 1 }, { t: 9, event: 0, entry: 8 }];
    assert.deepEqual(fromLandmark(recs, 6), [{ t: 1, event: 1 }, { t: 3, event: 0, entry: 2 }]);
    assert.equal(fromLandmark(recs, 0), recs);
  });
});

describe("rmst figure", () => {
  const curve = (cohort: string, k: number) => ({ cohort, ...kaplanMeier([1, 2, 3 + k, 5, 8, 9, 12, 14].map((t, i) => ({ t, event: i % 3 ? 1 : 0 }))),
    rmst: 7 + k, se: 0.5, lo: 6 + k, hi: 8 + k, atRiskTau: 3, beforeLandmark: 0 });
  const cmp = { cohort: "B", vs: "A <x>", diff: 1, diffLo: -0.4, diffHi: 2.4, diffP: 0.16, ratio: 1.14, ratioLo: 0.95, ratioHi: 1.37, ratioP: 0.16 };
  const panel = (landmark: number) => ({ landmark, tau: 10, tauSet: true, curves: [curve("A <x>", 0), curve("B", 1)], comparisons: [cmp] });
  const v = { kind: "rmst", cohorts: ["A <x>", "B"], caveat: "not randomised",
    rmst: { endpointLabel: "OS", panels: [panel(0), panel(6)], cohorts: [] } } as unknown as ViewResult;
  for (const width of [560, 936]) test("draws, escapes names and lints clean at " + width, () => {
    const svg = viewToSvg(v, { width })!;
    assert.match(svg, /A &lt;x&gt;/);
    assert.match(svg, /τ = 10/);
    assert.deepEqual(lintSvg(svg), []);
  });
});
