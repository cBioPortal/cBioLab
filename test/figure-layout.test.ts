// The figure lint (lib/chart/lint.ts): type too small, text off the figure, text over text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintSvg, textBoxes } from "../lib/chart/lint.ts";
import { frame, palette, label, legend, axisBottom, linear } from "../lib/svg-kit.ts";

const p = palette("light");
const fig = (w: number, h: number, body: string) => frame(w, h, body, p.bg);

test("a clean figure has nothing to report", () => {
  const s = linear(0, 100, 40, 560);
  const svg = fig(600, 80, axisBottom(s, 30, p, { title: "Months", minX: 0, maxX: 600 }) + label(8, 70, "a caption", { size: 10, fill: p.muted }));
  assert.deepEqual(lintSvg(svg), []);
});

test("type below the floor is reported", () => {
  const issues = lintSvg(fig(200, 40, `<text x="10" y="20" font-size="7" fill="#000">tiny</text>`));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "small");
});

test("a label past the right edge, or turned off the left, is reported", () => {
  const right = lintSvg(fig(200, 40, `<text x="150" y="20" font-size="11" fill="#000">Non-Small Cell Lung Cancer</text>`));
  assert.ok(right.some((i) => i.kind === "outside"));
  const turned = lintSvg(fig(200, 200, `<text x="10" y="50" font-size="10" fill="#000" text-anchor="end" transform="rotate(-45 10 50)">a long turned label</text>`));
  assert.ok(turned.some((i) => i.kind === "outside"));
  const end = lintSvg(fig(200, 40, `<text x="195" y="20" font-size="11" fill="#000" text-anchor="end">fits</text>`));
  assert.deepEqual(end, []);
});

test("two labels printed over each other are reported, neighbours are not", () => {
  const over = lintSvg(fig(300, 40, `<text x="10" y="20" font-size="11" fill="#000">30%</text><text x="22" y="20" font-size="11" fill="#000">2%</text>`));
  assert.equal(over.filter((i) => i.kind === "overlap").length, 1);
  const apart = lintSvg(fig(300, 40, `<text x="10" y="20" font-size="11" fill="#000">30%</text><text x="40" y="20" font-size="11" fill="#000">2%</text>`));
  assert.deepEqual(apart, []);
  const stacked = lintSvg(fig(300, 60, `<text x="10" y="20" font-size="11" fill="#000">30%</text><text x="10" y="34" font-size="11" fill="#000">2%</text>`));
  assert.deepEqual(stacked, []);
});

test("translated groups and tooltips are read as drawn", () => {
  const svg = fig(300, 60, `<g transform="translate(250,0)"><text x="10" y="20" font-size="11" fill="#000">wide label here</text></g>` +
    `<rect><title>a tooltip far longer than the figure is wide, which is never drawn</title></rect>`);
  const { boxes } = textBoxes(svg);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0].x0 >= 259);
  assert.ok(lintSvg(svg).some((i) => i.kind === "outside" && i.text === "wide label here"));
});

test("a legend of fifteen long entries wraps inside its figure without overprinting", () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ label: "Gastrointestinal Neuroendocrine Tumor " + i, color: "#0072B2", detail: "median 48.1 mo · n = 186" }));
  for (const W of [360, 720, 1200]) {
    const lg = legend(items, 8, 0, W - 16, p, { grid: true });
    assert.deepEqual(lintSvg(fig(W, lg.height + 4, lg.svg)), [], "at " + W);
  }
});
