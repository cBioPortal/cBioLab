// Which copy-number call a cell shows when it holds several, written from the case table without
// the implementation in view. Legacy source, cbioportal-frontend cd8c6df:
//   DU = src/shared/components/oncoprint/DataUtils.ts fillGeneticTrackDatum (161-243), selectDisplayValue (126-158)
//   SU = src/shared/components/oncoprint/SortUtils.ts cna_order
// Each copy-number event of a cell adds one to a count keyed amp / amp_rec / homdel / homdel_rec;
// none of the _rec keys has a render priority, so the key with the most events is the cell's
// disp_cna. It decides both the glyph (amp or homdel) and whether the copy number is a driver.
// On equal counts the portal keeps the first event's kind; ours, documented: a driver before a
// VUS, then amplification before deep deletion.
//
// Columns are letters mapped to reversed ids (A = P9, B = P8, ...) so an id tie-break cannot hide
// a tie that should not be one.
import test from "node:test";
import assert from "node:assert/strict";
import { assembleContract, normalizeDisplay, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";
import { STYLE, cellLayers, staircaseOptions } from "../lib/oncoprint-style.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { sortColumns } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import type { DisplaySpec } from "../lib/types.ts";

const B = STYLE.bits;
type Key = { track: string; dir: "asc" | "desc" };
type Ev = EventRow & { driver?: boolean };
interface Case { cols: string[]; events: Ev[]; genes?: AssembleInput["genes"]; display?: DisplaySpec; unit?: "patient" | "sample" }

const LETTERS = "ABCDEFGHI";
const pidOf = (l: string) => "P" + (9 - LETTERS.indexOf(l));
const letterOf = (p: string) => LETTERS[9 - Number(p.slice(1))];
const memberGenes = (genes: AssembleInput["genes"]): string[] =>
  genes.flatMap((g) => (typeof g === "string" ? [g] : (g as { genes: string[] }).genes));
const GENOMIC: Key[] = [{ track: "genomic", dir: "asc" }];
const MERGED = [{ label: "M", genes: ["G1", "G2", "G3"] }];

function contract(c: Case, sort: Key[] = GENOMIC) {
  const genes = c.genes ?? ["TP53"], all = memberGenes(genes);
  return assembleContract({
    genes, groups: [{ name: "all", pids: c.cols.map(pidOf) }], studies: ["s"],
    events: c.events.map((e) => ({ ...e, pid: pidOf(e.pid) })),
    coverage: c.cols.map((l) => ({ pid: pidOf(l), genes: all })),
    isDriver: (r) => !!(r as Ev).driver, annotationSource: "t", clinical: [], heatmap: [], derived: [], sort, lineGap: 0,
    ...(c.unit ? { unit: c.unit } : {}),
    display: normalizeDisplay(c.display ?? {})
  });
}

/** the cell of column `l` on the gene row `label` (TP53, or M for the merged row) */
function cell(c: Case, l = "A"): number {
  const k = contract(c), label = c.genes ? "M" : "TP53";
  const t = k.tracks.find((x) => x.label === label);
  assert.ok(t, "track " + label);
  return t.cells[k.columns.indexOf(pidOf(l))];
}

const has = (code: number, bit: number) => (code & bit) !== 0;
/** the copy-number call of a cell as the table names it */
function call(code: number): string {
  const kinds = [has(code, B.AMP) && "amp", has(code, B.HOMDEL) && "homdel"].filter(Boolean);
  return (kinds.length ? kinds.join("+") : "none") + (has(code, B.CNA_DRIVER) ? " driver" : " VUS");
}

const cna = (pid: string, v: number, driver = false, gene = "TP53"): Ev => ({ pid, gene, vt: "cna", cna: v, driver });
const mut = (pid: string, mt: string, driver = false, gene = "TP53"): Ev => ({ pid, gene, vt: "mutation", mt, driver });
const MISSENSE = "Missense_Mutation";

// the merged-row fixtures, all in column A
const C2: Case = { cols: ["A"], genes: MERGED, events: [cna("A", 2, false, "G1"), cna("A", -2, false, "G2"), cna("A", -2, false, "G3")] };
const C4: Case = { cols: ["A"], genes: MERGED, events: [cna("A", 2, true, "G1"), cna("A", -2, false, "G2"), cna("A", -2, false, "G3")] };

test("C1: one call: VUS amp (DU 161-243)", () => {
  const x = cell({ cols: ["A"], events: [cna("A", 2)] });
  assert.equal(call(x), "amp VUS");
  assert.ok(!has(x, B.DRIVER), "no driver anywhere in the cell");
});

test("C2: merged row G1 VUS amp, G2 VUS homdel, G3 VUS homdel shows homdel, 2 > 1 (DU 126-158)", () => {
  assert.equal(call(cell(C2)), "homdel VUS");
});

test("C3: merged row amp x2, homdel x1, all VUS, shows amp (DU 126-158)", () => {
  const c: Case = { cols: ["A"], genes: MERGED, events: [cna("A", -2, false, "G1"), cna("A", 2, false, "G2"), cna("A", 2, false, "G3")] };
  assert.equal(call(cell(c)), "amp VUS");
});

test("C4: driver amp x1, VUS homdel x2 shows VUS homdel; the cell's copy number is not a driver (DU 126-158, NaN -> count)", () => {
  const x = cell(C4);
  assert.equal(call(x), "homdel VUS");
  assert.ok(!has(x, B.CNA_DRIVER), "CNA_DRIVER");
  // ours: the column still holds a driver alteration, so the gutter's driver % counts it
  assert.ok(has(x, B.DRIVER), "DRIVER");
});

test("C5: driver amp x1, VUS amp x1, VUS homdel x2 shows VUS homdel: amp and amp_rec are counted apart (DU 185-189)", () => {
  const c: Case = { cols: ["A"], genes: [{ label: "M", genes: ["G1", "G2", "G3", "G4"] }], events: [
    cna("A", 2, true, "G1"), cna("A", 2, false, "G2"), cna("A", -2, false, "G3"), cna("A", -2, false, "G4")] };
  const k = contract(c), t = k.tracks.find((x) => x.label === "M")!;
  assert.equal(call(t.cells[k.columns.indexOf(pidOf("A"))]), "homdel VUS");
});

test("C6: driver amp x2, VUS homdel x1 shows driver amp (DU 126-158)", () => {
  const c: Case = { cols: ["A"], genes: MERGED, events: [cna("A", 2, true, "G1"), cna("A", 2, true, "G2"), cna("A", -2, false, "G3")] };
  const x = cell(c);
  assert.equal(call(x), "amp driver");
  assert.ok(has(x, B.DRIVER), "DRIVER");
});

test("C7: patient mode, samples S1 VUS amp, S2 VUS homdel, S3 VUS homdel shows homdel (DU 161-243)", () => {
  // patient mode: one column per patient, every sample's event a row with that patient's id
  const c: Case = { cols: ["A"], unit: "patient", events: [cna("A", 2), cna("A", -2), cna("A", -2)] };
  assert.equal(call(cell(c)), "homdel VUS");
});

test("C8: equal counts, VUS amp x1 and VUS homdel x1: ours, documented, amp whichever came first (DU 126-158)", () => {
  // portal: the first event's kind; ours: driver before VUS, then amp before homdel
  for (const events of [[cna("A", 2, false, "G1"), cna("A", -2, false, "G2")], [cna("A", -2, false, "G1"), cna("A", 2, false, "G2")]])
    assert.equal(call(cell({ cols: ["A"], genes: MERGED, events })), "amp VUS", "events " + events.map((e) => e.cna).join(","));
});

test("C9: equal counts, VUS amp x1 and driver homdel x1: ours, driver homdel (as C8)", () => {
  for (const events of [[cna("A", 2, false, "G1"), cna("A", -2, true, "G2")], [cna("A", -2, true, "G1"), cna("A", 2, false, "G2")]])
    assert.equal(call(cell({ cols: ["A"], genes: MERGED, events })), "homdel driver", "events " + events.map((e) => e.cna).join(","));
});

test("C10: C4 with a driver missense in the same cell: the mutation stays a driver, the copy number is a VUS homdel (DU 205-216)", () => {
  const x = cell({ ...C4, events: [...C4.events, mut("A", MISSENSE, true, "G1")] });
  assert.equal(call(x), "homdel VUS");
  assert.ok(has(x, B.MISSENSE), "MISSENSE");
  assert.ok(has(x, B.MUT_DRIVER), "MUT_DRIVER");
  assert.ok(has(x, B.DRIVER), "DRIVER: some alteration in the cell is a driver");
});

test("C11: Hide VUS on, driver amp x1, VUS homdel x2: the VUS are hidden before counting: driver amp (VUS hidden upstream)", () => {
  const x = cell({ ...C4, display: { hideVUS: true } });
  assert.equal(call(x), "amp driver");
});

test("C12: annotation off (nothing is a driver), amp x1, homdel x2 shows homdel (DU 126-158)", () => {
  const events = [cna("A", 2, false, "G1"), cna("A", -2, false, "G2"), cna("A", -2, false, "G3")];
  assert.equal(call(cell({ cols: ["A"], genes: MERGED, display: { annotate: "none" }, events })), "homdel VUS");
  // annotation off is applied by the driver callback itself (lib/annotation.ts isDriverEvent), which
  // then calls nothing a driver; the engine takes the callback's word, so that case is the one above
});

test("C13: the % altered of C2 / C4 is unchanged: the column is altered (OncoprintUtils percentAltered)", () => {
  // A = C2, B = C4, C unaltered
  const c: Case = { cols: ["A", "B", "C"], genes: MERGED, events: [
    ...C2.events, cna("B", 2, true, "G1"), cna("B", -2, false, "G2"), cna("B", -2, false, "G3")] };
  const t = contract(c).tracks.find((x) => x.label === "M")!;
  assert.equal(t.altered, 2);
  assert.equal(t.profiled, 3);
});

// ---- C14: the staircase, engine and browser re-sort -------------------------------------------

/** the browser's re-sort of a contract the engine assembled by id, descending */
function browser(c: Case, keys: Key[] = GENOMIC): string[] {
  const k = contract(c, [{ track: "id", dir: "desc" }]);
  const buf = packContract(k);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const order = Uint32Array.from({ length: data.n }, (_, i) => i), ids = data.columns();
  const sorted = sortColumns(data, order, [{ name: "all", start: 0, count: data.n, patients: data.n }], keys,
    staircaseOptions(normalizeDisplay(c.display ?? {}) as Parameters<typeof staircaseOptions>[0]));
  return Array.from(sorted, (i) => letterOf(ids[i]));
}
const engine = (c: Case, keys: Key[] = GENOMIC): string[] => contract(c, keys).columns.map(letterOf);

for (const [where, sort] of Object.entries({ engine, browser })) {
  test("C14: sort: X = C4 (VUS homdel), Y = VUS amp x1, Z = driver amp: with Driver on, Z, Y, X (SU cna_order) [" + where + "]", () => {
    // X = A, Y = B, Z = C; given in the reverse of the expected order
    const c: Case = { cols: ["A", "B", "C"], genes: MERGED, display: { sortByDrivers: true }, events: [
      cna("A", 2, true, "G1"), cna("A", -2, false, "G2"), cna("A", -2, false, "G3"),
      cna("B", 2, false, "G1"),
      cna("C", 2, true, "G1")] };
    assert.deepEqual(sort(c), ["C", "B", "A"]);
  });
}

// ---- C15: what is drawn ------------------------------------------------------------------------

test("C15: the drawing of C2 (canvas, server SVG) is the deep-deletion glyph, not the amplification (bits)", () => {
  const [amp, homdel] = ["AMP", "HOMDEL"].map((bit) => STYLE.glyph.cna.options.find((o) => o.bit === bit)!.color);
  const x = cell(C2);
  // the canvas and the SVG both draw a gene cell's layers from cellLayers
  const colors = cellLayers(x, STYLE).map((l) => l.color);
  assert.ok(colors.includes(homdel), "deep deletion drawn: " + colors.join(" "));
  assert.ok(!colors.includes(amp), "amplification not drawn: " + colors.join(" "));
  const svg = contractToSvg(contract(C2), 800).toLowerCase();
  assert.ok(svg.includes(homdel.toLowerCase()), "SVG has the deep-deletion colour");
  assert.ok(!svg.includes(amp.toLowerCase()), "SVG has no amplification colour (neither cell nor legend swatch)");
});
