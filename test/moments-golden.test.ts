// The moment- and rank-based tests checked against scipy, numpy and statsmodels.
//
// test/fixtures/golden/moments.json was generated from raw values (`uv run python/golden/moments.py`);
// our functions get the same data in the form production hands them — (n, Σx, Σx²) moments,
// (value, count) histograms, the six correlation sums, per-site (r, n) — and the libraries get the
// raw values. p-values are compared to a relative 1e-6; statistics we report rounded are compared
// within that rounding.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { welchT, welchAnovaTest, varianceFromMoments, mannWhitneyU, kruskalWallis, quantilesFromHistogram,
  pearsonFromMoments, fisherZMeta } from "../lib/stats.ts";
import { VERIFIED } from "../lib/method.ts";

const golden = JSON.parse(readFileSync("test/fixtures/golden/moments.json", "utf8"));

function closeRel(actual: number, expected: number, what: string, tol = 1e-6): void {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-300);
  assert.ok(err <= tol, what + ": got " + actual + ", reference " + expected + " (relative error " + err.toExponential(2) + ")");
}
const within = (actual: number, expected: number, tol: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, what + ": got " + actual + ", reference " + expected);
const fromMoments = (m: { n: number; sum: number; sumsq: number }) =>
  ({ n: m.n, mean: m.sum / m.n, variance: varianceFromMoments(m.n, m.sum, m.sumsq) });

describe("welchT from moments matches scipy ttest_ind(equal_var=False) — scipy " + golden.libraries.scipy, () => {
  golden.welch.forEach((c: any, i: number) => test("case " + (i + 1) + ": n " + c.a.n + " vs " + c.b.n, () => {
    const a = fromMoments(c.a), b = fromMoments(c.b);
    const r = welchT(a.n, a.mean, a.variance, b.n, b.mean, b.variance);
    within(r.t, c.t, 5e-5, "t"); within(r.df, c.df, 5e-3, "df"); closeRel(r.p, c.p, "p");
  }));
});

describe("welchAnovaTest matches statsmodels anova_generic(use_var='unequal') — statsmodels " + golden.libraries.statsmodels, () => {
  golden.anova.forEach((c: any, i: number) => test("case " + (i + 1) + ": " + c.groups.length + " groups", () => {
    const r = welchAnovaTest(c.groups.map(fromMoments));
    within(r.f, c.f, 5e-5, "F"); assert.equal(r.df1, c.df1); within(r.df2, c.df2, 5e-3, "df2"); closeRel(r.p, c.p, "p");
  }));
});

describe("rank tests and quantiles from value histograms match scipy and numpy", () => {
  golden.ranks.forEach((c: any, i: number) => test("case " + (i + 1) + ": " + c.groups.length + " groups", () => {
    c.groups.forEach((h: any, gi: number) => quantilesFromHistogram(h, [0.5, 0.25, 0.75])
      .forEach((q, qi) => within(q!, c.quantiles[gi][qi], 5e-4 + 1e-9, "group " + gi + " quantile " + qi)));
    if (c.mannWhitney) {
      const r = mannWhitneyU(c.groups[0], c.groups[1]);
      assert.equal(r.u, c.mannWhitney.u); closeRel(r.p, c.mannWhitney.p, "Mann-Whitney p");
    }
    const k = kruskalWallis(c.groups);
    within(k.h, c.kruskal.h, 5e-5, "H"); assert.equal(k.df, c.kruskal.df); closeRel(k.p, c.kruskal.p, "Kruskal-Wallis p");
  }));
});

describe("pearsonFromMoments matches scipy pearsonr", () => {
  golden.pearson.forEach((c: any, i: number) => test("case " + (i + 1) + ": n " + c.moments.n, () => {
    const r = pearsonFromMoments(c.moments);
    within(r.r!, c.r, 5e-5, "r"); closeRel(r.p, c.p, "p");
  }));
});

describe("fisherZMeta matches statsmodels combine_effects (fixed effect)", () => {
  golden.meta.forEach((c: any, i: number) => test("case " + (i + 1) + ": " + c.parts.length + " sites", () => {
    const r = fisherZMeta(c.parts);
    within(r.z, c.z, 5e-5, "z"); within(r.se, c.se, 5e-6, "se"); within(r.r!, c.r, 5e-5, "pooled r"); closeRel(r.p, c.p, "p");
  }));
});

test("the moment tests' verification claim names the library versions this fixture was made with", () => {
  assert.equal(VERIFIED.welch.version, golden.libraries.scipy);
  assert.equal(VERIFIED.anova.version, golden.libraries.statsmodels);
});
