// Statistics used by federated views, checked against published values.
//
// These are the functions that turn per-site aggregates into an inference, so
// "it runs" is not enough — a wrong log-rank is a wrong scientific claim that
// looks exactly like a right one. Each test below pins a number that can be
// looked up rather than one produced by this code.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { logRank, chiSquareP1df, fisherExact, kaplanMeier,
  benjaminiHochberg, cochranMantelHaenszel, log2OddsRatio,
  chiSquareP, studentTP, chiSquareTest, welchT, varianceFromMoments } from "../lib/stats.ts";

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

describe("Benjamini-Hochberg adjustment", () => {
  test("hand-computable cases", () => {
    // m=3: each raw q is p*m/rank, then made monotone from the largest down
    assert.deepEqual(benjaminiHochberg([0.01, 0.02, 0.03]).map((q) => +q.toFixed(6)), [0.03, 0.03, 0.03]);
    assert.deepEqual(benjaminiHochberg([0.001, 0.5, 0.9]).map((q) => +q.toFixed(6)), [0.003, 0.75, 0.9]);
  });
  test("order is preserved and q >= p", () => {
    const ps = [0.9, 0.001, 0.04, 0.5];
    const qs = benjaminiHochberg(ps);
    assert.equal(qs.length, ps.length);
    ps.forEach((p, i) => assert.ok(qs[i] >= p - 1e-12, "q must not be smaller than p at " + i));
    assert.ok(qs[1] < qs[2] && qs[2] < qs[3], "ranking is preserved");
  });
  test("empty input", () => assert.deepEqual(benjaminiHochberg([]), []));
});

describe("Cochran-Mantel-Haenszel", () => {
  // Simpson's paradox, constructed so every stratum points one way and the
  // pooled table points the other. This is the case federation must get right:
  // sites ARE the strata, so pooling their 2x2 tables can invert the finding.
  const STRATUM_A = { a: 80, b: 20, c: 9, d: 1 };    // OR = (80*1)/(20*9) = 0.444
  const STRATUM_B = { a: 10, b: 90, c: 18, d: 72 };  // OR = (10*72)/(90*18) = 0.444

  test("recovers the within-stratum odds ratio, not the pooled one", () => {
    const r = cochranMantelHaenszel([STRATUM_A, STRATUM_B]);
    assert.equal(r.tables, 2);
    assert.ok(Math.abs(r.oddsRatio! - 0.4444) < 5e-4, "OR_MH should be 0.444, got " + r.oddsRatio);
    // pooled: a=90 b=110 c=27 d=73 -> OR = (90*73)/(110*27) = 2.212, the opposite direction
    const pooled = (90 * 73) / (110 * 27);
    assert.ok(pooled > 2.2 && pooled < 2.22, "the pooled table really does invert: " + pooled);
    assert.ok(r.oddsRatio! < 1 && pooled > 1, "CMH and pooling disagree in DIRECTION, not just degree");
  });

  test("single stratum reduces to the Mantel-Haenszel form of chi-squared", () => {
    const t = { a: 53, b: 414, c: 11, d: 37 };
    const n = t.a + t.b + t.c + t.d;
    const r1 = t.a + t.b, r2 = t.c + t.d, c1 = t.a + t.c, c2 = t.b + t.d;
    // closed form: (|ad-bc| - n/2)^2 (n-1) / (r1 r2 c1 c2)
    const expected = Math.pow(Math.abs(t.a * t.d - t.b * t.c) - n / 2, 2) * (n - 1) / (r1 * r2 * c1 * c2);
    const r = cochranMantelHaenszel([t]);
    assert.ok(Math.abs(r.chi2 - expected) < 1e-3, "chi2 " + r.chi2 + " vs closed form " + expected);
    assert.ok(Math.abs(r.oddsRatio! - (t.a * t.d) / (t.b * t.c)) < 1e-3, "one stratum -> plain odds ratio");
  });

  test("degenerate tables are skipped, not counted", () => {
    const r = cochranMantelHaenszel([{ a: 0, b: 0, c: 0, d: 0 }, { a: 5, b: 0, c: 3, d: 0 }]);
    assert.equal(r.tables, 0, "an empty margin carries no information");
    assert.equal(r.chi2, 0);
    assert.equal(r.p, 1);
  });
});

describe("log2 odds ratio", () => {
  test("plain case", () => {
    assert.equal(log2OddsRatio(10, 10, 10, 10), 0);
    assert.ok(Math.abs(log2OddsRatio(20, 10, 10, 20)! - 2) < 1e-6, "OR=4 -> log2=2");
  });
  test("an empty cell is Haldane-corrected rather than infinite", () => {
    const v = log2OddsRatio(10, 0, 0, 10);
    assert.ok(v !== null && Number.isFinite(v) && v > 0, "should be large but finite, got " + v);
  });
});

describe("chi-squared, arbitrary degrees of freedom", () => {
  test("the 0.05 critical values across df match the table", () => {
    const critical: [number, number][] = [[3.841, 1], [5.991, 2], [7.815, 3], [9.488, 4], [11.070, 5], [18.307, 10]];
    for (const [x, df] of critical)
      assert.ok(Math.abs(chiSquareP(x, df) - 0.05) < 1e-3, "chi2=" + x + " df=" + df + " -> p=0.05, got " + chiSquareP(x, df));
  });
  test("the 0.01 critical values too", () => {
    for (const [x, df] of [[6.635, 1], [9.210, 2], [13.277, 4], [23.209, 10]] as [number, number][])
      assert.ok(Math.abs(chiSquareP(x, df) - 0.01) < 1e-3, "chi2=" + x + " df=" + df + ", got " + chiSquareP(x, df));
  });
  test("agrees with the dedicated 1-df routine", () => {
    for (const x of [0.5, 2, 3.841, 10, 25])
      assert.ok(Math.abs(chiSquareP(x, 1) - chiSquareP1df(x)) < 1e-9, "two routines disagree at " + x);
  });
});

describe("Student's t", () => {
  test("two-sided critical values match the table", () => {
    assert.ok(Math.abs(studentTP(2.228, 10) - 0.05) < 1e-3, "t=2.228 df=10 -> 0.05");
    assert.ok(Math.abs(studentTP(3.169, 10) - 0.01) < 1e-3, "t=3.169 df=10 -> 0.01");
    assert.ok(Math.abs(studentTP(2.086, 20) - 0.05) < 1e-3, "t=2.086 df=20 -> 0.05");
    assert.ok(Math.abs(studentTP(1.96, 1e7) - 0.05) < 1e-3, "large df approaches the normal");
  });
});

describe("chi-squared contingency test", () => {
  test("a 2x2 matches the closed form", () => {
    const t = [[20, 30], [30, 20]];
    const n = 100, chi2 = (n * Math.pow(20 * 20 - 30 * 30, 2)) / (50 * 50 * 50 * 50);
    const r = chiSquareTest(t);
    assert.equal(r.df, 1);
    assert.ok(Math.abs(r.chi2 - chi2) < 1e-3, r.chi2 + " vs " + chi2);
  });
  test("degrees of freedom for r x c, and empty rows/columns are dropped", () => {
    assert.equal(chiSquareTest([[10, 20, 30], [30, 20, 10]]).df, 2);      // (2-1)(3-1)
    assert.equal(chiSquareTest([[10, 20, 30], [30, 20, 10], [5, 5, 5]]).df, 4);
    // an all-zero column must not inflate df
    assert.equal(chiSquareTest([[10, 0, 30], [30, 0, 10]]).df, 1);
  });
  test("independence gives chi2 = 0 and p = 1", () => {
    const r = chiSquareTest([[25, 25], [25, 25]]);
    assert.equal(r.chi2, 0);
    assert.equal(r.p, 1);
    assert.equal(r.minExpected, 25);
  });
  test("degenerate tables are refused rather than guessed", () => {
    assert.equal(chiSquareTest([]).p, 1);
    assert.equal(chiSquareTest([[1, 2]]).p, 1);
    assert.equal(chiSquareTest([[0, 0], [0, 0]]).p, 1);
  });
});

describe("Welch's t-test from moments", () => {
  // Checked against the Welch-Satterthwaite definition written out here, rather
  // than against a remembered figure: t = (m1-m2)/sqrt(v1/n1 + v2/n2), and
  // df = (v1/n1 + v2/n2)^2 / ((v1/n1)^2/(n1-1) + (v2/n2)^2/(n2-1)).
  test("matches the Welch-Satterthwaite definition computed independently", () => {
    const [n1, m1, v1, n2, m2, v2] = [10, 42.14, 68.15, 10, 43.23, 41.79];
    const s1 = v1 / n1, s2 = v2 / n2;
    const expectedT = (m1 - m2) / Math.sqrt(s1 + s2);                       // -0.3287
    const expectedDf = (s1 + s2) ** 2 / (s1 ** 2 / (n1 - 1) + s2 ** 2 / (n2 - 1)); // 17.02
    const r = welchT(n1, m1, v1, n2, m2, v2);
    assert.ok(Math.abs(r.t - expectedT) < 1e-3, "t " + r.t + " vs " + expectedT.toFixed(4));
    assert.ok(Math.abs(r.df - expectedDf) < 0.02, "df " + r.df + " vs " + expectedDf.toFixed(2));
    assert.ok(r.p > 0.7 && r.p < 0.8, "clearly not significant, got p=" + r.p);
  });
  test("identical groups give t = 0", () => {
    const r = welchT(50, 10, 4, 50, 10, 4);
    assert.equal(r.t, 0);
    assert.equal(r.p, 1);
  });
  test("too few observations is refused, not extrapolated", () => {
    assert.equal(welchT(1, 5, 0, 30, 4, 2).p, 1);
  });

  test("variance recovered from additive moments equals the direct computation", () => {
    const xs = [4, 8, 15, 16, 23, 42, 7, 9];
    const n = xs.length, sum = xs.reduce((a, b) => a + b, 0);
    const sumsq = xs.reduce((a, b) => a + b * b, 0);
    const mean = sum / n;
    const direct = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
    assert.ok(Math.abs(varianceFromMoments(n, sum, sumsq) - direct) < 1e-9);
  });

  test("moments are additive across sites — the property federation relies on", () => {
    const a = [4, 8, 15, 16], b = [23, 42, 7, 9];
    const mom = (xs: number[]) => ({ n: xs.length, s: xs.reduce((p, c) => p + c, 0), q: xs.reduce((p, c) => p + c * c, 0) });
    const ma = mom(a), mb = mom(b), whole = mom([...a, ...b]);
    assert.equal(ma.n + mb.n, whole.n);
    assert.equal(ma.s + mb.s, whole.s);
    assert.equal(ma.q + mb.q, whole.q);
    // so the pooled variance is exact from per-site totals, never approximated
    assert.ok(Math.abs(varianceFromMoments(ma.n + mb.n, ma.s + mb.s, ma.q + mb.q)
      - varianceFromMoments(whole.n, whole.s, whole.q)) < 1e-9);
  });
});
