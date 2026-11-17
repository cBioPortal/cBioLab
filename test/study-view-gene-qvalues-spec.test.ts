// Written from docs/legacy-spec/parity/gene-tables-cases.md, rows QV1–QV3 and QV5–QV7 (with GD2, GD4,
// GD5 for the download's other cells), without reference to the implementation.
// Covered elsewhere, not here:
//   QV1, QV2 reading the study's mut_sig / gistic tables (geneTables in lib/explore.ts)
//   QV4      several studies carry no q-value (the merge in lib/explore.ts)
//   QV5      the icon's placement after the gene symbol (UI wiring)
import { test } from "node:test";
import assert from "node:assert/strict";
import { portalQValue, portalQTip } from "../lib/chart/format.ts";
import { qValueIcon, gisticQValues, withQValues, geneTableTsv } from "../lib/study-view-gene-tables.ts";
import type { GeneTableRow } from "../lib/types.ts";

const r = (gene: string, events: number, altered: number, profiled: number, extra: Partial<GeneTableRow> = {}): GeneTableRow => ({
  gene, events, altered, profiled,
  freqPct: profiled > 0 ? (altered / profiled) * 100 : null,
  ...extra,
});

/** the data line's cells and the header's, for a one-row table */
const tsvRow = (tsv: string): { header: string[]; row: string[] } => {
  const [h, l] = tsv.split("\n");
  return { header: h.split("\t"), row: l.split("\t") };
};

const MUTSIG_TIP = [
  "Candidate driver gene, as determined by the MutSig algorithm.",
  "MutSig identifies likely driver genes by evaluating the frequency of observed mutations within the entire study.",
  "Note that not all mutations in this gene are necessarily functional/driver events.",
];
const GISTIC_TIP = [
  "Candidate driver gene, as determined by the GISTIC algorithm.",
  "The GISTIC algorithm identifies likely driver copy number alterations by evaluating the frequency and amplitude of observed CNA events within the entire study.",
];

// ---- QV7. portalQValue ----

test("QV7: portalQValue writes 0 as \"0\" and anything else as toExponential(3)", () => {
  assert.equal(portalQValue(0), "0");
  assert.equal(portalQValue(2.12e-12), "2.120e-12");
  assert.equal(portalQValue(0.00999999), "1.000e-2");
  assert.equal(portalQValue(0.5), "5.000e-1");
  assert.equal(portalQValue(1), "1.000e+0");
});

// ---- QV6. portalQTip ----

test("QV6: portalQTip writes toExponential(3), 0 included", () => {
  assert.equal(portalQTip(2.12e-12), "2.120e-12");
  assert.equal(portalQTip(0), "0.000e+0");
});

// ---- QV2. gisticQValues ----

test("QV2: gisticQValues keeps the lowest q of the regions listing a gene with a call", () => {
  const m = gisticQValues([
    { gene: "MYC", amp: true, q: 0.01 },
    { gene: "MYC", amp: true, q: 0.001 },
    { gene: "MYC", amp: false, q: 0.2 },
  ]);
  assert.equal(m.get("MYC|2"), 0.001);
  assert.equal(m.get("MYC|-2"), 0.2);
  assert.equal(m.size, 2);
});

test("QV2: gisticQValues of no regions is an empty map", () => {
  assert.equal(gisticQValues([]).size, 0);
});

// ---- QV1–QV3. withQValues ----

test("QV1: a mutated row takes MutSig's q-value for its gene; a gene MutSig lacks has none", () => {
  const rows = [r("TP53", 10, 8, 20), r("KRAS", 5, 5, 20)];
  const before = structuredClone(rows);
  const out = withQValues("mutated", rows, new Map([["TP53", 2.12e-12]]), new Map([["KRAS|2", 0.1]]));
  assert.deepEqual(out.map((x) => x.gene), ["TP53", "KRAS"]);
  assert.equal(out[0].qValue, 2.12e-12);
  assert.equal(out[1].qValue, undefined);
  assert.deepEqual({ ...out[0], qValue: undefined }, { ...before[0], qValue: undefined });
  assert.deepEqual({ ...out[1], qValue: undefined }, { ...before[1], qValue: undefined });
  assert.deepEqual(rows, before, "input not mutated");
});

test("QV1: a MutSig q-value of 0 is kept", () => {
  const out = withQValues("mutated", [r("TP53", 1, 1, 1)], new Map([["TP53", 0]]), new Map());
  assert.equal(out[0].qValue, 0);
});

test("QV2: a CNA row takes GISTIC's q-value for its own gene and call; AMP of a gene GISTIC lists only as deleted has none", () => {
  const rows = [
    r("MYC", 3, 3, 30, { cna: 2, cytoband: "8q24.21" }),
    r("CDKN2A", 5, 5, 30, { cna: -2, cytoband: "9p21.3" }),
    r("PTEN", 2, 2, 30, { cna: 2, cytoband: "10q23.31" }),
  ];
  const before = structuredClone(rows);
  const gistic = new Map([["MYC|2", 0.001], ["CDKN2A|-2", 1e-20], ["PTEN|-2", 0.05]]);
  const out = withQValues("cna", rows, new Map([["PTEN", 0.3]]), gistic);
  assert.deepEqual(out.map((x) => x.gene), ["MYC", "CDKN2A", "PTEN"]);
  assert.equal(out[0].qValue, 0.001);
  assert.equal(out[1].qValue, 1e-20);
  assert.equal(out[2].qValue, undefined);
  for (let i = 0; i < rows.length; i++) assert.deepEqual({ ...out[i], qValue: undefined }, { ...before[i], qValue: undefined });
  assert.deepEqual(rows, before, "input not mutated");
});

test("QV3: no SV row takes a q-value, whatever the maps hold", () => {
  const rows = [r("ALK", 4, 3, 40), r("EML4", 2, 2, 40)];
  const before = structuredClone(rows);
  const out = withQValues("sv", rows, new Map([["ALK", 0.01], ["EML4", 0]]), new Map([["ALK|2", 0.01], ["EML4|-2", 0.02]]));
  assert.deepEqual(out.map((x) => x.gene), ["ALK", "EML4"]);
  for (const x of out) assert.equal(x.qValue, undefined);
  for (let i = 0; i < rows.length; i++) assert.deepEqual({ ...out[i], qValue: undefined }, { ...before[i], qValue: undefined });
  assert.deepEqual(rows, before, "input not mutated");
});

// ---- QV5, QV6. qValueIcon ----

test("QV5/QV6: a mutated row with a q-value shows \"M\" with MutSig's tooltip", () => {
  assert.deepEqual(qValueIcon("mutated", 2.12e-12), { text: "M", tip: [...MUTSIG_TIP, "Q-value: 2.120e-12"] });
});

test("QV5/QV6: a CNA row with a q-value shows \"G\" with GISTIC's tooltip", () => {
  assert.deepEqual(qValueIcon("cna", 2.12e-12), { text: "G", tip: [...GISTIC_TIP, "Q-value: 2.120e-12"] });
});

test("QV5: no icon on the SV table, nor without a q-value", () => {
  assert.equal(qValueIcon("sv", 0.01), null);
  assert.equal(qValueIcon("mutated", undefined), null);
  assert.equal(qValueIcon("cna", undefined), null);
  assert.equal(qValueIcon("sv", undefined), null);
});

test("QV5/QV6: a q-value of 0 shows its icon, written 0.000e+0", () => {
  const m = qValueIcon("mutated", 0);
  assert.equal(m?.text, "M");
  assert.equal(m?.tip[m.tip.length - 1], "Q-value: 0.000e+0");
  const g = qValueIcon("cna", 0);
  assert.equal(g?.text, "G");
  assert.equal(g?.tip[g.tip.length - 1], "Q-value: 0.000e+0");
});

// ---- QV7. geneTableTsv ----

test("QV7: the mutated download's MutSig(Q-value) cell: toExponential(3), 0 as \"0\", empty without", () => {
  const withQ = tsvRow(geneTableTsv("mutated", [r("TP53", 12, 9, 20, { qValue: 2.12e-12 })]));
  const qi = withQ.header.indexOf("MutSig(Q-value)");
  assert.equal(qi, 1);
  assert.deepEqual(withQ.row, ["TP53", "2.120e-12", "12", "9", "20", "45.0%"]);
  assert.equal(tsvRow(geneTableTsv("mutated", [r("TP53", 12, 9, 20, { qValue: 0 })])).row[qi], "0");
  assert.equal(tsvRow(geneTableTsv("mutated", [r("TP53", 12, 9, 20)])).row[qi], "");
});

test("QV7: the CNA download's Gistic(Q-value) cell, the rest of the line as GD5/GD6", () => {
  const amp = tsvRow(geneTableTsv("cna", [r("MYC", 3, 3, 30, { cna: 2, cytoband: "8q24.21", qValue: 0.001 })]));
  const qi = amp.header.indexOf("Gistic(Q-value)");
  assert.equal(qi, 1);
  assert.deepEqual(amp.row, ["MYC", "1.000e-3", "8q24.21", "AMP", "30", "3", "10.0%"]);
  const del = tsvRow(geneTableTsv("cna", [r("CDKN2A", 5, 5, 50, { cna: -2, cytoband: "9p21.3", qValue: 0 })]));
  assert.deepEqual(del.row, ["CDKN2A", "0", "9p21.3", "HOMDEL", "50", "5", "10.0%"]);
  assert.equal(tsvRow(geneTableTsv("cna", [r("X", 1, 1, 10, { cna: 2 })])).row[qi], "");
});

test("QV2: the lowest q-value wins whatever order the regions come in", () => {
  const m = gisticQValues([{ gene: "ERBB2", amp: true, q: 1e-9 }, { gene: "ERBB2", amp: true, q: 0.05 }]);
  assert.equal(m.get("ERBB2|2"), 1e-9);
});
