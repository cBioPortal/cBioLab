// cBioPortal's study-view histogram bins, ported from its DataBinner and helpers
// (org.cbioportal.legacy.web.util: DataBinner, DataBinHelper, LinearDataBinner, DiscreteDataBinner,
// LogScaleDataBinner, ScientificSmallDataBinner) for the DYNAMIC method: bins drawn over the values
// the cohort holds. A histogram on Explore is laid out by exactly these rules, so its bars are the
// portal's bars:
//   - few distinct values (at most DISTINCT_VALUE_THRESHOLD, after outliers): one bar per value;
//   - a box range (Tukey fences) wider than 1,000: log-scale bars, 10^(k/2);
//   - a median within ±0.001: bars by powers of ten;
//   - otherwise linear bars of a "nice" width, at most ~20 of them, AGE attributes starting at 18;
//   - values outside the bars go to a "<=" and a ">" bar, and a value recorded as a bound (">90",
//     "<=18") goes to the outlier bar on its side, which then starts or ends at that bound;
//   - leading and trailing empty bars are dropped, and bars that each hold one integer become
//     one-value bars;
//   - a value that is not a number ("Negative", "UNKNOWN") gets a bar of its own, by its text.
// The portal computes in BigDecimal, so a value on an edge (0.3 against an edge of 0.3) lands in the
// bar that ends there; this port keeps that exactness with decimals held as BigInt × 10^-scale,
// compared through their nearest doubles first. Browser-safe: no I/O.
import type { NumericBin as Bin } from "./types.ts";

/** one recorded value (as stored, untrimmed) and how many samples or patients hold it */
export interface BinInput { value: string; count: number }

/** at or below this many distinct values (outliers aside), every value gets a bar of its own */
export const DISTINCT_VALUE_THRESHOLD = 10;

// ---- exact decimals ---------------------------------------------------------------------------

/**
 * A number as Java's BigDecimal holds it, m × 10^-s (scale s may be negative), with x its nearest
 * double. A value read from the data keeps its text and is parsed exactly only when a comparison
 * needs it.
 */
interface Dec { x: number; t?: string; m?: bigint; s?: number }

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** a decimal string as BigDecimal reads it, or null when it is not a plain number */
const parseDec = (text: string): Dec | null => NUMBER_RE.test(text) ? { x: Number(text), t: text } : null;
/** m and s, parsed from the text on first use (the scale as BigDecimal keeps it) */
function ex(a: Dec): { m: bigint; s: number } {
  if (a.m === undefined) {
    const [mant, exp] = a.t!.split(/[eE]/);
    const neg = mant.startsWith("-");
    const [whole, frac = ""] = mant.replace(/^[+-]/, "").split(".");
    a.m = (neg ? -1n : 1n) * BigInt((whole + frac).replace(/^0+(?=\d)/, "") || "0");
    a.s = frac.length - (exp ? Number(exp) : 0);
  }
  return a as { m: bigint; s: number };
}
/** a computed decimal, its double read from its exact text */
function dec(m: bigint, s: number): Dec {
  const neg = m < 0n, digits = (neg ? -m : m).toString();
  const text = s <= 0 ? digits + "0".repeat(-s) : digits.padStart(s + 1, "0").slice(0, -s) + "." + digits.padStart(s + 1, "0").slice(-s);
  return { x: Number((neg ? "-" : "") + text), m, s };
}
/** a double as BigDecimal.valueOf reads it: its shortest decimal form */
const decOf = (x: number): Dec => parseDec(String(Number.isFinite(x) ? x : 0))!;
const int = (k: number): Dec => ({ x: k, m: BigInt(k), s: 0 });
const POW10: bigint[] = [];
const pow10 = (k: number): bigint => POW10[k] ??= 10n ** BigInt(k);
function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const A = ex(a), B = ex(b), s = Math.max(A.s, B.s);
  return [A.m * pow10(s - A.s), B.m * pow10(s - B.s), s];
}
/**
 * Rounding to the nearest double keeps order, so two values whose doubles differ compare as their
 * doubles do; only a tie (a value on an edge, or two decimals one double apart) is compared exactly.
 */
function cmp(a: Dec, b: Dec): number {
  if (a.x !== b.x) return a.x < b.x ? -1 : 1;
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}
const add = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return dec(x + y, s); };
const sub = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return dec(x - y, s); };
const mul = (a: Dec, b: Dec): Dec => { const A = ex(a), B = ex(b); return dec(A.m * B.m, A.s + B.s); };
/** BigDecimal.remainder: the sign of the dividend */
const rem = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return dec(x % y, s); };
const min = (a: Dec, b: Dec): Dec => cmp(a, b) <= 0 ? a : b;
const max = (a: Dec, b: Dec): Dec => cmp(a, b) >= 0 ? a : b;
/** an integer value: no fraction once trailing zeros are stripped */
const isInt = (a: Dec): boolean => { const A = ex(a); return A.s <= 0 || A.m % pow10(A.s) === 0n; };
/** BigDecimal.longValue: toward zero */
const trunc = (a: Dec): Dec => { const A = ex(a); return A.s <= 0 ? a : dec(A.m / pow10(A.s), 0); };
/** setScale(k) with HALF_UP, CEILING or FLOOR */
function setScale(a: Dec, k: number, mode: "half_up" | "ceiling" | "floor"): Dec {
  const { m, s } = ex(a);
  if (s <= k) return dec(m * pow10(k - s), k);
  const d = pow10(s - k), q = m / d, r = m % d;
  if (r === 0n) return dec(q, k);
  const up = mode === "ceiling" ? m > 0n : mode === "floor" ? m < 0n : (r < 0n ? -r : r) * 2n >= d;
  return dec(q + (up ? (m < 0n ? -1n : 1n) : 0n), k);
}
/** BigDecimal precision − scale − 1: the power of ten of the leading digit */
const exponentOf = (a: Dec): number => { const { m, s } = ex(a); return (m < 0n ? -m : m).toString().length - s - 1; };
const THOUSANDTH: Dec = { x: 0.001, m: 1n, s: 3 }, ONE = int(1), THOUSAND = int(1000), EIGHTEEN = int(18), ONE_AND_HALF: Dec = { x: 1.5, m: 15n, s: 1 };

// ---- the values: distinct, sorted, with running counts ---------------------------------------

/**
 * Distinct values in order, each with how many hold it; cum[i] counts those before d[i]. What the
 * portal does over its sorted list of every value (a quartile at an index, a bar's count) is done
 * here by binary search over these.
 */
interface Vals { d: Dec[]; n: number[]; cum: number[] }

function vals(entries: { d: Dec; n: number }[]): Vals {
  const sorted = entries.slice().sort((a, b) => cmp(a.d, b.d));
  const d: Dec[] = [], n: number[] = [], cum = [0];
  for (const e of sorted) {
    if (d.length && cmp(d[d.length - 1], e.d) === 0) { n[n.length - 1] += e.n; cum[cum.length - 1] += e.n; continue; }
    d.push(e.d); n.push(e.n); cum.push(cum[cum.length - 1] + e.n);
  }
  return { d, n, cum };
}
const total = (v: Vals) => v.cum[v.cum.length - 1];
/** the value at position i of the full sorted list */
function at(v: Vals, i: number): Dec {
  let lo = 0, hi = v.d.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (v.cum[mid + 1] > i) hi = mid; else lo = mid + 1; }
  return v.d[lo];
}
/** the first distinct value above x (strictly, or at or above it) */
function firstAbove(v: Vals, x: Dec, orEqual = false): number {
  let lo = 0, hi = v.d.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; const c = cmp(v.d[mid], x); if (c > 0 || (orEqual && c === 0)) hi = mid; else lo = mid + 1; }
  return lo;
}
/** the distinct values in a bar's range, as DataBinHelper.calcRange draws it: (start, end], [v, v], ≤ end, > start */
function within(v: Vals, b: DBin): [number, number] {
  if (b.start && b.end && cmp(b.start, b.end) === 0) return [firstAbove(v, b.start, true), firstAbove(v, b.start)];
  if (!b.start && !b.end) return [0, 0];
  return [b.start ? firstAbove(v, b.start) : 0, b.end ? firstAbove(v, b.end) : v.d.length];
}
const countIn = (v: Vals, b: DBin) => { const [i, j] = within(v, b); return j > i ? v.cum[j] - v.cum[i] : 0; };
const slice = (v: Vals, i: number, j: number): Vals => ({ d: v.d.slice(i, j), n: v.n.slice(i, j), cum: v.cum.slice(i, j + 1).map((c) => c - v.cum[i]) });

// ---- the binner -------------------------------------------------------------------------------

/** a bar while it is built: bounds exact, special markers as the portal sets them */
interface DBin { special?: string; start?: Dec; end?: Dec; count: number }

/** a bound recorded as a value (">90", "<=18"), as an open range on its side */
interface Bound { op: ">" | "<"; at: Dec }

/**
 * The bars for one attribute's values in a cohort, in order: the "<=" bar, the numeric bars, the ">"
 * bar, then one bar per non-numeric value. Values spelled as missing never reach here (clinicalTable).
 */
export function dataBins(values: BinInput[], attributeId?: string): Bin[] {
  const entries: { d: Dec; n: number }[] = [];
  const bounds: Bound[] = [];
  const words = new Map<string, { value: string; count: number }>();
  const upperAt: Dec[] = [], lowerAt: Dec[] = [];
  let lowerSpecial = 0, upperSpecial = 0;
  for (const { value, count } of values) {
    if (!(count > 0)) continue;
    const plain = parseDec(value);
    if (plain) { entries.push({ d: plain, n: count }); continue; }
    const t = value.trim();
    const op = /^(<=|>=|<|>)/.exec(t)?.[1];
    // a number with space around it: the portal reads it as neither a number nor a word
    if (!op && parseDec(t)) continue;
    const bounded = op ? parseDec(t.slice(op.length)) : null;
    if (op && bounded) {
      if (op[0] === "<") { lowerAt.push(bounded); lowerSpecial += count; } else { upperAt.push(bounded); upperSpecial += count; }
      bounds.push({ op: op[0] as ">" | "<", at: bounded });
      continue;
    }
    const key = t.toUpperCase();
    const w = words.get(key);
    if (w) w.count += count; else words.set(key, { value: t, count });
  }
  const all = vals(entries);

  // the portal's outlier bars from the values recorded as bounds: the lowest ">" bound and the
  // highest "<" bound, each holding those values
  const upper: DBin = { special: ">", start: upperAt.reduce<Dec | undefined>((m, x) => (m ? min(m, x) : x), undefined), count: upperSpecial };
  const lower: DBin = { special: "<=", end: lowerAt.reduce<Dec | undefined>((m, x) => (m ? max(m, x) : x), undefined), count: lowerSpecial };

  let bins: DBin[] = [];
  if (all.d.length) {
    let box = boxRange(all)!;
    // the values between the outlier bars a recorded bound opened
    const without = slice(all, lower.end ? firstAbove(all, lower.end) : 0, upper.start ? firstAbove(all, upper.start) : all.d.length);
    if (without.d.length > 0 && without.d.length <= DISTINCT_VALUE_THRESHOLD) {
      bins = without.d.map((d, i) => ({ start: d, end: d, count: without.n[i] }));
    } else if (without.d.length) {
      if (cmp(sub(box.hi, box.lo), THOUSAND) > 0) {
        bins = logScaleBins(box, without, lower.end, upper.start);
      } else if (isSmallData(all)) {
        bins = smallDataBins(all, without, lower.end, upper.start);
        if (bins.length) box = { lo: bins[0].start!, hi: bins[bins.length - 1].end! };
      } else {
        const allInts = without.d.every(isInt);
        if (allInts) box = { lo: trunc(box.lo), hi: trunc(box.hi) };
        const lo = lower.end ? max(box.lo, lower.end) : box.lo;
        const hi = upper.start ? min(box.hi, upper.start) : box.hi;
        bins = linearBins(allInts, box, without, lo, hi, attributeId);
      }
      // the outlier bars meet the numeric bars: a bound recorded in the data wins over a computed edge
      if (!lower.end) lower.end = bins.length ? bins[0].start : box.lo;
      else if (bins.length) {
        if (cmp(bins[0].start!, lower.end) > 0) lower.end = bins[0].start;
        else bins[0].start = lower.end;
      }
      if (!upper.start) upper.start = bins.length ? bins[bins.length - 1].end : box.hi;
      else if (bins.length) {
        if (cmp(bins[bins.length - 1].end!, upper.start) < 0) upper.start = bins[bins.length - 1].end;
        else bins[bins.length - 1].end = upper.start;
      }
    }
    if (lower.end) lower.count += countIn(all, { end: lower.end, count: 0 });
    if (upper.start) upper.count += countIn(all, { start: upper.start, count: 0 });
  }

  let out: DBin[] = [...(lower.count ? [lower] : []), ...bins, ...(upper.count ? [upper] : [])];
  out = trim(out);
  out = toDistinct(out, all, bounds);
  return [
    ...out.map((b): Bin => ({
      ...(b.special ? { special: b.special as "<=" | ">" } : {}),
      ...(b.start ? { start: b.start.x } : {}), ...(b.end ? { end: b.end.x } : {}), count: b.count })),
    ...[...words.values()].map((w): Bin => ({ value: w.value, count: w.count })),
  ];
}

/** DataBinHelper.calcBoxRange: Tukey's fences from an approximate IQR, clamped to the data */
function boxRange(v: Vals): { lo: Dec; hi: Dec } | null {
  if (!v.d.length) return null;
  const [q1, q3] = iqrApprox(v);
  const iqr15 = mul(sub(q3, q1), ONE_AND_HALF);
  const lowF = sub(q1, iqr15), highF = add(q3, iqr15);
  let lo: Dec, hi: Dec;
  const first = v.d[0], last = v.d[v.d.length - 1];
  if (cmp(first, last) === 0) { lo = first; hi = first; }
  else if (cmp(q3, THOUSANDTH) >= 0 && cmp(q3, ONE) < 0) { hi = setScale(highF, 3, "half_up"); lo = setScale(lowF, 3, "half_up"); }
  else if (cmp(q3, THOUSANDTH) < 0) { hi = highF; lo = lowF; }
  else { hi = setScale(highF, 1, "ceiling"); lo = setScale(lowF, 1, "floor"); }
  if (cmp(lo, first) < 0) lo = first;
  if (cmp(hi, last) > 0) hi = last;
  return { lo, hi };
}
/** calcInterquartileRangeApproximation: the values at 1/4 and 3/4, dropping the maximum while they meet at it */
function iqrApprox(v: Vals): [Dec, Dec] {
  const n = total(v);
  const q1 = at(v, Math.floor(n * 0.25)), q3 = at(v, Math.floor(n * 0.75));
  const top = v.d[v.d.length - 1];
  if (cmp(q1, q3) === 0 && cmp(top, q3) === 0 && v.d.length > 1) {
    const [a, b] = iqrApprox(slice(v, 0, v.d.length - 1));
    if (cmp(a, b) !== 0) return [a, b];
  }
  return [q1, q3];
}
/** DataBinHelper.isSmallData: the median (at index ceil(n/2)) within ±0.001 and not zero */
function isSmallData(v: Vals): boolean {
  const n = total(v), m = at(v, Math.min(n - 1, Math.ceil(n / 2)));
  return m.x < 0.001 && m.x > -0.001 && cmp(m, THOUSANDTH) < 0 && m.x !== 0;
}

const LINEAR = [0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].map(decOf);
const LINEAR_DISCRETE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].map(decOf);
const MAX_INTERVALS = 20;

/** LinearDataBinner: bars of the first width that makes fewer than 20 of them, from a multiple of it */
function linearBins(allInts: boolean, box: { lo: Dec; hi: Dec }, v: Vals, lowerOutlier: Dec, upperOutlier: Dec, attributeId?: string): DBin[] {
  const lo = max(v.d[0], lowerOutlier), hi = min(v.d[v.d.length - 1], upperOutlier);
  const choices = allInts ? LINEAR_DISCRETE : LINEAR;
  let interval = choices[choices.length - 1];
  for (const c of choices) { interval = c; if (sub(hi, lo).x / c.x < MAX_INTERVALS) break; }
  let start = sub(add(lo, interval), rem(lo, interval));
  if (cmp(sub(start, interval), lowerOutlier) > 0) start = sub(start, interval);
  const end = cmp(add(hi, interval), upperOutlier) < 0 ? hi : sub(hi, interval);
  const bins: DBin[] = [];
  for (let d = start; cmp(d, end) <= 0 && bins.length <= 1000; d = add(d, interval)) bins.push({ start: d, end: add(d, interval), count: 0 });
  // an age attribute's first bar starts at 18 when the data reach below it and spread wide
  if (attributeId && /(^AGE$)|(^AGE_.*)|(.*_AGE_.*)|(.*_AGE&)/.test(attributeId) && lo.x < 18 &&
      sub(box.hi, box.lo).x / 2 > 18 && bins.length && cmp(bins[0].end!, EIGHTEEN) > 0)
    bins[0].start = EIGHTEEN;
  for (const b of bins) b.count = countIn(v, b);
  return bins;
}

/** LogScaleDataBinner: edges at ±floor(10^(k/2)) from the box range's order of magnitude */
function logScaleBins(box: { lo: Dec; hi: Dec }, v: Vals, lowerOutlier: Dec | undefined, upperOutlier: Dec | undefined): DBin[] {
  const edges: Dec[] = [];
  let startExp = 0;
  if (box.lo.x !== 0) {
    const absLog = Math.log10(Math.abs(box.lo.x));
    startExp = box.lo.x < 0 ? -Math.ceil(absLog) : Math.floor(absLog);
  }
  const valueAt = (e: number) => decOf(Math.sign(e) * Math.floor(Math.pow(10, Math.abs(e))));
  const addOutlierEdge = (e: number) => {
    const x = valueAt(e);
    if (!upperOutlier || cmp(x, upperOutlier) <= 0) { edges.push(x); return true; }
    return false;
  };
  if (lowerOutlier) edges.push(lowerOutlier);
  for (let e = startExp; e < startExp + 200; e += 0.5) {
    const x = valueAt(e);
    if ((!lowerOutlier || cmp(x, lowerOutlier) > 0) && (!upperOutlier || cmp(x, upperOutlier) <= 0)) edges.push(x);
    if (cmp(x, box.hi) > 0) {
      e += 0.5;
      if (!addOutlierEdge(e) && upperOutlier) edges.push(upperOutlier);
      if (!Number.isInteger(e)) { e += 0.5; addOutlierEdge(e); }
      break;
    }
  }
  return binsFromEdges(edges, v);
}

/** 10^e: exact for an integer e, as Java's Math.pow gives it (JavaScript's is one unit short at 10^-4 and 10^-5) */
const p10 = (e: number): number => Number.isInteger(e) ? Number("1e" + e) : Math.pow(10, e);

/** ScientificSmallDataBinner: values within ±0.001, binned by powers of ten of their exponents */
function smallDataBins(all: Vals, without: Vals, lowerOutlier: Dec | undefined, upperOutlier: Dec | undefined): DBin[] {
  const exps = vals(all.d.map((d, i) => ({ d: int(exponentOf(d)), n: all.n[i] })).filter((e) => e.d.x !== 0));
  const eBox = boxRange(exps);
  const edges: Dec[] = [];
  if (!eBox) {
    edges.push(all.d[0], all.d[all.d.length - 1]);
  } else {
    const lo = trunc(eBox.lo).x, hi = trunc(eBox.hi).x, range = sub(eBox.hi, eBox.lo).x;
    if (range > 1) {
      // at least 1: the portal's own loop would never end on a step that rounds to 0
      const step = Math.max(1, Math.round(range / 4));
      for (let i = lo - step; i <= hi; i += step) edges.push(decOf(p10(i)));
    } else if (range === 1) {
      edges.push(decOf(p10(eBox.lo.x) / 3));
      for (let i = lo; i <= hi + 1; i++) { edges.push(decOf(p10(i))); edges.push(mul(decOf(p10(i)), int(3))); }
    } else {
      const step = decOf(2 * p10(eBox.lo.x));
      for (let d = decOf(p10(lo)); d.x <= p10(eBox.hi.x + 1); d = add(d, step)) edges.push(d);
    }
  }
  const kept = edges.filter((d) => (!lowerOutlier || cmp(d, lowerOutlier) > 0) && (!upperOutlier || cmp(d, upperOutlier) < 0));
  return binsFromEdges(kept, without);
}

/** DataBinHelper.initDataBins: a bar between each pair of consecutive edges, counted */
function binsFromEdges(edges: Dec[], v: Vals): DBin[] {
  const bins: DBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) bins.push({ start: edges[i], end: edges[i + 1], count: 0 });
  for (const b of bins) b.count = countIn(v, b);
  return bins;
}

/** DataBinHelper.trim: drop the empty bars before the first and after the last that hold anything */
function trim(bins: DBin[]): DBin[] {
  let a = 0, b = bins.length;
  while (a < b && !(bins[a].count > 0)) a++;
  while (b > a && !(bins[b - 1].count > 0)) b--;
  return bins.slice(a, b);
}

/**
 * DataBinHelper.convertToDistinctBins: when every numeric bar holds one integer value and no bound
 * recorded as a value, each becomes that value's own bar; otherwise the bars stay as they are.
 */
function toDistinct(bins: DBin[], all: Vals, bounds: Bound[]): DBin[] {
  const encloses = (b: DBin, r: Bound) => r.op === ">"
    ? !b.end && !!b.start && cmp(r.at, b.start) >= 0
    : !b.start && !!b.end && cmp(r.at, b.end) <= 0;
  const conv = bins.map((b) => {
    const [i, j] = within(all, b);
    if (j - i === 1 && isInt(all.d[i]) && !bounds.some((r) => encloses(b, r)))
      return { start: all.d[i], end: all.d[i], count: b.count };
    return b;
  });
  const interior = conv.filter((b) => b.start && b.end);
  return interior.length && interior.every((b) => cmp(b.start!, b.end!) === 0) ? conv : bins;
}
