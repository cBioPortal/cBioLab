// Small, dependency-free stats for comparison views.

// log(n!) via Lanczos-free cumulative sum with memo
const LF = [0, 0];
function logFact(n) {
  for (let i = LF.length; i <= n; i++) LF[i] = LF[i - 1] + Math.log(i);
  return LF[n];
}

// Fisher's exact test (two-sided) for a 2x2 table [[a,b],[c,d]]
export function fisherExact(a, b, c, d) {
  const logHyper = (a, b, c, d) =>
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
export function kaplanMeier(data) {
  const clean = data.filter(d => Number.isFinite(d.t) && d.t >= 0).sort((x, y) => x.t - y.t);
  const n0 = clean.length;
  let atRisk = n0, s = 1, median = null;
  const points = [{ t: 0, s: 1 }];
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
