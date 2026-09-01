// Small, dependency-free stats for comparison views.
import type { KmCurve, KmPoint, LogRank } from "./types.ts";

// log(n!) via Lanczos-free cumulative sum with memo
const LF: number[] = [0, 0];
function logFact(n: number): number {
  for (let i = LF.length; i <= n; i++) LF[i] = LF[i - 1] + Math.log(i);
  return LF[n];
}

// Fisher's exact test (two-sided) for a 2x2 table [[a,b],[c,d]]
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const logHyper = (a: number, b: number, c: number, d: number): number =>
    logFact(a + b) + logFact(c + d) + logFact(a + c) + logFact(b + d) -
    logFact(a) - logFact(b) - logFact(c) - logFact(d) - logFact(a + b + c + d);
  const pObs = logHyper(a, b, c, d);
  const rowA = a + b, rowC = c + d, colA = a + c;
  let p = 0;
  const lo = Math.max(0, colA - rowC), hi = Math.min(colA, rowA);
  for (let x = lo; x <= hi; x++) {
    const y = rowA - x, z = colA - x, w = rowC - z;
    const lp = logHyper(x, y, z, w);
    if (lp <= pObs + 1e-9) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

// Kaplan-Meier product-limit estimator.
// data: [{t: months, event: 0|1}] -> { points: [{t, s}], median, n, events }
export function kaplanMeier(data: { t: number; event: number }[]): Omit<KmCurve, "cohort"> {
  const clean = data.filter(d => Number.isFinite(d.t) && d.t >= 0).sort((x, y) => x.t - y.t);
  const n0 = clean.length;
  let atRisk = n0, s = 1;
  let median: number | null = null;
  const points: KmPoint[] = [{ t: 0, s: 1 }];
  let events = 0;
  let i = 0;
  while (i < clean.length) {
    const t = clean[i].t;
    let d = 0, c = 0;
    while (i < clean.length && clean[i].t === t) { clean[i].event ? d++ : c++; i++; }
    if (d > 0 && atRisk > 0) {
      s *= 1 - d / atRisk;
      points.push({ t, s: Math.round(s * 10000) / 10000 });
      if (median === null && s <= 0.5) median = t;
      events += d;
    }
    atRisk -= d + c;
  }
  return { points, median, n: n0, events };
}

// ---------------------------------------------------------------------------
// Log-rank test.
//
// The federation-relevant property: the test statistic is a SUM over event
// times of quantities computed from at-risk and event counts. Nothing about it
// needs an individual's identity, and — more usefully — the per-stratum
// contributions are additive, so each site can be its own stratum. That gives
// the stratified log-rank, which is the right test for multi-site data anyway:
// pooling risk sets across sites assumes a common baseline hazard, and when
// site composition differs the pooled statistic can point the wrong way
// (Simpson's paradox). Stratifying asks the question site by site and combines
// the answers, which is what a federated analysis should do by default.
// ---------------------------------------------------------------------------

/** Complementary error function (Numerical Recipes erfcc; |err| < 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x), t = 2 / (2 + z), ty = 4 * t - 2;
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
    -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
    4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
    1.30365583558e-6, 1.5626441722e-8, -8.5238095915e-8,
    6.529054439e-9, 5.059343495e-9, -9.91364156e-10,
    -2.27365122e-10, 9.6467911e-11, 2.394038e-12,
    -6.886027e-12, 8.94487e-13, 3.13092e-13,
    -1.12708e-13, 3.81e-16, 7.106e-15
  ];
  let d = 0, dd = 0;
  for (let j = cof.length - 1; j > 0; j--) { const tmp = d; d = ty * d - dd + cof[j]; dd = tmp; }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

/** Upper tail of the chi-squared distribution with 1 degree of freedom. */
export function chiSquareP1df(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1;
  return Math.min(1, erfc(Math.sqrt(x / 2)));
}

export interface SurvPoint { t: number; event: number }

/** One stratum's contribution: observed and expected events in group A, and the variance. */
function stratumTerms(a: SurvPoint[], b: SurvPoint[]): { o1: number; e1: number; v: number; o2: number } {
  const ok = (d: SurvPoint) => Number.isFinite(d.t) && d.t >= 0;
  const A = a.filter(ok).slice().sort((x, y) => x.t - y.t);
  const B = b.filter(ok).slice().sort((x, y) => x.t - y.t);
  let i = 0, j = 0, n1 = A.length, n2 = B.length;
  let o1 = 0, e1 = 0, v = 0, o2 = 0;
  while (i < A.length || j < B.length) {
    const t = Math.min(i < A.length ? A[i].t : Infinity, j < B.length ? B[j].t : Infinity);
    let d1 = 0, c1 = 0, d2 = 0, c2 = 0;
    while (i < A.length && A[i].t === t) { A[i].event ? d1++ : c1++; i++; }
    while (j < B.length && B[j].t === t) { B[j].event ? d2++ : c2++; j++; }
    const d = d1 + d2, n = n1 + n2;
    if (d > 0 && n > 1) {
      o1 += d1; o2 += d2;
      e1 += (d * n1) / n;
      // hypergeometric variance; zero when every at-risk subject fails at t
      v += (d * n1 * n2 * (n - d)) / (n * n * (n - 1));
    }
    n1 -= d1 + c1; n2 -= d2 + c2;
  }
  return { o1, e1, v, o2 };
}

/**
 * Two-group log-rank. Pass one stratum for the pooled test, or one stratum per
 * site for the stratified test — the arithmetic is the same either way, which
 * is exactly why a federated caller can compute it from per-site aggregates.
 */
export function logRank(strata: { a: SurvPoint[]; b: SurvPoint[] }[]): LogRank {
  let O1 = 0, E1 = 0, V = 0, O2 = 0, used = 0;
  for (const s of strata) {
    const { o1, e1, v, o2 } = stratumTerms(s.a, s.b);
    if (o1 + o2 === 0) continue;                 // a stratum with no events says nothing
    O1 += o1; E1 += e1; V += v; O2 += o2; used++;
  }
  const chi2 = V > 0 ? ((O1 - E1) * (O1 - E1)) / V : 0;
  return {
    chi2: Math.round(chi2 * 1e4) / 1e4,
    p: chiSquareP1df(chi2),
    df: 1,
    observed: [O1, O2],
    expected: [Math.round(E1 * 10) / 10, Math.round((O1 + O2 - E1) * 10) / 10],
    variance: Math.round(V * 1e4) / 1e4,
    strata: used
  };
}
