// The chart files' PDF font handling, the saved pie's room for a fallback font, and the KM figure's
// number-at-risk counts never drawn over one another.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfFonts, standaloneSvg } from "../app/lab/chart-files.ts";
import { pieFigureSvg } from "../lib/study-view-figures.ts";
import { survivalSvg } from "../lib/views/survival/figure.ts";
import { textWidth, FS } from "../lib/svg-kit.ts";
import type { KmCurve } from "../lib/types.ts";
import { PORTAL_STUDY_VIEW_KM, SERIES } from "../lib/chart/style.ts";

test("pdfFonts: the root's children are wrapped in a group naming the embedded font, the root kept", () => {
  const out = pdfFonts('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="0" y="5">a</text></svg>');
  assert.equal(out, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g font-family="IBM Plex Sans"><text x="0" y="5">a</text></g></svg>');
});

test("pdfFonts: bold text is drawn in the embedded regular weight, not a Times fallback", () => {
  const out = pdfFonts('<svg><text font-weight="600">T</text><text font-weight="bold">U</text><text font-size="600">V</text></svg>');
  assert.ok(!/font-weight/.test(out), out);
  assert.match(out, /font-size="600"/);
});

test("pie figure: the legend leaves room for a viewer's wider fallback font", () => {
  const entry = "Breast Invasive Mixed Mucinous Carcinoma: 17 (1.6%)";
  const svg = pieFigureSvg("Cancer Type Detailed", [{ value: "Breast Invasive Mixed Mucinous Carcinoma", count: 17, color: "#111111" }]);
  const width = Number(/width="(\d+)"/.exec(svg)![1]);
  assert.ok(width >= 1.15 * textWidth(entry, FS.body) + 16, "width " + width);
});

test("KM figure: no number-at-risk count is drawn over the one before it", () => {
  const atRisk = Array.from({ length: 280 }, (_, m) => m === 0 ? 1084 : Math.max(3, Math.round(600 * Math.exp(-m / 60))));
  const curve: KmCurve = { cohort: "Selected", points: [{ t: 0, s: 1 } as never, { t: 270, s: 0.3 } as never], median: 129.57, n: 1084, events: 151, atRisk, tLast: 270 };
  const svg = standaloneSvg(survivalSvg({ kind: "survival", curves: [curve] } as never, { width: 480, theme: "light" }));
  const counts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="(\d+)"[^>]*><title>[^<]*at risk at[^<]*<\/title>([^<]+)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), text: m[4], size: Number(m[3]) }));
  assert.ok(counts.length >= 5, "found " + counts.length + " counts");
  assert.equal(counts[0].text, "1,084");
  for (let i = 1; i < counts.length; i++) {
    const prevRight = counts[i - 1].x + textWidth(counts[i - 1].text, counts[i - 1].size);
    assert.ok(counts[i].x >= prevRight + 4, counts[i - 1].text + " ends at " + prevRight + ", " + counts[i].text + " starts at " + counts[i].x);
  }
});

test("pie figure: each share is of every case, NA included, as the chart's", () => {
  const svg = pieFigureSvg("Sex", [{ value: "Female", count: 3, color: "#111111" }, { value: "NA", count: 1, color: "#cccccc" }]);
  assert.match(svg, />Female: 3 \(75\.0%\)</);
  assert.match(svg, />NA: 1 \(25\.0%\)</);
});

test("STS-KM-2: the Study View's curve in the portal's #2986E2, its risk-table key too; other views keep the series colours", () => {
  const atRisk = [10, 8, 6];
  const curve: KmCurve = { cohort: "Selected", points: [{ t: 0, s: 1 } as never, { t: 2, s: 0.5 } as never], median: 2, n: 10, events: 5, atRisk, tLast: 2 };
  const strokes = (svg: string) => [...svg.matchAll(/stroke="(#[0-9A-Fa-f]{6})" stroke-width="2"/g)].map((m) => m[1]);
  const sv = survivalSvg({ kind: "survival", curves: [curve] } as never, { width: 480, theme: "light" }, PORTAL_STUDY_VIEW_KM);
  assert.equal(PORTAL_STUDY_VIEW_KM, "#2986E2");
  assert.ok(strokes(sv).length >= 2 && strokes(sv).every((c) => c === "#2986E2"), "the curve and its risk-table key: " + strokes(sv).join(","));
  const plain = survivalSvg({ kind: "survival", curves: [curve] } as never, { width: 480, theme: "light" });
  assert.ok(strokes(plain).every((c) => c === SERIES[0]));
});

test("survivalSvg plot-only at a height: the figure is that tall, whatever its width", () => {
  const curve: KmCurve = { cohort: "Selected", points: [{ t: 0, s: 1 } as never, { t: 40, s: 0.5 } as never], median: 40, n: 10, events: 5, tLast: 40 };
  const tall = (svg: string) => Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)?.[1]);
  for (const h of [220, 300]) assert.equal(tall(survivalSvg({ kind: "survival", curves: [curve] } as never, { width: 381 }, PORTAL_STUDY_VIEW_KM, true, h)), h);
  // without plotOnly the height is ignored: the full figure keeps its own
  const full = survivalSvg({ kind: "survival", curves: [curve] } as never, { width: 381 }, PORTAL_STUDY_VIEW_KM, false);
  assert.equal(tall(survivalSvg({ kind: "survival", curves: [curve] } as never, { width: 381 }, PORTAL_STUDY_VIEW_KM, false, 220)), tall(full));
});
