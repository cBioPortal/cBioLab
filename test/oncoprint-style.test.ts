// The style is data shared by every renderer. These checks pin the rule that turns a cell
// into layers, and fail when the generated Python copy has drifted from the source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STYLE, cellLayers, formatPct, geneLegend, numericColor } from "../lib/oncoprint-style.ts";
import { STYLE_JSON } from "../scripts/gen-style.ts";
import { bucketCodes, bucketEdges } from "../lib/oncoprint-lod.ts";

const B = STYLE.bits;

test("python/cohortlab/style.json is the generated copy of lib/oncoprint-style.ts", () => {
  assert.equal(readFileSync("python/cohortlab/style.json", "utf8"), STYLE_JSON, "run: npm run style:gen");
});

test("cell layers: base, one CNA, SV band, one mutation by priority, faded without the driver bit", () => {
  assert.deepEqual(cellLayers(0, STYLE).map((l) => l.color), [STYLE.palette.unaltered]);
  assert.equal(cellLayers(-1, STYLE).length, 2, "not profiled = fill + stripe");
  const both = cellLayers(B.MISSENSE | B.TRUNCATING | B.DRIVER, STYLE);
  assert.equal(both.length, 2);
  assert.equal(both[1].color, "#111111", "truncating outranks missense when both are present");
  const amp = cellLayers(B.AMP | B.HOMDEL | B.SV | B.SPLICE, STYLE);
  assert.deepEqual(amp.map((l) => l.color), [STYLE.palette.unaltered, "#e41a1c", "#8e24aa", "#ff8c00"]);
  assert.deepEqual(amp.map((l) => l.alpha), [1, STYLE.glyph.vusAlpha, STYLE.glyph.vusAlpha, STYLE.glyph.vusAlpha]);
  assert.deepEqual(amp[2].band, [0.15, 0.85]);
});

test("percent format follows the portal, legend order is mutations, SV, CNA, not profiled", () => {
  assert.equal(formatPct(null), "N/P"); assert.equal(formatPct(2.94), "2.9%"); assert.equal(formatPct(3.4), "3%"); assert.equal(formatPct(52.6), "53%");
  assert.deepEqual(geneLegend(STYLE).map((i) => i.label).slice(0, 2), ["Truncating Mutation", "Splice Mutation"]);
  assert.equal(geneLegend(STYLE).at(-1)!.kind, "notProfiled");
  assert.equal(numericColor(0, null), "rgb(222,235,247)"); assert.equal(numericColor(255, 128), "rgb(178,24,43)"); assert.equal(numericColor(128, 128), "rgb(255,255,255)");
});

test("level of detail: edges partition the columns, buckets OR genes and average numerics", () => {
  assert.deepEqual(bucketEdges(10, 4), [0, 2, 5, 7, 10]);
  assert.deepEqual(bucketEdges(3, 10), [0, 1, 2, 3]);
  const gene = { kind: "gene" as const };
  assert.deepEqual(bucketCodes(gene, [1, 0, -1, -1, 64 | 256, 0], 0, 6, 3), [1, -1, 64 | 256]);
  assert.deepEqual(bucketCodes({ kind: "clinical", numeric: true }, [10, 20, -1, -1], 0, 4, 2), [15, -1]);
  assert.deepEqual(bucketCodes({ kind: "clinical", categories: ["a", "b"] }, [0, 1, 1, 2, -1, -1], 0, 6, 3), [0, 1, -1], "ties go to the lower index");
});
