// Elastic-net Cox regression, and the repeated-split ensemble the `riskmodel` view is built on.
//
// The fit is glmnet's (Simon, Friedman, Hastie & Tibshirani 2011, J Stat Softw 39(5)): an outer
// loop takes the quadratic approximation of the partial log-likelihood at the current linear
// predictor (Breslow ties, diagonal Hessian), an inner loop solves the penalised weighted least
// squares by coordinate descent. The objective is
//     -(1/n) * logPL(b)  +  lambda * (alpha * |b|_1 + (1 - alpha)/2 * |b|_2^2)
// the same as glmnet's and scikit-survival's CoxnetSurvivalAnalysis, which pin it
// (test/coxnet-golden.test.ts). Delayed entry (left truncation) and strata are supported: a
// patient is at risk at t when entry < t <= time, among patients of the same stratum only.
//
// Features are sparse 0/1 columns (a gene altered or not) plus dense covariates; columns are
// scaled to unit variance before fitting, as glmnet does, and coefficients reported on the
// original scale. Scaling without centring keeps the binary columns sparse, and centring changes
// nothing in a Cox model (a shift of the linear predictor cancels in every risk set).
//
// The ensemble is OncoCast's (Martin et al.; github.com/AxelitoMartin/OncoCast): `runs` random
// splits of the patients into two thirds to train and a third to test; in each, the penalty is
// chosen by cross-validated partial likelihood on the training part (Verweij & van Houwelingen
// 1993, the measure cv.glmnet uses for Cox), and the fitted model scores the test third. A
// patient's risk score is the mean of the scores they got while held out, so no patient is ever
// scored by a model trained on them. Pure and deterministic: every random draw comes from a
// seeded generator, so the same input gives the same answer.

/** One patient. `entry` is when they joined the risk set (0 without delayed entry). */
export interface CoxSubject { time: number; event: boolean; entry: number; stratum: number }

/** Columns: sparse 0/1 features (the rows each is 1 in) and dense numeric covariates. */
export interface CoxDesign {
  n: number;
  binary: { name: string; rows: Int32Array }[];
  dense: { name: string; values: Float64Array }[];
}

export interface PathFit {
  lambdas: number[];
  /** coefficients per lambda, on the ORIGINAL scale of each column, in design order (binary then dense) */
  coefs: Float64Array[];
}

import { chiSquareP1df, Z_975 } from "./stats.ts";

// ---- risk sets ------------------------------------------------------------------------------

/**
 * Everything the partial likelihood needs that depends only on the subjects: per stratum, the
 * distinct event times, the deaths at each, and for every subject the range of event times
 * they are at risk for (entry < t <= time), as indices into its stratum's event times.
 */
interface RiskIndex {
  strata: { times: Float64Array; deaths: Float64Array; members: Int32Array }[];
  /** per subject: its stratum, and its at-risk event-time range [lo, hi) in that stratum */
  stratum: Int32Array; lo: Int32Array; hi: Int32Array;
}

function upperBound(a: Float64Array, x: number): number {
  let l = 0, h = a.length;
  while (l < h) { const m = (l + h) >> 1; if (a[m] <= x) l = m + 1; else h = m; }
  return l;
}

function riskIndex(subj: CoxSubject[], rows: Int32Array): RiskIndex {
  const byStratum = new Map<number, number[]>();
  for (let r = 0; r < rows.length; r++) {
    const s = subj[rows[r]].stratum;
    let l = byStratum.get(s); if (!l) byStratum.set(s, l = []); l.push(r);
  }
  const stratum = new Int32Array(rows.length), lo = new Int32Array(rows.length), hi = new Int32Array(rows.length);
  const strata: RiskIndex["strata"] = [];
  for (const members of byStratum.values()) {
    const deaths = new Map<number, number>();
    for (const r of members) { const s = subj[rows[r]]; if (s.event) deaths.set(s.time, (deaths.get(s.time) || 0) + 1); }
    const times = Float64Array.from([...deaths.keys()].sort((a, b) => a - b));
    const d = Float64Array.from(times, (t) => deaths.get(t)!);
    const k = strata.length;
    for (const r of members) {
      const s = subj[rows[r]];
      stratum[r] = k;
      lo[r] = upperBound(times, s.entry);      // first event time > entry
      hi[r] = upperBound(times, s.time);       // event times <= time
    }
    strata.push({ times, deaths: d, members: Int32Array.from(members) });
  }
  return { strata, stratum, lo, hi };
}

/**
 * For linear predictor `eta` (one per row): the partial log-likelihood, and per row the
 * gradient and diagonal Hessian of it with respect to eta. Risk-set sums are differences of
 * cumulative sums over event times, so each pass is O(n log n) with delayed entry.
 */
function likelihood(ix: RiskIndex, subj: CoxSubject[], rows: Int32Array, eta: Float64Array) {
  const n = rows.length;
  const grad = new Float64Array(n), hess = new Float64Array(n);
  let logpl = 0;
  // a common shift of eta cancels in every term; it keeps exp() in range
  let shift = -Infinity; for (let i = 0; i < n; i++) if (eta[i] > shift) shift = eta[i];
  if (!Number.isFinite(shift)) shift = 0;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.exp(eta[i] - shift);
  for (const st of ix.strata) {
    const m = st.times.length;
    if (!m) continue;
    // S[k] = sum of w over rows at risk at times[k]: + w at its lo, - w at its hi
    const delta = new Float64Array(m + 1);
    for (let j = 0; j < st.members.length; j++) {
      const r = st.members[j];
      if (ix.lo[r] < ix.hi[r]) { delta[ix.lo[r]] += w[r]; delta[ix.hi[r]] -= w[r]; }
    }
    const S = new Float64Array(m);
    let run = 0;
    for (let k = 0; k < m; k++) { run += delta[k]; S[k] = run; }
    const c1 = new Float64Array(m + 1), c2 = new Float64Array(m + 1);
    for (let k = 0; k < m; k++) {
      c1[k + 1] = c1[k] + st.deaths[k] / S[k];
      c2[k + 1] = c2[k] + st.deaths[k] / (S[k] * S[k]);
      logpl -= st.deaths[k] * (Math.log(S[k]) + shift);
    }
    for (let j = 0; j < st.members.length; j++) {
      const r = st.members[j];
      const a = c1[ix.hi[r]] - c1[ix.lo[r]], b = c2[ix.hi[r]] - c2[ix.lo[r]];
      const ev = subj[rows[r]].event ? 1 : 0;
      grad[r] = ev - w[r] * a;
      hess[r] = w[r] * a - w[r] * w[r] * b;
      if (ev) logpl += eta[r];
    }
  }
  return { logpl, grad, hess };
}

/** Partial log-likelihood of `rows` at coefficients `b` (original scale). */
export function partialLogLik(subj: CoxSubject[], X: CoxDesign, rows: Int32Array, b: Float64Array): number {
  return likelihood(riskIndex(subj, rows), subj, rows, linearPredictor(X, rows, b)).logpl;
}

/** X b for the given rows, coefficients on the original scale. */
export function linearPredictor(X: CoxDesign, rows: Int32Array, b: Float64Array): Float64Array {
  const pos = rowPositions(X.n, rows);
  const eta = new Float64Array(rows.length);
  X.binary.forEach((c, j) => {
    if (!b[j]) return;
    for (const r of c.rows) { const p = pos[r]; if (p >= 0) eta[p] += b[j]; }
  });
  const nb = X.binary.length;
  X.dense.forEach((c, j) => {
    const bj = b[nb + j]; if (!bj) return;
    for (let p = 0; p < rows.length; p++) eta[p] += bj * c.values[rows[p]];
  });
  return eta;
}

function rowPositions(n: number, rows: Int32Array): Int32Array {
  const pos = new Int32Array(n).fill(-1);
  for (let p = 0; p < rows.length; p++) pos[rows[p]] = p;
  return pos;
}

// ---- the fit --------------------------------------------------------------------------------

export interface PathOptions {
  /** the l1 share of the penalty: 1 = lasso, 0 = ridge; default 0.5 (elastic net) */
  alpha?: number;
  /** penalties to fit, largest first; default a log-spaced path from the smallest that zeroes every coefficient */
  lambdas?: number[];
  nLambda?: number;
  /** the smallest lambda on the default path, as a share of the largest */
  minRatio?: number;
  /** scale columns to unit variance before fitting (glmnet's default); default true */
  standardize?: boolean;
  /** columns never penalised (forced in), by name */
  unpenalized?: string[];
  tol?: number;
  maxIter?: number;
}

/** The elastic-net Cox path for the subjects in `rows`, warm-started from each penalty to the next. */
export function coxnetPath(subj: CoxSubject[], X: CoxDesign, rows: Int32Array, o: PathOptions = {}): PathFit {
  const alpha = o.alpha ?? 0.5, tol = o.tol ?? 1e-7, maxIter = o.maxIter ?? 100;
  const n = rows.length, nb = X.binary.length, p = nb + X.dense.length;
  const pos = rowPositions(X.n, rows);
  // each column as (row positions, values) over `rows`, and its scale
  const colRows: Int32Array[] = [], colVals: (Float64Array | null)[] = [], scale = new Float64Array(p);
  X.binary.forEach((c, j) => {
    const ps: number[] = [];
    for (const r of c.rows) if (pos[r] >= 0) ps.push(pos[r]);
    colRows[j] = Int32Array.from(ps); colVals[j] = null;
    const f = ps.length / n;
    scale[j] = o.standardize === false ? 1 : Math.sqrt(f * (1 - f)) || 0;
  });
  X.dense.forEach((c, j) => {
    const v = Float64Array.from(rows, (r) => c.values[r]);
    colRows[nb + j] = new Int32Array(0); colVals[nb + j] = v;
    let mean = 0; for (const x of v) mean += x; mean /= n;
    let ss = 0; for (const x of v) ss += (x - mean) * (x - mean);
    scale[nb + j] = o.standardize === false ? 1 : Math.sqrt(ss / n) || 0;
  });
  const free = new Uint8Array(p);
  const unpen = new Set(o.unpenalized || []);
  [...X.binary.map((c) => c.name), ...X.dense.map((c) => c.name)].forEach((nm, j) => { if (unpen.has(nm)) free[j] = 1; });
  const usable = (j: number) => scale[j] > 0;
  // column j (scaled) dotted with a per-row vector, and its weighted square
  const dot = (j: number, v: Float64Array) => {
    let s = 0;
    const cv = colVals[j];
    if (cv) for (let i = 0; i < n; i++) s += cv[i] * v[i]; else { const cr = colRows[j]; for (let k = 0; k < cr.length; k++) s += v[cr[k]]; }
    return s / scale[j];
  };
  const sq = (j: number, h: Float64Array) => {
    let s = 0;
    const cv = colVals[j];
    if (cv) for (let i = 0; i < n; i++) s += cv[i] * cv[i] * h[i]; else { const cr = colRows[j]; for (let k = 0; k < cr.length; k++) s += h[cr[k]]; }
    return s / (scale[j] * scale[j]);
  };
  const ix = riskIndex(subj, rows);

  let lambdas = o.lambdas;
  if (!lambdas) {
    const { grad } = likelihood(ix, subj, rows, new Float64Array(n));
    let lmax = 0;
    for (let j = 0; j < p; j++) if (usable(j) && !free[j]) lmax = Math.max(lmax, Math.abs(dot(j, grad)) / n);
    lmax /= Math.max(alpha, 1e-3);
    const k = o.nLambda ?? 50, ratio = o.minRatio ?? (n > p ? 1e-3 : 1e-2);
    lambdas = Array.from({ length: k }, (_, i) => lmax * Math.pow(ratio, i / (k - 1)));
  }

  const beta = new Float64Array(p);   // scaled coefficients, carried along the path
  const eta = new Float64Array(n);
  const coefs: Float64Array[] = [];
  for (const lambda of lambdas) {
    for (let outer = 0; outer < maxIter; outer++) {
      const { grad, hess } = likelihood(ix, subj, rows, eta);
      // working response residual r = z - eta = grad / hess, weights hess / n
      const res = new Float64Array(n);
      for (let i = 0; i < n; i++) res[i] = hess[i] > 1e-12 ? grad[i] / hess[i] : 0;
      const wt = Float64Array.from(hess, (h) => Math.max(h, 0) / n);
      const xwx = new Float64Array(p);
      for (let j = 0; j < p; j++) if (usable(j)) xwx[j] = sq(j, wt);
      const betaBefore = Float64Array.from(beta);
      // one coordinate's update; returns its weighted squared change
      const update = (j: number): number => {
        if (!usable(j) || xwx[j] <= 0) return 0;
        let g = 0;
        const cv = colVals[j];
        const cr = colRows[j];
        if (cv) for (let i = 0; i < n; i++) g += wt[i] * cv[i] * res[i]; else for (let k = 0; k < cr.length; k++) { const i = cr[k]; g += wt[i] * res[i]; }
        g /= scale[j];
        const old = beta[j];
        const zj = g + xwx[j] * old;
        const l1 = free[j] ? 0 : lambda * alpha, l2 = free[j] ? 0 : lambda * (1 - alpha);
        const nb2 = Math.sign(zj) * Math.max(Math.abs(zj) - l1, 0) / (xwx[j] + l2);
        if (nb2 === old) return 0;
        const d = nb2 - old;
        beta[j] = nb2;
        const dd = d / scale[j];
        if (cv) for (let i = 0; i < n; i++) { res[i] -= dd * cv[i]; eta[i] += dd * cv[i]; }
        else for (let k = 0; k < cr.length; k++) { const i = cr[k]; res[i] -= dd; eta[i] += dd; }
        return xwx[j] * d * d;
      };
      // glmnet's active-set cycling: a full sweep, then only the non-zero coefficients until they
      // settle, then a full sweep again to see whether any other coordinate wants in
      for (let full = 0; full < maxIter; full++) {
        let change = 0;
        for (let j = 0; j < p; j++) change = Math.max(change, update(j));
        if (change < tol) break;
        const active: number[] = [];
        for (let j = 0; j < p; j++) if (beta[j] !== 0) active.push(j);
        for (let inner = 0; inner < maxIter * 10; inner++) {
          let c = 0;
          for (const j of active) c = Math.max(c, update(j));
          if (c < tol) break;
        }
      }
      // glmnet's test: the largest weighted squared change of a coefficient over this quadratic step
      let moved = 0;
      for (let j = 0; j < p; j++) { const d = beta[j] - betaBefore[j]; if (d) moved = Math.max(moved, xwx[j] * d * d); }
      if (moved < tol) break;
    }
    coefs.push(Float64Array.from(beta, (b, j) => scale[j] > 0 ? b / scale[j] : 0));
  }
  return { lambdas, coefs };
}

// ---- choosing the penalty -------------------------------------------------------------------

/** Seeded generator (mulberry32): the same seed always draws the same splits. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(rows: Int32Array, rand: () => number): Int32Array {
  const a = Int32Array.from(rows);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

/**
 * The penalty with the best cross-validated partial likelihood (Verweij & van Houwelingen):
 * for each fold, logPL(all rows) - logPL(rows outside the fold), both at the coefficients fitted
 * without the fold, summed over folds.
 */
export function cvLambda(subj: CoxSubject[], X: CoxDesign, rows: Int32Array, folds: number, rand: () => number, o: PathOptions = {}) {
  const full = coxnetPath(subj, X, rows, o);
  const order = shuffled(rows, rand);
  const score = new Float64Array(full.lambdas.length);
  for (let f = 0; f < folds; f++) {
    const train = Int32Array.from(order.filter((_, i) => i % folds !== f));
    const fit = coxnetPath(subj, X, train, { ...o, lambdas: full.lambdas });
    const ixAll = riskIndex(subj, rows), ixTrain = riskIndex(subj, train);
    fit.coefs.forEach((b, k) => {
      score[k] += likelihood(ixAll, subj, rows, linearPredictor(X, rows, b)).logpl
        - likelihood(ixTrain, subj, train, linearPredictor(X, train, b)).logpl;
    });
  }
  let best = 0;
  for (let k = 1; k < score.length; k++) if (score[k] > score[best]) best = k;
  return { path: full, best, score };
}

// ---- concordance ----------------------------------------------------------------------------

/**
 * Harrell's C: of the pairs where the patient with the shorter time had the event, the share in
 * which that patient has the higher risk score; ties in score count a half. Within strata only,
 * as survival::concordance counts a stratified fit. Two patients with the same time are not compared.
 * O(n log n) with a Fenwick tree over score ranks.
 */
export function concordance(subj: CoxSubject[], rows: Int32Array, risk: Float64Array): number {
  const groups = new Map<number, number[]>();
  rows.forEach((r, p) => { const s = subj[r].stratum; let l = groups.get(s); if (!l) groups.set(s, l = []); l.push(p); });
  let concordant = 0, comparable = 0;
  for (const ps of groups.values()) {
    const ranks = [...new Set(ps.map((p) => risk[p]))].sort((a, b) => a - b);
    const rankOf = new Map(ranks.map((v, i) => [v, i + 1] as const));
    const tree = new Float64Array(ranks.length + 1);
    const add = (i: number) => { for (; i < tree.length; i += i & -i) tree[i]++; };
    const sum = (i: number) => { let s = 0; for (; i > 0; i -= i & -i) s += tree[i]; return s; };
    // longest times first: when an event at t is reached, the tree holds everyone with time > t
    const order = [...ps].sort((a, b) => subj[rows[b]].time - subj[rows[a]].time);
    for (let i = 0; i < order.length;) {
      let j = i;
      const t = subj[rows[order[i]]].time;
      while (j < order.length && subj[rows[order[j]]].time === t) j++;
      const total = sum(ranks.length);
      for (let q = i; q < j; q++) {
        const p = order[q];
        if (!subj[rows[p]].event) continue;
        const rk = rankOf.get(risk[p])!;
        const lower = sum(rk - 1), equal = sum(rk) - lower;
        concordant += lower + 0.5 * equal;
        comparable += total;
      }
      for (let q = i; q < j; q++) add(rankOf.get(risk[order[q]])!);
      i = j;
    }
  }
  return comparable ? concordant / comparable : NaN;
}

// ---- the ensemble ---------------------------------------------------------------------------

export interface EnsembleOptions extends PathOptions {
  runs: number;
  /** share of patients held out in each run; OncoCast's third */
  testShare?: number;
  folds?: number;
  seed?: number;
  /** the rows the runs split between training and testing (default: every row) */
  pool?: Int32Array;
  /** rows outside the pool that every run's model scores (a validation set never trained on) */
  alsoScore?: Int32Array;
}

export interface EnsembleResult {
  /** per subject (design row), the mean of its held-out scores; NaN if never held out */
  risk: Float64Array;
  /** how many runs held each subject out */
  heldOut: Int32Array;
  /** per run: the test-set concordance and the chosen penalty */
  runs: { cIndex: number; lambda: number; nonzero: number }[];
  /** per column: the share of runs that kept it (non-zero), and its mean coefficient over those runs */
  selected: Float64Array; meanCoef: Float64Array;
  /** per row of `alsoScore`: the mean of every run's score; NaN for every other row */
  external: Float64Array;
}

/** OncoCast's ensemble: random two-thirds / one-third splits, penalty by inner cross-validation, held-out scores averaged. */
export function coxnetEnsemble(subj: CoxSubject[], X: CoxDesign, o: EnsembleOptions): EnsembleResult {
  const n = X.n, p = X.binary.length + X.dense.length;
  const rand = rng(o.seed ?? 1);
  const all = o.pool ?? Int32Array.from({ length: n }, (_, i) => i);
  const ext = new Float64Array(n);
  const sum = new Float64Array(n), heldOut = new Int32Array(n);
  const keptCount = new Float64Array(p), coefSum = new Float64Array(p);
  const runs: EnsembleResult["runs"] = [];
  for (let run = 0; run < o.runs; run++) {
    const order = shuffled(all, rand);
    const nTest = Math.round(all.length * (o.testShare ?? 1 / 3));
    const test = Int32Array.from(order.subarray(0, nTest)).sort();
    const train = Int32Array.from(order.subarray(nTest)).sort();
    const { path, best } = cvLambda(subj, X, train, o.folds ?? 3, rand, o);
    const b = path.coefs[best];
    const eta = linearPredictor(X, test, b);
    test.forEach((r, i) => { sum[r] += eta[i]; heldOut[r]++; });
    if (o.alsoScore && o.alsoScore.length) {
      const e2 = linearPredictor(X, o.alsoScore, b);
      o.alsoScore.forEach((r, i) => { ext[r] += e2[i] / o.runs; });
    }
    let nonzero = 0;
    for (let j = 0; j < p; j++) if (b[j] !== 0) { nonzero++; keptCount[j]++; coefSum[j] += b[j]; }
    runs.push({ cIndex: concordance(subj, test, eta), lambda: path.lambdas[best], nonzero });
  }
  const risk = Float64Array.from(sum, (s, i) => heldOut[i] ? s / heldOut[i] : NaN);
  const scoredExt = new Set(o.alsoScore || []);
  const external = Float64Array.from(ext, (v, i) => scoredExt.has(i) ? v : NaN);
  return { risk, heldOut, runs, external,
    selected: Float64Array.from(keptCount, (k) => k / o.runs),
    meanCoef: Float64Array.from(coefSum, (s, j) => keptCount[j] ? s / keptCount[j] : 0) };
}

// ---- an unpenalised fit with standard errors ------------------------------------------------

export interface CoxFitResult { beta: number[]; se: number[]; hr: number[]; ciLow: number[]; ciHigh: number[]; p: number[]; loglik: number; n: number; events: number }

/**
 * Newton-Raphson Cox fit of a few dense columns (risk-group indicators, a score, covariates) with
 * the full information matrix, so each coefficient gets a standard error, a 95% Wald interval and
 * a p-value. Breslow ties, delayed entry and strata as coxnetPath. Pinned against statsmodels' PHReg by
 * test/coxnet-golden.test.ts.
 */
export function coxFit(subj: CoxSubject[], rows: Int32Array, cols: Float64Array[], maxIter = 30): CoxFitResult {
  const p = cols.length, n = rows.length;
  const byStratum = new Map<number, number[]>();
  for (let q = 0; q < n; q++) { const s = subj[rows[q]].stratum; let l = byStratum.get(s); if (!l) byStratum.set(s, l = []); l.push(q); }
  const x = (q: number, j: number) => cols[j][rows[q]];
  const evaluate = (b: number[]) => {
    let ll = 0;
    const g = new Array(p).fill(0), H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (const qs of byStratum.values()) {
      const eta = qs.map((q) => { let e = 0; for (let j = 0; j < p; j++) e += b[j] * x(q, j); return e; });
      const shift = Math.max(...eta);
      const w = eta.map((e) => Math.exp(e - shift));
      const byEntry = qs.map((_, i) => i).sort((a, c) => subj[rows[qs[a]]].entry - subj[rows[qs[c]]].entry);
      const byExit = qs.map((_, i) => i).sort((a, c) => subj[rows[qs[a]]].time - subj[rows[qs[c]]].time);
      const times = [...new Set(qs.filter((q) => subj[rows[q]].event).map((q) => subj[rows[q]].time))].sort((a, c) => a - c);
      let S0 = 0; const S1 = new Array(p).fill(0), S2 = Array.from({ length: p }, () => new Array(p).fill(0));
      const add = (i: number, sign: number) => {
        const q = qs[i]; S0 += sign * w[i];
        for (let j = 0; j < p; j++) { S1[j] += sign * w[i] * x(q, j); for (let k = 0; k <= j; k++) S2[j][k] += sign * w[i] * x(q, j) * x(q, k); }
      };
      let ei = 0, xi = 0;
      for (const t of times) {
        // at risk at t: entry < t <= time
        while (ei < byEntry.length && subj[rows[qs[byEntry[ei]]]].entry < t) add(byEntry[ei++], 1);
        while (xi < byExit.length && subj[rows[qs[byExit[xi]]]].time < t) add(byExit[xi++], -1);
        let d = 0;
        for (let i = 0; i < qs.length; i++) {
          const s = subj[rows[qs[i]]];
          if (s.event && s.time === t) { d++; ll += eta[i]; for (let j = 0; j < p; j++) g[j] += x(qs[i], j); }
        }
        ll -= d * (Math.log(S0) + shift);
        for (let j = 0; j < p; j++) {
          g[j] -= d * S1[j] / S0;
          for (let k = 0; k <= j; k++) H[j][k] += d * (S2[j][k] / S0 - S1[j] * S1[k] / (S0 * S0));
        }
      }
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) H[k][j] = H[j][k];
    return { ll, g, H };
  };
  let b = new Array(p).fill(0);
  let cur = evaluate(b);
  for (let it = 0; it < maxIter; it++) {
    const step = solve(cur.H, cur.g);
    let scale = 1, next = b.map((v, j) => v + step[j]), ev = evaluate(next);
    while (ev.ll < cur.ll - 1e-12 && scale > 1e-4) { scale /= 2; next = b.map((v, j) => v + scale * step[j]); ev = evaluate(next); }
    const moved = Math.max(...step.map((s) => Math.abs(s * scale)));
    b = next; cur = ev;
    if (moved < 1e-10) break;
  }
  const inv = invert(cur.H);
  const se = b.map((_, j) => Math.sqrt(Math.max(inv[j][j], 0)));
  const Z = Z_975;
  return { beta: b, se, hr: b.map(Math.exp), ciLow: b.map((v, j) => Math.exp(v - Z * se[j])), ciHigh: b.map((v, j) => Math.exp(v + Z * se[j])),
    p: b.map((v, j) => se[j] > 0 ? chiSquareP1df((v / se[j]) ** 2) : NaN), loglik: cur.ll, n, events: [...rows].filter((r) => subj[r].event).length };
}

function solve(A: number[][], y: number[]): number[] {
  const n = y.length, M = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) throw new Error("the model's columns are collinear (a group or covariate level with no events, or one that duplicates another)");
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

function invert(A: number[][]): number[][] {
  const n = A.length;
  return Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_, i) => i === j ? 1 : 0)))
    .reduce((acc, col, j) => { col.forEach((v, i) => { acc[i][j] = v; }); return acc; }, Array.from({ length: n }, () => new Array(n).fill(0)));
}
