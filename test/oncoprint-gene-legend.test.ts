// The OncoPrint gene legend's last two entries, as the portal's (cbioportal-frontend cd8c6df
// src/shared/components/oncoprint/geneticrules.ts 300-306 and 405-410; oncoprintjs oncoprintruleset.ts — the `always`
// rule and the NA rule are listed when a datum used them — and oncoprintlegendrenderer.ts 118-140, equal orders sorted
// by label):
//
// | ID  | rule                                                                                              |
// |-----|---------------------------------------------------------------------------------------------------|
// | GL1 | "No alterations" (the always rule, the grey cell) is listed when some gene cell is profiled          |
// | GL2 | "Not profiled" (the NA rule) is listed only when some gene cell is not profiled                      |
// | GL3 | both have the last order; "No alterations" sorts before "Not profiled"                               |
// | GL4 | a style listing (no cells) names both                                                                |
import { test } from "node:test";
import assert from "node:assert/strict";
import { geneLegend, glyphPresence, STYLE } from "../lib/oncoprint-style.ts";

const B = STYLE.bits;
const labels = (cells: number[][]) => geneLegend(STYLE, glyphPresence(cells.map((c) => ({ kind: "gene", cells: Int32Array.from(c) })))).map((i) => i.label);

test("GL1/GL3: an altered and an unaltered cell: the glyph, then No alterations; nothing unprofiled, no Not profiled", () => {
  const l = labels([[B.MISSENSE | B.MUT_DRIVER, 0]]);
  assert.deepEqual(l.slice(-2), ["Missense Mutation (putative driver)", "No alterations"]);
  assert.ok(!l.includes("Not profiled"));
});

test("GL1: an altered cell alone still lists No alterations (every profiled datum uses the always rule)", () => {
  assert.equal(labels([[B.AMP]]).at(-1), "No alterations");
});

test("GL2/GL3: a cell not profiled: Not profiled, after No alterations", () => {
  assert.deepEqual(labels([[B.AMP, 0, -1]]).slice(-2), ["No alterations", "Not profiled"]);
});

test("GL1/GL2: every cell not profiled: Not profiled alone", () => {
  assert.deepEqual(labels([[-1, -1]]), ["Not profiled"]);
});

test("GL1: gene rows of other kinds of track are not read", () => {
  const l = geneLegend(STYLE, glyphPresence([{ kind: "clinical", cells: Int32Array.from([-1, 0]) }, { kind: "gene", cells: Int32Array.from([0]) }])).map((i) => i.label);
  assert.deepEqual(l, ["No alterations"]);
});

test("GL4: the style's own listing names both", () => {
  assert.deepEqual(geneLegend(STYLE).map((i) => i.label).slice(-2), ["No alterations", "Not profiled"]);
});
