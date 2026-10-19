// The single-cell summary (lib/singlecell/summary.ts): what it judges a column to be, the numbers it
// writes for a case, the minimums and filters, and the datasets it makes — on columns built by hand,
// so every expected value can be counted by eye.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fmtValue, colName, judgeColumns, variesWithin, summariseSource, toDatasets, validateConfig, datasetTsv,
  type SingleCellConfig
} from "../lib/singlecell/summary.ts";
import type { ObsColumn } from "../lib/singlecell/zarr.ts";

const L = (...v: (string | null)[]): ObsColumn => ({ kind: "label", values: v });
const N = (...v: number[]): ObsColumn => ({ kind: "number", values: Float64Array.from(v) });

test("values are written with 4 significant digits, in the '%.4g' style", () => {
  assert.equal(fmtValue(0.5), "0.5");
  assert.equal(fmtValue(1 / 3), "0.3333");
  assert.equal(fmtValue(0.001399), "0.001399");
  assert.equal(fmtValue(0.00001234), "1.234e-05");
  assert.equal(fmtValue(12345.6), "1.235e+04");
  assert.equal(fmtValue(1430), "1430");
  assert.equal(fmtValue(-0.4567), "-0.4567");
  assert.equal(fmtValue(null), "");
  assert.equal(fmtValue(NaN), "");
});

test("a column is judged by its type, name and number of values, and says why", () => {
  const j = judgeColumns([
    { name: "donor_id", dtype: "categorical", cardinality: 4 },
    { name: "Sample ID", dtype: "categorical", cardinality: 8 },
    { name: "cell_type_ontology_term_id", dtype: "categorical", cardinality: 9 },
    { name: "Cell_Type", dtype: "categorical", cardinality: 9 },
    { name: "barcode", dtype: "categorical", cardinality: 50000 },
    { name: "Module Squamous Score", dtype: "numeric", cardinality: null },
    { name: "total_counts", dtype: "numeric", cardinality: null },
    { name: "x_umap", dtype: "numeric", cardinality: null },
  ], { patient: "donor_id", sample: "Sample ID" });
  const role = Object.fromEntries(j.map((x) => [x.name, x.role]));
  assert.deepEqual(role, { donor_id: "skip", "Sample ID": "skip", cell_type_ontology_term_id: "skip", Cell_Type: "label", barcode: "skip",
    "Module Squamous Score": "score", total_counts: "skip", x_umap: "skip" });
  assert.ok(j.every((x) => x.why.length > 0));
  assert.match(j.find((x) => x.name === "barcode")!.why, /50,000 values/);
});

test("a column that never varies within a sample describes the sample, not the cell", () => {
  const sample = L("s1", "s1", "s2", "s2");
  assert.equal(variesWithin(L("liver", "liver", "lung", "lung"), sample), false);
  assert.equal(variesWithin(L("T", "B", "T", "T"), sample), true);
});

const cfg = (over: Partial<SingleCellConfig> = {}): SingleCellConfig => ({
  study: "st", id: "t-sc", name: "Test", patient: { obs: "donor", attribute: null }, sample: { obs: "sample", attribute: null },
  sources: [{ zarr: "x", prefix: "A", labels: ["type"], scores: ["score"], where: {} }], minCells: 2, minScoreCells: 2, ...over,
});
// six cells: patient P1 (samples S1 ×3, S2 ×1), patient P2 (S3 ×2); one cell of an unknown donor
const cols = new Map<string, ObsColumn>([
  ["donor", L("d1", "d1", "d1", "d1", "d2", "d2", "dx")],
  ["sample", L("s1", "s1", "s1", "s2", "s3", "s3", "sx")],
  ["type", L("T", "B", "T", "T", "B", null, "T")],
  ["score", N(1, 2, 3, 10, 5, NaN, 7)],
  ["tissue", L("tumor", "tumor", "normal", "tumor", "tumor", "tumor", "tumor")],
]);
const P: Record<string, string> = { d1: "P1", d2: "P2" }, S: Record<string, string> = { s1: "S1", s2: "S2", s3: "S3" };

test("shares and means per patient and per sample, with the minimums leaving blanks", () => {
  const c = cfg();
  const s = summariseSource(c, c.sources[0], cols, (v) => P[v], (v) => S[v]);
  assert.deepEqual(s.cells, { read: 7, kept: 7, patient: 6, sample: 6 });
  const p1 = s.patients.get("P1")!;
  assert.equal(p1.get("A_N_CELLS"), 4);
  assert.equal(p1.get("A_type_T"), 3 / 4);
  assert.equal(p1.get("A_type_B"), 1 / 4);
  assert.equal(p1.get("A_SCORE_score"), (1 + 2 + 3 + 10) / 4);
  // P2: two cells, one without a type — the share's denominator is every cell, the mean's every cell with a number
  const p2 = s.patients.get("P2")!;
  assert.equal(p2.get("A_type_B"), 1 / 2);
  assert.equal(p2.get("A_type_T"), 0);
  assert.equal(p2.get("A_SCORE_score"), null, "one cell with a score is under minScoreCells = 2");
  // S2 has one cell: under minCells, so its shares are blank
  assert.equal(s.samples.get("S2")!.get("A_type_T"), null);
  assert.equal(s.samples.get("S1")!.get("A_type_T"), 2 / 3);
  assert.deepEqual(s.columns.patient, ["A_N_CELLS", "A_type_B", "A_type_T", "A_SCORE_score"]);
});

test("a filter keeps only the cells whose column takes the ticked values", () => {
  const c = cfg({ sources: [{ zarr: "x", prefix: "A", labels: ["type"], scores: [], where: { tissue: ["tumor"] } }] });
  const s = summariseSource(c, c.sources[0], cols, (v) => P[v], (v) => S[v]);
  assert.equal(s.cells.kept, 6);
  assert.equal(s.patients.get("P1")!.get("A_N_CELLS"), 3);
  assert.equal(s.patients.get("P1")!.get("A_type_T"), 2 / 3);
});

test("datasets: one per level, columns no case has dropped, rows in id order, sample rows naming their patient", () => {
  const c = cfg();
  const s = summariseSource(c, c.sources[0], cols, (v) => P[v], (v) => S[v]);
  const ds = toDatasets(c, [s], (sid) => ({ S1: "P1", S2: "P1", S3: "P2" } as Record<string, string>)[sid]);
  assert.deepEqual(ds.map((d) => [d.id, d.level, d.rows.length]), [["t-sc-p", "patient", 2], ["t-sc-s", "sample", 3]]);
  const smp = ds[1];
  assert.deepEqual(smp.rows.map((r) => [r.patient, r.sample]), [["P1", "S1"], ["P1", "S2"], ["P2", "S3"]]);
  assert.deepEqual(ds[0].rows[0].values, ["4", "0.25", "0.75", "4"]);
  assert.equal(datasetTsv(ds[0]).split("\n")[0], "PATIENT_ID\tA_N_CELLS\tA_type_B\tA_type_T\tA_SCORE_score");
});

test("a config is checked before anything is read", () => {
  assert.doesNotThrow(() => validateConfig(cfg()));
  assert.throws(() => validateConfig(cfg({ id: "Bad Id" })), /id is lowercase/);
  assert.throws(() => validateConfig(cfg({ sources: [{ zarr: "x", prefix: "A", labels: [], scores: [], where: {} }] })), /keeps no label and no score/);
  assert.throws(() => validateConfig(cfg({ sources: [{ zarr: "x", prefix: "A", labels: ["t"], scores: [], where: {} }, { zarr: "y", prefix: "A", labels: ["t"], scores: [], where: {} }] })), /share the prefix A/);
  assert.equal(colName("Module Tumor ISC-like Score"), "Module_Tumor_ISC_like_Score");
});
