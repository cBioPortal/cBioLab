// The Study View grid (STS-LY-1…3), from docs/legacy-spec/30-study-summary.md §1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRID_CELL, cellWidth, chartCells, findSpotLayout, gridCols, kmPlotTitle, orderCards } from "../lib/study-view-layout.ts";

test("LY-1: a 195 × 170 cell, 7 px apart (the portal's 5, and 2 more)", () => {
  assert.deepEqual(GRID_CELL, { w: 195, h: 170, margin: 7 });
  assert.equal(Math.round(cellWidth(1395, 7)), 193);    // 7 columns, 6 gaps of 7, fill 1395
  assert.equal(cellWidth(195, 1), 195);
});

test("LY-1: the columns that fill the width with cells closest to 195 px, never under 175, at least one", () => {
  const cases: [number, number][] = [
    [1395, 7],   // a 1440 px window: 193 px cells (6 would be 226)
    [1555, 8],   // 1600: 188.4 (7 would be 216)
    [1407, 7],   // 195 exactly
    [1205, 6],   // 195 exactly
    [1306, 7],   // 6.5 cells' worth rounds up to 7 at 180.6; ties go up
    [1305, 6],   // just under the half: 6 at 211.7
    [500, 2],    // round gives 2.5→3 at 162, under 175: 2 at 246.5
    [195, 1], [100, 1], [0, 1],
  ];
  for (const [w, cols] of cases) assert.equal(gridCols(w), cols, w + " px");
  for (const w of [400, 700, 1000, 1395, 1900, 2500]) assert.ok(cellWidth(w, gridCols(w)) >= 175 || gridCols(w) === 1, w + " px");
});

test("LY-2: each kind's default size", () => {
  assert.deepEqual(chartCells("pie"), { w: 1, h: 1 });
  assert.deepEqual(chartCells("survival"), { w: 1, h: 1 });
  assert.deepEqual(chartCells("bar"), { w: 2, h: 1 });
  assert.deepEqual(chartCells("table"), { w: 2, h: 2 });
  assert.deepEqual(chartCells("density"), { w: 2, h: 2 });
  assert.deepEqual(chartCells("violin"), { w: 2, h: 2 });
  // Cancer Type Detailed: 3 rows 395 × 170, 6+ rows 395 × 345
  assert.deepEqual(chartCells("list", 3), { w: 2, h: 1 });
  assert.deepEqual(chartCells("list", 4), { w: 2, h: 1 });
  assert.deepEqual(chartCells("list", 5), { w: 2, h: 2 });
});

test("LY-3: by priority, then name; the reader's charts last, as added", () => {
  const cards = [
    { key: "added2", w: 1, h: 1, name: "B" }, { key: "age", w: 2, h: 1, name: "Diagnosis Age", priority: 9 },
    { key: "added1", w: 1, h: 1, name: "A" }, { key: "sex", w: 1, h: 1, name: "Sex", priority: 9 },
    { key: "ct", w: 2, h: 2, name: "Cancer Type", priority: 3000 },
  ];
  assert.deepEqual(orderCards(cards).map((c) => c.key), ["ct", "age", "sex", "added2", "added1"]);
});

test("LY-3: each card in the first free spot, rows top-down then left-right", () => {
  const layout = findSpotLayout([
    { key: "a", w: 2, h: 2 }, { key: "b", w: 2, h: 1 }, { key: "c", w: 1, h: 1 }, { key: "d", w: 2, h: 2 }, { key: "e", w: 1, h: 1 },
  ], 5);
  assert.deepEqual(layout, [
    { i: "a", x: 0, y: 0, w: 2, h: 2 },
    { i: "b", x: 2, y: 0, w: 2, h: 1 },
    { i: "c", x: 4, y: 0, w: 1, h: 1 },
    { i: "d", x: 2, y: 1, w: 2, h: 2 },   // the first row with room for 2 × 2
    { i: "e", x: 4, y: 1, w: 1, h: 1 },   // back-fills the hole beside it
  ]);
});

test("LY-3: a card wider than the grid is narrowed to it", () => {
  assert.deepEqual(findSpotLayout([{ key: "t", w: 2, h: 2 }, { key: "p", w: 1, h: 1 }], 1),
    [{ i: "t", x: 0, y: 0, w: 1, h: 2 }, { i: "p", x: 0, y: 2, w: 1, h: 1 }]);
});

test("KM-1: a survival chart's title from its status attribute's name", () => {
  assert.equal(kmPlotTitle("Overall Survival Status"), "KM Plot: Overall (months)");
  assert.equal(kmPlotTitle("Disease Free Status"), "KM Plot: Disease Free (months)");
  assert.equal(kmPlotTitle("Disease-specific Survival status"), "KM Plot: Disease-specific (months)");
  assert.equal(kmPlotTitle("Progression Free Status"), "KM Plot: Progression Free (months)");
});
