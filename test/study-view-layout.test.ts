// The Study View grid (STS-LY-1…3), from docs/legacy-spec/30-study-summary.md §1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRID_CELL, chartCells, findSpotLayout, gridCols, gridWidth, kmPlotTitle, orderCards } from "../lib/study-view-layout.ts";

test("LY-1: a 195 × 170 cell, 7 px apart (the portal's 5, and 2 more); the grid cols·195 + (cols+1)·7 wide", () => {
  assert.deepEqual(GRID_CELL, { w: 195, h: 170, margin: 7 });
  assert.equal(gridWidth(6), 1219);
  assert.equal(gridWidth(1), 209);
});

test("LY-1: floor((window − 40) / 202) columns, at least one", () => {
  assert.equal(gridCols(1280), 6);
  assert.equal(gridCols(1440), 6);
  assert.equal(gridCols(1454), 7);
  assert.equal(gridCols(1920), 9);
  assert.equal(gridCols(1251), 5);
  assert.equal(gridCols(1252), 6);
  assert.equal(gridCols(200), 1);
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
