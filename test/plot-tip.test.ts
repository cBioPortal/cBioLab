// A plot's hover: every drawn point is tagged with its case and drawn one size, and the tip says
// what the portal's Plots tab says — the case, its value on each axis (a log axis in its own units),
// its colour and ring, and the layers it is in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plotSvg, PLOT_POINT_R } from "../lib/views/plot/figure.ts";
import { pointTip } from "../lib/views/plot/point-tip.ts";
import type { PlotData } from "../lib/plot.ts";

const scatter: PlotData = {
  shape: "scatter", n: 3, x: { label: "log10(TMB + 1)", kind: "num", log: true }, y: { label: "FGA", kind: "num" },
  extent: { x0: 0, x1: 2, y0: 0, y1: 1 }, grid: [10, 10], bins: [{ bx: 0, by: 0, n: 3 }],
  xyPoints: [{ id: "S1", x: 1, y: 0.123 }, { id: "S2", x: 2, y: 0.5 }, { id: "S3", x: 0, y: 0 }],
  pointSet: { rule: "all", drawn: 3 },
  layers: [{ kind: "cohort", label: "Altered", color: "#D55E00", n: 1, shown: "points", points: [{ id: "S2", x: 2, y: 0.5 }] }],
};
const box: PlotData = {
  shape: "box", n: 2, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "TMB", kind: "num" },
  groups: [{ g: "Breast", n: 2, lo: 0, hi: 10, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }],
  points: [{ id: "S1", g: "Breast", v: 3.456, c: "Mutated" }, { id: "S2", g: "Breast", v: 9, c: "" }],
  overlay: "points", colorLabel: "KRAS", legend: [{ label: "Mutated", color: "#000" }],
  layers: [{ kind: "outliers", label: "outliers", color: "#0072B2", n: 1, shown: "points", points: [{ id: "S2", g: "Breast", v: 9 }] }],
};
const svgOf = (d: PlotData) => plotSvg({ kind: "plot", plot: d } as never, { width: 800 });

test("every point carries its case, and the plotted cohort's dots are the size of a layer's", () => {
  for (const d of [scatter, box]) {
    // a layer's ring round a coloured case (fill="none") is drawn outside the dot on purpose
    const circles = (svgOf(d).match(/<circle[^>]*data-id="[^"]*"[^>]*>/g) || []).filter((c) => !c.includes('fill="none"'));
    assert.ok(circles.length >= 2, "points drawn");
    for (const c of circles) {
      assert.match(c, new RegExp(`r="${PLOT_POINT_R}"`));
      assert.match(c, /stroke-width="0\.6"/, "same outline on every unringed dot: " + c);
    }
  }
});

test("a scatter point's tip: case, both axes, a log axis in its own units, its layers", () => {
  assert.deepEqual(pointTip(scatter, "S1", "base"), { id: "S1", rows: [["TMB (log scale)", "9"], ["FGA", "0.12"]], layers: [] });
  assert.deepEqual(pointTip(scatter, "S2", "0")?.layers, ["Altered"]);
  assert.equal(pointTip(scatter, "nobody", "base"), null);
});

test("a box point's tip: category and value on their own axes, colour from the plotted cohort's point", () => {
  assert.deepEqual(pointTip(box, "S1", "base"), { id: "S1", rows: [["CANCER_TYPE", "Breast"], ["TMB", "3.46"], ["KRAS", "Mutated"]], layers: [] });
  assert.deepEqual(pointTip(box, "S2", "0"), { id: "S2", rows: [["CANCER_TYPE", "Breast"], ["TMB", "9"], ["KRAS", "no value"]], layers: ["outliers"] });
  const flipped: PlotData = { ...box, x: box.y, y: box.x };
  assert.deepEqual(pointTip(flipped, "S1", "base")?.rows.slice(0, 2), [["TMB", "3.46"], ["CANCER_TYPE", "Breast"]]);
});
