// A clinical track typed by its attribute's declared datatype, and the zoomed-out tooltip's
// averages and counts. Case table rows D1-D7, D9 (SQL text only) and T1-T14. Legacy source:
// cbioportal-frontend cd8c6df — OU = src/shared/components/oncoprint/OncoprintUtils.ts 1421-1470
// (number when NUMBER, string when STRING, nothing looks at the values), DU = DataUtils.ts 661-760
// fillClinicalTrackDatum, TU = TooltipUtils.ts 202-295 makeClinicalTrackTooltip and 297-395
// makeHeatmapTrackTooltip.
import test from "node:test";
import assert from "node:assert/strict";
import { assembleContract, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { clinicalNamesSql } from "../lib/oncoprint.ts";
import { zoomedTip } from "../app/_oncoprint/zoomed-tip.ts";

// ---- assembly ------------------------------------------------------------------------------

type ClinicalIn = AssembleInput["clinical"][number] & { datatype?: string };

const pidsOf = (n: number) => Array.from({ length: n }, (_, i) => "P" + String(i + 1).padStart(2, "0"));

/** a cohort of `vals.length` columns, one clinical attribute, no gene events */
function assemble(attr: string, vals: (string | undefined)[], datatype?: string) {
  const pids = pidsOf(vals.length);
  const values = new Map<string, string>();
  vals.forEach((v, i) => { if (v !== undefined) values.set(pids[i], v); });
  const clin: ClinicalIn = { attr, values, ...(datatype !== undefined ? { datatype } : {}) };
  const input: AssembleInput = {
    genes: ["TP53"],
    groups: [{ name: "A", pids }],
    studies: ["s"],
    events: [],
    coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })),
    isDriver: () => false,
    annotationSource: "fixture",
    clinical: [clin as AssembleInput["clinical"][number]],
    heatmap: [], derived: [],
    sort: [{ track: "genomic", dir: "asc" }], lineGap: 90
  };
  const c = assembleContract(input);
  const track = c.tracks.find((t) => t.kind === "clinical" && (t.label === attr || t.label === attr + " (no data)"));
  assert.ok(track, "a clinical track for " + attr);
  return { c, track: track!, col: (i: number) => c.columns.indexOf(pids[i]) };
}

test("D1: a NUMBER attribute with 3 distinct values is a numeric bar track over its range", () => {
  const { track, col } = assemble("N_STAGES", ["0", "1", "2", "1", "0", "2"], "NUMBER");
  assert.equal(track.numeric, true, "NUMBER is drawn as a number whatever its distinct count (OU 1421)");
  assert.equal(track.bar, true);
  assert.equal(track.min, 0);
  assert.equal(track.max, 2);
  assert.ok(track.values, "the exact values are carried");
  assert.equal(track.values![col(2)], 2);
  assert.equal(track.categories, undefined, "no categories on a numeric track");
});

test("D2: a STRING attribute whose values all parse and are > 10 distinct is categorical, each value its own category", () => {
  const vals = ["0.1", "0.5", "1.2", "2", "3.3", "4.1", "5", "6.8", "7.7", "9", "11", "12.5"];
  const { track, col } = assemble("PSA", vals, "STRING");
  assert.ok(!track.numeric, "STRING is drawn as a string (OU 1455), never as bars");
  assert.ok(track.categories, "categories");
  assert.deepEqual([...track.categories!].sort(), [...vals].sort(), "every value is its own category");
  assert.equal(track.categories![track.cells[col(11)]], "12.5");
});

test("D3: a BOOLEAN attribute is categorical", () => {
  const { track } = assemble("IS_SMOKER", ["True", "False", "True", "True"], "BOOLEAN");
  assert.ok(!track.numeric);
  assert.deepEqual([...track.categories!].sort(), ["False", "True"]);
});

test("D3: a declared datatype other than NUMBER is categorical even when its values look numeric", () => {
  const vals = Array.from({ length: 12 }, (_, i) => String(i));
  const { track } = assemble("FLAG_COUNT", vals, "BOOLEAN");
  assert.ok(!track.numeric, "only NUMBER has the number branch in OU");
  assert.equal(track.categories!.length, 12);
});

test("D4: with no declaration, today's rule — >10 distinct numbers are bars, 3 are categories", () => {
  const many = assemble("AGE", Array.from({ length: 12 }, (_, i) => String(40 + i)));
  assert.equal(many.track.numeric, true, "≥90% parse and >10 distinct");
  const few = assemble("AGE", ["0", "1", "2", "1"]);
  assert.ok(!few.track.numeric, "3 distinct values stay categorical without a declaration");
  assert.deepEqual([...few.track.categories!].sort(), ["0", "1", "2"]);
});

test("D5: a NUMBER attribute with some non-numeric values is numeric; those columns have no data", () => {
  // "unknown" and "N/A" are not numbers to the portal's parseFloat either (DU 674-683)
  const { track, col } = assemble("PSA_LEVEL", ["1", "unknown", "3", "N/A", "2"], "NUMBER");
  assert.equal(track.numeric, true);
  assert.equal(track.min, 1);
  assert.equal(track.max, 3);
  for (const i of [1, 3]) {
    assert.equal(track.cells[col(i)], -1, "column " + i + " is no data");
    // the contract carries a missing value as null (lib/oncoprint-assemble.ts remapValues), NaN before packing
    assert.ok(track.values![col(i)] == null || Number.isNaN(track.values![col(i)]), "column " + i + " has no value");
  }
  assert.notEqual(track.cells[col(0)], -1);
  assert.equal(track.values![col(2)], 3);
});

test("D6: a NUMBER attribute whose values are all non-numeric is the \"(no data)\" track", () => {
  const { track } = assemble("GLEASON", ["4+3", "3+4", "unknown"], "NUMBER");
  assert.equal(track.label, "GLEASON (no data)", "no column has a number (DU 682)");
  assert.ok([...track.cells].every((x) => x === -1));
});

test("D7: FRACTION_GENOME_ALTERED declared NUMBER keeps [0,1]; MUTATION_COUNT keeps its log scale", () => {
  const fga = assemble("FRACTION_GENOME_ALTERED", ["0.2", "0.4", "0.2"], "NUMBER").track;
  assert.equal(fga.numeric, true, "a NUMBER with 2 distinct values is still numeric");
  assert.equal(fga.min, 0, "OU 1424: numberRange [0,1]");
  assert.equal(fga.max, 1);
  const mc = assemble("MUTATION_COUNT", ["3", "10", "3", "250"], "NUMBER").track;
  assert.equal(mc.numeric, true);
  assert.equal(mc.logScale, true, "OU 1428: numberLogScale");
});

test("D9: the names query also reads each attribute's datatype, upper-cased, as column d", () => {
  const sql = clinicalNamesSql(["AGE", "PSA"], "s", "db");
  assert.ok(sql, "a query");
  assert.match(sql!, /upper\([\s\S]*datatype[\s\S]*\)\s+AS\s+d\b/i, "selects upper(...datatype...) AS d");
  assert.match(sql!, /\bAS\s+a\b/i, "still the attribute as a");
  assert.match(sql!, /\bAS\s+n\b/i, "still the display name as n");
});

// ---- the zoomed-out tooltip ----------------------------------------------------------------

type TipTrack = {
  label: string; kind: "clinical" | "heatmap" | "gene" | "derivedEvent";
  numeric?: boolean; categories?: string[]; profiledFor?: string;
  stack?: { categories: string[] }; values?: Float32Array; cells: ArrayLike<number>;
};
function tip(track: TipTrack, cols: number[]): string[] {
  return zoomedTip(track as never, cols);
}

const numeric = (label: string, vals: number[]): TipTrack => ({
  label, kind: "clinical", numeric: true,
  values: Float32Array.from(vals), cells: vals.map((v) => (Number.isNaN(v) ? -1 : 128))
});
const categorical = (label: string, categories: string[], cells: number[], extra: Partial<TipTrack> = {}): TipTrack =>
  ({ label, kind: "clinical", categories, cells: Int32Array.from(cells), ...extra });
const heatmap = (label: string, vals: number[]): TipTrack => ({
  label, kind: "heatmap", numeric: true,
  values: Float32Array.from(vals), cells: vals.map((v) => (Number.isNaN(v) ? -1 : 128))
});

test("T1: numeric clinical, values [1, 2, 4] -> the mean to 2 places, \"(average of 3 values)\"", () => {
  assert.deepEqual(tip(numeric("Age", [1, 2, 4]), [0, 1, 2]), ["Age: 2.33 (average of 3 values)"]);
});

test("T2: numeric clinical, values [2, 4] -> \"3\", the \".00\" dropped (TU 241-243)", () => {
  assert.deepEqual(tip(numeric("Age", [2, 4]), [0, 1]), ["Age: 3 (average of 2 values)"]);
});

test("T3: numeric clinical, one value among no-data columns -> the value, no \"average of\"", () => {
  assert.deepEqual(tip(numeric("Age", [NaN, 5, NaN]), [0, 1, 2]), ["Age: 5"]);
});

test("T4: numeric clinical, no value under the pixel -> \"no data\" (the portal prints NaN)", () => {
  assert.deepEqual(tip(numeric("Age", [NaN, NaN]), [0, 1]), ["Age: no data"]);
});

test("T1: only the columns under the pixel are averaged", () => {
  assert.deepEqual(tip(numeric("Age", [100, 1, 2, 4, 100]), [1, 2, 3]), ["Age: 2.33 (average of 3 values)"]);
});

test("T5: categorical, values A, A, B -> \"Label:\" then a count line per value", () => {
  const t = categorical("Type", ["A", "B"], [0, 0, 1]);
  assert.deepEqual(tip(t, [0, 1, 2]), ["Type:", "A: 2 samples", "B: 1 sample"]);
});

test("T5: lines follow the order values are first met under the pixel, not the category order", () => {
  const t = categorical("Type", ["A", "B"], [1, 0, 0]);
  assert.deepEqual(tip(t, [0, 1, 2]), ["Type:", "B: 1 sample", "A: 2 samples"]);
});

test("T6: categorical, values A, A -> \"Label: A (2 samples)\"", () => {
  const t = categorical("Type", ["A", "B"], [0, 0]);
  assert.deepEqual(tip(t, [0, 1]), ["Type: A (2 samples)"]);
});

test("T7: integer-like values come first, ascending, as JavaScript Object.keys orders them", () => {
  const t = categorical("Stage", ["A", "10", "2"], [0, 1, 2]);
  assert.deepEqual(tip(t, [0, 1, 2]), ["Stage:", "2: 1 sample", "10: 1 sample", "A: 1 sample"]);
});

test("T8: a Profiled row, 3 Yes and 2 No -> the Yes line then \"No (2 samples)\"", () => {
  const t = categorical("Mutations profiled", ["Yes"], [0, -1, 0, -1, 0], { profiledFor: "mutation" });
  assert.deepEqual(tip(t, [0, 1, 2, 3, 4]), ["Mutations profiled: Yes (3 samples)", "Mutations profiled: No (2 samples)"]);
});

test("T8: a Profiled row with none profiled under the pixel -> only the No line", () => {
  const t = categorical("Mutations profiled", ["Yes"], [-1, -1], { profiledFor: "mutation" });
  assert.deepEqual(tip(t, [0, 1]), ["Mutations profiled: No (2 samples)"]);
});

test("T9: a categorical track (not a Profiled row) says nothing of its no-data columns", () => {
  const t = categorical("Type", ["A", "B"], [0, -1, 0, -1]);
  assert.deepEqual(tip(t, [0, 1, 2, 3]), ["Type: A (2 samples)"]);
  const mixed = categorical("Type", ["A", "B"], [0, -1, 1]);
  assert.deepEqual(tip(mixed, [0, 1, 2]), ["Type:", "A: 1 sample", "B: 1 sample"]);
});

test("T9: one value among no-data columns keeps the portal's plural \"(1 samples)\" (TU 270-273)", () => {
  const t = categorical("Type", ["A"], [-1, 0]);
  assert.deepEqual(tip(t, [0, 1]), ["Type: A (1 samples)"]);
});

test("T9: no value at all under the pixel -> no lines", () => {
  const t = categorical("Type", ["A"], [-1, -1]);
  assert.deepEqual(tip(t, [0, 1]), []);
});

test("T10: heatmap, values [0.5, -1.25] -> \"-0.38 (average of 2 values)\", toFixed(2) unstripped", () => {
  assert.deepEqual(tip(heatmap("TP53 mRNA", [0.5, -1.25]), [0, 1]), ["TP53 mRNA: -0.38 (average of 2 values)"]);
});

test("T10: heatmap, a mean with \".00\" keeps it", () => {
  assert.deepEqual(tip(heatmap("TP53 mRNA", [1, 3]), [0, 1]), ["TP53 mRNA: 2.00 (average of 2 values)"]);
});

test("T11: heatmap, one value 2 among no-data columns -> \"2.00\"", () => {
  assert.deepEqual(tip(heatmap("TP53 mRNA", [NaN, 2, NaN]), [0, 1, 2]), ["TP53 mRNA: 2.00"]);
});

test("T12: heatmap, no value -> \"N/A\" (TU 17 tooltipTextElementNaN)", () => {
  assert.deepEqual(tip(heatmap("TP53 mRNA", [NaN, NaN]), [0, 1]), ["TP53 mRNA: N/A"]);
});

test("T13: spectrum, several columns -> one line per category of the first column under the pixel", () => {
  const cats = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
  // the contract carries `stack` as the category list; it is given its own `categories` too so
  // either reading of the stack names the same six
  const stack = Object.assign(cats.slice(), { categories: cats.slice() }) as unknown as { categories: string[] };
  const values = Float32Array.from([1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60, 7, 0, 0, 0, 0, 9]);
  const t: TipTrack = { label: "Mutation spectrum", kind: "clinical", stack, values, cells: [0, 1, 2] };
  assert.deepEqual(tip(t, [1, 2]), ["C>A: 10", "C>G: 20", "C>T: 30", "T>A: 40", "T>C: 50", "T>G: 60"]);
  assert.deepEqual(tip(t, [2, 0]), ["C>A: 7", "C>G: 0", "C>T: 0", "T>A: 0", "T>C: 0", "T>G: 9"]);
});

test("T14: gene and derived-event rows -> \"a altered of p profiled\", unchanged", () => {
  const gene: TipTrack = { label: "TP53", kind: "gene", cells: Int32Array.from([5, 0, -1, 3, 0]) };
  assert.deepEqual(tip(gene, [0, 1, 2, 3, 4]), ["TP53: 2 altered of 4 profiled"]);
  const derived: TipTrack = { label: "treated", kind: "derivedEvent", cells: Int32Array.from([1, 0, 1]) };
  assert.deepEqual(tip(derived, [0, 1, 2]), ["treated: 2 altered of 3 profiled"]);
});
