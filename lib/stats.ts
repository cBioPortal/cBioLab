// Small, dependency-free stats for comparison views.
import type { KmCurve, KmPoint, LogRank, LogRankK, Cmh } from "./types.ts";

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

/**
 * One subject's follow-up. `entry` is the time at which they became observable;
 * omit it (or pass -Infinity) when observation starts at time zero for everyone,
 * which is the ordinary untruncated case.
 *
 * LEFT TRUNCATION matters whenever the clock starts before the subject could be
 * observed — survival measured from diagnosis while patients only enter the
 * cohort at sequencing, say. Ignoring it manufactures immortal time: everyone
 * appears to survive from the anchor to their entry, because surviving that long
 * is what got them into the data at all.
 */
export interface SurvRecord { t: number; event: number; entry?: number }

/** Number at risk just before `t`: entered strictly before it, not yet left. */
function riskSweep(recs: SurvRecord[]) {
  const entries = recs.map(r => (r.entry == null ? -Infinity : r.entry)).sort((a, b) => a - b);
  const exits = recs.map(r => r.t).sort((a, b) => a - b);
  let ei = 0, xi = 0, entered = 0, exited = 0;
  // advance() is called with non-decreasing t, so the sweep is O(n log n) overall
  return (t: number) => {
    while (ei < entries.length && entries[ei] < t) { entered++; ei++; }
    while (xi < exits.length && exits[xi] < t) { exited++; xi++; }
    return entered - exited;
  };
}

// Kaplan-Meier product-limit estimator, with optional delayed entry.
// data: [{t: months, event: 0|1, entry?}] -> { points: [{t, s}], median, n, events }
export function kaplanMeier(data: SurvRecord[]): Omit<KmCurve, "cohort"> {
  const clean = data.filter(d => Number.isFinite(d.t) && d.t >= 0).sort((x, y) => x.t - y.t);
  const n0 = clean.length;
  const atRiskAt = riskSweep(clean);
  let s = 1;
  let median: number | null = null;
  const points: KmPoint[] = [{ t: 0, s: 1 }];
  let events = 0;
  let i = 0;
  while (i < clean.length) {
    const t = clean[i].t;
    let d = 0;
    while (i < clean.length && clean[i].t === t) { if (clean[i].event) d++; i++; }
    const atRisk = atRiskAt(t);
    if (d > 0 && atRisk > 0) {
      s *= 1 - d / atRisk;
      points.push({ t, s: Math.round(s * 10000) / 10000 });
      if (median === null && s <= 0.5) median = t;
      events += d;
    }
  }
  return { points, median, n: n0, events };
}

/**
 * Administrative censoring at a fixed month: anyone still under observation past `cutoff`
 * is treated as censored AT the cutoff rather than dropped. Dropping would bias the risk set
 * (their at-risk time up to the cutoff is real and must still count); this only removes what
 * happens after it.
 */
export function applyCutoff(data: SurvRecord[], cutoff: number): SurvRecord[] {
  return data.map(d => d.t > cutoff ? { t: cutoff, event: 0, entry: d.entry } : d);
}

/**
 * The complement of a KM curve: cumulative incidence, 1 - S(t) — "how much of the cohort has
 * had the event by t" instead of "how much hasn't". Same points, same censoring, just flipped;
 * an event's uptick reads as a rise instead of a drop, and "median" becomes the month by which
 * half the cohort's events have happened.
 */
export function toIncidence<T extends { points: KmPoint[] }>(curve: T): T {
  return { ...curve, points: curve.points.map(p => ({ t: p.t, s: Math.round((1 - p.s) * 10000) / 10000 })) };
}

/**
 * Shared x-axis domain for both KM renderers (SVG and canvas), so a cutoff or a tick-interval
 * choice can't visually drift between them. `tMax` is the cutoff when one is set, otherwise the
 * latest observed event/censoring time (floored at 12mo so a very short curve doesn't collapse
 * to a sliver); `step` is the requested tick spacing, otherwise the existing 12/24mo default.
 */
export function survivalAxis(curves: { points: { t: number }[] }[], opts?: { cutoffMonths?: number; tickMonths?: number }): { tMax: number; step: number } {
  const observed = Math.max(12, ...curves.flatMap(c => c.points.map(p => p.t)));
  const tMax = opts?.cutoffMonths || observed;
  const step = opts?.tickMonths || (tMax > 60 ? 24 : 12);
  return { tMax, step };
}

// ---------------------------------------------------------------------------
// Multivariate Cox proportional-hazards regression (Efron partial likelihood).
//
// Unlike KM/log-rank, this takes one row per SUBJECT rather than per-site
// counts — see cohort-lab's CLAUDE.md and the PR notes for why that's fine
// here: it never leaves the resolver that already holds those rows, and
// federating it across untrusted remote peers isn't a goal. Ties are handled
// with Efron's approximation (the modern default — R's coxph, lifelines),
// which is exact for distinct event times and only approximate, not wrong,
// when several subjects fail at once.
// ---------------------------------------------------------------------------

export interface CoxRow { t: number; event: number; x: number[]; stratum?: string }
export interface CoxFit {
  beta: number[]; se: number[]; hr: number[]; ciLow: number[]; ciHigh: number[]; p: number[];
  loglik: number; n: number; events: number; iterations: number;
}

/** The 97.5% standard-normal quantile, for 95% Wald intervals (scipy.stats.norm.ppf(0.975)). */
export const Z_975 = 1.959963984540054;

function zeros(n: number): number[] { return new Array(n).fill(0); }
function zerosMat(n: number): number[][] { return Array.from({ length: n }, () => zeros(n)); }
function dot(a: number[], b: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

/** Solve H·delta = U by Gauss-Jordan elimination with partial pivoting; H is modified in place. */
function solveLinear(H: number[][], U: number[]): number[] {
  const n = U.length;
  const A = H.map((row, i) => [...row, U[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) throw new Error("this model is not identifiable: covariates are collinear or a category has no variation");
    [A[col], A[piv]] = [A[piv], A[col]];
    const pv = A[col][col];
    for (let c = col; c <= n; c++) A[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row[n]);
}

/** Diagonal of H^-1, i.e. the Wald variances, without forming the full inverse. */
function inverseDiagonal(H: number[][]): number[] {
  const n = H.length, out = zeros(n);
  for (let i = 0; i < n; i++) {
    const e = zeros(n); e[i] = 1;
    out[i] = solveLinear(H.map((r) => [...r]), e)[i];
  }
  return out;
}

/**
 * Log partial likelihood, gradient and observed-information Hessian at `beta`, Efron-tied,
 * summed over strata (each stratum's risk set is its own — the same additive-over-strata shape
 * the stratified log-rank already relies on). Rows need not be pre-sorted.
 */
function coxScore(rows: CoxRow[], beta: number[]): { ll: number; grad: number[]; hess: number[][] } {
  const p = beta.length;
  let ll = 0;
  const grad = zeros(p), hess = zerosMat(p);
  const strata = new Map<string, CoxRow[]>();
  for (const r of rows) {
    const s = r.stratum ?? "";
    if (!strata.has(s)) strata.set(s, []);
    strata.get(s)!.push(r);
  }
  for (const srows of strata.values()) {
    const sorted = srows.slice().sort((a, b) => a.t - b.t);
    // Walk from the latest time to the earliest, accumulating a running risk-set sum — the
    // risk set for time t is everyone with t' >= t, which is exactly what's been folded in
    // by the time the sweep reaches t, since the sweep goes from large t to small t.
    let cumExp = 0; const cumX = zeros(p), cumXX = zerosMat(p);
    let i = sorted.length - 1;
    while (i >= 0) {
      const t = sorted[i].t;
      let j = i;
      while (j >= 0 && sorted[j].t === t) j--;
      // members of this tie group are indices (j, i]
      let tieExp = 0, dCount = 0;
      const tieX = zeros(p), tieXX = zerosMat(p), eventX = zeros(p);
      for (let k = j + 1; k <= i; k++) {
        const row = sorted[k], eb = Math.exp(dot(beta, row.x));
        cumExp += eb;
        for (let a = 0; a < p; a++) cumX[a] += eb * row.x[a];
        for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) cumXX[a][b] += eb * row.x[a] * row.x[b];
        if (row.event) {
          dCount++; tieExp += eb;
          for (let a = 0; a < p; a++) { tieX[a] += eb * row.x[a]; eventX[a] += row.x[a]; }
          for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) tieXX[a][b] += eb * row.x[a] * row.x[b];
        }
      }
      if (dCount > 0) {
        ll += dot(beta, eventX);
        for (let a = 0; a < p; a++) grad[a] += eventX[a];
        for (let l = 0; l < dCount; l++) {
          const frac = l / dCount;
          const denom = cumExp - frac * tieExp;
          const numer = cumX.map((v, a) => v - frac * tieX[a]);
          ll -= Math.log(denom);
          for (let a = 0; a < p; a++) grad[a] -= numer[a] / denom;
          for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
            const xxTerm = (cumXX[a][b] - frac * tieXX[a][b]) / denom;
            hess[a][b] += xxTerm - (numer[a] / denom) * (numer[b] / denom);
          }
        }
      }
      i = j;
    }
  }
  return { ll, grad, hess };
}

/** The Efron partial log-likelihood at a given beta — exposed for diagnostics and tests. */
export function coxPartialLogLik(rows: CoxRow[], beta: number[]): number { return coxScore(rows, beta).ll; }

/**
 * Fit a (possibly stratified) multivariate Cox model by Newton-Raphson on the Efron partial
 * likelihood. Every `x` must be the same length (dummy-code categoricals before calling this —
 * this function only ever sees numbers, so it doesn't need to know which covariate was which).
 */
export function coxRegression(rows: CoxRow[]): CoxFit {
  const p = rows[0]?.x.length ?? 0;
  const events = rows.reduce((n, r) => n + (r.event ? 1 : 0), 0);
  if (!rows.length || p === 0) return { beta: [], se: [], hr: [], ciLow: [], ciHigh: [], p: [], loglik: 0, n: rows.length, events, iterations: 0 };
  let beta = zeros(p), ll = -Infinity, iterations = 0;
  for (; iterations < 25; iterations++) {
    const s = coxScore(rows, beta);
    const delta = solveLinear(s.hess.map((r) => [...r]), s.grad);
    // step-halve if the update overshoots into a worse likelihood — Newton-Raphson on a
    // partial likelihood is usually well-behaved, but a large first step from beta=0 with a
    // small or separated sample can overshoot. A drop no bigger than the rounding error in
    // summing the likelihood is not an overshoot: near the optimum a real step changes it by
    // less than that, and halving would stall the fit short of the optimum.
    const noise = 1e-12 * Math.abs(s.ll);
    let step = 1, next = beta.map((b, a) => b + delta[a]);
    for (let tries = 0; tries < 10; tries++) {
      const llNext = coxScore(rows, next).ll;
      if (llNext >= s.ll - noise || tries === 9) { ll = llNext; break; }
      step /= 2; next = beta.map((b, a) => b + step * delta[a]);
    }
    // converged when the full Newton step is negligible, whatever fraction of it was taken
    const converged = Math.max(...delta.map((d) => Math.abs(d))) < 1e-10;
    beta = next;
    if (converged) { iterations++; break; }
  }
  const finalHess = coxScore(rows, beta).hess;
  const variances = inverseDiagonal(finalHess);
  const se = variances.map((v) => Math.sqrt(Math.max(0, v)));
  const hr = beta.map((b) => Math.exp(b));
  const ciLow = beta.map((b, a) => Math.exp(b - Z_975 * se[a]));
  const ciHigh = beta.map((b, a) => Math.exp(b + Z_975 * se[a]));
  const pvals = beta.map((b, a) => se[a] > 0 ? chiSquareP1df((b / se[a]) * (b / se[a])) : 1);
  return { beta, se, hr, ciLow, ciHigh, p: pvals, loglik: ll, n: rows.length, events, iterations };
}

// ---------------------------------------------------------------------------
// Logistic regression (binomial GLM, Newton-Raphson / IRLS on the log-likelihood).
//
// Unlike Cox's partial likelihood, this is a fully parametric model — P(y=1|x) is estimated
// directly, not just a hazard ratio relative to an unspecified baseline — so it needs an
// intercept the way Cox does not: with every covariate at its reference/zero, Cox's baseline
// hazard absorbs that case, but logistic has nothing analogous, and without an intercept term
// the fit is forced through log-odds=0 at that point regardless of the true baseline rate. The
// intercept is fit like any other coefficient (x augmented with a leading 1) and simply not
// reported as one of the covariate coefficients — the same convention a forest plot follows.
// ---------------------------------------------------------------------------

export interface LogisticRow { y: 0 | 1; x: number[] }
export interface LogisticFit {
  /** the fitted intercept — not reported as a covariate coefficient, but real fitted state */
  intercept: number;
  /** beta/se/or/ciLow/ciHigh/p line up with each row's x[0..], the intercept excluded from all of them */
  beta: number[]; se: number[]; or: number[]; ciLow: number[]; ciHigh: number[]; p: number[];
  loglik: number; n: number; events: number; iterations: number;
}

/** The binomial log-likelihood at (intercept, beta) — exposed for tests, mirroring coxPartialLogLik. */
export function logisticLogLik(rows: LogisticRow[], intercept: number, beta: number[]): number {
  return logisticScore(rows.map((r) => ({ y: r.y, x: [1, ...r.x] })), [intercept, ...beta]).ll;
}

/** Log-likelihood, score and Fisher information for the binomial GLM at `beta` (x already has its leading 1). */
function logisticScore(rows: { y: 0 | 1; x: number[] }[], beta: number[]): { ll: number; grad: number[]; info: number[][] } {
  const p = beta.length;
  let ll = 0;
  const grad = zeros(p), info = zerosMat(p);
  for (const r of rows) {
    const eta = dot(beta, r.x);
    // numerically stable sigmoid and log(1+exp(eta)), whichever sign of eta avoids overflow
    const prob = eta >= 0 ? 1 / (1 + Math.exp(-eta)) : Math.exp(eta) / (1 + Math.exp(eta));
    const logDenom = eta >= 0 ? eta + Math.log1p(Math.exp(-eta)) : Math.log1p(Math.exp(eta));
    ll += r.y ? eta - logDenom : -logDenom;
    const resid = r.y - prob, w = prob * (1 - prob);
    for (let a = 0; a < p; a++) {
      grad[a] += resid * r.x[a];
      for (let b = 0; b < p; b++) info[a][b] += w * r.x[a] * r.x[b];
    }
  }
  return { ll, grad, info };
}

/**
 * Fit a logistic regression by Newton-Raphson (equivalently IRLS) on the binomial
 * log-likelihood. Every `x` must be the same length (dummy-code categoricals before calling
 * this, via buildCoxColumns — the same columns a Cox fit would use); an intercept is added
 * internally. `y` must already be 0/1.
 */
export function logisticRegression(rows: LogisticRow[]): LogisticFit {
  const p0 = rows[0]?.x.length ?? 0;
  const events = rows.reduce((n, r) => n + (r.y ? 1 : 0), 0);
  if (!rows.length || p0 === 0) return { intercept: 0, beta: [], se: [], or: [], ciLow: [], ciHigh: [], p: [], loglik: 0, n: rows.length, events, iterations: 0 };
  const aug = rows.map((r) => ({ y: r.y, x: [1, ...r.x] }));
  const p = p0 + 1;
  let beta = zeros(p), iterations = 0;
  for (; iterations < 50; iterations++) {
    const s = logisticScore(aug, beta);
    const delta = solveLinear(s.info.map((r) => [...r]), s.grad);
    // same step acceptance and convergence rule as coxRegression, for the same reasons
    const noise = 1e-12 * Math.abs(s.ll);
    let step = 1, next = beta.map((b, a) => b + delta[a]);
    for (let tries = 0; tries < 10; tries++) {
      const llNext = logisticScore(aug, next).ll;
      if (llNext >= s.ll - noise || tries === 9) break;
      step /= 2; next = beta.map((b, a) => b + step * delta[a]);
    }
    const converged = Math.max(...delta.map((d) => Math.abs(d))) < 1e-10;
    beta = next;
    if (converged) { iterations++; break; }
  }
  const finalLl = logisticScore(aug, beta).ll;
  const finalInfo = logisticScore(aug, beta).info;
  const variances = inverseDiagonal(finalInfo);
  const se = variances.map((v) => Math.sqrt(Math.max(0, v)));
  // drop the intercept (index 0) from what's reported — a forest plot has no row for it
  const betaCov = beta.slice(1), seCov = se.slice(1);
  const or = betaCov.map((b) => Math.exp(b));
  const ciLow = betaCov.map((b, a) => Math.exp(b - Z_975 * seCov[a]));
  const ciHigh = betaCov.map((b, a) => Math.exp(b + Z_975 * seCov[a]));
  const pvals = betaCov.map((b, a) => seCov[a] > 0 ? chiSquareP1df((b / seCov[a]) * (b / seCov[a])) : 1);
  return { intercept: beta[0], beta: betaCov, se: seCov, or, ciLow, ciHigh, p: pvals, loglik: finalLl, n: rows.length, events, iterations };
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

export type SurvPoint = SurvRecord;

/** One stratum's contribution: observed and expected events in group A, and the variance. */
function stratumTerms(a: SurvPoint[], b: SurvPoint[]): { o1: number; e1: number; v: number; o2: number } {
  const ok = (d: SurvPoint) => Number.isFinite(d.t) && d.t >= 0;
  const A = a.filter(ok).slice().sort((x, y) => x.t - y.t);
  const B = b.filter(ok).slice().sort((x, y) => x.t - y.t);
  const riskA = riskSweep(A), riskB = riskSweep(B);
  let i = 0, j = 0;
  let o1 = 0, e1 = 0, v = 0, o2 = 0;
  while (i < A.length || j < B.length) {
    const t = Math.min(i < A.length ? A[i].t : Infinity, j < B.length ? B[j].t : Infinity);
    let d1 = 0, d2 = 0;
    while (i < A.length && A[i].t === t) { if (A[i].event) d1++; i++; }
    while (j < B.length && B[j].t === t) { if (B[j].event) d2++; j++; }
    // risk sets honour delayed entry: a subject not yet observable is not at risk
    const n1 = riskA(t), n2 = riskB(t);
    const d = d1 + d2, n = n1 + n2;
    if (d > 0 && n > 1) {
      o1 += d1; o2 += d2;
      e1 += (d * n1) / n;
      // hypergeometric variance; zero when every at-risk subject fails at t
      v += (d * n1 * n2 * (n - d)) / (n * n * (n - 1));
    }
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

/**
 * One stratum's contribution for k groups at once: observed/expected events per group, and the
 * k×k covariance matrix of the deviations — the direct generalization of stratumTerms's single
 * (o1, e1, v) triple. At i=l this reduces to exactly stratumTerms's scalar variance formula
 * (verified algebraically and by test below); off-diagonal terms are the covariance between two
 * groups' deviations, needed because they are not independent (one more event in group A is one
 * fewer possible in the others at that same risk set).
 */
function stratumTermsK(groups: SurvPoint[][]): { o: number[]; e: number[]; v: number[][]; events: number } {
  const ok = (d: SurvPoint) => Number.isFinite(d.t) && d.t >= 0;
  const k = groups.length;
  const G = groups.map((g) => g.filter(ok).slice().sort((x, y) => x.t - y.t));
  const risk = G.map((g) => riskSweep(g));
  const idx = zeros(k);
  const o = zeros(k), e = zeros(k), v = zerosMat(k);
  let events = 0;
  const allTimes = [...new Set(G.flatMap((g) => g.map((d) => d.t)))].sort((a, b) => a - b);
  for (const t of allTimes) {
    const d = zeros(k);
    for (let i = 0; i < k; i++)
      while (idx[i] < G[i].length && G[i][idx[i]].t === t) { if (G[i][idx[i]].event) d[i]++; idx[i]++; }
    const n = G.map((_, i) => risk[i](t));
    const dTotal = d.reduce((a, b) => a + b, 0), nTotal = n.reduce((a, b) => a + b, 0);
    if (dTotal > 0 && nTotal > 1) {
      events += dTotal;
      const w = (dTotal * (nTotal - dTotal)) / (nTotal - 1); // hypergeometric weight, this time
      const p = n.map((ni) => ni / nTotal);
      for (let i = 0; i < k; i++) {
        o[i] += d[i];
        e[i] += (dTotal * n[i]) / nTotal;
        for (let l = 0; l < k; l++) v[i][l] += w * ((i === l ? p[i] : 0) - p[i] * p[l]);
      }
    }
  }
  return { o, e, v, events };
}

/**
 * K-group log-rank (the Peto & Peto / Mantel-Cox generalization — the same statistic R's
 * survdiff() reports for 3+ groups): at each distinct event time, compares every group's observed
 * events against what its share of the risk set predicts, then tests the whole deviation vector
 * against its covariance with a chi-squared on (groups with data − 1) degrees of freedom, rather
 * than the single scalar variance the 2-group logRank() uses. Pass one stratum for the pooled
 * test, one per site for the stratified test — same shape as logRank(), same reason (a federated
 * caller computes it from per-site aggregates, never a pooled risk set).
 *
 * A group with no records in ANY stratum is dropped before the test rather than left in as an
 * all-zero row — it would make the covariance matrix singular and says nothing anyway.
 */
export function logRankK(strata: { groups: SurvPoint[][] }[]): LogRankK {
  const k0 = strata[0]?.groups.length || 0;
  if (strata.some((s) => s.groups.length !== k0))
    throw new Error("logRankK: every stratum must name the same number of groups");
  const present = Array.from({ length: k0 }, (_, i) => strata.some((s) => s.groups[i].length > 0));
  const keep = present.map((p, i) => p ? i : -1).filter((i) => i >= 0);
  const k = keep.length;
  if (k < 2) return { chi2: 0, p: 1, df: 0, observed: [], expected: [], groups: k, strata: 0 };

  const O = zeros(k), E = zeros(k), V = zerosMat(k);
  let used = 0;
  for (const s of strata) {
    const g = keep.map((i) => s.groups[i]);
    const { o, e, v, events } = stratumTermsK(g);
    if (!events) continue;
    for (let i = 0; i < k; i++) E[i] += e[i], O[i] += o[i];
    for (let i = 0; i < k; i++) for (let l = 0; l < k; l++) V[i][l] += v[i][l];
    used++;
  }

  // The full (O-E) vector and V are singular by construction (both sum to zero across every
  // group) — drop the last group's row/column and solve the (k-1)-dimensional system, the
  // standard reduction. Which group is dropped does not change the resulting chi2 (tested below).
  const d = O.map((o, i) => o - E[i]).slice(0, k - 1);
  const Vsub = V.slice(0, k - 1).map((row) => row.slice(0, k - 1));
  let chi2 = 0;
  if (used > 0 && d.some((x) => x !== 0)) {
    try { chi2 = Math.max(0, dot(d, solveLinear(Vsub, d))); }
    catch { chi2 = 0; } // a degenerate covariance (e.g. one group with data but zero variation) says nothing, not an error
  }
  return {
    chi2: Math.round(chi2 * 1e4) / 1e4,
    p: chiSquareP(chi2, k - 1),
    df: k - 1,
    observed: O, expected: E.map((x) => Math.round(x * 10) / 10),
    groups: k, strata: used
  };
}

// ---------------------------------------------------------------------------
// Multiple testing and stratified 2x2 inference.
// ---------------------------------------------------------------------------

/**
 * Benjamini-Hochberg adjusted p-values, returned in the caller's order.
 * Needed as soon as a view tests many hypotheses at once (every gene pair, every
 * clinical attribute) — an unadjusted list of "significant" pairs is mostly noise.
 */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length;
  if (!m) return [];
  const order = ps.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const q = new Array<number>(m);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    running = Math.min(running, (order[k].p * m) / (k + 1));  // enforce monotonicity
    q[order[k].i] = Math.min(1, running);
  }
  return q;
}

/**
 * Cochran-Mantel-Haenszel test across a series of 2x2 tables.
 *
 * The federated statistic par excellence: every site contributes four counts,
 * the coordinator sums two running totals, and the result is the association
 * ASKED WITHIN EACH SITE rather than across the pooled population. When case mix
 * differs between sites, the pooled table can show the opposite association to
 * every stratum in it (Simpson's paradox), so pooling is not merely less private
 * than this — it is less correct.
 *
 * Includes the conventional 0.5 continuity correction.
 */
export function cochranMantelHaenszel(tables: { a: number; b: number; c: number; d: number }[]): Cmh {
  let sumA = 0, sumE = 0, sumV = 0, num = 0, den = 0, used = 0;
  for (const t of tables) {
    const n = t.a + t.b + t.c + t.d;
    const r1 = t.a + t.b, r2 = t.c + t.d, c1 = t.a + t.c, c2 = t.b + t.d;
    if (n < 2 || !r1 || !r2 || !c1 || !c2) continue;   // an empty margin says nothing
    sumA += t.a;
    sumE += (r1 * c1) / n;
    sumV += (r1 * r2 * c1 * c2) / (n * n * (n - 1));
    num += (t.a * t.d) / n;
    den += (t.b * t.c) / n;
    used++;
  }
  // continuity correction as R's mantelhaen.test applies it: only when |Δ| >= 0.5, so it never
  // overshoots past zero (subtracting it from a smaller |Δ| and squaring would inflate chi2)
  const delta = Math.abs(sumA - sumE);
  const corrected = delta >= 0.5 ? delta - 0.5 : delta;
  const chi2 = sumV > 0 ? (corrected * corrected) / sumV : 0;
  return {
    chi2: Math.round(chi2 * 1e4) / 1e4,
    p: chiSquareP1df(chi2),
    df: 1,
    oddsRatio: den > 0 ? Math.round((num / den) * 1e4) / 1e4 : null,
    tables: used
  };
}

/** log2 odds ratio for one 2x2, Haldane-corrected so an empty cell stays finite. */
export function log2OddsRatio(a: number, b: number, c: number, d: number): number | null {
  const zero = a === 0 || b === 0 || c === 0 || d === 0;
  const [A, B, C, D] = zero ? [a + 0.5, b + 0.5, c + 0.5, d + 0.5] : [a, b, c, d];
  if (!B || !C) return null;
  const or = (A * D) / (B * C);
  return or > 0 ? Math.round(Math.log2(or) * 1e3) / 1e3 : null;
}

// ---------------------------------------------------------------------------
// Distributions needed by the clinical-comparison view. Numerical Recipes
// algorithms, dependency-free; each is pinned to table values in test/stats.test.ts.
// ---------------------------------------------------------------------------

const GAMMA_COF = [
  76.18009172947146, -86.50532032941677, 24.01409824083091,
  -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
];
/** log Gamma(x) for x > 0 (Lanczos). */
function gammaLn(x: number): number {
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += GAMMA_COF[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized upper incomplete gamma Q(a,x) = 1 - P(a,x). */
function gammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) return 1;
  if (x === 0) return 1;
  if (x < a + 1) {                       // series for P, then complement
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 300; n++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gammaLn(a));
  }
  // continued fraction for Q directly
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h;
}

/** Upper tail of chi-squared with arbitrary degrees of freedom. */
export function chiSquareP(x: number, df: number): number {
  if (!Number.isFinite(x) || x <= 0 || df < 1) return 1;
  return Math.min(1, Math.max(0, gammaQ(df / 2, x / 2)));
}

/** Continued fraction for the incomplete beta function. */
function betaCf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b). */
function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaLn(a + b) - gammaLn(a) - gammaLn(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(a, b, x)) / a : 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for Student's t. */
export function studentTP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return 1;
  return Math.min(1, betaI(df / 2, 0.5, df / (df + t * t)));
}

/** Upper-tail p-value for the F distribution, via its relation to the regularized incomplete
 *  beta function: P(F(df1,df2) > f) = I_{df2/(df2+df1*f)}(df2/2, df1/2). */
export function fTestP(f: number, df1: number, df2: number): number {
  if (!Number.isFinite(f) || f <= 0 || df1 <= 0 || df2 <= 0) return 1;
  return Math.min(1, betaI(df2 / 2, df1 / 2, df2 / (df2 + df1 * f)));
}

export interface ChiSquareTest { chi2: number; df: number; p: number; minExpected: number }

/**
 * Pearson chi-squared on an r x c contingency table of counts.
 * `minExpected` is reported so a caller can say when the approximation is thin
 * (the conventional rule of thumb is that expected counts should exceed 5).
 */
export function chiSquareTest(table: number[][]): ChiSquareTest {
  const rows = table.length, cols = rows ? table[0].length : 0;
  if (rows < 2 || cols < 2) return { chi2: 0, df: 0, p: 1, minExpected: 0 };
  const rowSum = table.map((r) => r.reduce((a, b) => a + b, 0));
  const colSum = Array.from({ length: cols }, (_, j) => table.reduce((a, r) => a + r[j], 0));
  const n = rowSum.reduce((a, b) => a + b, 0);
  if (!n) return { chi2: 0, df: 0, p: 1, minExpected: 0 };
  // a row or column that is entirely zero carries no information; drop it
  const keepR = rowSum.map((s) => s > 0), keepC = colSum.map((s) => s > 0);
  const R = keepR.filter(Boolean).length, C = keepC.filter(Boolean).length;
  if (R < 2 || C < 2) return { chi2: 0, df: 0, p: 1, minExpected: 0 };
  let chi2 = 0, minExpected = Infinity;
  for (let i = 0; i < rows; i++) {
    if (!keepR[i]) continue;
    for (let j = 0; j < cols; j++) {
      if (!keepC[j]) continue;
      const e = (rowSum[i] * colSum[j]) / n;
      minExpected = Math.min(minExpected, e);
      if (e > 0) chi2 += ((table[i][j] - e) * (table[i][j] - e)) / e;
    }
  }
  const df = (R - 1) * (C - 1);
  return {
    chi2: Math.round(chi2 * 1e4) / 1e4, df,
    p: chiSquareP(chi2, df),
    minExpected: Math.round(minExpected * 100) / 100
  };
}

export interface WelchTest { t: number; df: number; p: number }

/**
 * Welch's unequal-variance t-test from MOMENTS only — (n, mean, variance) per
 * group. That is the point for federation: n, sum(x) and sum(x^2) are additive
 * across sites, so a site never sends a value, only three running totals.
 */
export function welchT(
  n1: number, mean1: number, var1: number,
  n2: number, mean2: number, var2: number
): WelchTest {
  if (n1 < 2 || n2 < 2) return { t: 0, df: 0, p: 1 };
  const s1 = var1 / n1, s2 = var2 / n2;
  const denom = s1 + s2;
  if (denom <= 0) return { t: 0, df: 0, p: 1 };
  const t = (mean1 - mean2) / Math.sqrt(denom);
  const df = (denom * denom) / ((s1 * s1) / (n1 - 1) + (s2 * s2) / (n2 - 1));
  return { t: Math.round(t * 1e4) / 1e4, df: Math.round(df * 100) / 100, p: studentTP(t, df) };
}

export interface WelchAnovaTest { f: number; df1: number; df2: number; p: number }

/**
 * Welch's one-way ANOVA (the unequal-variance F test) for k >= 2 groups — the same (n, mean,
 * variance) sufficient statistics welchT() uses, so it needs nothing a federated site doesn't
 * already report, and generalizes to any number of cohorts the same way logRankK generalizes
 * logRank. At k=2 this reduces EXACTLY to welchT (F = t², df2 = welchT's df) — verified in
 * test/stats.test.ts, a real check since the two are computed by entirely different formulas.
 * A group with fewer than 2 members or zero variance is dropped, mirroring logRankK's handling
 * of an empty group; fewer than 2 usable groups says nothing rather than dividing by zero.
 */
export function welchAnovaTest(groups: { n: number; mean: number; variance: number }[]): WelchAnovaTest {
  const gs = groups.filter((g) => g.n >= 2 && g.variance > 0);
  const k = gs.length;
  if (k < 2) return { f: 0, df1: 0, df2: 0, p: 1 };
  const w = gs.map((g) => g.n / g.variance);
  const W = w.reduce((a, b) => a + b, 0);
  const grandMean = gs.reduce((s, g, i) => s + w[i] * g.mean, 0) / W;
  const numerSS = gs.reduce((s, g, i) => s + w[i] * (g.mean - grandMean) * (g.mean - grandMean), 0);
  const A = numerSS / (k - 1);
  const S = gs.reduce((s, g, i) => s + ((1 - w[i] / W) * (1 - w[i] / W)) / (g.n - 1), 0);
  const denomF = 1 + (2 * (k - 2) / (k * k - 1)) * S;
  const f = denomF > 0 ? A / denomF : 0;
  const df1 = k - 1;
  const df2 = S > 0 ? (k * k - 1) / (3 * S) : Infinity;
  return { f: Math.round(f * 1e4) / 1e4, df1, df2: Math.round(df2 * 100) / 100, p: fTestP(f, df1, df2) };
}

/** Sample variance from the additive moments a federated site can report. */
export function varianceFromMoments(n: number, sum: number, sumsq: number): number {
  if (n < 2) return 0;
  return Math.max(0, (sumsq - (sum * sum) / n) / (n - 1));
}

// ---------------------------------------------------------------------------
// Correlation from moments.
//
// Pearson's r depends on the data only through six running totals — n, Sx, Sy,
// Sxy, Sxx, Syy — every one of them a sum. A site can therefore report its
// contribution to a correlation without transmitting a single expression value,
// and the totals add, so the result is exact rather than approximate. This is
// the classic sufficient-statistic argument for federated analytics.
// ---------------------------------------------------------------------------

export interface Moments { n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number }

/** Upper tail of the standard normal, two-sided. */
export function normalP(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(1, erfc(Math.abs(z) / Math.SQRT2));
}

export interface Correlation { r: number | null; n: number; t: number; df: number; p: number }

/**
 * The least-squares line from the same six sums Pearson's r uses — the ordinary closed-form OLS
 * solution, identical to what ClickHouse's simpleLinearRegression(x,y) computes in one pass, so a
 * federated slope/intercept is exact rather than a per-site average. Unlike r, this has no
 * pooling-vs-per-site ambiguity to caveat: a single line drawn through the combined cloud of
 * points is exactly what "the regression line" means, over however many sites contributed to it.
 */
export interface Regression { slope: number | null; intercept: number | null }
export function regressionFromMoments(m: Moments): Regression {
  const { n, sx, sy, sxy, sxx } = m;
  if (n < 2) return { slope: null, intercept: null };
  const vx = n * sxx - sx * sx;
  if (vx <= 0) return { slope: null, intercept: null };  // a constant x has no slope
  const slope = (n * sxy - sx * sy) / vx;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Pearson's r from the six sums, unrounded — null where it is undefined (n < 3, or a constant series). */
export function pearsonR(m: Moments): number | null {
  const { n, sx, sy, sxy, sxx, syy } = m;
  if (n < 3) return null;
  const vx = n * sxx - sx * sx, vy = n * syy - sy * sy;
  if (vx <= 0 || vy <= 0) return null;  // a constant series has no correlation
  return Math.max(-1, Math.min(1, (n * sxy - sx * sy) / Math.sqrt(vx * vy)));
}

export function pearsonFromMoments(m: Moments): Correlation {
  const n = m.n;
  const r = pearsonR(m);
  if (r == null) return { r: null, n, t: 0, df: 0, p: 1 };
  const df = n - 2;
  const t = r === 1 || r === -1 ? Infinity : r * Math.sqrt(df / (1 - r * r));
  return {
    r: Math.round(r * 1e4) / 1e4, n, df,
    t: Number.isFinite(t) ? Math.round(t * 1e4) / 1e4 : Infinity,
    p: Number.isFinite(t) ? studentTP(t, df) : 0
  };
}

export interface CorrelationMeta { r: number | null; z: number; se: number; p: number; sites: number }

/**
 * Fixed-effects meta-analysis of per-site correlations (Fisher z transform).
 *
 * Pooling the moments instead would answer a different question: the
 * correlation of the combined population, which can differ from the correlation
 * present at every site when the sites have different means. Combining site
 * correlations asks "do these genes move together WITHIN a site", weighted by
 * how much each site knows. Each site contributes r and n; nothing else.
 */
export function fisherZMeta(parts: { r: number | null; n: number }[]): CorrelationMeta {
  let sumWZ = 0, sumW = 0, sites = 0;
  for (const p of parts) {
    if (p.r == null || p.n < 4 || Math.abs(p.r) >= 1) continue;  // z is undefined at |r| = 1
    const w = p.n - 3;
    sumWZ += w * Math.atanh(p.r); sumW += w; sites++;
  }
  if (!sumW) return { r: null, z: 0, se: 0, p: 1, sites: 0 };
  const z = sumWZ / sumW, se = 1 / Math.sqrt(sumW);
  return {
    r: Math.round(Math.tanh(z) * 1e4) / 1e4,
    z: Math.round(z * 1e4) / 1e4,
    se: Math.round(se * 1e5) / 1e5,
    p: normalP(z / se),
    sites
  };
}

// ---------------------------------------------------------------------------
// Median/IQR and a rank-based test, from a value HISTOGRAM alone — (value, count)
// pairs are the complete, lossless distribution for a single-study cohort (nothing was
// sampled or capped), so quantiles and ranks computed from them are exact, not approximated.
// This is deliberately single-study only: unlike (n, sum, sumsq), a median or a rank is not
// additive across sites, so there is no honest way to combine two sites' histograms into one
// without merging raw values across a boundary that must not be crossed.
// ---------------------------------------------------------------------------

export interface Histogram { v: number; n: number }

/**
 * Quantiles by linear interpolation between order statistics (the "R-7"/numpy-default method),
 * from a histogram instead of an expanded array — same result, without materializing N values.
 */
export function quantilesFromHistogram(hist: Histogram[], qs: number[]): (number | null)[] {
  const N = hist.reduce((s, h) => s + h.n, 0);
  if (!N) return qs.map(() => null);
  const sorted = [...hist].sort((a, b) => a.v - b.v);
  const at = (rank0: number): number => {
    let cum = 0;
    for (const h of sorted) { cum += h.n; if (rank0 < cum) return h.v; }
    return sorted[sorted.length - 1].v;
  };
  return qs.map((q) => {
    const idx = q * (N - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx), frac = idx - lo;
    const vlo = at(lo), vhi = at(hi);
    return Math.round((vlo + frac * (vhi - vlo)) * 1e3) / 1e3;
  });
}

export interface RankSumTest { u: number; z: number; p: number; n1: number; n2: number }

/**
 * Wilcoxon rank-sum / Mann-Whitney U between two cohorts' complete value histograms. Ranks are
 * averaged within a tied value (the standard treatment), and the variance carries the usual tie
 * correction. This is the large-sample NORMAL APPROXIMATION every stats package falls back to
 * once there are ties or the sample isn't tiny — not the exact permutation p a small, tie-free
 * sample gets from e.g. R's wilcox.test by default.
 */
export function mannWhitneyU(histA: Histogram[], histB: Histogram[]): RankSumTest {
  const n1 = histA.reduce((s, h) => s + h.n, 0);
  const n2 = histB.reduce((s, h) => s + h.n, 0);
  if (!n1 || !n2) return { u: 0, z: 0, p: 1, n1, n2 };
  const merged = new Map<number, { a: number; b: number }>();
  for (const h of histA) merged.set(h.v, { a: (merged.get(h.v)?.a || 0) + h.n, b: merged.get(h.v)?.b || 0 });
  for (const h of histB) merged.set(h.v, { a: merged.get(h.v)?.a || 0, b: (merged.get(h.v)?.b || 0) + h.n });
  const values = [...merged.keys()].sort((x, y) => x - y);
  let cum = 0, r1 = 0, tieSum = 0;
  for (const v of values) {
    const { a, b } = merged.get(v)!;
    const t = a + b;
    const avgRank = cum + (t + 1) / 2; // average of ranks cum+1 .. cum+t
    r1 += avgRank * a;
    tieSum += t * t * t - t;
    cum += t;
  }
  const N = n1 + n2;
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);
  const meanU = (n1 * n2) / 2;
  const varU = (n1 * n2 / 12) * ((N + 1) - tieSum / (N * (N - 1)));
  if (varU <= 0) return { u, z: 0, p: 1, n1, n2 };
  const sd = Math.sqrt(varU);
  const diff = u1 - meanU;
  const cc = diff > 0 ? -0.5 : diff < 0 ? 0.5 : 0; // continuity correction, toward the mean
  const z = (diff + cc) / sd;
  return { u: Math.round(u * 1e3) / 1e3, z: Math.round(z * 1e4) / 1e4, p: normalP(z), n1, n2 };
}

export interface KruskalWallisTest { h: number; df: number; p: number }

/**
 * Kruskal-Wallis — the k-group generalization of mannWhitneyU, same reason: single-study only,
 * complete histograms, tie-averaged ranks with the usual tie correction. At k=2, without ties,
 * H equals the SQUARE of mannWhitneyU's z computed WITHOUT its continuity correction — a real
 * algebraic identity, checked by hand in test/stats.test.ts (mannWhitneyU always applies the
 * correction, by design, so the two are not expected to match exactly once ties are involved or
 * the correction is applied — only the underlying rank machinery is shared and checked).
 * An empty group is dropped, same as logRankK/mannWhitneyU; fewer than 2 non-empty groups says
 * nothing rather than dividing by zero.
 */
export function kruskalWallis(histograms: Histogram[][]): KruskalWallisTest {
  const nonEmpty = histograms.filter((h) => h.reduce((s, x) => s + x.n, 0) > 0);
  const k = nonEmpty.length;
  if (k < 2) return { h: 0, df: 0, p: 1 };
  const ns = nonEmpty.map((h) => h.reduce((s, x) => s + x.n, 0));
  const N = ns.reduce((a, b) => a + b, 0);
  const merged = new Map<number, number[]>(); // value -> per-group counts
  for (let gi = 0; gi < k; gi++) for (const { v, n } of nonEmpty[gi]) {
    if (!merged.has(v)) merged.set(v, new Array(k).fill(0));
    merged.get(v)![gi] += n;
  }
  const values = [...merged.keys()].sort((a, b) => a - b);
  let cum = 0, tieSum = 0;
  const R = new Array(k).fill(0);
  for (const v of values) {
    const counts = merged.get(v)!;
    const t = counts.reduce((a, b) => a + b, 0);
    const avgRank = cum + (t + 1) / 2;
    for (let gi = 0; gi < k; gi++) R[gi] += avgRank * counts[gi];
    tieSum += t * t * t - t;
    cum += t;
  }
  const rawH = (12 / (N * (N + 1))) * R.reduce((s, Ri, gi) => s + (Ri * Ri) / ns[gi], 0) - 3 * (N + 1);
  const tieCorrection = 1 - tieSum / (N * N * N - N);
  const h = tieCorrection > 0 ? rawH / tieCorrection : rawH;
  const df = k - 1;
  return { h: Math.round(h * 1e4) / 1e4, df, p: chiSquareP(h, df) };
}

// ---------------------------------------------------------------------------
// Preranked gene-set enrichment (Subramanian et al., PNAS 2005)

/** A small seeded PRNG (mulberry32), so a permutation null is the same on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit seed from a string (FNV-1a). */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * The enrichment score of a set whose members sit at `positions` (0-based, ascending) in a
 * ranking of `n` genes, each weighted by |score| (weight exponent 1, the GSEA default). The
 * running sum rises by w/ΣW at a member and falls by 1/(n-k) at a non-member, so its maximum
 * is reached just after a member and its minimum just before one (or at the end) — which is
 * why this needs only the k member positions, not a walk over all n genes.
 */
export function enrichmentScore(positions: ArrayLike<number>, weights: ArrayLike<number>, n: number): number {
  const k = positions.length;
  if (!k || k >= n) return 0;
  let nr = 0;
  for (let i = 0; i < k; i++) nr += weights[i];
  // all-zero weights: fall back to the unweighted (Kolmogorov–Smirnov) walk
  const unweighted = !(nr > 0);
  if (unweighted) nr = k;
  const miss = 1 / (n - k);
  let cum = 0, best = 0;
  for (let i = 0; i < k; i++) {
    const before = cum / nr - (positions[i] - i) * miss;           // just before this member
    if (Math.abs(before) > Math.abs(best)) best = before;
    cum += unweighted ? 1 : weights[i];
    const after = cum / nr - (positions[i] + 1 - (i + 1)) * miss; // just after it
    if (Math.abs(after) > Math.abs(best)) best = after;
  }
  return best;
}

export interface GseaResult {
  name: string;
  /** members found in the ranking, of the set's full size */
  size: number; setSize: number;
  es: number; nes: number;
  /** permutation p, (b + 1) / (m + 1) over the m null sets of the same sign (never exactly 0) */
  p: number;
  /** members ranked at or before the peak (after it, for a negative score) */
  leadingEdge: string[];
  /** the running sum sampled at `curveAt` ranks, for drawing */
  curve: number[]; curveAt: number[];
  /** every member's rank */
  hits: number[];
}

/**
 * Preranked GSEA: `ranked` is the whole ranking, best first. Significance is by gene-set
 * permutation (random sets of the same size drawn from the same ranking), the method GSEA's own
 * preranked mode uses, seeded from the set's name so a shared document reproduces its p-values.
 */
export function preRankedGsea(ranked: { gene: string; score: number }[], sets: { name: string; genes: string[] }[],
  opts: { permutations?: number; minSize?: number; curvePoints?: number } = {}): GseaResult[] {
  const n = ranked.length, perms = opts.permutations ?? 1000, minSize = opts.minSize ?? 10, CP = opts.curvePoints ?? 200;
  const rankOf = new Map<string, number>();
  ranked.forEach((r, i) => { if (!rankOf.has(r.gene)) rankOf.set(r.gene, i); });
  const absW = Float64Array.from(ranked, (r) => Math.abs(r.score));
  const out: GseaResult[] = [];
  for (const set of sets) {
    const pos = [...new Set(set.genes)].map((g) => rankOf.get(g)).filter((x): x is number => x != null).sort((a, b) => a - b);
    const k = pos.length;
    if (k < minSize || k >= n) continue;
    const w = pos.map((i) => absW[i]);
    const es = enrichmentScore(pos, w, n);
    // the null: random sets of k ranks (Floyd's sampling), their ES computed the same way
    const rnd = seededRandom(seedOf(set.name));
    const nullPos: number[] = [], nullNeg: number[] = [];
    const pick = new Int32Array(k), pw = new Float64Array(k);
    for (let b = 0; b < perms; b++) {
      const chosen = new Set<number>();
      for (let j = n - k; j < n; j++) {
        const t = Math.floor(rnd() * (j + 1));
        chosen.add(chosen.has(t) ? j : t);
      }
      let m = 0;
      for (const x of chosen) pick[m++] = x;
      pick.sort();
      for (let i = 0; i < k; i++) pw[i] = absW[pick[i]];
      const e = enrichmentScore(pick, pw, n);
      (e >= 0 ? nullPos : nullNeg).push(e);
    }
    const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const nes = es >= 0 ? (mean(nullPos) > 0 ? es / mean(nullPos) : 0) : (mean(nullNeg) < 0 ? -es / mean(nullNeg) : 0);
    const same = es >= 0 ? nullPos : nullNeg;
    const beyond = same.filter((e) => es >= 0 ? e >= es : e <= es).length;
    const p = (beyond + 1) / (same.length + 1);
    // the running sum, sampled for a figure, and where it peaks
    const curve: number[] = [], curveAt: number[] = [];
    const inSet = new Uint8Array(n);
    for (const i of pos) inSet[i] = 1;
    let nr = 0;
    for (const x of w) nr += x;
    const unweighted = !(nr > 0);
    if (unweighted) nr = k;
    const miss = 1 / (n - k), step = Math.max(1, Math.floor(n / CP));
    let rs = 0, peakAt = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      rs += inSet[i] ? (unweighted ? 1 : absW[i]) / nr : -miss;
      if (Math.abs(rs) > Math.abs(peak)) { peak = rs; peakAt = i; }
      if (i % step === 0 || i === n - 1) { curve.push(Math.round(rs * 1e4) / 1e4); curveAt.push(i); }
    }
    const leadingEdge = pos.filter((i) => es >= 0 ? i <= peakAt : i >= peakAt).map((i) => ranked[i].gene);
    out.push({ name: set.name, size: k, setSize: new Set(set.genes).size, es: Math.round(es * 1e4) / 1e4,
      nes: Math.round(nes * 1e3) / 1e3, p, leadingEdge, curve, curveAt, hits: pos });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paired proportions

/**
 * Exact McNemar test: of the discordant pairs, `b` changed one way and `c` the other; under
 * the null each discordant pair is a fair coin, so the two-sided p is twice the smaller binomial
 * tail (capped at 1). Concordant pairs carry no information about the direction and do not enter.
 */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logFact(n) - logFact(i) - logFact(n - i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

// ---------------------------------------------------------------------------
// Competing risks: cumulative incidence (Aalen–Johansen) and Gray's test

/**
 * One subject's competing-risks follow-up: leaves at `t` by `cause` 1 (the event of interest),
 * 2 (the competing event) or 0 (censored), having become observable at `entry` (left truncation;
 * omit for "observed from time zero").
 */
export interface CrRecord { t: number; cause: 0 | 1 | 2; entry?: number }

export interface CifPoint { t: number; f1: number; f2: number; se1: number; atRisk: number }
export interface CifCurve { n: number; events: number; competing: number; censored: number; points: CifPoint[] }

/**
 * Aalen–Johansen: at each distinct exit time, F1 rises by S(t−)·d1/R and F2 by S(t−)·d2/R,
 * where S is the all-cause Kaplan–Meier survival and R the number at risk — entered strictly
 * before t and not yet left, so delayed entry is honoured. 1 − KM of cause 1 alone overstates
 * incidence whenever the competing event is common, because it treats the dead as still at risk.
 * The standard error is the delta-method (Aalen 1978) estimator.
 */
export function aalenJohansen(recs: CrRecord[]): CifCurve {
  const n = recs.length;
  const byT = [...recs].sort((a, b) => a.t - b.t);
  const entries = recs.map((r) => r.entry ?? -Infinity).sort((a, b) => a - b);
  const times: { t: number; d1: number; d2: number; c: number; R: number }[] = [];
  let ei = 0, left = 0, i = 0;
  while (i < byT.length) {
    const t = byT[i].t;
    let d1 = 0, d2 = 0, c = 0;
    while (i < byT.length && byT[i].t === t) { const x = byT[i++]; if (x.cause === 1) d1++; else if (x.cause === 2) d2++; else c++; }
    while (ei < entries.length && entries[ei] < t) ei++;
    const R = ei - left;
    left += d1 + d2 + c;
    times.push({ t, d1, d2, c, R });
  }
  // cumulative quantities, then the delta-method variance at each event time
  const pts: CifPoint[] = [];
  let S = 1, F1 = 0, F2 = 0;
  const hist: { F1: number; Sprev: number; d: number; d1: number; R: number }[] = [];
  for (const x of times) {
    if (x.R <= 0) continue;
    const Sprev = S, d = x.d1 + x.d2;
    F1 += Sprev * x.d1 / x.R; F2 += Sprev * x.d2 / x.R;
    S *= 1 - d / x.R;
    hist.push({ F1, Sprev, d, d1: x.d1, R: x.R });
    if (d > 0) {
      let v = 0;
      for (const h of hist) {
        if (h.d === 0) continue;
        const diff = F1 - h.F1;
        v += (h.R - h.d > 0 ? diff * diff * h.d / (h.R * (h.R - h.d)) : 0) +
          h.Sprev * h.Sprev * h.d1 * (h.R - h.d1) / (h.R * h.R * h.R) -
          2 * diff * h.Sprev * h.d1 / (h.R * h.R);
      }
      pts.push({ t: x.t, f1: F1, f2: F2, se1: Math.sqrt(Math.max(0, v)), atRisk: x.R });
    }
  }
  return { n, events: recs.filter((r) => r.cause === 1).length, competing: recs.filter((r) => r.cause === 2).length,
    censored: recs.filter((r) => r.cause === 0).length, points: pts };
}

/** F1 at time t: the step function's value, 0 before the first event. */
export function cifAt(c: CifCurve, t: number): { f1: number; se1: number } {
  let f1 = 0, se1 = 0;
  for (const p of c.points) { if (p.t > t) break; f1 = p.f1; se1 = p.se1; }
  return { f1, se1 };
}

/**
 * Gray's (1988) statistic for K groups, weight 1: per group, observed cause-1 events minus the
 * number expected from the pooled subdistribution hazard, with each group's subdistribution risk
 * set R_k = Y_k (1 − F1_k(t−)) / S_k(t−) (those still at risk, plus those who died of the
 * competing cause, reweighted). Returned as Σ z_k² / E_k over groups, a chi-squared-shaped
 * summary; its p-value comes from grayPermutationTest rather than an asymptotic variance.
 */
function grayStatistic(order: Int32Array, t: Float64Array, cause: Uint8Array, groupOf: Int32Array, entryOrder: Int32Array,
  entry: Float64Array, K: number): number {
  const Y = new Float64Array(K), S = new Float64Array(K).fill(1), F = new Float64Array(K);
  const z = new Float64Array(K), E = new Float64Array(K);
  const d1 = new Float64Array(K), d2 = new Float64Array(K), cc = new Float64Array(K), R = new Float64Array(K);
  let i = 0, ei = 0;
  const n = order.length;
  while (i < n) {
    const tj = t[order[i]];
    while (ei < n && entry[entryOrder[ei]] < tj) { Y[groupOf[entryOrder[ei]]]++; ei++; }
    d1.fill(0); d2.fill(0); cc.fill(0);
    while (i < n && t[order[i]] === tj) {
      const r = order[i++], g = groupOf[r];
      if (cause[r] === 1) d1[g]++; else if (cause[r] === 2) d2[g]++; else cc[g]++;
    }
    let D1 = 0, Rtot = 0;
    for (let k = 0; k < K; k++) { R[k] = Y[k] > 0 && S[k] > 0 ? Y[k] * (1 - F[k]) / S[k] : 0; D1 += d1[k]; Rtot += R[k]; }
    if (D1 > 0 && Rtot > 0) for (let k = 0; k < K; k++) { const e = R[k] * D1 / Rtot; z[k] += d1[k] - e; E[k] += e; }
    for (let k = 0; k < K; k++) {
      if (Y[k] > 0) { F[k] += S[k] * d1[k] / Y[k]; S[k] *= 1 - (d1[k] + d2[k]) / Y[k]; }
      Y[k] -= d1[k] + d2[k] + cc[k];
    }
  }
  let stat = 0;
  for (let k = 0; k < K; k++) if (E[k] > 0) stat += z[k] * z[k] / E[k];
  return stat;
}

export interface GrayTest { statistic: number; p: number; permutations: number; groups: number }

/**
 * Gray's test by permutation: group labels are shuffled over the pooled records (a seeded
 * shuffle, so the p-value is reproducible), which is exact under the null that every group's
 * records come from one distribution — entry times included — and needs nothing but the records
 * themselves. p = (b + 1) / (m + 1).
 */
export function grayPermutationTest(groups: CrRecord[][], permutations = 2000, seed = 1): GrayTest {
  const K = groups.length;
  const all = groups.flatMap((g, k) => g.map((r) => ({ ...r, k })));
  const n = all.length;
  const t = Float64Array.from(all, (r) => r.t), entry = Float64Array.from(all, (r) => r.entry ?? -Infinity);
  const cause = Uint8Array.from(all, (r) => r.cause);
  const labels = Int32Array.from(all, (r) => r.k);
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => t[a] - t[b]);
  const entryOrder = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => entry[a] - entry[b]);
  const observed = grayStatistic(order, t, cause, labels, entryOrder, entry, K);
  const rnd = seededRandom(seed), perm = Int32Array.from(labels);
  let beyond = 0;
  for (let b = 0; b < permutations; b++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = perm[i]; perm[i] = perm[j]; perm[j] = x; }
    if (grayStatistic(order, t, cause, perm, entryOrder, entry, K) >= observed - 1e-12) beyond++;
  }
  return { statistic: observed, p: (beyond + 1) / (permutations + 1), permutations, groups: K };
}
