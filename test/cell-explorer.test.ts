// Cell Explorer links, both ways (lib/cell-explorer.ts): what a link carries, and what a pasted
// link or list is read as — or refused for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellExplorerFor, cellExplorerUrl, donorsFromInput, CELL_EXPLORER_MAX_DONORS } from "../lib/cell-explorer.ts";

const d = cellExplorerFor("msk_spectrum_tme_2022")!;

test("a study without a dataset has no link", () => {
  assert.equal(cellExplorerFor("luad_mskimpact_2021"), null);
  assert.equal(d.dataset, "spectrum");
});

test("a link opens the dataset filtered to the cohort's donors, coloured as the dataset opens", () => {
  const url = cellExplorerUrl(d, ["SPECTRUM-OV-002", "SPECTRUM-OV-007"]);
  assert.ok(url.startsWith("https://cell-explorer.cbioportal.org/view?config="));
  const cfg = JSON.parse(new URL(url).searchParams.get("config")!);
  assert.deepEqual(cfg.filter, { obsColumn: "donor_id", ids: ["SPECTRUM-OV-002", "SPECTRUM-OV-007"] });
  assert.equal(cfg.dataset, "spectrum");
  assert.equal(cfg.category, "author_cell_type");
  assert.throws(() => cellExplorerUrl(d, []), /no donors/);
  assert.throws(() => cellExplorerUrl(d, Array.from({ length: CELL_EXPLORER_MAX_DONORS + 1 }, (_, i) => "D" + i)), /at most 500 donors; this cohort has 501/);
});

test("a link made here reads back as the same donors", () => {
  const ids = ["SPECTRUM-OV-002", "SPECTRUM-OV-007", "SPECTRUM-OV-118"];
  assert.deepEqual(donorsFromInput(d, cellExplorerUrl(d, ids)), { donors: ids, from: "link" });
});

test("a pasted list is split on commas, spaces and lines, once each", () => {
  assert.deepEqual(donorsFromInput(d, "SPECTRUM-OV-002, SPECTRUM-OV-007\nSPECTRUM-OV-002;SPECTRUM-OV-009"),
    { donors: ["SPECTRUM-OV-002", "SPECTRUM-OV-007", "SPECTRUM-OV-009"], from: "list" });
});

test("a link that names no donors of this dataset is refused, saying why", () => {
  assert.throws(() => donorsFromInput(d, ""), /paste a Cell Explorer link/);
  assert.throws(() => donorsFromInput(d, "https://cell-explorer.cbioportal.org/view?dataset=spectrum"), /opens the whole “spectrum” dataset/);
  const other = (cfg: object) => "https://cell-explorer.cbioportal.org/view?config=" + encodeURIComponent(JSON.stringify(cfg));
  assert.throws(() => donorsFromInput(d, other({ dataset: "pbmc", filter: { obsColumn: "donor_id", ids: ["x"] } })), /for the “pbmc” dataset/);
  assert.throws(() => donorsFromInput(d, other({ dataset: "spectrum", filter: { obsColumn: "author_cell_type", ids: ["T.cell"] } })), /filters on "author_cell_type"/);
  assert.throws(() => donorsFromInput(d, other({ dataset: "spectrum" })), /shows every cell/);
  assert.throws(() => donorsFromInput(d, "https://cell-explorer.cbioportal.org/view?config=%7Bnot-json"), /cannot be read/);
});
