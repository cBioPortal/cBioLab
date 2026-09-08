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
