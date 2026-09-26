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
  chiSquareP, studentTP, chiSquareTest, welchT, varianceFromMoments,
  pearsonFromMoments, fisherZMeta, normalP, applyCutoff, toIncidence, survivalAxis,
  coxRegression, coxPartialLogLik, mannWhitneyU, quantilesFromHistogram,
  type CoxRow, type Histogram } from "../lib/stats.ts";

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

describe("applyCutoff (administrative censoring at a fixed month)", () => {
  test("events beyond the cutoff become censoring at the cutoff, not deletion", () => {
    const cut = applyCutoff(SIXMP, 20);
    assert.equal(cut.length, SIXMP.length, "truncation must not drop rows");
    assert.ok(cut.every((r) => r.t <= 20), "no record should exit after the cutoff");
    const km = kaplanMeier(cut);
    assert.equal(km.events, 7, "only the 7 events at or before 20mo (6,6,6,7,10,13,16) should count");
    assert.equal(km.n, 21, "rows are censored, not removed, so n is unchanged");
  });
  test("the risk set and curve level before the cutoff are unaffected", () => {
    const uncut = kaplanMeier(SIXMP).points;
    const cut = kaplanMeier(applyCutoff(SIXMP, 20)).points;
    const levelAt16 = uncut.find((p) => p.t === 16)!.s;
    assert.equal(cut.find((p) => p.t === 16)!.s, levelAt16, "cutoff must not change the level reached before it");
    assert.ok(cut.every((p) => p.t <= 20), "no plotted point should fall past the cutoff");
  });
});

describe("toIncidence (cumulative incidence, the complement of a KM curve)", () => {
  test("every point is 1 - survival, and 'median' keeps the same crossing month", () => {
    const km = kaplanMeier(SIXMP);
    const ci = toIncidence(km);
    for (let i = 0; i < km.points.length; i++) {
      assert.equal(ci.points[i].t, km.points[i].t);
      assert.ok(Math.abs(ci.points[i].s - (1 - km.points[i].s)) < 1e-9);
    }
    assert.equal(ci.median, km.median, "S(t) <= 0.5 and 1-S(t) >= 0.5 cross at the same t");
  });
});

describe("survivalAxis (shared x-axis domain for both KM renderers)", () => {
  test("defaults to the latest EVENT time and the existing 12/24mo tick rule", () => {
    // kaplanMeier only emits a point where an event actually occurred (SIXMP's last two
    // rows are pure censoring at 34 and 35mo), so the domain — like the pre-existing
    // renderer code this replaces — runs to the last event, not the last censoring.
    const a = survivalAxis([kaplanMeier(SIXMP)]);
    assert.equal(a.tMax, 23, "SIXMP's latest event time");
    assert.equal(a.step, 12, "23mo is under the 60mo threshold, so ticks stay at 12");
  });
  test("an explicit cutoff or tick spacing overrides both defaults", () => {
    const a = survivalAxis([kaplanMeier(SIXMP)], { cutoffMonths: 20, tickMonths: 6 });
    assert.equal(a.tMax, 20);
    assert.equal(a.step, 6);
  });
});

describe("coxRegression (multivariate Cox, Efron partial likelihood)", () => {
  test("matches a hand-derived MLE on a tiny no-ties, no-censoring dataset", () => {
    // 4 subjects, distinct event times, covariate x alternating 1/0: the partial likelihood
    // is short enough to write out and differentiate by hand —
    //   log PL(b) = 2b - log(2e^b+2) - log(e^b+2) - log(e^b+1)
    //   d/db      = 2 - 2e^b/(e^b+1) - e^b/(e^b+2)
    // solved here by bisection on that closed form, entirely independent of lib/stats.ts, as
    // the reference coxRegression's Newton-Raphson answer must agree with.
    const rows: CoxRow[] = [
      { t: 1, event: 1, x: [1] }, { t: 2, event: 1, x: [0] },
      { t: 3, event: 1, x: [1] }, { t: 4, event: 1, x: [0] },
    ];
    const dLogLik = (b: number) => { const e = Math.exp(b); return 2 - 2 * e / (e + 1) - e / (e + 2); };
    let lo = 0, hi = 2;
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (dLogLik(mid) > 0) lo = mid; else hi = mid; }
    const reference = (lo + hi) / 2;
    const fit = coxRegression(rows);
    assert.ok(Math.abs(fit.beta[0] - reference) < 1e-6,
      "beta should match the hand-derived root: " + fit.beta[0] + " vs " + reference);
    assert.ok(fit.hr[0] > 1, "x=1 fails earlier here, so its hazard ratio should exceed 1");
  });

  test("the fitted beta is a local maximum of its own partial likelihood", () => {
    // A generic property any correct optimizer must satisfy, checked without assuming
    // anything about the specific numbers: nudging the fit in either direction along any
    // coordinate should never increase the likelihood it was fit to maximize.
    const rows: CoxRow[] = [
      { t: 4, event: 1, x: [1, 0] }, { t: 4, event: 1, x: [0, 1] }, { t: 6, event: 0, x: [1, 1] },
      { t: 7, event: 1, x: [0, 0] }, { t: 9, event: 1, x: [1, 0] }, { t: 9, event: 0, x: [0, 1] },
      { t: 12, event: 1, x: [1, 1] }, { t: 15, event: 1, x: [0, 0] },
    ];
    const fit = coxRegression(rows);
    const atFit = coxPartialLogLik(rows, fit.beta);
    const eps = 1e-4;
    for (let a = 0; a < fit.beta.length; a++) {
      for (const d of [-eps, eps]) {
        const perturbed = fit.beta.slice(); perturbed[a] += d;
        assert.ok(coxPartialLogLik(rows, perturbed) <= atFit + 1e-9,
          "perturbing coordinate " + a + " by " + d + " must not increase the likelihood");
      }
    }
  });

  test("stratifying by a constant label changes nothing (one stratum = unstratified)", () => {
    const rows: CoxRow[] = [
      { t: 4, event: 1, x: [1] }, { t: 6, event: 1, x: [0] },
      { t: 9, event: 0, x: [1] }, { t: 12, event: 1, x: [0] },
    ];
    const plain = coxRegression(rows);
    const stratified = coxRegression(rows.map((r) => ({ ...r, stratum: "only" })));
    assert.ok(Math.abs(plain.beta[0] - stratified.beta[0]) < 1e-9);
  });

  test("a genuinely stratified fit only compares within each stratum", () => {
    // Two strata with opposite baseline risk but the SAME within-stratum covariate effect;
    // pooling them unstratified would blend two different baselines, stratifying should not.
    const siteA: CoxRow[] = [
      { t: 1, event: 1, x: [1], stratum: "A" }, { t: 2, event: 1, x: [0], stratum: "A" },
      { t: 3, event: 1, x: [1], stratum: "A" }, { t: 4, event: 1, x: [0], stratum: "A" },
    ];
    const siteB: CoxRow[] = siteA.map((r) => ({ ...r, t: r.t + 100, stratum: "B" }));
    const stratified = coxRegression([...siteA, ...siteB]);
    const singleSite = coxRegression(siteA);
    assert.ok(Math.abs(stratified.beta[0] - singleSite.beta[0]) < 1e-6,
      "two copies of the same within-stratum pattern should fit the same effect as one copy alone");
  });

  test("a collinear covariate is refused rather than fit into nonsense", () => {
    const rows: CoxRow[] = [
      { t: 1, event: 1, x: [1, 1] }, { t: 2, event: 1, x: [0, 0] },
      { t: 3, event: 1, x: [1, 1] }, { t: 4, event: 1, x: [0, 0] },
    ];
    assert.throws(() => coxRegression(rows), /collinear|not identifiable/);
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

describe("Pearson correlation from moments", () => {
  // x = 1..5, y = [2,4,5,4,5]; by hand r = 6/sqrt(10*6) = 0.7746
  const X = [1, 2, 3, 4, 5], Y = [2, 4, 5, 4, 5];
  const M = {
    n: X.length,
    sx: X.reduce((a, b) => a + b, 0), sy: Y.reduce((a, b) => a + b, 0),
    sxy: X.reduce((a, b, i) => a + b * Y[i], 0),
    sxx: X.reduce((a, b) => a + b * b, 0), syy: Y.reduce((a, b) => a + b * b, 0)
  };

  test("matches the hand-computed value", () => {
    assert.deepEqual([M.n, M.sx, M.sy, M.sxy, M.sxx, M.syy], [5, 15, 20, 66, 55, 86]);
    const r = pearsonFromMoments(M);
    assert.ok(Math.abs(r.r! - 0.7746) < 5e-4, "r should be 0.7746, got " + r.r);
    assert.equal(r.df, 3);
  });

  test("moments split across two sites give the identical r", () => {
    const half = (xs: number[], ys: number[]) => ({
      n: xs.length,
      sx: xs.reduce((a, b) => a + b, 0), sy: ys.reduce((a, b) => a + b, 0),
      sxy: xs.reduce((a, b, i) => a + b * ys[i], 0),
      sxx: xs.reduce((a, b) => a + b * b, 0), syy: ys.reduce((a, b) => a + b * b, 0)
    });
    const a = half(X.slice(0, 2), Y.slice(0, 2)), b = half(X.slice(2), Y.slice(2));
    const merged = { n: a.n + b.n, sx: a.sx + b.sx, sy: a.sy + b.sy,
      sxy: a.sxy + b.sxy, sxx: a.sxx + b.sxx, syy: a.syy + b.syy };
    assert.equal(pearsonFromMoments(merged).r, pearsonFromMoments(M).r,
      "a federated correlation is EXACT, not an approximation");
  });

  test("perfect correlation, and constants", () => {
    assert.equal(pearsonFromMoments({ n: 4, sx: 10, sy: 20, sxy: 60, sxx: 30, syy: 120 }).r, 1);
    // y constant -> undefined, refused rather than reported as 0
    assert.equal(pearsonFromMoments({ n: 4, sx: 10, sy: 8, sxy: 20, sxx: 30, syy: 16 }).r, null);
    assert.equal(pearsonFromMoments({ n: 2, sx: 3, sy: 3, sxy: 5, sxx: 5, syy: 5 }).r, null);
  });
});

describe("normal tail and Fisher-z meta-analysis", () => {
  test("normal critical values", () => {
    assert.ok(Math.abs(normalP(1.96) - 0.05) < 1e-3);
    assert.ok(Math.abs(normalP(2.576) - 0.01) < 1e-3);
    assert.equal(normalP(0), 1);
  });
  test("identical sites reproduce their own correlation", () => {
    const m = fisherZMeta([{ r: 0.5, n: 100 }, { r: 0.5, n: 100 }]);
    assert.ok(Math.abs(m.r! - 0.5) < 1e-3, "got " + m.r);
    assert.equal(m.sites, 2);
    // two sites of n=100 are more evidence than one: se shrinks by ~sqrt(2)
    const one = fisherZMeta([{ r: 0.5, n: 100 }]);
    assert.ok(m.se < one.se && Math.abs(one.se / m.se - Math.SQRT2) < 0.02);
  });
  test("weights by site size, and skips sites that cannot contribute", () => {
    const m = fisherZMeta([{ r: 0.9, n: 1000 }, { r: 0.1, n: 10 }]);
    assert.ok(m.r! > 0.85, "the large site dominates, got " + m.r);
    assert.equal(fisherZMeta([{ r: null, n: 50 }, { r: 1, n: 50 }, { r: 0.3, n: 3 }]).sites, 0);
  });
});

describe("left truncation (delayed entry)", () => {
  // Immortal time, constructed so the two answers are far apart and hand-checkable.
  // Group A is observed from time 0 and dies at 1..5. Group B only becomes
  // observable at time 10 and dies at 11..15 — B could not have been seen dying
  // before 10, because surviving to 10 is what put them in the data.
  const A = [1, 2, 3, 4, 5].map((t) => ({ t, event: 1, entry: 0 }));
  const B = [11, 12, 13, 14, 15].map((t) => ({ t, event: 1, entry: 10 }));

  test("ignoring entry overstates early survival", () => {
    // all ten treated as observed from 0: 1 death out of 10, then 9, then 8...
    const naive = kaplanMeier([...A, ...B].map(({ t, event }) => ({ t, event })));
    const at5 = naive.points.filter((p) => p.t <= 5).pop()!;
    assert.equal(at5.s, 0.5, "naive S(5) = 0.9*0.888*0.875*0.857*0.833 = 0.5");
  });

  test("honouring entry gives the correct, much lower curve", () => {
    const truncated = kaplanMeier([...A, ...B]);
    const at5 = truncated.points.filter((p) => p.t <= 5).pop()!;
    // before t=10 only A is at risk: 1/5, then 1/4, 1/3, 1/2, 1/1 -> everyone gone
    assert.equal(at5.s, 0, "with delayed entry the survivors at 5 are only A, and all of A has died");
  });

  test("an absent entry means the same as entering before time zero", () => {
    const withZero = kaplanMeier(A.map((r) => ({ ...r, entry: -Infinity })));
    const without = kaplanMeier(A.map(({ t, event }) => ({ t, event })));
    assert.deepEqual(withZero.points, without.points);
    assert.equal(withZero.median, without.median);
  });

  test("the log-rank risk sets honour entry too", () => {
    // A vs B compared naively looks like a colossal difference (they never overlap
    // in time); with delayed entry there is no period in which both are at risk,
    // so there is nothing to compare and the test must not claim significance.
    const naive = logRank([{ a: A.map(({ t, event }) => ({ t, event })), b: B.map(({ t, event }) => ({ t, event })) }]);
    const honest = logRank([{ a: A, b: B }]);
    assert.ok(naive.p < 0.01, "ignoring entry claims significance: chi2=" + naive.chi2 + " p=" + naive.p);
    // The two groups are never simultaneously at risk, so there is no comparison
    // to make. The variance of the statistic is zero and the honest answer is
    // "these data say nothing", not "these groups differ".
    assert.equal(honest.chi2, 0);
    assert.equal(honest.p, 1);
    assert.equal(honest.variance, 0, "no overlapping risk set means no information");
  });

  test("truncation never invents survivors: n and events are unchanged", () => {
    const t = kaplanMeier([...A, ...B]);
    assert.equal(t.n, 10);
    assert.equal(t.events, 10);
  });
});

describe("quantilesFromHistogram", () => {
  const h = (vs: number[]): Histogram[] => vs.map((v) => ({ v, n: 1 }));

  test("odd N: the middle order statistic, no interpolation needed", () => {
    assert.deepEqual(quantilesFromHistogram(h([1, 2, 3, 4, 5]), [0.25, 0.5, 0.75]), [2, 3, 4]);
  });

  test("even N: the median interpolates between the two middle values", () => {
    assert.deepEqual(quantilesFromHistogram(h([1, 2, 3, 4]), [0.5]), [2.5]);
  });

  test("a repeated value (count > 1) is weighted correctly, without expanding it", () => {
    // {1,1,1,2,3} written as a histogram: median is the 3rd of 5 order statistics = 1
    assert.deepEqual(quantilesFromHistogram([{ v: 1, n: 3 }, { v: 2, n: 1 }, { v: 3, n: 1 }], [0.5]), [1]);
  });

  test("an empty histogram reports null rather than NaN", () => {
    assert.deepEqual(quantilesFromHistogram([], [0.5]), [null]);
  });
});

describe("mannWhitneyU: Wilcoxon rank-sum from complete histograms", () => {
  test("two completely separated groups, no ties — hand-verified against the U statistic and z formula", () => {
    // A={1,2,3}, B={4,5,6}: ranks 1..6, R1=1+2+3=6, U1=R1-n1(n1+1)/2=6-6=0, meanU=4.5,
    // varU (no ties) = n1*n2/12*(N+1) = 9/12*7 = 5.25, z (continuity-corrected) = (0-4.5+0.5)/sqrt(5.25)
    const r = mannWhitneyU([{ v: 1, n: 1 }, { v: 2, n: 1 }, { v: 3, n: 1 }], [{ v: 4, n: 1 }, { v: 5, n: 1 }, { v: 6, n: 1 }]);
    assert.equal(r.u, 0);
    assert.ok(Math.abs(r.z - -1.7457) < 1e-3, "z=" + r.z);
    assert.ok(Math.abs(r.p - 0.08086) < 1e-4, "p=" + r.p);
  });

  test("two identical distributions: U sits exactly at its null mean, z=0, p=1", () => {
    const same = [{ v: 1, n: 1 }, { v: 2, n: 1 }, { v: 3, n: 1 }, { v: 4, n: 1 }, { v: 5, n: 1 }];
    const r = mannWhitneyU(same, same);
    assert.equal(r.u, 12.5); // = n1*n2/2 = meanU exactly
    assert.equal(r.z, 0);
    assert.equal(r.p, 1);
  });

  test("tied values: the tie-corrected variance, hand-verified", () => {
    // A: {1,1,2,3,3} (n1=5), B: {2,3,4,4} (n2=4) — hand-derived R1=18.5, U1=3.5, tieSum=42
    const A: Histogram[] = [{ v: 1, n: 2 }, { v: 2, n: 1 }, { v: 3, n: 2 }];
    const B: Histogram[] = [{ v: 2, n: 1 }, { v: 3, n: 1 }, { v: 4, n: 2 }];
    const r = mannWhitneyU(A, B);
    assert.equal(r.u, 3.5);
    assert.ok(Math.abs(r.z - -1.5145) < 1e-3, "z=" + r.z);
  });

  test("an empty group refuses rather than dividing by zero", () => {
    const r = mannWhitneyU([], [{ v: 1, n: 1 }]);
    assert.equal(r.p, 1);
    assert.equal(r.n1, 0);
  });
});
