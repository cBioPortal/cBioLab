// The shared volcano's label placer (lib/views/enrichment/figure.ts): measured boxes, inside the plot,
// never on another label or a labelled point, and every label it cannot place reported.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unplacedNote, volcano } from "../lib/figures/volcano.ts";
import { placeLabels, crosses, type Box } from "../lib/chart/place.ts";
import { palette } from "../lib/svg-kit.ts";

const bounds: Box = { x: 0, y: 0, w: 300, h: 200 };
const want = (text: string, px: number, py: number, w = 40) => ({ text, px, py, w, h: 12 });
const inside = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 300 && b.y + b.h <= 200;
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("placeLabels", () => {
  test("a lone label sits right beside its point, with no leader", () => {
    const { placed, unplaced } = placeLabels([want("TP53", 100, 100)], bounds, [], 3);
    assert.deepEqual(unplaced, []);
    assert.equal(placed[0].leader, null);
    assert.ok(placed[0].box.x > 100 && placed[0].box.x < 110, "to the right of the point");
  });
  test("labels stay inside the plot: a point at the right edge is labelled on its left", () => {
    const { placed } = placeLabels([want("EDGE", 298, 100)], bounds, [], 3);
    assert.ok(inside(placed[0].box) && placed[0].box.x + placed[0].box.w < 298);
  });
  test("a crowd of points at one spot: no two labels overlap, none covers a labelled point", () => {
    const wants = Array.from({ length: 30 }, (_, i) => want("G" + i, 150 + (i % 3), 100 + (i % 2), 30));
    const { placed, unplaced } = placeLabels(wants, bounds, [], 3);
    assert.equal(placed.length + unplaced.length, 30, "every label is placed or reported");
    for (let i = 0; i < placed.length; i++) {
      assert.ok(inside(placed[i].box));
      for (let j = i + 1; j < placed.length; j++) assert.ok(!overlap(placed[i].box, placed[j].box), placed[i].text + " overlaps " + placed[j].text);
      for (const w of wants) assert.ok(!(w.px > placed[i].box.x && w.px < placed[i].box.x + placed[i].box.w && w.py > placed[i].box.y && w.py < placed[i].box.y + placed[i].box.h));
    }
    assert.ok(placed.some((q) => q.leader), "labels moved away are joined to their point");
    for (const q of placed) if (q.leader) for (const o of placed) if (o !== q) assert.ok(!crosses(q.leader, o.box), "a leader never crosses another label");
  });
  test("a plot too small for the label reports it rather than drawing it", () => {
    const { placed, unplaced } = placeLabels([want("A-VERY-LONG-GENE-NAME", 10, 10, 400)], bounds, [], 3);
    assert.deepEqual(placed, []);
    assert.deepEqual(unplaced, ["A-VERY-LONG-GENE-NAME"]);
  });
  test("prefers a spot over empty space to one over unlabelled points", () => {
    const dots = Array.from({ length: 20 }, (_, i) => ({ x: 106 + i * 2, y: 100 }));
    const { placed } = placeLabels([want("X", 100, 100)], bounds, dots, 3);
    assert.ok(placed[0].box.x + placed[0].box.w <= 100, "goes left, away from the dots on its right");
  });
});

describe("crosses", () => {
  test("a segment through a box crosses it; one beside it does not", () => {
    const b = { x: 10, y: 10, w: 10, h: 10 };
    assert.ok(crosses({ x1: 0, y1: 15, x2: 30, y2: 15 }, b));
    assert.ok(!crosses({ x1: 0, y1: 25, x2: 30, y2: 25 }, b));
    assert.ok(!crosses({ x1: 0, y1: 0, x2: 5, y2: 5 }, b));
  });
});

describe("volcano", () => {
  test("names what it could not label, in its own caption", () => {
    assert.equal(unplacedNote([], 5, "genes"), "");
    assert.match(unplacedNote(["A", "B"], 25, "genes"), /^2 of 25 genes .* left unlabelled: A, B\.$/);
    const p = palette("light");
    const pts = Array.from({ length: 12 }, (_, i) => ({ key: "GENE" + i, x: 1, p: 1e-10, color: "#000" }));
    const v = volcano(p, { x0: 0, y0: 0, width: 160, plotH: 60, grid: { xMax: 2, yMax: 12, nx: 10, ny: 10, cells: [] }, pts, labels: pts.map((x) => x.key), xTitle: "x" });
    assert.ok(v.unplaced.length > 0);
    assert.ok(v.svg.includes(v.unplaced.length + " of 12 genes"));
  });
});
