// The oncoprint's "Tabular" download (lib/oncoprint-tabular.ts): one row per track — its name, its
// type, then one column per case in the oncoprint's order — and one text label per cell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contractToTsv, geneticText } from "../lib/oncoprint-tabular.ts";
import { BITS, NOT_PROFILED, assembleContract } from "../lib/oncoprint-assemble.ts";
import { STYLE } from "../lib/oncoprint-style.ts";
import type { Contract, Track } from "../lib/types.ts";

const contract = (columns: string[], tracks: Track[]): Contract =>
  ({ study: "s", unit: "patient", groups: [{ name: "all", start: 0, count: columns.length }], columns, tracks, conventions: {} } as unknown as Contract);

const table = (tsv: string) => tsv.split("\n").filter((l) => l !== "").map((l) => l.split("\t"));

test("a gene cell's text in each genetic group: nothing when not profiled or unaltered", () => {
  for (const g of ["CNA", "MUTATIONS", "MRNA", "PROTEIN", "STRUCTURAL_VARIANT"] as const) {
    assert.equal(geneticText(NOT_PROFILED, g, true), "");
    assert.equal(geneticText(0, g, true), "");
  }
  assert.equal(geneticText(BITS.AMP, "CNA", true), "Amplification");
  assert.equal(geneticText(BITS.HOMDEL, "CNA", false), "Deep Deletion");
  assert.equal(geneticText(BITS.MISSENSE, "MUTATIONS", true), "Missense Mutation (putative passenger)");
  assert.equal(geneticText(BITS.TRUNCATING | BITS.MUT_DRIVER, "MUTATIONS", true), "Truncating mutation (putative driver)");
  assert.equal(geneticText(BITS.AMP, "MUTATIONS", true), "", "a copy number is not a mutation");
  assert.equal(geneticText(BITS.AMP | BITS.MISSENSE, "MRNA", true), "", "mRNA and protein calls are not loaded");
});

test("driver status is per glyph: a mutation's driver bit does not make the cell's SV or copy number a driver", () => {
  const code = BITS.MISSENSE | BITS.MUT_DRIVER | BITS.SV | BITS.AMP;
  assert.equal(geneticText(code, "MUTATIONS", true), "Missense Mutation (putative driver)");
  assert.equal(geneticText(code, "STRUCTURAL_VARIANT", true), "Structural Variant");
  assert.equal(geneticText(code, "CNA", true), "Amplification");
  assert.equal(geneticText(BITS.SV | BITS.SV_DRIVER, "STRUCTURAL_VARIANT", true), "Structural Variant (putative driver)");
  assert.equal(geneticText(BITS.SV | BITS.SV_DRIVER, "STRUCTURAL_VARIANT", false), "Structural Variant");
});

test("the header names the cases in oncoprint order, and every row has a cell for each", () => {
  const tsv = contractToTsv(contract(["P3", "P1", "P2"], [
    { kind: "gene", label: "TP53", cells: [BITS.MISSENSE, 0, NOT_PROFILED] },
  ]));
  assert.ok(tsv.endsWith("\n"));
  const rows = table(tsv);
  assert.deepEqual(rows[0], ["track_name", "track_type", "P3", "P1", "P2"]);
  assert.deepEqual(rows[1], ["TP53", "CNA", "", "", ""]);
  assert.deepEqual(rows[2], ["TP53", "MUTATIONS", "Missense Mutation", "", ""], "annotation off: no driver call");
});

test("each track kind gets its type and its cells' text", () => {
  const rows = table(contractToTsv(contract(["A", "B", "C"], [
    { kind: "derivedEvent", label: "Any driver", cells: [1, 0, 2] } as Track,
    { kind: "clinical", label: "Sex", cells: [0, 1, -1], categories: ["Female", "Male"] } as Track,
    { kind: "clinical", label: "Stage", cells: [5, 0, -1], categories: ["I"] } as Track,
    { kind: "clinical", label: "Profiled for mutations", cells: [0, -1, 0], categories: ["Yes"], profiledFor: "mutations" } as Track,
    { kind: "clinical", label: "Age", cells: [0, 255, -1], numeric: true, min: 20, max: 80 } as Track,
    { kind: "heatmap", label: "EGFR mRNA", gene: "EGFR", cells: [0, 255, -1], numeric: true, min: -2, max: 2, values: [-2, 2, NaN], profileType: "mrna_zscores", profileKind: "MRNA_EXPRESSION Z-SCORE" } as Track,
    { kind: "heatmap", label: "untyped", cells: [-1, -1, -1], numeric: true } as Track,
  ])));
  const byName = Object.fromEntries(rows.slice(1).map((r) => [r[0], r.slice(1)]));
  assert.deepEqual(byName["Any driver"], ["DERIVED", "yes", "no", "yes"]);
  assert.deepEqual(byName.Sex, ["CLINICAL", "Female", "Male", ""], "no value is an empty cell");
  assert.deepEqual(byName.Stage, ["CLINICAL", "Other", "I", ""], "a code with no category is Other");
  assert.deepEqual(byName["Profiled for mutations"], ["CLINICAL", "Yes", STYLE.glyph.profiled.no, "Yes"], "an empty profiled-for cell means No");
  assert.deepEqual(byName.Age, ["CLINICAL", "20", "80", ""], "numeric cells are values on the track's scale");
  assert.deepEqual(byName.EGFR, ["HEATMAP MRNA_EXPRESSION Z-SCORE", "-2", "2", ""], "named by the gene, typed by the profile's kind");
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

test("a germline mutation reads as the somatic one: the file has no germline mark (tabularDownload reads no disp_germ)", () => {
  assert.equal(geneticText(BITS.MISSENSE | BITS.GERMLINE, "MUTATIONS", false), "Missense Mutation");
});

test("a numeric row gives the exact value where the contract carries one, and the drawing code's value where it does not", () => {
  const rows = table(contractToTsv(contract(["A", "B", "C"], [
    { kind: "clinical", label: "TMB", numeric: true, min: 0, max: 255, cells: [100, 100, -1], values: [Math.fround(100.4), Math.fround(0.1), null] } as Track,
    { kind: "clinical", label: "AGE", numeric: true, min: 0, max: 255, cells: [61, 0, -1] } as Track,
  ])));
  assert.deepEqual(rows[1], ["TMB", "CLINICAL", "100.4", "0.1", ""], "float32 at the digits it holds; the code would say 100 for both");
  assert.deepEqual(rows[2], ["AGE", "CLINICAL", "61", "0", ""], "an older contract: no values, the code's");
});

test("the mutation spectrum exports as the portal's: one row per substitution, its counts", () => {
  const tsv = contractToTsv({ columns: ["A", "B"], tracks: [{ kind: "clinical", label: "MUTATION_SPECTRUM", stack: ["C>A", "C>G"], cells: [0, -1], values: [119, 186, 0, 0] }] } as never);
  assert.deepEqual(tsv.split("\n").filter(Boolean).slice(1), ["MUTATION_SPECTRUM (C>A)\tCLINICAL\t119\t", "MUTATION_SPECTRUM (C>G)\tCLINICAL\t186\t"]);
});

// #199 W1: the mutation spectrum in the TSV (tabularDownload 23-25, 150-185)
test("#199 W1: one row per class, '<label> (C>A)' ... '(T>G)', each the count, blank with no data", () => {
  const stack = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
  const tsv = contractToTsv({ columns: ["A", "B", "C"], tracks: [{ kind: "clinical", label: "MUTATION_SPECTRUM", stack, cells: [1, -1, 0],
    values: [0, 0, 0, 0, 0, 7, 1, 2, 3, 4, 5, 6] }] } as never);
  assert.deepEqual(tsv.split("\n").filter(Boolean), [
    "track_name\ttrack_type\tA\tB\tC",
    "MUTATION_SPECTRUM (C>A)\tCLINICAL\t1\t\t0",
    "MUTATION_SPECTRUM (C>G)\tCLINICAL\t2\t\t0",
    "MUTATION_SPECTRUM (C>T)\tCLINICAL\t3\t\t0",
    "MUTATION_SPECTRUM (T>A)\tCLINICAL\t4\t\t0",
    "MUTATION_SPECTRUM (T>C)\tCLINICAL\t5\t\t0",
    "MUTATION_SPECTRUM (T>G)\tCLINICAL\t6\t\t7"
  ], "column A reads its own cell's counts (cell 1), C its (cell 0); B has none");
});

// Legacy: a case whose spectrum rows sum to 0 (only ref = alt SNVs) is no data for drawing and sort,
// but its attr_val is still the zero counts (DataUtils 736-746), so the TSV writes 0, not blank
// (tabularDownload 172-185); a case with no spectrum row has no attr_val and is blank.
test("#199 W1: no spectrum row, or an all-zero one, writes blank (the portal writes 0 for all-zero: docs/PORTAL-PARITY.md ONC-TT-3)", () => {
  const pids = ["Z", "N", "D"];
  const c = assembleContract({ genes: ["TP53"], groups: [{ name: "all", pids }], studies: ["s"], events: [], coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })),
    isDriver: () => false, annotationSource: "t", heatmap: [], derived: [], lineGap: 0, sort: [{ track: "id", dir: "asc" }],
    clinical: [{ attr: "MUTATION_SPECTRUM", values: new Map([["Z", "0,0,0,0,0,0"], ["D", "1,0,0,0,0,0"]]) }] });
  const lines = contractToTsv(c).split("\n");
  const cols = lines[0].split("\t"), row = lines.find((l) => l.startsWith("MUTATION_SPECTRUM (C>A)"))!.split("\t");
  assert.equal(row[cols.indexOf("D")], "1");
  assert.equal(row[cols.indexOf("N")], "", "no spectrum row: blank");
  assert.equal(row[cols.indexOf("Z")], "", "all-zero spectrum: blank, as no data");
});

test("without the page's order, Show unaltered off leaves out the columns no gene track alters (the server's and the CLI's download)", () => {
  const c = { ...contract(["A", "B", "C"], [
    { kind: "gene", label: "TP53", cells: [BITS.MISSENSE, 0, NOT_PROFILED] },
    { kind: "gene", label: "KRAS", cells: [0, 0, BITS.AMP] },
  ]), display: { showUnaltered: false } } as unknown as Contract;
  assert.deepEqual(table(contractToTsv(c))[0], ["track_name", "track_type", "A", "C"]);
  assert.deepEqual(table(contractToTsv({ ...c, display: { showUnaltered: true } } as unknown as Contract))[0], ["track_name", "track_type", "A", "B", "C"]);
  assert.deepEqual(table(contractToTsv(c, [1, 0]))[0], ["track_name", "track_type", "B", "A"], "the page's order is the columns drawn, as given");
});
