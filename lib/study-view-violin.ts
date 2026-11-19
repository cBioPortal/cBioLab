// The Study View's clinical violin table (STS-VI-1…7): a categorical attribute against a numeric one,
// a row per category with its count, quartiles, box and mirrored curve. The numbers are the portal's
// (cBioPortal's ViolinPlotServiceImpl): quartiles by Apache Commons' Percentile, outliers past
// 3 × IQR left out of the curve and drawn as points, the curve a sum of Gaussians over 100 points
// with sigma 4 steps wide. Computed here from each category's value counts, so the server sends
// values with how many cases hold each, never ids. No server imports: the page and the tests read
// the same rules.
import { portalFixedTrim } from "./chart/format.ts";

/** a violin table's two attributes */
export interface ViolinPair { categorical: string; numeric: string }
/** the one chart a pair of attributes has, whichever way round, as the X vs Y tab's density pairs are keyed */
export const violinPairKey = (p: ViolinPair): string => [p.categorical, p.numeric].sort().join("|");
/** Remove chart on a violin table, as the portal's: the pair goes, with the filters on both its attributes (`clear`) */
export function violinChartRemoval(pairs: ViolinPair[], pair: ViolinPair): { pairs: ViolinPair[]; clear: string[] } {
  return { pairs: pairs.filter((p) => violinPairKey(p) !== violinPairKey(pair)), clear: [pair.categorical, pair.numeric].sort() };
}
/** the most violin tables shown at once */
export const VIOLIN_CHART_LIMIT = 6;

/** one value of the numeric attribute in a category: how many cases hold it, and how many of those the selection keeps */
export interface ViolinValue { v: number; n: number; sel: number }
/** a category's values, as the server counts them */
export interface ViolinCategory { category: string; values: ViolinValue[] }

export interface ViolinBox { q1: number; median: number; q3: number; whiskerLower: number; whiskerUpper: number }
export interface ViolinRow {
  category: string;
  /** the selected cases in the category: the # column, and what Hide # < compares */
  n: number;
  box: ViolinBox;
  /** the curve's height at each of CURVE_POINTS points across the axis; empty when the row is drawn as points */
  curve: number[];
  /** values drawn as dots: every one when a row has too few for a curve, else its far outliers */
  points: number[];
}
export interface ViolinTable { axis: [number, number]; rows: ViolinRow[] }

/** the portal's numCurvePoints and sigmaMultiplier */
export const CURVE_POINTS = 100;
export const SIGMA_STEPS = 4;
/** a row of this many values or fewer is drawn as its points, with no curve or box */
export const POINTS_ONLY_MAX = 7;
/** the footer's "Hide # <" default */
export const VIOLIN_MIN_N = 10;

/** the portal's log scale for a mutation count: ln(1 + v) */
export const violinLog = (v: number): number => Math.log(1 + v);

/**
 * Apache Commons Math's Percentile (its default, R-6): the value at position p(n + 1) of the n
 * sorted values, interpolated between neighbours, clamped to the first and last. `sorted` holds
 * each value once with its count.
 */
export function percentile(sorted: { v: number; n: number }[], p: number): number {
  const total = sorted.reduce((a, x) => a + x.n, 0);
  if (!total) return NaN;
  const at = (k: number): number => {   // the k-th value, 1-based
    let seen = 0;
    for (const x of sorted) { seen += x.n; if (seen >= k) return x.v; }
    return sorted[sorted.length - 1].v;
  };
  const pos = p * (total + 1);
  if (pos < 1) return at(1);
  if (pos >= total) return at(total);
  const lo = Math.floor(pos), d = pos - lo, a = at(lo);
  return a + d * (at(lo + 1) - a);
}

const gaussian = (x: number, mean: number, sigma: number) => Math.exp(-((x - mean) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));

/**
 * The table's numbers from each category's value counts. The box and curve are over every case
 * counted (the selection without the numeric attribute's own filter, as the portal draws them);
 * # is the cases the whole selection keeps. `log` takes ln(1 + v) first.
 */
export function violinTable(categories: ViolinCategory[], log: boolean): ViolinTable {
  let axisStart = Infinity, axisEnd = -Infinity;
  const prepared = categories.map((c) => {
    const merged = new Map<number, { v: number; n: number; sel: number }>();
    for (const x of c.values) {
      const v = log ? violinLog(x.v) : x.v, was = merged.get(v);
      if (was) { was.n += x.n; was.sel += x.sel; } else merged.set(v, { v, n: x.n, sel: x.sel });
    }
    const values = [...merged.values()].filter((x) => x.n > 0 && Number.isFinite(x.v)).sort((a, b) => a.v - b.v);
    return { category: c.category, values };
  }).filter((c) => c.values.length);
  const boxes = prepared.map(({ category, values }) => {
    const q1 = percentile(values, 0.25), q3 = percentile(values, 0.75), iqr = q3 - q1;
    const min = values[0].v, max = values[values.length - 1].v;
    const suspectLo = q1 - 1.5 * iqr, suspectHi = q3 + 1.5 * iqr, farLo = q1 - 3 * iqr, farHi = q3 + 3 * iqr;
    const suspected = values.some((x) => x.v <= suspectLo || x.v >= suspectHi);
    axisStart = Math.min(axisStart, min); axisEnd = Math.max(axisEnd, max);
    const outlier = (v: number) => (v <= suspectLo && v <= farLo) || (v >= suspectHi && v >= farHi);
    return { category, values, outlier,
      box: { q1, median: percentile(values, 0.5), q3, whiskerLower: suspected ? suspectLo : min, whiskerUpper: suspected ? suspectHi : max } };
  });
  if (!boxes.length) return { axis: [0, 0], rows: [] };
  const step = (axisEnd - axisStart) / (CURVE_POINTS - 1), sigma = SIGMA_STEPS * step;
  const rows = boxes.map(({ category, values, outlier, box }) => {
    const count = values.reduce((a, x) => a + x.n, 0);
    const expand = (xs: typeof values) => xs.flatMap((x) => Array.from({ length: x.n }, () => x.v));
    const few = count <= POINTS_ONLY_MAX;
    // a single value everywhere leaves no width to spread over: the box alone
    const curve = few || !(sigma > 0) ? [] : Array.from({ length: CURVE_POINTS }, (_, i) => {
      const p = axisStart + i * step;
      return values.reduce((a, x) => (outlier(x.v) ? a : a + x.n * gaussian(p, x.v, sigma)), 0);
    });
    return {
      category, n: values.reduce((a, x) => a + x.sel, 0),
      // the portal's limitWhiskers: kept on the axis
      box: { ...box, whiskerLower: Math.max(box.whiskerLower, axisStart), whiskerUpper: Math.min(box.whiskerUpper, axisEnd) },
      curve,
      points: few ? expand(values) : expand(values.filter((x) => outlier(x.v))),
    };
  });
  return { axis: [axisStart, axisEnd], rows };
}

/** the rows shown: # at least `minN`, most first, then by category (STS-VI-2, STS-VI-3) */
export function violinRows(rows: ViolinRow[], minN: number): ViolinRow[] {
  return rows.filter((r) => r.n >= minN).sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
}

/** a quartile as the table writes it: at most two decimals, no trailing zeros (the portal's toFixedWithoutTrailingZeros) */
export const violinNumber = (x: number): string => portalFixedTrim(x, 2);

/** the title, "<numeric>[ (log)] vs <categorical>" (STS-VI-1) */
export const violinTitle = (numeric: string, categorical: string, log: boolean): string => numeric + (log ? " (log)" : "") + " vs " + categorical;

/** the svg's height, and the space left above and below the curve, as the portal's */
export const VIOLIN_HEIGHT = 30;
const Y_PAD = 3;

/**
 * One row's curve as two mirrored halves over `width`: each row scaled by min(1, half height / its
 * own peak), so a small row is never drawn larger than its density (STS-VI-4).
 */
export function violinPath(curve: number[], width: number): string {
  if (curve.length < 2) return "";
  const center = VIOLIN_HEIGHT / 2, limit = (VIOLIN_HEIGHT - 2 * Y_PAD) / 2;
  const peak = Math.max(...curve), scale = peak > 0 ? Math.min(1, limit / peak) : 0;
  const step = width / (curve.length - 1), r = (x: number) => Math.round(x * 100) / 100;
  const half = (sign: number) => "M 0 " + center + " " + curve.map((y, i) => "L " + r(i * step) + " " + r(center + sign * scale * y)).join(" ") +
    " L " + r(width) + " " + center + " Z";
  return half(-1) + " " + half(1);
}

/** a value's place across the violin column: the axis mapped onto [pad, pad + width] */
export const violinX = (v: number, axis: [number, number], width: number, pad = 5): number =>
  pad + (axis[1] > axis[0] ? ((v - axis[0]) * width) / (axis[1] - axis[0]) : width / 2);
