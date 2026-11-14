// Audit of the genetic-track staircase sort (PR #193), written from the case table without the
// implementation in view. Legacy source, cbioportal-frontend cd8c6df:
//   SU  = src/shared/components/oncoprint/SortUtils.ts getGeneticTrackSortComparator
//   DU  = src/shared/components/oncoprint/DataUtils.ts fillGeneticTrackDatum, selectDisplayValue
//   DeU = src/shared/components/oncoprint/DeltaUtils.ts sortByMutationType/sortByDrivers/sortIgnoreVUS
//   PC  = packages/oncoprintjs/src/js/precomputedcomparator.ts
//   BS  = packages/oncoprintjs/src/js/bucketsort.ts
//   OM  = packages/oncoprintjs/src/js/oncoprintmodel.ts sortByTracks
// Each gene row gives a column a mandatory vector [sv, cna, mut, germ, mrna, prot] and a preferred
// vector [na, ...mandatory, caseId] (SU 211-244). sortByTracks compares every row's mandatory key
// before any row's preferred key (OM 2447-2468), so `na` and the case id are read only after all rows.
//
// Every row runs twice: in the engine (assembleContract) and in the browser re-sort (sortColumns,
// given staircaseOptions of the same resolved display). The SVG renderer draws a contract's columns
// in the order it is given and takes no sort input, so it is not a third place the rule lives.
//
// Columns are named by the table's letters; each letter's id runs the other way (A = P9, B = P8, ...)
// so that a tie that should not be one is not hidden by the id tie-break.
import test from "node:test";
import assert from "node:assert/strict";
import { assembleContract, normalizeDisplay, NOT_PROFILED, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";
import { staircaseOptions } from "../lib/oncoprint-style.ts";
import { sortColumns } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import type { DisplaySpec } from "../lib/types.ts";

type Dir = "asc" | "desc";
type Key = { track: string; dir: Dir };
type Ev = EventRow & { driver?: boolean };

interface Case {
  /** column names in input order: letters (mapped to reversed ids) unless `raw` */
  cols: string[];
  events?: Ev[];
  genes?: AssembleInput["genes"];
  /** column -> genes it is NOT profiled for */
  np?: Record<string, string[]>;
  overlays?: AssembleInput["overlays"];
  display?: DisplaySpec;
  raw?: boolean;
  unit?: "patient" | "sample";
  studies?: string[];
  studyOf?: Map<string, string>;
}

const LETTERS = "ABCDEFGHI";
const pidOf = (c: Case, l: string) => (c.raw ? l : "P" + (9 - LETTERS.indexOf(l)));
const letterOf = (c: Case, p: string) => (c.raw ? p : LETTERS[9 - Number(p.slice(1))]);
const memberGenes = (genes: AssembleInput["genes"]): string[] =>
  genes.flatMap((g) => (typeof g === "string" ? [g] : (g as { genes: string[] }).genes));

function contract(c: Case, sort: Key[]) {
  const genes = c.genes ?? ["TP53"];
  const all = memberGenes(genes);
  const pids = c.cols.map((l) => pidOf(c, l));
  const events = (c.events ?? []).map((e) => ({ ...e, pid: pidOf(c, e.pid) }));
  const overlays = c.overlays?.map((o) => ({ ...o, values: new Map([...o.values].map(([k, v]): [string, number] => {
    const [l, g] = k.split("|"); return [pidOf(c, l) + "|" + g, v]; })) }));
  return assembleContract({
    genes, groups: [{ name: "all", pids }], studies: c.studies ?? ["s"], ...(c.studyOf ? { studyOf: c.studyOf } : {}),
    events, coverage: c.cols.map((l) => ({ pid: pidOf(c, l), genes: all.filter((g) => !(c.np?.[l] ?? []).includes(g)) })),
    isDriver: (r) => !!(r as Ev).driver, annotationSource: "t", clinical: [], heatmap: [], derived: [], sort, lineGap: 0,
    ...(overlays ? { overlays } : {}), ...(c.unit ? { unit: c.unit } : {}),
    display: normalizeDisplay(c.display ?? {})
  });
}

const GENOMIC: Key[] = [{ track: "genomic", dir: "asc" }];
const DESC: Key[] = [{ track: "genomic", dir: "desc" }];

const engine = (c: Case, keys: Key[] = GENOMIC): string[] => contract(c, keys).columns.map((p) => letterOf(c, p));

/** the browser's re-sort of a contract the engine assembled by id, descending */
function browserFull(c: Case, keys: Key[] = GENOMIC): { input: string[]; out: string[] } {
  const k = contract(c, [{ track: "id", dir: "desc" }]);
  const buf = packContract(k);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const order = Uint32Array.from({ length: data.n }, (_, i) => i), ids = data.columns();
  const sorted = sortColumns(data, order, [{ name: "all", start: 0, count: data.n, patients: data.n }], keys,
    staircaseOptions(normalizeDisplay(c.display ?? {}) as Parameters<typeof staircaseOptions>[0]));
  return { input: Array.from(order, (i) => letterOf(c, ids[i])), out: Array.from(sorted, (i) => letterOf(c, ids[i])) };
}
const browser = (c: Case, keys: Key[] = GENOMIC): string[] => browserFull(c, keys).out;

const WHERE = { engine, browser } as const;
const each = (name: string, fn: (sort: (c: Case, keys?: Key[]) => string[]) => void, opts: { skip?: string; todo?: string } = {}) => {
  for (const [where, sort] of Object.entries(WHERE)) test(name + " [" + where + "]", opts, () => fn(sort));
};

/** letters that tie on every key: they fall to the id, ascending, which runs against the letters */
const tie = (...ls: string[]) => [...ls].sort().reverse();

// event builders, pid as a letter
const mut = (pid: string, mt: string, driver = false, germ = false, gene = "TP53"): Ev => ({ pid, gene, vt: "mutation", mt, driver, germ });
const cna = (pid: string, v: number, driver = false, gene = "TP53"): Ev => ({ pid, gene, vt: "cna", cna: v, driver });
const sv = (pid: string, driver = false, gene = "TP53"): Ev => ({ pid, gene, vt: "structural_variant", driver });
const TRUNC = "Nonsense_Mutation", SPLICE = "Splice_Site", INFRAME = "In_Frame_Del", PROMOTER = "5'Flank", MISSENSE = "Missense_Mutation", OTHER = "Targeted_Region";
const MERGED = [{ label: "M", genes: ["G1", "G2", "G3"] }];

// ---- D: cell display values --------------------------------------------------------------------

test("D1: CNA 2 / -2 draw amp / homdel; 0 draws nothing (DU 35-41, 184-193) [engine]", () => {
  const c = { cols: ["A", "B", "C"], events: [cna("A", 2), cna("B", -2), cna("C", 0)] };
  const k = contract(c, GENOMIC), t = k.tracks.find((x) => x.label === "TP53")!;
  const cell = (l: string) => t.cells[k.columns.indexOf(pidOf(c, l))];
  assert.ok(cell("A") & 64, "amp");
  assert.ok(cell("B") & 128, "homdel");
  assert.equal(cell("C"), 0, "diploid is never produced");
});

each("D1 (ours, documented in #193: gain and hetloss are not loaded): CNA 1 / -1 rank as unaltered (DU 35-41)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B", "C"], events: [cna("A", 1), cna("B", -1)] }), tie("A", "B", "C"));
});

each("D2: a driver amp ranks as amp_rec, before a VUS amp (DU 186-188, SU 75-87)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [cna("A", 2, true), cna("B", 2)] }), ["A", "B"]);
});

each("D3: a driver mutation ranks as <type>_rec, before the same VUS type (DU 211-215, SU 160-172)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [mut("A", MISSENSE, true), mut("B", MISSENSE)] }), ["A", "B"]);
});

each("D4: an SV driver ranks as sv_rec, a VUS SV as sv (DU 224-229, SU 187)", (sort) => {
  assert.deepEqual(sort({ cols: ["C", "B", "A"], events: [sv("A", true), sv("B")] }), ["A", "B", "C"]);
});

each("D5: a cell with missense_rec x1 and VUS trunc x3 shows and ranks as missense_rec (DU 42-55, 124-153)", (sort) => {
  // A ties B (both missense_rec); C trunc_rec before both; D trunc VUS after both
  const c: Case = { cols: ["D", "C", "B", "A"], events: [
    mut("A", MISSENSE, true), mut("A", TRUNC), mut("A", TRUNC), mut("A", TRUNC),
    mut("B", MISSENSE, true), mut("C", TRUNC, true), mut("D", TRUNC)] };
  assert.deepEqual(sort(c), ["C", ...tie("A", "B"), "D"]);
});

each("D6: a cell with trunc x1 and trunc x2 of the same key is trunc (DU 124-153)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], events: [mut("A", TRUNC), mut("A", TRUNC), mut("A", TRUNC), mut("B", TRUNC)] }), tie("A", "B"));
});

test("D7: two mutation keys of the same render priority, count decides (DU 139-148)", { skip: "unreachable: every mutation display key has its own priority in mutRenderPriority (DU 42-55); the CNA form of the rule is D9" }, () => {});

each("D8: merged row, amp_rec x1 and homdel x2: amp_rec has no render priority, so count wins and the cell ranks as VUS homdel (DU 63-68, 134-148)", (sort) => {
  // table's case is amp_rec x1 + gain x2; gain is not loaded here (documented), the same rule with homdel:
  // priority[amp_rec] is undefined, the diff NaN, neither < nor > 0, so the larger count (homdel, 2) is shown.
  // D amp_rec alone < B amp VUS < {A, C} homdel VUS
  const c: Case = { cols: ["A", "B", "C", "D"], genes: MERGED, events: [
    cna("A", 2, true, "G1"), cna("A", -2, false, "G2"), cna("A", -2, false, "G3"),
    cna("B", 2, false, "G1"), cna("C", -2, false, "G1"), cna("D", 2, true, "G1")] };
  assert.deepEqual(sort(c), ["D", "B", ...tie("A", "C")]);
});

each("D9: merged row, VUS amp x1 and VUS homdel x2: same priority, count wins: homdel (DU 63-68)", (sort) => {
  const c: Case = { cols: ["A", "B", "C"], genes: MERGED, events: [
    cna("A", 2, false, "G1"), cna("A", -2, false, "G2"), cna("A", -2, false, "G3"), cna("B", 2, false, "G1"), cna("C", -2, false, "G1")] };
  assert.deepEqual(sort(c), ["B", ...tie("A", "C")]);
});

each("D10: merged row, sv_rec x1 and sv x5 shows sv_rec (DU 56-59)", (sort) => {
  const c: Case = { cols: ["C", "B", "A"], genes: MERGED, events: [
    sv("A", true, "G1"), sv("A", false, "G2"), sv("A", false, "G3"), sv("B", true, "G1"), sv("C", false, "G1")] };
  assert.deepEqual(sort(c), [...tie("A", "B"), "C"]);
});

each("D11: germline is read from the displayed mutation's events only (DU 206-209, 243-245)", (sort) => {
  // A: somatic missense_rec shown, its germline event is a VUS trunc that is not shown: disp_germ false
  // B: somatic missense_rec; C: germline missense_rec (first)
  const c: Case = { cols: ["A", "B", "C"], events: [
    mut("A", MISSENSE, true), mut("A", TRUNC, false, true), mut("B", MISSENSE, true), mut("C", MISSENSE, true, true)] };
  assert.deepEqual(sort(c), ["C", ...tie("A", "B")]);
});

test("D12: a column with no profile for the gene is NOT_PROFILED (DU 310-312) [engine]", () => {
  const c: Case = { cols: ["A", "B"], np: { A: ["TP53"] } };
  const k = contract(c, GENOMIC), t = k.tracks.find((x) => x.label === "TP53")!;
  assert.equal(t.cells[k.columns.indexOf(pidOf(c, "A"))], NOT_PROFILED);
  assert.equal(t.cells[k.columns.indexOf(pidOf(c, "B"))], 0);
});

test("D13: profiled for mutation but not CNA is not na (DU 303-312)", { skip: "coverage here is per gene, not per profile type: a covered gene is profiled, there is no partial-profile notion for the sort to read" }, () => {});

// ---- single row, defaults -----------------------------------------------------------------------

each("1: sv_rec before amp_rec (SU 215-218)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [sv("A", true), cna("B", 2, true)] }), ["A", "B"]);
});
each("2: a VUS SV before a driver amp: any SV before any CNA (SU 187, 215)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [sv("A"), cna("B", 2, true)] }), ["A", "B"]);
});
each("3: sv_rec before sv (SU 187)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [sv("A", true), sv("B")] }), ["A", "B"]);
});
each("4: sv before unaltered (SU 187)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [sv("A")] }), ["A", "B"]);
});
each("5: amp_rec before homdel_rec, not tied (SU 75-87)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [cna("A", 2, true), cna("B", -2, true)] }), ["A", "B"]);
});
each("6: every CNA driver before every CNA VUS: homdel_rec before amp (SU 75-87; gain_rec/hetloss_rec not loaded, documented)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [cna("A", -2, true), cna("B", 2)] }), ["A", "B"]);
});
each("7: amp < homdel < unaltered (SU 81-86; gain/hetloss not loaded, documented)", (sort) => {
  assert.deepEqual(sort({ cols: ["C", "B", "A"], events: [cna("A", 2), cna("B", -2)] }), ["A", "B", "C"]);
});
each("8: homdel_rec before VUS amp + missense_rec: the CNA key decides before the mutation (SU 218-222)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [cna("A", -2, true), cna("B", 2), mut("B", MISSENSE, true)] }), ["A", "B"]);
});
each("9: amp + missense before amp alone (SU 160-175, 222)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [cna("A", 2), mut("A", MISSENSE), cna("B", 2)] }), ["A", "B"]);
});
each("10: a VUS amp alone before trunc_rec alone: any CNA before no CNA (SU 218)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [cna("A", 2), mut("B", TRUNC, true)] }), ["A", "B"]);
});
each("11: trunc_rec < splice_rec < inframe_rec < promoter_rec < missense_rec < other_rec (SU 160-166)", (sort) => {
  const ts = [TRUNC, SPLICE, INFRAME, PROMOTER, MISSENSE, OTHER];
  assert.deepEqual(sort({ cols: ["F", "E", "D", "C", "B", "A"], events: ts.map((t, i) => mut(LETTERS[i], t, true)) }), ["A", "B", "C", "D", "E", "F"]);
});
each("12: missense_rec before VUS trunc (SU 160-172)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [mut("A", MISSENSE, true), mut("B", TRUNC)] }), ["A", "B"]);
});
each("13: other_rec before VUS trunc (SU 165-167)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [mut("A", OTHER, true), mut("B", TRUNC)] }), ["A", "B"]);
});
each("14: trunc < splice < inframe < promoter < missense < other < unaltered, all VUS (SU 167-173)", (sort) => {
  const ts = [TRUNC, SPLICE, INFRAME, PROMOTER, MISSENSE, OTHER];
  assert.deepEqual(sort({ cols: ["G", "F", "E", "D", "C", "B", "A"], events: ts.map((t, i) => mut(LETTERS[i], t)) }), ["A", "B", "C", "D", "E", "F", "G"]);
});
each("15: germline missense before somatic missense (SU 196, 224)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], events: [mut("A", MISSENSE, false, true), mut("B", MISSENSE)] }), ["A", "B"]);
});
each("16: germline is only a tie-break: missense_rec germline before missense somatic, the type deciding (SU 222-224)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], events: [mut("A", MISSENSE), mut("B", MISSENSE, true, true)] }), ["B", "A"]);
  // and the type decides even against germline: a somatic trunc_rec before a germline missense_rec
  assert.deepEqual(sort({ cols: ["B", "A"], events: [mut("A", TRUNC, true), mut("B", MISSENSE, true, true)] }), ["A", "B"]);
});
test("17: disp_germ false before undefined on unaltered columns (SU 196)", { skip: "impossible in practice (the table says so): an unaltered cell has no germline status to be false" }, () => {});

const mrna = (vals: Record<string, number>) => ({ kind: "mrna" as const, profileType: "rna", threshold: 2, values: new Map(Object.entries(vals).map(([l, v]): [string, number] => [l + "|TP53", v])) });
const prot = (vals: Record<string, number>) => ({ kind: "protein" as const, profileType: "rppa", threshold: 2, values: new Map(Object.entries(vals).map(([l, v]): [string, number] => [l + "|TP53", v])) });

each("18: mRNA high < mRNA low < none (SU 195, 227)", (sort) => {
  assert.deepEqual(sort({ cols: ["C", "B", "A"], overlays: [mrna({ A: 3, B: -3, C: 0 })] }), ["A", "B", "C"]);
});
each("19: protein high < protein low < none (SU 195, 230)", (sort) => {
  assert.deepEqual(sort({ cols: ["C", "B", "A"], overlays: [prot({ A: 3, B: -3, C: 0 })] }), ["A", "B", "C"]);
});
each("20: mRNA after mutation: missense + mRNA high before missense + mRNA low (SU 222-227)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], events: [mut("A", MISSENSE), mut("B", MISSENSE)], overlays: [mrna({ A: -3, B: 3 })] }), ["B", "A"]);
});
each("21: the mRNA key before the protein key (SU 227-230)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], overlays: [mrna({ A: 3 }), prot({ B: 3 })] }), ["A", "B"]);
});
each("22: unaltered profiled before not profiled (SU 241)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], np: { B: ["TP53"] } }), ["A", "B"]);
});
each("23: not profiled after every profiled column, altered ones too (SU 241, PC 150)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], np: { A: ["TP53"] }, events: [mut("B", MISSENSE)] }), ["B", "A"]);
});

// ---- ids (BS stringToVector, ascending) ---------------------------------------------------------
const raw = (cols: string[], extra: Partial<Case> = {}): Case => ({ cols, raw: true, ...extra });

each("24: tied columns P10, P2: P2 first, natural order (SU 243, BS 116-148)", (sort) => {
  assert.deepEqual(sort(raw(["P10", "P2"], { unit: "sample" })), ["P2", "P10"]);
});
each("25: TCGA-AA-A00N before TCGA-AA-3864: 'A' = 65 < 3864 (BS 116-148, 164-172)", (sort) => {
  assert.deepEqual(sort(raw(["TCGA-AA-3864", "TCGA-AA-A00N"])), ["TCGA-AA-A00N", "TCGA-AA-3864"]);
});
each("26: SA before S70: char code 65 < number 70 (BS 121-147)", (sort) => {
  assert.deepEqual(sort(raw(["S70", "SA"])), ["SA", "S70"]);
});
each("27: S60 before SA: 60 < 65 (BS 121-147)", (sort) => {
  assert.deepEqual(sort(raw(["SA", "S60"])), ["S60", "SA"]);
});
each("28: B1 before b1, case-sensitive (BS 139)", (sort) => {
  assert.deepEqual(sort(raw(["b1", "B1"])), ["B1", "b1"]);
});

each("29 (ours, documented in #206 T11): P2 and P02 tie on the vector; legacy keeps input order, ours then the full id (BS 240-258, 107)", (sort) => {
  assert.deepEqual(sort(raw(["P2", "P02"])), ["P02", "P2"]);
  assert.deepEqual(sort(raw(["P02", "P2"])), ["P02", "P2"]);
});

each("30: P1 before P1A, the shorter vector first (BS 194-199)", (sort) => {
  assert.deepEqual(sort(raw(["P1A", "P1"])), ["P1", "P1A"]);
});
each("31: the case id carries no study: study2's S2 before study1's S10 (SU 243)", (sort) => {
  const cols = ["study1_S10", "study2_S2"];
  assert.deepEqual(sort(raw(cols, { unit: "sample", studies: ["study1", "study2"], studyOf: new Map(cols.map((p): [string, string] => [p, p.split("_")[0]])) })),
    ["study2_S2", "study1_S10"]);
});
each("32 (ours, documented in #206 T11): the same id S1 in two studies: legacy ties to input order, ours then the full id ascending (SU 243, BS 240-258)", (sort) => {
  const cols = ["s2_S1", "s1_S1"];
  assert.deepEqual(sort(raw(cols, { unit: "sample", studies: ["s2", "s1"], studyOf: new Map(cols.map((p): [string, string] => [p, p.split("_")[0]])) })),
    ["s1_S1", "s2_S1"]);
});
each("33: patient mode, P2 before P10 (SU 243)", (sort) => {
  assert.deepEqual(sort(raw(["P10", "P2"], { unit: "patient" })), ["P2", "P10"]);
});
each("34 (ours, invariant 1): no columns: legacy draws an empty oncoprint, ours refuses, naming why (BS 218-226, PC 173)", (sort) => {
  assert.throws(() => sort(raw([])), /empty/);
});
each("35: one column: that column (PC 173)", (sort) => {
  assert.deepEqual(sort(raw(["S1"], { events: [{ pid: "S1", gene: "TP53", vt: "mutation", mt: MISSENSE }] })), ["S1"]);
});
each("36: all keys equal, ids S3, S1, S2: S1, S2, S3 (SU 243)", (sort) => {
  assert.deepEqual(sort(raw(["S3", "S1", "S2"])), ["S1", "S2", "S3"]);
});
each("37: no display values at all (a diploid call only) ranks as unaltered (SU 72-86, 173, 187, 195)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], events: [cna("A", 0)] }), tie("A", "B"));
});

// ---- T: the Sort switches -----------------------------------------------------------------------
const NO_DRV: DisplaySpec = { sortByDrivers: false };
const NO_TYPE: DisplaySpec = { sortByMutationType: false };
const NEITHER: DisplaySpec = { sortByMutationType: false, sortByDrivers: false };
const IGN: DisplaySpec = { sortIgnoreVUS: true };

each("T1: Driver off: VUS trunc ties trunc_rec, both before missense_rec (SU 147-158)", (sort) => {
  assert.deepEqual(sort({ cols: ["C", "B", "A"], display: NO_DRV, events: [mut("A", TRUNC), mut("B", TRUNC, true), mut("C", MISSENSE, true)] }), [...tie("A", "B"), "C"]);
});
test("T2: Driver off, amp_rec vs amp (SU 65-73, BS 253-255)", { skip: "legacy is ill-defined: amp_rec is absent from the non-driver CNA metric, its rank undefined, and the bucket order of an undefined key unspecified" }, () => {});
each("T3: Driver off: sv_rec ties sv (SU 189)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: NO_DRV, events: [sv("A", true), sv("B")] }), tie("A", "B"));
});
each("T4: Type off, Driver on: trunc_rec ties missense_rec (SU 134-146)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: NO_TYPE, events: [mut("A", TRUNC, true), mut("B", MISSENSE, true)] }), tie("A", "B"));
});
each("T5: Type off: missense_rec before VUS trunc (SU 134-146)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], display: NO_TYPE, events: [mut("A", MISSENSE, true), mut("B", TRUNC)] }), ["A", "B"]);
});
each("T6: Type off: VUS trunc before unaltered (SU 144-145)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], display: NO_TYPE, events: [mut("A", TRUNC)] }), ["A", "B"]);
});
each("T7: both off: missense_rec ties VUS trunc (SU 128-133)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: NEITHER, events: [mut("A", MISSENSE, true), mut("B", TRUNC)] }), tie("A", "B"));
});
each("T8: both off: missense before unaltered (SU 128-133)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], display: NEITHER, events: [mut("A", MISSENSE)] }), ["A", "B"]);
});
test("T9: both off, amp_rec vs amp (SU 65-73)", { skip: "same as T2: legacy's rank for amp_rec is undefined" }, () => {});
each("T10: Ignore VUS + Type: VUS trunc ties unaltered (SU 106-115)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: IGN, events: [mut("A", TRUNC)] }), tie("A", "B"));
});
each("T11: Ignore VUS + Type: trunc_rec before missense_rec (SU 107-113)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: IGN, events: [mut("A", MISSENSE, true), mut("B", TRUNC, true)] }), ["B", "A"]);
});
each("T12: Ignore VUS, Type off: trunc_rec ties missense_rec (SU 116-127)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: { ...IGN, ...NO_TYPE }, events: [mut("A", TRUNC, true), mut("B", MISSENSE, true)] }), tie("A", "B"));
});
each("T13: Ignore VUS: VUS amp ties unaltered (SU 56-64)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: IGN, events: [cna("A", 2)] }), tie("A", "B"));
});
each("T14: Ignore VUS: VUS SV ties unaltered (SU 184-185)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: IGN, events: [sv("A")] }), tie("A", "B"));
});
each("T15: Ignore VUS: a germline VUS missense ties unaltered, its germline ignored (SU 201-209)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], display: IGN, events: [mut("A", MISSENSE, false, true)] }), tie("A", "B"));
});
each("T16: Ignore VUS: germline missense_rec before somatic missense_rec (SU 201-209)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], display: IGN, events: [mut("A", MISSENSE, true, true), mut("B", MISSENSE, true)] }), ["A", "B"]);
});
each("T17: Ignore VUS with Driver off is treated as off (DeU 1030-1038)", (sort) => {
  // Type on, Driver off, VUS counted: C VUS trunc < B missense_rec < A unaltered
  const c: Case = { cols: ["A", "B", "C"], display: { sortByDrivers: false, sortIgnoreVUS: true }, events: [mut("B", MISSENSE, true), mut("C", TRUNC)] };
  assert.deepEqual(sort(c), ["C", "B", "A"]);
});
each("T18: no driver annotation turns Driver, and so Ignore VUS, off (DeU 1022-1038)", (sort) => {
  // annotation off: every alteration a VUS; Ignore VUS must not tie them all with unaltered
  const c: Case = { cols: ["A", "B", "C"], display: { annotate: "none", sortIgnoreVUS: true }, events: [mut("B", MISSENSE), mut("C", TRUNC)] };
  assert.deepEqual(sort(c), ["C", "B", "A"]);
});
each("T19: colour by type off (the portal's distinguishMutationType) turns the Type sort off (DeU 1014-1020)", (sort) => {
  const c: Case = { cols: ["A", "B"], display: { colorByType: false }, events: [mut("A", MISSENSE), mut("B", TRUNC)] };
  assert.deepEqual(sort(c), tie("A", "B"));
});

// ---- R: direction -------------------------------------------------------------------------------

test("R1: the default sort is the staircase ascending (OM 1468-1471) [engine]", () => {
  assert.deepEqual(engine({ cols: ["B", "A"], events: [cna("A", 2)] }, []), ["A", "B"]);
});
each("R2: descending: unaltered before amp (PC 115-130)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], events: [cna("A", 2)] }, DESC), ["B", "A"]);
});
each("R3: descending: not profiled first, the na flag negated too (PC 122-125, SU 241)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], np: { A: ["TP53"] } }, DESC), ["A", "B"]);
});
each("R4: descending: tied ids P2 before P10, strings not negated (PC 126-127)", (sort) => {
  assert.deepEqual(sort(raw(["P10", "P2"]), DESC), ["P2", "P10"]);
});
test("R5: direction 0 (PC 116-119)", { skip: "no sort key has a direction 0: a key is asc or desc, and leaving genomic out still adds it as the final tie-break" }, () => {});

// ---- M: several rows ----------------------------------------------------------------------------
const TWO = ["KRAS", "TP53"];

each("M1: row 1 decides: KRAS amp before KRAS missense_rec + TP53 trunc_rec (OM 2447-2468)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], genes: TWO, events: [cna("A", 2, false, "KRAS"), mut("B", MISSENSE, true, false, "KRAS"), mut("B", TRUNC, true, false, "TP53")] }), ["A", "B"]);
});
each("M2: row 1 tied, row 2 decides (OM 2447-2468)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], genes: TWO, events: [mut("A", MISSENSE, true, false, "TP53")] }), ["A", "B"]);
});
each("M3: not profiled in row 1 but altered in row 2 goes BEFORE profiled-unaltered in both: na is preferred-only (SU 235-244, OM 2449-2458)", (sort) => {
  assert.deepEqual(sort({ cols: ["B", "A"], genes: TWO, np: { A: ["KRAS"] }, events: [mut("A", MISSENSE, false, false, "TP53")] }), ["A", "B"]);
});
each("M4: the id is preferred-only: row 1 tied on P10 / P2, row 2 amp on P10 decides (SU 243, OM 2449-2458)", (sort) => {
  assert.deepEqual(sort(raw(["P2", "P10"], { genes: TWO, events: [{ pid: "P10", gene: "TP53", vt: "cna", cna: 2 }] })), ["P10", "P2"]);
});
each("M5: every row tied, profiled: P2 before P10 (OM 2458)", (sort) => {
  assert.deepEqual(sort(raw(["P10", "P2"], { genes: TWO })), ["P2", "P10"]);
});
each("M6: both not profiled in row 1, row 2 decides (OM 2447-2468)", (sort) => {
  assert.deepEqual(sort({ cols: ["A", "B"], genes: TWO, np: { A: ["KRAS"], B: ["KRAS"] }, events: [mut("B", MISSENSE, false, false, "TP53")] }), ["B", "A"]);
});
test("M7: genetic rows sort after a clinical group in the group sort priority (OM 2426-2445)", { skip: "the sort is an explicit key list here, not track-group priority; a clinical key before 'genomic' is covered by test/oncoprint-sort-ties.test.ts" }, () => {});
test("M8: mixed sample and patient columns in one sort", { skip: "not possible in legacy or here: the unit is global" }, () => {});
