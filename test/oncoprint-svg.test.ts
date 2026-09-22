// The server SVG of the fixture is pinned. A change to lib/oncoprint-style.ts or the renderer
// shows up here as a diff to review; set UPDATE_GOLDEN=1 to accept it.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assembleContract } from "../lib/oncoprint-assemble.ts";
import { localInput, parseTsv } from "../lib/oncoprint-local.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";

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
