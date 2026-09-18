// Small, dependency-free stats for comparison views.
import type { KmCurve, KmPoint, LogRank, Cmh } from "./types.ts";

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
    if (Math.abs(A[piv][col]) < 1e-12) throw new Error("Cox model is not identifiable: covariates are collinear or a category has no variation");
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
    // small or separated sample can overshoot
    let step = 1, next = beta.map((b, a) => b + delta[a]);
    for (let tries = 0; tries < 10; tries++) {
      const llNext = coxScore(rows, next).ll;
      if (llNext >= s.ll || tries === 9) { ll = llNext; break; }
      step /= 2; next = beta.map((b, a) => b + step * delta[a]);
    }
    const converged = Math.max(...delta.map((d) => Math.abs(d) * step)) < 1e-7;
    beta = next;
    if (converged) { iterations++; break; }
  }
  const finalHess = coxScore(rows, beta).hess;
  const variances = inverseDiagonal(finalHess);
  const se = variances.map((v) => Math.sqrt(Math.max(0, v)));
  const hr = beta.map((b) => Math.exp(b));
  const ciLow = beta.map((b, a) => Math.exp(b - 1.96 * se[a]));
  const ciHigh = beta.map((b, a) => Math.exp(b + 1.96 * se[a]));
  const pvals = beta.map((b, a) => se[a] > 0 ? chiSquareP1df((b / se[a]) * (b / se[a])) : 1);
  return { beta, se, hr, ciLow, ciHigh, p: pvals, loglik: ll, n: rows.length, events, iterations };
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
  const corrected = Math.max(0, Math.abs(sumA - sumE) - 0.5);
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

export function pearsonFromMoments(m: Moments): Correlation {
  const { n, sx, sy, sxy, sxx, syy } = m;
  if (n < 3) return { r: null, n, t: 0, df: 0, p: 1 };
  const cov = n * sxy - sx * sy;
  const vx = n * sxx - sx * sx, vy = n * syy - sy * sy;
  if (vx <= 0 || vy <= 0) return { r: null, n, t: 0, df: 0, p: 1 };  // a constant series has no correlation
  let r = cov / Math.sqrt(vx * vy);
  r = Math.max(-1, Math.min(1, r));
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
