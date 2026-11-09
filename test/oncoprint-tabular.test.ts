// The oncoprint's "Tabular" download (lib/oncoprint-tabular.ts): one row per track — its name, its
// type, then one column per case in the oncoprint's order — and one text label per cell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contractToTsv, geneCellLabel } from "../lib/oncoprint-tabular.ts";
import { BITS, NOT_PROFILED } from "../lib/oncoprint-assemble.ts";
import { STYLE } from "../lib/oncoprint-style.ts";
import type { Contract, Track } from "../lib/types.ts";

const contract = (columns: string[], tracks: Track[]): Contract =>
  ({ study: "s", unit: "patient", groups: [{ name: "all", start: 0, count: columns.length }], columns, tracks, conventions: {} } as unknown as Contract);

const table = (tsv: string) => tsv.split("\n").filter((l) => l !== "").map((l) => l.split("\t"));

test("a gene cell says not profiled, nothing for unaltered, and names each alteration it holds", () => {
  assert.equal(geneCellLabel(NOT_PROFILED), "not profiled");
  assert.equal(geneCellLabel(0), "");
  assert.equal(geneCellLabel(BITS.AMP), "Amplification");
  assert.equal(geneCellLabel(BITS.HOMDEL), "Deep Deletion");
  assert.equal(geneCellLabel(BITS.MISSENSE), "Missense Mutation (unknown significance)");
  assert.equal(geneCellLabel(BITS.TRUNCATING | BITS.MUT_DRIVER), "Truncating Mutation (putative driver)");
  for (const [bit, name] of [[BITS.INFRAME, "Inframe"], [BITS.SPLICE, "Splice"], [BITS.PROMOTER, "Promoter"], [BITS.OTHER_MUT, "Other"]] as const)
    assert.equal(geneCellLabel(bit), name + " Mutation (unknown significance)");
});

test("driver status is per glyph: a mutation's driver bit does not make the cell's SV a driver", () => {
  const label = geneCellLabel(BITS.MISSENSE | BITS.MUT_DRIVER | BITS.SV | BITS.AMP);
  const parts = label.split(", ");
  assert.ok(parts.includes("Missense Mutation (putative driver)"), label);
  assert.ok(parts.includes("Structural Variant (unknown significance)"), label);
  assert.ok(parts.includes("Amplification"), label);
  assert.equal(geneCellLabel(BITS.SV | BITS.SV_DRIVER), "Structural Variant (putative driver)");
});

test("the header names the cases in oncoprint order, and every row has a cell for each", () => {
  const tsv = contractToTsv(contract(["P3", "P1", "P2"], [
    { kind: "gene", label: "TP53", cells: [BITS.MISSENSE, 0, NOT_PROFILED] },
  ]));
  assert.ok(tsv.endsWith("\n"));
  const rows = table(tsv);
  assert.deepEqual(rows[0], ["track_name", "track_type", "P3", "P1", "P2"]);
  assert.deepEqual(rows[1], ["TP53", "GENE", "Missense Mutation (unknown significance)", "", "not profiled"]);
});

test("each track kind gets its type and its cells' text", () => {
  const rows = table(contractToTsv(contract(["A", "B", "C"], [
    { kind: "derivedEvent", label: "Any driver", cells: [1, 0, 2] } as Track,
    { kind: "clinical", label: "Sex", cells: [0, 1, -1], categories: ["Female", "Male"] } as Track,
    { kind: "clinical", label: "Stage", cells: [5, 0, -1], categories: ["I"] } as Track,
    { kind: "clinical", label: "Profiled for mutations", cells: [0, -1, 0], categories: ["Yes"], profiledFor: "mutations" } as Track,
    { kind: "clinical", label: "Age", cells: [0, 255, -1], numeric: true, min: 20, max: 80 } as Track,
    { kind: "heatmap", label: "EGFR mRNA", cells: [0, 255, -1], numeric: true, min: -2, max: 2, profileType: "MRNA_EXPRESSION" } as Track,
    { kind: "heatmap", label: "untyped", cells: [-1, -1, -1], numeric: true } as Track,
  ])));
  const byName = Object.fromEntries(rows.slice(1).map((r) => [r[0], r.slice(1)]));
  assert.deepEqual(byName["Any driver"], ["DERIVED", "yes", "no", "yes"]);
  assert.deepEqual(byName.Sex, ["CLINICAL", "Female", "Male", ""], "no value is an empty cell");
  assert.deepEqual(byName.Stage, ["CLINICAL", "Other", "I", ""], "a code with no category is Other");
  assert.deepEqual(byName["Profiled for mutations"], ["CLINICAL", "Yes", STYLE.glyph.profiled.no, "Yes"], "an empty profiled-for cell means No");
  assert.deepEqual(byName.Age, ["CLINICAL", "20", "80", ""], "numeric cells are values on the track's scale");
  assert.deepEqual(byName["EGFR mRNA"], ["HEATMAP MRNA_EXPRESSION", "-2", "2", ""]);
  assert.deepEqual(byName.untyped, ["HEATMAP ", "", "", ""]);
});

test("numeric values are rounded to two decimals, on a log scale where the track has one", () => {
  const rows = table(contractToTsv(contract(["A", "B"], [
    { kind: "clinical", label: "x", cells: [85, 128], numeric: true, min: 0, max: 1 } as Track,
    { kind: "clinical", label: "log", cells: [0, 255], numeric: true, min: 0, max: 1000, logScale: true } as Track,
  ])));
  assert.deepEqual(rows[1].slice(2), [String(Math.round(85 / 255 * 100) / 100), String(Math.round(128 / 255 * 100) / 100)]);
  assert.deepEqual(rows[2].slice(2), ["0", "1000"], "a log scale's ends are still its min and max");
});

test("typed-array cells are read the same as plain ones", () => {
  const plain = contractToTsv(contract(["A", "B"], [{ kind: "gene", label: "KRAS", cells: [BITS.AMP, 0] }]));
  const typed = contractToTsv(contract(["A", "B"], [{ kind: "gene", label: "KRAS", cells: Int32Array.from([BITS.AMP, 0]) }]));
  assert.equal(typed, plain);
});

test("a germline mutation is named in the tabular download", () => {
  assert.equal(geneCellLabel(BITS.MISSENSE | BITS.GERMLINE), "Missense Mutation (unknown significance), Germline Mutation");
});
