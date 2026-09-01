// Statistics used by federated views, checked against published values.
//
// These are the functions that turn per-site aggregates into an inference, so
// "it runs" is not enough — a wrong log-rank is a wrong scientific claim that
// looks exactly like a right one. Each test below pins a number that can be
// looked up rather than one produced by this code.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { logRank, chiSquareP1df, fisherExact, kaplanMeier } from "../lib/stats.ts";

/** Freireich et al. (1963), 6-MP vs placebo in acute leukaemia. `+` = censored. */
const SIXMP = [
  [6, 0], [6, 1], [6, 1], [6, 1], [7, 1], [9, 0], [10, 0], [10, 1], [11, 0], [13, 1],
  [16, 1], [17, 0], [19, 0], [20, 0], [22, 1], [23, 1], [25, 0], [32, 0], [32, 0], [34, 0], [35, 0]
].map(([t, event]) => ({ t, event }));
const PLACEBO = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23]
  .map((t) => ({ t, event: 1 }));

describe("chi-squared upper tail (1 df)", () => {
  test("critical values match the table", () => {
    assert.ok(Math.abs(chiSquareP1df(3.841) - 0.05) < 5e-4, "chi2=3.841 -> p=0.05");
    assert.ok(Math.abs(chiSquareP1df(6.635) - 0.01) < 5e-4, "chi2=6.635 -> p=0.01");
    assert.ok(Math.abs(chiSquareP1df(10.828) - 0.001) < 5e-4, "chi2=10.828 -> p=0.001");
  });
  test("degenerate input is not significant", () => {
    assert.equal(chiSquareP1df(0), 1);
    assert.equal(chiSquareP1df(NaN), 1);
  });
});

describe("log-rank", () => {
  test("Freireich 6-MP vs placebo: chi2 = 16.79, p = 4.2e-5", () => {
    const r = logRank([{ a: SIXMP, b: PLACEBO }]);
    assert.equal(r.observed[0], 9, "9 events on 6-MP");
    assert.equal(r.observed[1], 21, "21 events on placebo");
    assert.ok(Math.abs(r.expected[0] - 19.3) < 0.15, "expected ~19.25 on 6-MP, got " + r.expected[0]);
    assert.ok(Math.abs(r.chi2 - 16.79) < 0.02, "chi2 should be 16.79, got " + r.chi2);
    assert.ok(r.p > 3e-5 && r.p < 5.5e-5, "p should be ~4.2e-5, got " + r.p);
    assert.equal(r.strata, 1);
  });

  test("KM medians on the same data match the published 8 vs 23 weeks", () => {
    assert.equal(kaplanMeier(PLACEBO).median, 8);
    assert.equal(kaplanMeier(SIXMP).median, 23);
  });

  // The property that makes site-stratification worth doing.
  test("stratifying refuses to read a site difference as a group difference", () => {
    // Group A exists only at site 1, group B only at site 2, and the sites have
    // wildly different survival. Pooled, that looks like an enormous group
    // effect; stratified, neither site contains a comparison, so the honest
    // answer is that the data say nothing.
    const early = Array.from({ length: 40 }, (_, i) => ({ t: 1 + (i % 5), event: 1 }));
    const late = Array.from({ length: 40 }, (_, i) => ({ t: 60 + (i % 5), event: 1 }));
    const pooled = logRank([{ a: early, b: late }]);
    const stratified = logRank([{ a: early, b: [] }, { a: [], b: late }]);
    assert.ok(pooled.chi2 > 50, "pooled sees a huge effect: " + pooled.chi2);
    assert.equal(stratified.chi2, 0, "stratified has no within-site comparison to make");
    assert.equal(stratified.p, 1);
  });

  test("strata contributions are additive: one stratum twice = twice the evidence", () => {
    const one = logRank([{ a: SIXMP, b: PLACEBO }]);
    const two = logRank([{ a: SIXMP, b: PLACEBO }, { a: SIXMP, b: PLACEBO }]);
    assert.equal(two.strata, 2);
    assert.equal(two.observed[0], 2 * one.observed[0]);
    // O-E and V both double, so chi2 = (2(O-E))^2 / 2V = 2 * chi2
    assert.ok(Math.abs(two.chi2 - 2 * one.chi2) < 0.02,
      "doubling the strata should double chi2: " + two.chi2 + " vs " + 2 * one.chi2);
  });

  test("no events anywhere is not significant", () => {
    const censored = [{ t: 5, event: 0 }, { t: 9, event: 0 }];
    const r = logRank([{ a: censored, b: censored }]);
    assert.equal(r.chi2, 0);
    assert.equal(r.p, 1);
    assert.equal(r.strata, 0, "a stratum with no events must not count as informative");
  });
});

describe("Fisher's exact (already in use by the compare view)", () => {
  test("Fisher's tea-taster 4x4 split gives p = 0.4857", () => {
    assert.ok(Math.abs(fisherExact(3, 1, 1, 3) - 0.4857) < 5e-4);
  });
  test("a perfect 2x2 separation is significant", () => {
    assert.ok(fisherExact(10, 0, 0, 10) < 1e-4);
  });
});
