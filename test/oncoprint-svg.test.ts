// The server SVG of the fixture is pinned. A change to lib/oncoprint-style.ts or the renderer
// shows up here as a diff to review; set UPDATE_GOLDEN=1 to accept it.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assembleContract } from "../lib/oncoprint-assemble.ts";
import { localInput, parseTsv } from "../lib/oncoprint-local.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { clinicalColor } from "../lib/oncoprint-style.ts";
import type { Contract } from "../lib/types.ts";

const FIX = "test/fixtures/oncoprint/";
const fixture = () => assembleContract(localInput({
  events: parseTsv(readFileSync(FIX + "events.tsv", "utf8")), clinical: parseTsv(readFileSync(FIX + "clinical.tsv", "utf8")),
  coverage: parseTsv(readFileSync(FIX + "coverage.tsv", "utf8")), groupBy: "CANCER_TYPE", sort: "STAGE" }));

test("golden SVG of the fixture", () => {
  const svg = contractToSvg(fixture(), 800);
  const golden = FIX + "golden.svg";
  if (process.env.UPDATE_GOLDEN || !existsSync(golden)) writeFileSync(golden, svg);
  assert.equal(svg, readFileSync(golden, "utf8"), "SVG differs from " + golden + " — review, then UPDATE_GOLDEN=1 npm test to accept");
});

test("the SVG is level-of-detail too: a 60k-column contract draws ~one rect per pixel per track", () => {
  const c = fixture();
  const reps = 5000;
  const big = { ...c, columns: Array.from({ length: c.columns.length * reps }, (_, i) => c.columns[i % c.columns.length]),
    groups: [{ name: "all", start: 0, count: c.columns.length * reps }],
    tracks: c.tracks.map((t) => ({ ...t, cells: Array.from({ length: c.columns.length * reps }, (_, i) => (t.cells as number[])[i % c.columns.length]) })) };
  const svg = contractToSvg(big, 1200);
  const rects = (svg.match(/<rect /g) || []).length;
  assert.ok(rects < 1100 * c.tracks.length * 3, "rects " + rects);
  assert.ok(svg.length < 1.5e6, "bytes " + svg.length);
});

test("a figure's style override and per-track colours reach the SVG", () => {
  const c = fixture();
  const plain = contractToSvg(c, 800);
  const themed = contractToSvg({ ...c, display: { ...c.display,
    style: { palette: { unaltered: "#f0f0f0" }, glyph: { mutation: { priority: [{ color: "#abcdef" }, {}, {}, {}, {}, {}] } } },
    colors: { CANCER_TYPE: { Lung: "#123456" } } } }, 800);
  assert.ok(!plain.includes("#f0f0f0") && themed.includes("#f0f0f0"), "the unaltered fill follows the override");
  assert.ok(themed.includes("#abcdef"), "truncating mutations and their legend swatch follow the override");
  assert.ok(themed.includes("#123456"), "the per-track colour reaches both the cells and the category key");
  assert.equal((themed.match(/#123456/g) || []).length >= 2, true);
  assert.ok(!themed.includes(">Lung</text>") === false, "labels are untouched");
});

test("a physical width prints in inches but leaves the internal layout, and the default call, untouched", () => {
  const c = fixture();
  const plain = contractToSvg(c, 800);
  const sized = contractToSvg(c, 800, undefined, 8.5);
  assert.ok(plain.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="800" height='), "no viewBox added when physicalWidthIn is absent");
  assert.ok(!plain.includes("viewBox"));
  assert.ok(sized.includes('width="8.5in"') && sized.includes('viewBox="0 0 800 '), sized.slice(0, 200));
  // same px coordinates either way — only the outer declared size changes
  assert.equal(sized.replace(/^<svg[^>]*>/, ""), plain.replace(/^<svg[^>]*>/, ""));
});

test("clinicalLegends: 'none' drops the per-track keys and shrinks the canvas", () => {
  const c = fixture();
  const all = contractToSvg(c, 800);
  const none = contractToSvg({ ...c, display: { ...c.display, clinicalLegends: "none" } }, 800);
  assert.ok(none.length < all.length);
  assert.ok(all.includes(">Lung</text>") && !none.includes(">Lung</text>"));
  const h = (s: string) => Number(/height="(\d+)"/.exec(s)![1]);
  assert.ok(h(none) < h(all), "height drops with the keys: " + h(none) + " vs " + h(all));
});

test("germline: the legend draws the stripe, and the caption says how many hiding germline left out", () => {
  const events = readFileSync(FIX + "events.tsv", "utf8").trimEnd() + "\nP05\tKRAS\tG13D\tMISSENSE_GERMLINE\n";
  const make = (drivers?: { hideGermline: boolean }) => assembleContract(localInput({ events: parseTsv(events), coverage: parseTsv(readFileSync(FIX + "coverage.tsv", "utf8")), drivers }));
  const shown = contractToSvg(make(), 900);
  assert.match(shown, />Germline Mutation</);
  const hidden = contractToSvg(make({ hideGermline: true }), 900);
  assert.doesNotMatch(hidden, />Germline Mutation</);
  assert.match(hidden, /1 germline mutation is hidden and not in the %/);
});

test("zoomed out, a track with more than 63 values still draws its commonest one", () => {
  const n = 3000, cats = Array.from({ length: 100 }, (_, i) => "v" + i);
  const c = { study: "s", studies: ["s"], groups: [{ name: "all", start: 0, count: n }], columns: Array.from({ length: n }, (_, i) => "P" + i),
    unit: "patient", conventions: { sort: [] }, stats: { nColumns: n }, display: {},
    tracks: [{ kind: "clinical", label: "X", categories: cats, cells: new Array(n).fill(70) }] } as unknown as Contract;
  assert.ok(contractToSvg(c, 800).includes(clinicalColor(70)), "value v70's colour, past the old 64-slot vote");
});

test("the server SVG draws a stacked row as shares in the portal's colours, and lists them in the legend", () => {
  const c = { study: "s", studies: ["s"], groups: [{ name: "all", start: 0, count: 2 }], columns: ["A", "B"], unit: "patient",
    conventions: { sort: [] }, stats: { nColumns: 2 }, display: {},
    tracks: [{ kind: "clinical", label: "MUTATION_SPECTRUM", stack: ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"], cells: [0, -1],
      values: [3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }] } as unknown as Contract;
  const svg = contractToSvg(c, 400);
  assert.ok(svg.includes('fill="#3D6EB1"') && svg.includes('fill="#DFF1F8"'), "C>A and C>T drawn, in the portal's colours");
  assert.ok(svg.includes(">T>G<") || svg.includes(">T&gt;G<"), "the legend names every substitution");
});

// #199 D1, D2: the mutation spectrum's stacked bar (oncoprintjs StackedBarRuleSet 1203-1290, ClinicalDataCache 32-48)
const SPECTRUM_FILLS = ["#3D6EB1", "#8EBFDC", "#DFF1F8", "#FCE08E", "#F78F5E", "#D62B23"];
function spectrumRects(values: number[], cells: number[]) {
  const n = cells.length;
  const c = { study: "s", studies: ["s"], groups: [{ name: "all", start: 0, count: n }], columns: cells.map((_, i) => "C" + i), unit: "patient",
    conventions: { sort: [] }, stats: { nColumns: n }, display: {},
    tracks: [{ kind: "clinical", label: "MUTATION_SPECTRUM", stack: ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"], cells, values }] } as unknown as Contract;
  const svg = contractToSvg(c, 600);
  // the figure's cells: rects inside the drawing group, in one of the six fills
  const body = svg.slice(svg.indexOf("<g"), svg.indexOf("</g>"));
  return [...body.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="(#[0-9A-Fa-f]{6})"/g)]
    .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5].toUpperCase() }))
    .filter((r) => SPECTRUM_FILLS.includes(r.fill));
}

test("#199 D1: each class is its share of the column's total, stacked to the full cell height whatever the total", () => {
  // column 0: 3 C>A, 1 C>T; column 1: 300 T>G and 100 C>G; column 2: no data
  const rects = spectrumRects([3, 0, 1, 0, 0, 0, 0, 100, 0, 0, 0, 300], [0, 1, -1]);
  const xs = [...new Set(rects.map((r) => r.x))].sort((a, b) => a - b);
  const col = (i: number) => rects.filter((r) => r.x === xs[i] && r.h > 0);
  assert.equal(xs.length, 2, "two columns drawn, the one with no data not at all");
  const h0 = col(0).reduce((s, r) => s + r.h, 0), h1 = col(1).reduce((s, r) => s + r.h, 0);
  assert.ok(h0 > 0 && Math.abs(h0 - h1) < 0.01, "a total of 4 and of 400 both fill the cell: " + h0 + " vs " + h1);
  const ca = col(0).find((r) => r.fill === "#3D6EB1")!, ct = col(0).find((r) => r.fill === "#DFF1F8")!;
  assert.ok(Math.abs(ca.h / h0 - 0.75) < 0.01 && Math.abs(ct.h / h0 - 0.25) < 0.01, "C>A 3/4, C>T 1/4");
  assert.ok(ca.y < ct.y, "C>A, the first class, at the top");
  const tg = col(1).find((r) => r.fill === "#D62B23")!, cg = col(1).find((r) => r.fill === "#8EBFDC")!;
  assert.ok(Math.abs(tg.h / h1 - 0.75) < 0.01 && cg.y < tg.y, "T>G 3/4, below C>G");
});

test("#199 D2: the six classes in the portal's colours, in class order C>A ... T>G", () => {
  // column i holds class i only
  const values = Array.from({ length: 36 }, (_, j) => (j % 7 === 0 ? 2 : 0));
  const rects = spectrumRects(values, [0, 1, 2, 3, 4, 5]).filter((r) => r.h > 0).sort((a, b) => a.x - b.x);
  assert.deepEqual(rects.map((r) => r.fill), SPECTRUM_FILLS);
});
