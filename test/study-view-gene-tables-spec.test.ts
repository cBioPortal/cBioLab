// Written from docs/legacy-spec/parity/gene-tables-cases.md, rows GT1–GT7, GS1–GS4, GH1–GH4,
// GD1–GD11, GP1–GP2, GU1–GU2, GU4, GU6, GQ1–GQ3 and GI1–GI2 (one or more tests per row, named by its id), and the legacy source each row cites
// (~/cbioportal-frontend at cd8c6df), without reference to the implementation.
// Covered elsewhere, not here:
//   GR1–GR3 the rows themselves (geneTables / mergeExplore in lib/explore.ts) and the search box
//   GT7     the per-study sum of each profile kind's count happens upstream; profiledSamples is
//           handed counts already summed, and the tests below check it reads them by kind
//   GD1     the menu's Download ▸ Data entry (UI wiring); the file name is checked here
//   GP3     which panels a row holds: scripts/check-gene-panels.ts, against the fixture study
//   GP4, GP5 the panels' order and their merge across connections: test/explore-facets.test.ts
//   GP6, GQ4 UI only, not built
//   GU3, GU5 the Union/Intersection control and appending to the draft (UI wiring)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geneTableName, geneTableTitle, profiledSamples, defaultGeneSort, nextGeneSort,
  geneRowOrder, sortGeneRows, geneHeaderTips, geneTableTsv,
  freqTipLines, geneSelection, appliedLines, toggleQueued, queuedQuery, alteredHeaderTip,
  intersectionRefusal,
  type GeneTableKind, type GeneSort, type GeneSortColumn,
} from "../lib/study-view-gene-tables.ts";
import { chartFileName } from "../lib/study-view-download.ts";
import type { GeneTableRow } from "../lib/types.ts";

const KINDS: GeneTableKind[] = ["mutated", "cna", "sv"];

/** a row whose freqPct agrees with alteredOnPanel (else altered) ÷ profiled */
const r = (
  gene: string, events: number, altered: number, profiled: number,
  extra: Partial<GeneTableRow> = {},
): GeneTableRow => {
  const num = extra.alteredOnPanel ?? altered;
  return {
    gene, events, altered, profiled,
    freqPct: profiled > 0 ? (num / profiled) * 100 : null,
    ...extra,
  };
};
const genes = (rows: GeneTableRow[]) => rows.map(x => x.gene);
const lines = (tsv: string) => tsv.split("\n");
const cells = (tsv: string) => lines(tsv).slice(1).map(l => l.split("\t"));

const HEADER = {
  mutated: "Gene\tMutSig(Q-value)\t# Mut\t#\tProfiled Samples\tFreq",
  sv: "Gene\t# Structural Variant\t#\tProfiled Samples\tFreq",
  cna: "Gene\tGistic(Q-value)\tCytoband\tCNA\tProfiled Samples\t#\tFreq",
} as const;

// ---- names ----

test("names: each kind's table name", () => {
  assert.equal(geneTableName("mutated"), "Mutated Genes");
  assert.equal(geneTableName("cna"), "CNA Genes");
  assert.equal(geneTableName("sv"), "Structural Variant Genes");
});

// ---- GT1–GT3. Title ----

test("GT1: the name with (N profiled samples), N a plain integer", () => {
  assert.equal(geneTableTitle("mutated", 534), "Mutated Genes (534 profiled samples)");
  assert.equal(geneTableTitle("cna", 534), "CNA Genes (534 profiled samples)");
  assert.equal(geneTableTitle("sv", 534), "Structural Variant Genes (534 profiled samples)");
});

test("GT1: no thousands separator", () => {
  assert.equal(geneTableTitle("mutated", 4974), "Mutated Genes (4974 profiled samples)");
  assert.equal(geneTableTitle("cna", 1234567), "CNA Genes (1234567 profiled samples)");
});

test("GT2: one sample is singular", () => {
  assert.equal(geneTableTitle("mutated", 1), "Mutated Genes (1 profiled sample)");
  assert.equal(geneTableTitle("cna", 1), "CNA Genes (1 profiled sample)");
  assert.equal(geneTableTitle("sv", 1), "Structural Variant Genes (1 profiled sample)");
});

test("GT2: two samples are plural", () => {
  assert.equal(geneTableTitle("sv", 2), "Structural Variant Genes (2 profiled samples)");
});

test("GT3: N of 0 gives the bare title", () => {
  for (const k of KINDS) assert.equal(geneTableTitle(k, 0), geneTableName(k));
});

test("GT3: an unknown N gives the bare title", () => {
  for (const k of KINDS) assert.equal(geneTableTitle(k, undefined), geneTableName(k));
});

// ---- GT4–GT7. N ----

test("GT4: mutated reads the mutations kind", () => {
  assert.equal(profiledSamples("mutated", { mutations: 534, cna: 900, fusion: 12 }), 534);
});

test("GT4: no mutations count gives 0, and so the bare title", () => {
  const n = profiledSamples("mutated", { cna: 900, structural_variants: 3 });
  assert.equal(n, 0);
  assert.equal(geneTableTitle("mutated", n), "Mutated Genes");
});

test("GT5: SV reads fusion first", () => {
  assert.equal(profiledSamples("sv", { fusion: 40, structural_variants: 70 }), 40);
});

test("GT5: SV falls back to structural_variants", () => {
  assert.equal(profiledSamples("sv", { structural_variants: 70, mutations: 500 }), 70);
});

test("GT5: a fusion count of 0 falls through to structural_variants (SVU:3650 uses ||)", () => {
  assert.equal(profiledSamples("sv", { fusion: 0, structural_variants: 70 }), 70);
});

test("GT5: neither SV kind gives 0", () => {
  assert.equal(profiledSamples("sv", { mutations: 500, cna: 300 }), 0);
  assert.equal(profiledSamples("sv", {}), 0);
});

test("GT6: CNA priority cna, gistic, cna_rae, cna_consensus", () => {
  const all = { cna: 1, gistic: 2, cna_rae: 3, cna_consensus: 4 };
  assert.equal(profiledSamples("cna", all), 1);
  assert.equal(profiledSamples("cna", { gistic: 2, cna_rae: 3, cna_consensus: 4 }), 2);
  assert.equal(profiledSamples("cna", { cna_rae: 3, cna_consensus: 4 }), 3);
  assert.equal(profiledSamples("cna", { cna_consensus: 4 }), 4);
});

test("GT6: priority is by kind, not by the object's key order", () => {
  assert.equal(profiledSamples("cna", { cna_consensus: 4, cna_rae: 3, gistic: 2 }), 2);
});

test("GT6: a count of 0 falls through to the next kind (SVU:3662 uses ||)", () => {
  assert.equal(profiledSamples("cna", { cna: 0, gistic: 0, cna_rae: 9 }), 9);
});

test("GT6: no CNA kind gives 0, and so the bare title", () => {
  const n = profiledSamples("cna", { mutations: 500, fusion: 10 });
  assert.equal(n, 0);
  assert.equal(geneTableTitle("cna", n), "CNA Genes");
});

test("GT7: counts already summed over studies are read as they are", () => {
  // two studies' mutations kinds (e.g. acc_tcga_mutations 92 + brca_tcga_mutations 982) arrive summed
  assert.equal(profiledSamples("mutated", { mutations: 92 + 982 }), 1074);
  assert.equal(geneTableTitle("mutated", 1074), "Mutated Genes (1074 profiled samples)");
});

test("GT7: a key is a kind, so a study-prefixed profile id is not one", () => {
  assert.equal(profiledSamples("mutated", { acc_tcga_mutations: 92 }), 0);
});

// ---- GS1. Default sort ----

test("GS1: mutated and CNA by Freq, highest first; SV by # SV, highest first", () => {
  assert.deepEqual(defaultGeneSort("mutated"), { column: "freq", desc: true });
  assert.deepEqual(defaultGeneSort("cna"), { column: "freq", desc: true });
  assert.deepEqual(defaultGeneSort("sv"), { column: "events", desc: true });
});

// ---- GS2. The rows' own order ----

test("GS2: events descending, then gene A to Z", () => {
  const rows = [r("B", 3, 1, 10), r("A", 3, 1, 10), r("C", 9, 1, 10), r("D", 1, 5, 10)];
  assert.deepEqual(genes(geneRowOrder(rows)), ["C", "A", "B", "D"]);
});

test("GS2: gene order is by code unit (upper case before lower, digits before letters)", () => {
  const rows = [r("a1", 1, 1, 1), r("Z9", 1, 1, 1), r("C1orf", 1, 1, 1), r("C10orf", 1, 1, 1)];
  assert.deepEqual(genes(geneRowOrder(rows)), ["C10orf", "C1orf", "Z9", "a1"]);
});

test("GS2: a new array; the input is left as it was", () => {
  const rows = [r("B", 1, 1, 1), r("A", 2, 1, 1)];
  const out = geneRowOrder(rows);
  assert.notEqual(out, rows);
  assert.deepEqual(genes(rows), ["B", "A"]);
  assert.deepEqual(genes(out), ["A", "B"]);
});

test("GS2: empty in, empty out", () => {
  assert.deepEqual(geneRowOrder([]), []);
});

test("GS2: keeps extra fields of a subtype", () => {
  const rows = [{ ...r("B", 1, 1, 1), key: "b" }, { ...r("A", 2, 1, 1), key: "a" }];
  assert.deepEqual(geneRowOrder(rows).map(x => x.key), ["a", "b"]);
});

test("GS2: sortGeneRows ties fall back to events desc, then gene", () => {
  // equal altered counts; events and gene decide
  const rows = [r("B", 2, 5, 10), r("C", 7, 5, 10), r("A", 2, 5, 10), r("Z", 1, 9, 10)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "altered", desc: true })), ["Z", "C", "A", "B"]);
});

test("GS2: ties keep the rows' own order in the ascending direction too", () => {
  const rows = [r("B", 2, 5, 10), r("C", 7, 5, 10), r("A", 2, 5, 10), r("Z", 1, 1, 10)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "altered", desc: false })), ["Z", "C", "A", "B"]);
});

test("GS2: equal frequencies tie-break the same way", () => {
  const rows = [r("B", 1, 1, 10), r("A", 1, 2, 20), r("C", 5, 3, 30)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: true })), ["C", "A", "B"]);
});

// ---- GS3. Header click ----

test("GS3: a new numeric column starts highest first", () => {
  const cur: GeneSort = { column: "gene", desc: false };
  for (const col of ["events", "altered", "freq"] as GeneSortColumn[]) {
    assert.deepEqual(nextGeneSort(cur, col), { column: col, desc: true });
  }
});

test("GS3: a new text column (Gene, Cytoband) starts A to Z", () => {
  const cur: GeneSort = { column: "freq", desc: true };
  for (const col of ["gene", "cytoband"] as GeneSortColumn[]) {
    assert.deepEqual(nextGeneSort(cur, col), { column: col, desc: false });
  }
});

test("GS3: CNA starts lowest first (MST:575 defaultSortDirection asc)", () => {
  assert.deepEqual(nextGeneSort({ column: "freq", desc: true }, "cna"), { column: "cna", desc: false });
  assert.deepEqual(nextGeneSort({ column: "gene", desc: true }, "cna"), { column: "cna", desc: false });
});

test("GS3: a new column's start does not depend on the current direction", () => {
  assert.deepEqual(nextGeneSort({ column: "freq", desc: false }, "altered"), { column: "altered", desc: true });
  assert.deepEqual(nextGeneSort({ column: "gene", desc: true }, "cytoband"), { column: "cytoband", desc: false });
});

test("GS3: the same column again reverses, and again restores", () => {
  const a = nextGeneSort({ column: "freq", desc: true }, "freq");
  assert.deepEqual(a, { column: "freq", desc: false });
  assert.deepEqual(nextGeneSort(a, "freq"), { column: "freq", desc: true });
  assert.deepEqual(nextGeneSort({ column: "gene", desc: false }, "gene"), { column: "gene", desc: true });
  assert.deepEqual(nextGeneSort({ column: "cna", desc: true }, "cna"), { column: "cna", desc: false });
});

test("GS3: does not change the sort it is given", () => {
  const cur: GeneSort = { column: "freq", desc: true };
  nextGeneSort(cur, "freq");
  assert.deepEqual(cur, { column: "freq", desc: true });
});

test("GS3: gene sorts A to Z and back", () => {
  const rows = [r("TP53", 9, 9, 10), r("BRAF", 1, 1, 10), r("KRAS", 5, 5, 10)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "gene", desc: false })), ["BRAF", "KRAS", "TP53"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "gene", desc: true })), ["TP53", "KRAS", "BRAF"]);
});

test("GS3: events and altered sort numerically", () => {
  const rows = [r("A", 9, 1, 100), r("B", 10, 2, 100), r("C", 100, 10, 100)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "events", desc: true })), ["C", "B", "A"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "events", desc: false })), ["A", "B", "C"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "altered", desc: true })), ["C", "B", "A"]);
});

test("GS3: Freq sorts by value, not its text (9.5% below 10.0%)", () => {
  const rows = [r("NINE", 5, 19, 200), r("TEN", 5, 20, 200), r("ONE", 5, 2, 200)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: true })), ["TEN", "NINE", "ONE"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: false })), ["ONE", "NINE", "TEN"]);
});

test("GS3: Freq is alteredOnPanel ÷ profiled, not altered ÷ profiled", () => {
  // OFF has more altered samples, but most are off-panel: 2/10 = 20% vs ON 3/10 = 30%
  const rows = [r("OFF", 5, 8, 10, { alteredOnPanel: 2 }), r("ON", 5, 3, 10, { alteredOnPanel: 3 })];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: true })), ["ON", "OFF"]);
});

test("GS3: Freq reads altered when alteredOnPanel is absent", () => {
  const rows = [r("A", 1, 1, 10), r("B", 1, 3, 10, { alteredOnPanel: 2 }), r("C", 1, 5, 10)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: true })), ["C", "B", "A"]);
});

test("GS3: Freq is a ratio, not the altered count", () => {
  // 5/100 = 5% sorts below 2/10 = 20%
  const rows = [r("BIG", 1, 5, 100), r("SMALL", 1, 2, 10)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: true })), ["SMALL", "BIG"]);
});

test("GS3: cytoband sorts A to Z and back", () => {
  const rows = [r("A", 1, 1, 1, { cna: 2, cytoband: "8q24.21" }), r("B", 1, 1, 1, { cna: 2, cytoband: "17p13.1" }),
    r("C", 1, 1, 1, { cna: 2, cytoband: "12p12.1" })];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "cytoband", desc: false })), ["C", "B", "A"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "cytoband", desc: true })), ["A", "B", "C"]);
});

test("GS3: CNA sorts by the call's number, lowest first: HOMDEL (−2) before AMP (2)", () => {
  // AMP has more events, so the rows' own order would put it first; the call's number decides
  const rows = [r("AMPG", 9, 9, 10, { cna: 2 }), r("DELG", 1, 1, 10, { cna: -2 })];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "cna", desc: false })), ["DELG", "AMPG"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "cna", desc: true })), ["AMPG", "DELG"]);
});

test("GS3: CNA is not sorted by the call's text (AMP < HOMDEL alphabetically, yet HOMDEL comes first)", () => {
  const rows = [r("A", 1, 1, 10, { cna: 2 }), r("Z", 1, 1, 10, { cna: -2 })];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "cna", desc: false })), ["Z", "A"]);
});

test("GS3: within a CNA call, rows keep their own order, in both directions", () => {
  const rows = [r("B", 1, 1, 10, { cna: 2 }), r("X", 1, 1, 10, { cna: -2 }), r("A", 1, 1, 10, { cna: 2 }),
    r("C", 4, 1, 10, { cna: 2 }), r("W", 7, 1, 10, { cna: -2 })];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "cna", desc: false })), ["W", "X", "C", "A", "B"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "cna", desc: true })), ["C", "A", "B", "W", "X"]);
});

test("GS3: sortGeneRows returns a new array and leaves the input alone", () => {
  const rows = [r("A", 1, 1, 10), r("B", 1, 5, 10)];
  const out = sortGeneRows(rows, { column: "freq", desc: true });
  assert.notEqual(out, rows);
  assert.deepEqual(genes(rows), ["A", "B"]);
  assert.deepEqual(genes(out), ["B", "A"]);
});

// ---- GS4. No frequency ----

test("GS4: a row with profiled 0 sorts last by Freq, highest first", () => {
  const rows = [r("NOPROF", 9, 3, 0), r("ZERO", 1, 0, 10), r("HALF", 1, 5, 10)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: true })), ["HALF", "ZERO", "NOPROF"]);
});

test("GS4: and last by Freq, lowest first", () => {
  const rows = [r("NOPROF", 9, 3, 0), r("ZERO", 1, 0, 10), r("HALF", 1, 5, 10)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: false })), ["ZERO", "HALF", "NOPROF"]);
});

test("GS4: also when alteredOnPanel is given", () => {
  const rows = [r("NOPROF", 9, 3, 0, { alteredOnPanel: 0 }), r("LOW", 1, 1, 100, { alteredOnPanel: 1 })];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: true })), ["LOW", "NOPROF"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: false })), ["LOW", "NOPROF"]);
});

test("GS4: several unprofiled rows keep their own order among themselves, in both directions", () => {
  const rows = [r("B", 1, 1, 0), r("A", 1, 1, 0), r("C", 5, 1, 0), r("P", 1, 1, 10)];
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: true })), ["P", "C", "A", "B"]);
  assert.deepEqual(genes(sortGeneRows(rows, { column: "freq", desc: false })), ["P", "C", "A", "B"]);
});

// ---- GH1–GH4. Header tooltips ----

const tipsOf = (k: GeneTableKind) => {
  const t = geneHeaderTips(k);
  const all: GeneSortColumn[] = ["gene", "cytoband", "cna", "events", "altered", "freq"];
  return Object.fromEntries(all.map(c => [c, t[c]]));
};

test("GH1: mutated", () => {
  assert.deepEqual(tipsOf("mutated"), {
    gene: undefined, cytoband: undefined, cna: undefined,
    events: "Total number of mutations",
    altered: "Number of samples with one or more mutations",
    freq: "Percentage of samples with one or more mutations",
  });
});

test("GH2: SV", () => {
  assert.deepEqual(tipsOf("sv"), {
    gene: undefined, cytoband: undefined, cna: undefined,
    events: "Total number of structural variants",
    altered: "Number of samples with one or more structural variants",
    freq: "Percentage of samples with one or more structural variants",
  });
});

test("GH3: CNA (no events column)", () => {
  assert.deepEqual(tipsOf("cna"), {
    gene: undefined,
    cytoband: "Cytoband",
    cna: "Copy number alteration, only amplifications and deep deletions are shown",
    events: undefined,
    altered: "Number of samples with one or more copy number alterations",
    freq: "Percentage of samples with one or more copy number alterations",
  });
});

test("GH4: Gene has no tooltip in any table", () => {
  for (const k of KINDS) assert.equal(geneHeaderTips(k).gene, undefined);
});

// ---- GD1. File name ----

test("GD1: the table's name without its count, as a data file", () => {
  assert.equal(chartFileName(geneTableName("mutated"), "data"), "Mutated_Genes.txt");
  assert.equal(chartFileName(geneTableName("cna"), "data"), "CNA_Genes.txt");
  assert.equal(chartFileName(geneTableName("sv"), "data"), "Structural_Variant_Genes.txt");
});

// ---- GD2–GD4. Headers ----

test("GD2: mutated header", () => {
  assert.equal(lines(geneTableTsv("mutated", [r("TP53", 1, 1, 1)]))[0], HEADER.mutated);
});

test("GD3: SV header", () => {
  assert.equal(lines(geneTableTsv("sv", [r("ALK", 1, 1, 1)]))[0], HEADER.sv);
});

test("GD4: CNA header", () => {
  assert.equal(lines(geneTableTsv("cna", [r("MYC", 1, 1, 1, { cna: 2, cytoband: "8q24.21" })]))[0], HEADER.cna);
});

// ---- GD5. Cells ----

test("GD5: mutated row: gene, empty q-value, events, altered, profiled, freq", () => {
  assert.deepEqual(cells(geneTableTsv("mutated", [r("TP53", 12, 9, 20)])), [["TP53", "", "12", "9", "20", "45.0%"]]);
});

test("GD5: SV row: gene, events, altered, profiled, freq", () => {
  assert.deepEqual(cells(geneTableTsv("sv", [r("ALK", 4, 3, 40)])), [["ALK", "4", "3", "40", "7.5%"]]);
});

test("GD5: CNA row: gene, empty q-value, cytoband, call, profiled, altered, freq", () => {
  assert.deepEqual(
    cells(geneTableTsv("cna", [r("MYC", 3, 3, 30, { cna: 2, cytoband: "8q24.21" })])),
    [["MYC", "", "8q24.21", "AMP", "30", "3", "10.0%"]],
  );
});

test("GD5: a deep deletion's call is HOMDEL", () => {
  assert.deepEqual(
    cells(geneTableTsv("cna", [r("CDKN2A", 5, 5, 50, { cna: -2, cytoband: "9p21.3" })]))[0].slice(2, 4),
    ["9p21.3", "HOMDEL"],
  );
});

test("GD5: no cytoband is an empty cell", () => {
  const row = cells(geneTableTsv("cna", [r("X", 1, 1, 10, { cna: 2 })]))[0];
  assert.equal(row.length, 7);
  assert.equal(row[2], "");
  assert.equal(row[3], "AMP");
});

test("GD5: each row has as many cells as the header", () => {
  const rows = [r("A", 1, 1, 10, { cna: 2, cytoband: "1p" }), r("B", 1, 1, 10, { cna: -2 })];
  for (const k of KINDS) {
    const tsv = geneTableTsv(k, rows);
    const width = lines(tsv)[0].split("\t").length;
    for (const row of cells(tsv)) assert.equal(row.length, width, k);
  }
});

// ---- GD6. CNA columns ----

test("GD6: under Profiled Samples the profiled count, under # the altered count", () => {
  const [row] = cells(geneTableTsv("cna", [r("EGFR", 7, 7, 300, { cna: 2, cytoband: "7p11.2" })]));
  const header = HEADER.cna.split("\t");
  assert.equal(row[header.indexOf("Profiled Samples")], "300");
  assert.equal(row[header.indexOf("#")], "7");
});

test("GD6: mutated and SV write # then Profiled Samples, each under its own header", () => {
  for (const k of ["mutated", "sv"] as const) {
    const header = HEADER[k].split("\t");
    const [row] = cells(geneTableTsv(k, [r("G", 8, 7, 300)]));
    assert.equal(row[header.indexOf("#")], "7", k);
    assert.equal(row[header.indexOf("Profiled Samples")], "300", k);
  }
});

// ---- GD7. Freq ----

const freqOf = (k: GeneTableKind, row: GeneTableRow) => {
  const [c] = cells(geneTableTsv(k, [row]));
  return c[c.length - 1];
};

test("GD7: Freq is alteredOnPanel ÷ profiled, while # is every altered sample", () => {
  const row = r("BRCA2", 6, 5, 10, { alteredOnPanel: 2 });
  for (const k of ["mutated", "sv"] as const) {
    const [c] = cells(geneTableTsv(k, [row]));
    const header = HEADER[k].split("\t");
    assert.equal(c[header.indexOf("#")], "5", k);
    assert.equal(c[header.indexOf("Freq")], "20.0%", k);
  }
  assert.equal(freqOf("cna", { ...row, cna: 2 }), "20.0%");
});

test("GD7: Freq reads altered when alteredOnPanel is absent", () => {
  assert.equal(freqOf("mutated", r("A", 3, 3, 4)), "75.0%");
});

test("GD7: NA with no profiled sample", () => {
  for (const k of KINDS) assert.equal(freqOf(k, r("A", 3, 3, 0, { cna: 2 })), "NA", k);
});

test("GD7: portalFreq's forms: 0%, <0.1%, one decimal, 99.9%, 100.0%", () => {
  assert.equal(freqOf("mutated", r("A", 0, 0, 10)), "0%");
  assert.equal(freqOf("mutated", r("A", 1, 1, 2000)), "<0.1%");
  assert.equal(freqOf("mutated", r("A", 1, 1, 1000)), "0.1%");
  assert.equal(freqOf("mutated", r("A", 1, 1, 3)), "33.3%");
  assert.equal(freqOf("mutated", r("A", 1999, 1999, 2000)), "99.9%");
  assert.equal(freqOf("mutated", r("A", 10, 10, 10)), "100.0%");
});

test("GD7: on-panel 0 of profiled is 0%, not NA", () => {
  assert.equal(freqOf("mutated", r("A", 4, 4, 10, { alteredOnPanel: 0 })), "0%");
});

// ---- GD8. Rows and order ----

test("GD8: rows in their own order: events desc, then gene A to Z", () => {
  const rows = [r("B", 2, 2, 10), r("A", 2, 9, 10), r("C", 8, 1, 10), r("D", 1, 10, 10)];
  assert.deepEqual(cells(geneTableTsv("mutated", rows)).map(c => c[0]), ["C", "A", "B", "D"]);
});

test("GD8: the same file whatever order the rows are passed in", () => {
  const rows = [r("B", 2, 2, 10), r("A", 2, 9, 10), r("C", 8, 1, 10), r("D", 1, 10, 10)];
  const sortedByFreq = sortGeneRows(rows, { column: "freq", desc: true });
  for (const k of KINDS) {
    const base = geneTableTsv(k, rows.map(x => ({ ...x, cna: 2 })));
    assert.equal(geneTableTsv(k, [...rows].reverse().map(x => ({ ...x, cna: 2 }))), base, k);
    assert.equal(geneTableTsv(k, sortedByFreq.map(x => ({ ...x, cna: 2 }))), base, k);
  }
});

test("GD8: every row is written", () => {
  const rows = Array.from({ length: 250 }, (_, i) => r(`G${String(i).padStart(3, "0")}`, 1, 1, 10));
  assert.equal(cells(geneTableTsv("mutated", rows)).length, 250);
});

test("GD8: does not reorder the array it is given", () => {
  const rows = [r("B", 1, 1, 10), r("A", 5, 1, 10)];
  geneTableTsv("mutated", rows);
  assert.deepEqual(genes(rows), ["B", "A"]);
});

test("GD8: CNA rows of one gene with both calls are both written", () => {
  const rows = [r("G", 1, 1, 10, { cna: -2, cytoband: "1p" }), r("G", 1, 2, 10, { cna: 2, cytoband: "1p" })];
  const out = cells(geneTableTsv("cna", rows));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(c => c[3]).sort(), ["AMP", "HOMDEL"]);
});

// ---- GD9. No OncoKB column ----

test("GD9: no Is Cancer Gene column", () => {
  for (const k of KINDS) {
    const tsv = geneTableTsv(k, [r("TP53", 1, 1, 1, { cna: 2 })]);
    assert.ok(!tsv.includes("Is Cancer Gene"), k);
    assert.ok(!tsv.includes("OncoKB"), k);
  }
});

// ---- GD10. Layout ----

test("GD10: tab-separated, LF, nothing after the last line", () => {
  const tsv = geneTableTsv("sv", [r("A", 2, 1, 10), r("B", 1, 1, 10)]);
  assert.equal(tsv, `${HEADER.sv}\nA\t2\t1\t10\t10.0%\nB\t1\t1\t10\t10.0%`);
  assert.ok(!tsv.includes("\r"));
  assert.ok(!tsv.endsWith("\n"));
});

test("GD10: plain integers, no thousands separator", () => {
  const [c] = cells(geneTableTsv("mutated", [r("TTN", 12345, 4974, 10000)]));
  assert.deepEqual(c, ["TTN", "", "12345", "4974", "10000", "49.7%"]);
  const [d] = cells(geneTableTsv("cna", [r("MYC", 1, 2500, 10000, { cna: 2, cytoband: "8q24.21" })]));
  assert.deepEqual(d.slice(4, 6), ["10000", "2500"]);
});

// ---- GD11. Empty table ----

test("GD11: no rows gives the header alone, with no trailing LF", () => {
  for (const k of KINDS) assert.equal(geneTableTsv(k, []), HEADER[k], k);
});

// ---- GP1–GP2. The Freq cell's tooltip (TableUtils.tsx:110-131, StudyViewGenePanelModal.tsx:20-44) ----

test("GP1: mutated — three lines, N the altered samples on a covering panel, M the profiled", () => {
  const row = r("TP53", 9, 7, 40, { alteredOnPanel: 5, panels: ["IMPACT341", "IMPACT468"] });
  assert.deepEqual(freqTipLines("mutated", row), [
    "# of samples with a mutation in this gene that are also profiled for mutations: 5",
    "# of samples profiled for mutations in this gene: 40",
    "Gene panels: IMPACT341, IMPACT468",
  ]);
});

test("GP1: sv and cna name their alteration type, singular then plural (type.replace(/s$/, ''))", () => {
  const row = r("ALK", 3, 2, 10, { panels: ["WES"] });
  assert.deepEqual(freqTipLines("sv", row).slice(0, 2), [
    "# of samples with a structural variant in this gene that are also profiled for structural variants: 2",
    "# of samples profiled for structural variants in this gene: 10",
  ]);
  assert.deepEqual(freqTipLines("cna", r("MYC", 3, 2, 10, { cna: 2, panels: ["WES"] })).slice(0, 2), [
    "# of samples with a copy number alteration in this gene that are also profiled for copy number alterations: 2",
    "# of samples profiled for copy number alterations in this gene: 10",
  ]);
});

test("GP1: without alteredOnPanel (a peer that predates it) N is the altered count", () => {
  const [first] = freqTipLines("mutated", r("KRAS", 4, 3, 12, { panels: ["A"] }));
  assert.equal(first, "# of samples with a mutation in this gene that are also profiled for mutations: 3");
});

test("GP1: N of 0 is written, not dropped", () => {
  const [first] = freqTipLines("mutated", r("EGFR", 3, 3, 7, { alteredOnPanel: 0, panels: [] }));
  assert.equal(first, "# of samples with a mutation in this gene that are also profiled for mutations: 0");
});

test("GP1: numbers carry thousands separators (toLocaleString)", () => {
  const lines = freqTipLines("mutated", r("TTN", 12345, 4974, 1234567, { alteredOnPanel: 4974, panels: ["WES"] }));
  assert.equal(lines[0], "# of samples with a mutation in this gene that are also profiled for mutations: 4,974");
  assert.equal(lines[1], "# of samples profiled for mutations in this gene: 1,234,567");
});

test("GP2: the panel line lists the row's panels as given, comma-separated", () => {
  assert.equal(freqTipLines("cna", r("MYC", 1, 1, 1, { cna: 2, panels: ["A", "B", "WES"] }))[2], "Gene panels: A, B, WES");
  assert.equal(freqTipLines("mutated", r("KRAS", 1, 1, 1, { panels: ["ONLY"] }))[2], "Gene panels: ONLY");
  // the row's list is sorted upstream (GP4); the tooltip does not re-sort it
  assert.equal(freqTipLines("mutated", r("KRAS", 1, 1, 1, { panels: ["Z", "A"] }))[2], "Gene panels: Z, A");
});

test("GP2: no panels, or no panels field, gives \"Gene panels: none\"", () => {
  assert.equal(freqTipLines("mutated", r("EGFR", 1, 1, 1, { panels: [] }))[2], "Gene panels: none");
  assert.equal(freqTipLines("sv", r("EGFR", 1, 1, 1))[2], "Gene panels: none");
  assert.equal(freqTipLines("cna", r("EGFR", 1, 1, 1, { cna: -2 })).length, 3);
});

// ---- GU1–GU2. Union / Intersection (STS-GT-9; MultiSelectionTable.tsx) ----

test("GU1: union of several lines is one OQL clause, the lines joined by \"; \"", () => {
  assert.deepEqual(geneSelection(["TP53: MUT", "KRAS: MUT", "EGFR: MUT"], "union"),
    [{ kind: "oql", q: "TP53: MUT; KRAS: MUT; EGFR: MUT" }]);
  assert.deepEqual(geneSelection(["MYC: AMP", "CDKN2A: HOMDEL"], "union"),
    [{ kind: "oql", q: "MYC: AMP; CDKN2A: HOMDEL" }]);
});

test("GU2: intersection is one OQL clause per line, in the given order", () => {
  assert.deepEqual(geneSelection(["TP53: MUT", "KRAS: MUT", "EGFR: MUT"], "intersection"), [
    { kind: "oql", q: "TP53: MUT" }, { kind: "oql", q: "KRAS: MUT" }, { kind: "oql", q: "EGFR: MUT" },
  ]);
});

test("GU1/GU2: one line is the same single clause either way", () => {
  for (const op of ["union", "intersection"] as const)
    assert.deepEqual(geneSelection(["MYC: AMP"], op), [{ kind: "oql", q: "MYC: AMP" }], op);
});

test("GU1/GU2: no lines, no clauses (never an empty query)", () => {
  for (const op of ["union", "intersection"] as const) assert.deepEqual(geneSelection([], op), [], op);
});

// ---- GU4. Applied rows (STS-GT-9: pinned, checked, disabled, in the filter's order) ----

test("GU4: the lines a top-level OQL clause already holds, in clause order then line order", () => {
  const clauses = [
    { kind: "clinical", attribute: "SEX", op: "=", value: "Female" },
    { kind: "oql", q: "KRAS: MUT; TP53: MUT" },
    { kind: "oql", q: "EGFR: MUT" },
  ];
  assert.deepEqual(appliedLines(clauses, ["EGFR: MUT", "TP53: MUT", "KRAS: MUT", "BRAF: MUT"]),
    ["KRAS: MUT", "TP53: MUT", "EGFR: MUT"]);
});

test("GU4: a line in two clauses is listed once, where it first appears", () => {
  const clauses = [{ kind: "oql", q: "TP53: MUT" }, { kind: "oql", q: "KRAS: MUT; TP53: MUT" }];
  assert.deepEqual(appliedLines(clauses, ["KRAS: MUT", "TP53: MUT"]), ["TP53: MUT", "KRAS: MUT"]);
});

test("GU4: the clause's lines are trimmed before matching", () => {
  assert.deepEqual(appliedLines([{ kind: "oql", q: "  KRAS: MUT ;TP53: MUT  " }], ["TP53: MUT", "KRAS: MUT"]),
    ["KRAS: MUT", "TP53: MUT"]);
});

test("GU4: a line matches whole — another call of the same gene is not applied", () => {
  assert.deepEqual(appliedLines([{ kind: "oql", q: "MYC: HOMDEL" }], ["MYC: AMP"]), []);
  assert.deepEqual(appliedLines([{ kind: "oql", q: "KRAS: MUT = G12C" }], ["KRAS: MUT"]), []);
});

test("GU4: only top-level OQL clauses count — negated, nested and other kinds do not", () => {
  const clauses = [
    { not: { kind: "oql", q: "TP53: MUT" } },
    { any: [{ kind: "oql", q: "KRAS: MUT" }] },
    { kind: "profiled", type: "MUTATION", gene: "EGFR" },
    { kind: "clinical", attribute: "q", op: "=", value: "EGFR: MUT" },
  ];
  assert.deepEqual(appliedLines(clauses, ["TP53: MUT", "KRAS: MUT", "EGFR: MUT"]), []);
});

test("GU4: no clauses, or no lines, gives nothing; junk entries are passed over", () => {
  assert.deepEqual(appliedLines([], ["TP53: MUT"]), []);
  assert.deepEqual(appliedLines([{ kind: "oql", q: "TP53: MUT" }], []), []);
  assert.deepEqual(appliedLines([null, "TP53: MUT", 3, { kind: "oql" }, { kind: "oql", q: "TP53: MUT" }], ["TP53: MUT"]), ["TP53: MUT"]);
});

// ---- GU6. Intersection past the 8-clause limit (lib/cohort2.ts all: 0-8 clauses) ----

test("GU6: fits when filters + genes stay at or under 8", () => {
  assert.equal(intersectionRefusal(0, 8), null);
  assert.equal(intersectionRefusal(6, 2), null);
  assert.equal(intersectionRefusal(7, 1), null);
  assert.equal(intersectionRefusal(0, 1), null);
});

test("GU6: refused past 8, naming the count it would make and the limit", () => {
  for (const [filters, genes] of [[0, 9], [6, 3], [8, 1]] as const) {
    const msg = intersectionRefusal(filters, genes);
    assert.equal(typeof msg, "string", `${filters} + ${genes}`);
    assert.match(msg!, new RegExp("\\b" + (filters + genes) + "\\b"), `${filters} + ${genes}: the count`);
    assert.match(msg!, /\b8\b/, `${filters} + ${genes}: the limit`);
  }
});

// ---- GQ1–GQ3. The query queue (GeneCell.tsx; StudyViewPageStore.ts:3174-3189; StudyViewUtils.tsx:617-635) ----

test("GQ1/GQ2: a gene not queued is appended, with the queued message", () => {
  assert.deepEqual(toggleQueued([], "TP53"),
    { queue: ["TP53"], message: "TP53 queued for query (see top right of page for submit)" });
  assert.deepEqual(toggleQueued(["TP53", "KRAS"], "EGFR"),
    { queue: ["TP53", "KRAS", "EGFR"], message: "EGFR queued for query (see top right of page for submit)" });
});

test("GQ1/GQ2: a queued gene is removed, the others keeping their order, with the removed message", () => {
  assert.deepEqual(toggleQueued(["TP53", "KRAS", "EGFR"], "KRAS"),
    { queue: ["TP53", "EGFR"], message: "KRAS removed from query queue" });
  assert.deepEqual(toggleQueued(["TP53"], "TP53"), { queue: [], message: "TP53 removed from query queue" });
});

test("GQ1: toggling twice restores the queue; the input is not changed", () => {
  const q = ["TP53", "KRAS"];
  const once = toggleQueued(q, "EGFR");
  assert.deepEqual(q, ["TP53", "KRAS"]);
  assert.deepEqual(toggleQueued(once.queue, "EGFR").queue, q);
});

test("GQ1: gene symbols match exactly (case-sensitive)", () => {
  assert.deepEqual(toggleQueued(["TP53"], "tp53").queue, ["TP53", "tp53"]);
});

test("GQ3: the query is the queued genes one per line, in queue order", () => {
  assert.equal(queuedQuery(["TP53", "KRAS", "EGFR"]), "TP53\nKRAS\nEGFR");
  assert.equal(queuedQuery(["MYC"]), "MYC");
  assert.equal(queuedQuery([]), "");
});

// ---- GI1–GI2. The "#" header under the Alteration Filter (ChartContainer.tsx:728-1066) ----

const FILTER_NOTE = "This table is filtered based on selections in the Alteration Filter menu.";

test("GI2: unfiltered, the plain \"#\" tooltip (GH1–GH3)", () => {
  for (const k of KINDS) assert.equal(alteredHeaderTip(k, false), geneHeaderTips(k).altered, k);
  assert.equal(alteredHeaderTip("mutated", false), "Number of samples with one or more mutations");
});

test("GI1: filtered, the portal's first line then the filter note on a line of its own", () => {
  // the first lines are the portal's own (ChartContainer.tsx:733-739 mutated, 879-885 SV,
  // 1056-1063 CNA), including its "Total number of …" on the mutated and SV "#" column
  assert.equal(alteredHeaderTip("mutated", true), "Total number of mutations\n" + FILTER_NOTE);
  assert.equal(alteredHeaderTip("sv", true), "Total number of fusions\n" + FILTER_NOTE);
  assert.equal(alteredHeaderTip("cna", true), "Number of samples with one or more copy number alterations\n" + FILTER_NOTE);
});

test("GI1: every filtered tooltip ends with the note", () => {
  for (const k of KINDS) assert.ok(alteredHeaderTip(k, true).endsWith("\n" + FILTER_NOTE), k);
});

test("Intersection's refusal names the row it adds a filter for: a gene by default, or a kind of data", () => {
  assert.equal(intersectionRefusal(7, 2), "Intersection adds a filter per gene, which would make 9 filters; a selection holds at most 8 (Union adds one)");
  assert.equal(intersectionRefusal(7, 2, "kind of data"), "Intersection adds a filter per kind of data, which would make 9 filters; a selection holds at most 8 (Union adds one)");
  assert.equal(intersectionRefusal(6, 2, "kind of data"), null);
});
