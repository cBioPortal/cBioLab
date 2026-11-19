// Written from the legacy violin table, one case per branch: the server's
// ViolinPlotServiceImpl.getClinicalViolinPlotData (quartiles by Apache Commons Percentile,
// suspected outliers past 1.5 × IQR moving the whiskers to the fences, outliers past 3 × IQR left
// out of the curve and drawn as points, rows of ≤ 7 values drawn as points alone, the curve a sum of
// Gaussians at 100 points with sigma 4 steps, limitWhiskers) and the frontend's
// StudyViewViolinPlotTable (Hide # <, # descending, toFixedWithoutTrailingZeros) and
// StudyViewViolinPlot (scale min(1, 12 / the row's peak)). Reference quartiles are the portal's own
// /api/clinical-data-violin-plots/fetch answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  percentile, violinChartRemoval, violinTable, violinRows, violinNumber, violinTitle, violinPath, violinLog, CURVE_POINTS, VIOLIN_MIN_N, type ViolinCategory
} from "../lib/study-view-violin.ts";
import { portalFixedTrim } from "../lib/chart/format.ts";

const vals = (xs: number[], sel = true) => xs.map((v) => ({ v, n: 1, sel: sel ? 1 : 0 }));

test("percentile: Apache Commons' default, position p(n + 1), interpolated, clamped at the ends", () => {
  const s = [1, 2, 3, 4].map((v) => ({ v, n: 1 }));
  assert.equal(percentile(s, 0.25), 1.25);
  assert.equal(percentile(s, 0.5), 2.5);
  assert.equal(percentile(s, 0.75), 3.75);
  assert.equal(percentile([{ v: 5, n: 1 }, { v: 9, n: 1 }], 0.25), 5, "below position 1: the first value");
  assert.equal(percentile([{ v: 5, n: 1 }, { v: 9, n: 1 }], 0.75), 9, "at or past n: the last value");
  // counts stand for repeated values
  assert.equal(percentile([{ v: 1, n: 2 }, { v: 4, n: 2 }], 0.5), 2.5);
  assert.ok(Number.isNaN(percentile([], 0.5)));
});

test("percentile reproduces the portal's coadread quartiles (58.25 / 69 / 77 for 376 ages)", () => {
  // the exclusive method's position: q1 at 0.25 × 377 = 94.25 of the sorted values
  const s = [{ v: 58, n: 94 }, { v: 59, n: 282 }];
  assert.equal(percentile(s, 0.25), 58.25);
});

test("whiskers: the data's ends when no value lies past a 1.5 × IQR fence", () => {
  const t = violinTable([{ category: "A", values: vals([10, 11, 12, 13, 14, 15, 16, 17]) }], false);
  const b = t.rows[0].box;
  assert.equal(b.whiskerLower, 10);
  assert.equal(b.whiskerUpper, 17);
  assert.deepEqual(t.axis, [10, 17]);
});

test("whiskers: the fences when any value is a suspected outlier, kept on the axis (limitWhiskers)", () => {
  // q1 = 11.25, q3 = 15.75 over 1..9 plus 30: IQR 4.5, upper fence 22.5 → 30 is suspected
  const xs = [10, 11, 12, 13, 14, 15, 16, 17, 30];
  const t = violinTable([{ category: "A", values: vals(xs) }], false);
  const s = xs.map((v) => ({ v, n: 1 }));
  const q1 = percentile(s, 0.25), q3 = percentile(s, 0.75), iqr = q3 - q1;
  assert.equal(t.rows[0].box.whiskerUpper, q3 + 1.5 * iqr);
  // the lower fence lies below the axis start, so it is clamped there
  assert.equal(t.rows[0].box.whiskerLower, Math.max(q1 - 1.5 * iqr, 10));
});

test("outliers past 3 × IQR are points and left out of the curve; nearer suspected ones stay in it", () => {
  const xs = [10, 11, 12, 13, 14, 15, 16, 17, 100];
  const t = violinTable([{ category: "A", values: vals(xs) }], false);
  assert.deepEqual(t.rows[0].points, [100]);
  assert.equal(t.rows[0].curve.length, CURVE_POINTS);
  // nothing of the outlier's Gaussian at its own end of the axis
  assert.ok(t.rows[0].curve[CURVE_POINTS - 1] < 1e-6);
});

test("a row of seven values or fewer is drawn as its points, with no curve", () => {
  const t = violinTable([{ category: "few", values: vals([1, 2, 3, 4, 5, 6, 7]) }, { category: "many", values: vals([1, 2, 3, 4, 5, 6, 7, 8]) }], false);
  const few = t.rows.find((r) => r.category === "few")!, many = t.rows.find((r) => r.category === "many")!;
  assert.deepEqual(few.curve, []);
  assert.deepEqual(few.points, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(many.curve.length, CURVE_POINTS);
  assert.deepEqual(many.points, []);
});

test("the curve: Gaussians of sigma 4 steps summed at 100 points across the shared axis", () => {
  const t = violinTable([{ category: "A", values: vals([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) }, { category: "B", values: vals([99]) }], false);
  assert.deepEqual(t.axis, [0, 99]);
  // the axis is 0…99 over 100 points: a step of 1
  const step = 1, sigma = 4 * step;
  const at = (p: number) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((a, v) => a + Math.exp(-((p - v) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI)), 0);
  const curve = t.rows.find((r) => r.category === "A")!.curve;
  assert.ok(Math.abs(curve[0] - at(0)) < 1e-12);
  assert.ok(Math.abs(curve[5] - at(5)) < 1e-12);
});

test("# counts the cases the whole selection keeps; the box is over every case counted", () => {
  const values = [...vals([1, 2, 3, 4], true), ...vals([5, 6, 7, 8], false)];
  const r = violinTable([{ category: "A", values }], false).rows[0];
  assert.equal(r.n, 4);
  assert.equal(r.box.median, 4.5);
});

test("Log Scale takes ln(1 + v) before every number", () => {
  const xs = [0, 1, 3, 7, 15, 31, 63, 127, 255];
  const t = violinTable([{ category: "A", values: vals(xs) }], true);
  assert.equal(t.rows[0].box.median, violinLog(15));
  assert.deepEqual(t.axis, [0, violinLog(255)]);
});

test("a category without a numeric value is not a row", () => {
  const cats: ViolinCategory[] = [{ category: "A", values: vals([1, 2]) }, { category: "B", values: [] }];
  assert.deepEqual(violinTable(cats, false).rows.map((r) => r.category), ["A"]);
  assert.deepEqual(violinTable([], false), { axis: [0, 0], rows: [] });
});

test("rows: Hide # < 10 by default, # descending, then by category", () => {
  const rows = [{ category: "b", n: 20 }, { category: "a", n: 20 }, { category: "c", n: 9 }, { category: "d", n: 50 }]
    .map((r) => ({ ...r, box: { q1: 0, median: 0, q3: 0, whiskerLower: 0, whiskerUpper: 0 }, curve: [], points: [] }));
  assert.equal(VIOLIN_MIN_N, 10);
  assert.deepEqual(violinRows(rows, VIOLIN_MIN_N).map((r) => r.category), ["d", "a", "b"]);
  assert.deepEqual(violinRows(rows, 0).map((r) => r.category), ["d", "a", "b", "c"]);
});

test("numbers: at most two decimals without trailing zeros", () => {
  for (const [x, s] of [[58.25, "58.25"], [69, "69"], [52.5, "52.5"], [1.006, "1.01"], [2.10, "2.1"]] as const) {
    assert.equal(violinNumber(x), s);
    assert.equal(portalFixedTrim(x, 2), s);
  }
});

test("title: <numeric>[ (log)] vs <categorical>", () => {
  assert.equal(violinTitle("Diagnosis Age", "Sex", false), "Diagnosis Age vs Sex");
  assert.equal(violinTitle("Mutation Count", "Sex", true), "Mutation Count (log) vs Sex");
});

test("the drawn curve: mirrored halves, scaled down to the half height and never up", () => {
  const tall = violinPath([0, 24, 0], 100), low = violinPath([0, 6, 0], 100);
  // half height is (30 − 2 × 3) / 2 = 12 around the centre 15: a peak of 24 is halved, a peak of 6 kept
  assert.match(tall, /L 50 3 /);
  assert.match(tall, /L 50 27 /);
  assert.match(low, /L 50 9 /);
  assert.match(low, /L 50 21 /);
  assert.equal(violinPath([], 100), "");
});

// Remove chart, as the portal's (and as #462's density charts): the table goes with its filters on both attributes
test("Remove chart on a violin table: the pair goes, whichever way round, and both attributes' filters are cleared", () => {
  const a = { categorical: "SEX", numeric: "AGE" }, b = { categorical: "CANCER_TYPE", numeric: "AGE" };
  const r = violinChartRemoval([a, b], { categorical: "SEX", numeric: "AGE" });
  assert.deepEqual(r.pairs, [b]);
  assert.deepEqual(r.clear, ["AGE", "SEX"]);
});
