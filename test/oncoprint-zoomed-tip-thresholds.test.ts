// A generic-assay heatmap's tip over several columns when some cells are threshold categories
// (">90.00"), as the portal's makeHeatmapTrackTooltip writes it
// (cbioportal-frontend src/shared/components/oncoprint/TooltipUtils.ts, cd8c6df).
import { test } from "node:test";
import assert from "node:assert/strict";
import { zoomedTip, type TipTrack } from "../app/_oncoprint/zoomed-tip.ts";

const T = [">90.00", "<1.00"];
/** a heatmap track from [code, value] pairs: code ≥0 value, −1 not profiled, −2 no value, −3−k category k */
function track(cells: [number, number][], thresholds?: string[]): TipTrack {
  return {
    label: "IC50", kind: "heatmap", numeric: true, ...(thresholds ? { thresholds } : {}),
    cells: Int32Array.from(cells.map((c) => c[0])), values: Float64Array.from(cells.map((c) => c[1])),
  } as TipTrack;
}
const all = (n: number) => [...Array(n).keys()];

// 341-358: a datum with a category goes to profileCategories, not the sum; 360-369 mean of the rest;
// 383-392: value text, " and ", category text
test("values plus one category: the mean of the values only, and the category", () => {
  assert.deepEqual(zoomedTip(track([[0, 10], [0, 20], [-3, 90]], T), all(3)),
    ["IC50: 15.00 (average of 2 values) and >90.00"]);
});

// 371-372 a lone category; 383 the N/A value text is dropped when there are categories
test("one category alone: just the category", () => {
  assert.deepEqual(zoomedTip(track([[-3, 90]], T), [0]), ["IC50: >90.00"]);
});

// 376-380: several categories → uniq joined ", " with the count of data points; no value text (383)
test("several categories: the unique ones and the data-point count", () => {
  assert.deepEqual(zoomedTip(track([[-3, 90], [-3, 90], [-4, 1]], T), all(3)),
    ["IC50: >90.00, <1.00 (3 data points)"]);
});

// 361-364 one value, no "average of"; 376-380 two categories even with a value
test("one value plus two of the same category", () => {
  assert.deepEqual(zoomedTip(track([[0, 10], [-3, 90], [-3, 90]], T), all(3)),
    ["IC50: 10.00 and >90.00 (2 data points)"]);
});

// 383-385: no categories → the value text alone, N/A when there is none
test("no categories: unchanged — mean, average of n, N/A", () => {
  assert.deepEqual(zoomedTip(track([[0, 10]], T), [0]), ["IC50: 10.00"]);
  assert.deepEqual(zoomedTip(track([[0, 10], [0, 21]], T), all(2)), ["IC50: 15.50 (average of 2 values)"]);
  assert.deepEqual(zoomedTip(track([[-2, NaN], [-1, NaN]], T), all(2)), ["IC50: N/A"]);
  assert.deepEqual(zoomedTip(track([[0, 10], [0, 21]]), all(2)), ["IC50: 15.50 (average of 2 values)"]);
});

// 342-345: a datum without profile_data (not profiled, or no value) counts for nothing
test("−2 and −1 cells are ignored alongside values and categories", () => {
  assert.deepEqual(zoomedTip(track([[0, 10], [-2, NaN], [-1, NaN], [-3, 90]], T), all(4)),
    ["IC50: 10.00 and >90.00"]);
  assert.deepEqual(zoomedTip(track([[-2, NaN], [-3, 90], [-1, NaN]], T), all(3)), ["IC50: >90.00"]);
});
