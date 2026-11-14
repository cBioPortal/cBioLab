// Audit of the OncoPrint Sort switches (cBioLab#195) against the legacy portal, written from the
// case table only (rows 1-24), at cbioportal-frontend cd8c6df:
//   SU  = src/shared/components/oncoprint/SortUtils.ts getGeneticTrackSortComparator
//   DU  = src/shared/components/oncoprint/DeltaUtils.ts (the effective switches, 1013-1038)
//   DAT = src/shared/components/oncoprint/DataUtils.ts (the cell's displayed mutation, 42-55, 242)
//   OC  = src/shared/components/oncoprint/controls/OncoprintControls.tsx
//   RVO = src/shared/components/oncoprint/ResultsViewOncoprint.tsx
// Switches: MT = display.sortByMutationType, DR = display.sortByDrivers, IV = display.sortIgnoreVUS.
//
// Every row runs in the engine (assembleContract) and in the browser re-sort (sortColumns, with the
// switches from staircaseOptions of the resolved display). Every case is run under two id
// assignments, forward (A=c1 .. E=c5) and reversed (A=c5 .. E=c1): a tie is then broken by the id
// both ways round, so a wrong tie and a wrong rank both show. Expectations are tie classes of
// letters, each class in id order (the genetic preferred vector ends with the id, SU 246).
import test from "node:test";
import assert from "node:assert/strict";
import { assembleContract, normalizeDisplay, type EventRow } from "../lib/oncoprint-assemble.ts";
import { staircaseOptions } from "../lib/oncoprint-style.ts";
import { sortColumns } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import type { DisplaySpec } from "../lib/types.ts";
import type { DriverSettings } from "../lib/driver-settings.ts";

type Ev = { vt: "mutation" | "cna" | "structural_variant"; mt?: string; cna?: number; driver?: boolean; germ?: boolean };
interface Fixture {
  /** letter -> its TP53 events; [] is profiled and unaltered */
  cols: Record<string, Ev[]>;
  /** letters not profiled for TP53 (absent from coverage) */
  notProfiled?: string[];
  /** letter -> value, for mRNA / protein overlays at threshold 2 */
  mrna?: Record<string, number>;
  prot?: Record<string, number>;
}
type Switches = Pick<DisplaySpec, "sortByMutationType" | "sortByDrivers" | "sortIgnoreVUS">;
type Mapping = "forward" | "reversed";

const TRUNC = "Nonsense_Mutation", MIS = "Missense_Mutation";
const mut = (mt: string, driver = false, germ = false): Ev => ({ vt: "mutation", mt, driver, ...(germ ? { germ } : {}) });
const cna = (v: number, driver = false): Ev => ({ vt: "cna", cna: v, driver });
const sv = (driver = false): Ev => ({ vt: "structural_variant", driver });
const NO_DRIVERS: DriverSettings = { oncokb: false, custom: false, tiers: [] };

function ids(f: Fixture, m: Mapping): Map<string, string> {
  const letters = Object.keys(f.cols);
  return new Map(letters.map((l, i): [string, string] => [l, "c" + (m === "forward" ? i + 1 : letters.length - i)]));
}

function build(f: Fixture, m: Mapping, display: DisplaySpec, drivers?: DriverSettings) {
  const id = ids(f, m), letters = [...id.keys()];
  const events = letters.flatMap((l) => f.cols[l].map((e) => ({ pid: id.get(l)!, gene: "TP53", ...e }))) as EventRow[];
  const overlays = ([["mrna", f.mrna], ["protein", f.prot]] as const).filter(([, v]) => v).map(([kind, v]) => ({
    kind, profileType: kind, threshold: 2, values: new Map(Object.entries(v!).map(([l, x]): [string, number] => [id.get(l)! + "|TP53", x])) }));
  return assembleContract({
    genes: ["TP53"], groups: [{ name: "all", pids: letters.map((l) => id.get(l)!) }], studies: ["s"], events,
    coverage: letters.filter((l) => !(f.notProfiled ?? []).includes(l)).map((l) => ({ pid: id.get(l)!, genes: ["TP53"] })),
    isDriver: (r) => !!(r as { driver?: boolean }).driver, annotationSource: "t",
    clinical: [], heatmap: [], derived: [], ...(overlays.length ? { overlays } : {}),
    sort: [{ track: "genomic", dir: "asc" }], lineGap: 0, display: normalizeDisplay(display, drivers) });
}

const toLetters = (f: Fixture, m: Mapping, cols: string[]) => {
  const back = new Map([...ids(f, m)].map(([l, i]) => [i, l]));
  return cols.map((c) => back.get(c)!);
};

/** the engine's column order, as letters */
function engine(f: Fixture, m: Mapping, display: DisplaySpec, drivers?: DriverSettings): string[] {
  return toLetters(f, m, build(f, m, display, drivers).columns);
}

/** the browser's re-sort of a contract drawn with default switches, to this display's switches */
function browser(f: Fixture, m: Mapping, display: DisplaySpec, drivers?: DriverSettings): string[] {
  const { sortByMutationType: _a, sortByDrivers: _b, sortIgnoreVUS: _c, ...rest } = display;
  const buf = packContract(build(f, m, rest, drivers));
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const order = Uint32Array.from({ length: data.n }, (_, i) => i), cols = data.columns();
  const sorted = sortColumns(data, order, [{ name: "all", start: 0, count: data.n, patients: data.n }], [{ track: "genomic", dir: "asc" }],
    staircaseOptions(normalizeDisplay(display, drivers)));
  return toLetters(f, m, Array.from(sorted, (i) => cols[i]));
}

/** tie classes -> the order, each class by id */
function expected(f: Fixture, m: Mapping, classes: string[][]): string[] {
  const id = ids(f, m), n = (l: string) => Number(id.get(l)!.slice(1));
  return classes.flatMap((c) => [...c].sort((a, b) => n(a) - n(b)));
}

type Sorter = typeof engine;
const WHERE = { engine, browser } as const;
const each = (name: string, fn: (sort: Sorter, where: string) => void, opts: { skip?: string } = {}) => {
  for (const [where, sort] of Object.entries(WHERE)) test(name + " [" + where + "]", opts, () => fn(sort, where));
};
/** assert the order under both id mappings */
function check(sort: Sorter, f: Fixture, display: DisplaySpec, classes: string[][], label: string, drivers?: DriverSettings) {
  for (const m of ["forward", "reversed"] as const)
    assert.deepEqual(sort(f, m, display, drivers), expected(f, m, classes), label + " (" + m + " ids)");
}

const sw = (mt: boolean, dr: boolean, iv: boolean): Switches => ({ sortByMutationType: mt, sortByDrivers: dr, sortIgnoreVUS: iv });
const ALL_SWITCHES: [string, Switches][] = [];
for (const mt of [true, false]) for (const dr of [true, false]) for (const iv of [false, true])
  ALL_SWITCHES.push([`MT ${mt ? "on" : "off"}, DR ${dr ? "on" : "off"}, IV ${iv ? "on" : "off"}`, sw(mt, dr, iv)]);

// ---- fixtures -----------------------------------------------------------------------------------
// rows 2-8: A missense VUS, B truncating driver, C missense driver, D truncating VUS, E unaltered
const MUTS: Fixture = { cols: { A: [mut(MIS)], B: [mut(TRUNC, true)], C: [mut(MIS, true)], D: [mut(TRUNC)], E: [] } };
// rows 9-11, with D a homdel VUS in place of the table's gain VUS (see row 9)
const CNAS: Fixture = { cols: { A: [cna(2)], B: [cna(-2, true)], C: [cna(2, true)], D: [cna(-2)], E: [] } };
const SVS: Fixture = { cols: { A: [sv()], B: [sv(true)], C: [] } };

// ---- rows ---------------------------------------------------------------------------------------

each("1: defaults are MT on, DR on, IV off (RVO 230-250)", (sort) => {
  assert.deepEqual(staircaseOptions(), { byType: true, byDriver: true, ignoreVus: false }, "staircaseOptions()");
  assert.deepEqual(staircaseOptions(normalizeDisplay({})), { byType: true, byDriver: true, ignoreVus: false }, "staircaseOptions(normalizeDisplay({}))");
  for (const m of ["forward", "reversed"] as const)
    assert.deepEqual(sort(MUTS, m, {}), sort(MUTS, m, sw(true, true, false)), "no switches = the explicit defaults (" + m + ")");
});

each("2: MT on, DR on, IV off: every driver type before every VUS type, then type order (SU 159-176)", (sort) => {
  check(sort, MUTS, sw(true, true, false), [["B"], ["C"], ["D"], ["A"], ["E"]], "B, C, D, A, E");
});

each("3: MT on, DR off, IV off: trunc (B, D) tie, then missense (C, A) tie, then E (SU 147-158)", (sort) => {
  check(sort, MUTS, sw(true, false, false), [["B", "D"], ["A", "C"], ["E"]], "[B D] [A C] E");
});

each("4: MT off, DR on, IV off: drivers (B, C) tie, VUS (A, D) tie, then E (SU 134-146)", (sort) => {
  check(sort, MUTS, sw(false, true, false), [["B", "C"], ["A", "D"], ["E"]], "[B C] [A D] E");
});

each("5: MT off, DR off, IV off: every mutated column ties, then E (SU 128-133)", (sort) => {
  check(sort, MUTS, sw(false, false, false), [["A", "B", "C", "D"], ["E"]], "[A B C D] E");
});

each("6: MT on, DR on, IV on: B, then C, then A, D, E tie (SU 106-115, vusAndUnmutated 96-105)", (sort) => {
  check(sort, MUTS, sw(true, true, true), [["B"], ["C"], ["A", "D", "E"]], "B C [A D E]");
});

each("7: MT off, DR on, IV on: B and C tie, then A, D, E tie (SU 116-127)", (sort) => {
  check(sort, MUTS, sw(false, true, true), [["B", "C"], ["A", "D", "E"]], "[B C] [A D E]");
});

each("8: IV on with DR off, or with no driver annotation, has no effect (DU 1030-1038, 1220-1235)", (sort) => {
  check(sort, MUTS, sw(true, false, true), [["B", "D"], ["A", "C"], ["E"]], "MT on, DR off, IV on = row 3");
  check(sort, MUTS, sw(false, false, true), [["A", "B", "C", "D"], ["E"]], "MT off, DR off, IV on = row 5");
  // no driver source: nothing is a driver, distinguishDrivers is false, so DR and IV are both off in effect
  const noAnn: Fixture = { cols: { A: [mut(MIS)], B: [mut(TRUNC)], C: [mut(MIS)], D: [mut(TRUNC)], E: [] } };
  check(sort, noAnn, sw(true, true, true), [["B", "D"], ["A", "C"], ["E"]], "no driver annotation, MT on, DR on, IV on = by type", NO_DRIVERS);
});

each("9: CNA, DR on, IV off: driver CNAs before VUS CNAs, then amp before homdel (SU 76-87)", (sort) => {
  // the table's D is a gain VUS; this engine does not draw a low-level gain (the portal's default OQL
  // does not fetch one either), so D is a homdel VUS here: C, B, A, D, E either way
  check(sort, CNAS, sw(true, true, false), [["C"], ["B"], ["A"], ["D"], ["E"]], "C B A D E");
});

each("10: CNA, DR off: amps (A, C) tie, then homdels (B, D), then E; MT has no effect on CNA (SU 65-73)", (sort) => {
  check(sort, CNAS, sw(true, false, false), [["A", "C"], ["B", "D"], ["E"]], "MT on");
  check(sort, CNAS, sw(false, false, false), [["A", "C"], ["B", "D"], ["E"]], "MT off: CNA is not collapsed to altered-or-not");
});

each("11: CNA, DR on, IV on: C, B, then A, D, E tie (SU 56-64)", (sort) => {
  check(sort, CNAS, sw(true, true, true), [["C"], ["B"], ["A", "D", "E"]], "MT on");
  check(sort, CNAS, sw(false, true, true), [["C"], ["B"], ["A", "D", "E"]], "MT off");
});

each("12: SV: DR on, IV off: B, A, C / DR off: A and B tie, then C / IV on: B, then A and C tie (SU 183-189)", (sort) => {
  check(sort, SVS, sw(true, true, false), [["B"], ["A"], ["C"]], "DR on, IV off");
  check(sort, SVS, sw(true, false, false), [["A", "B"], ["C"]], "DR off");
  check(sort, SVS, sw(false, false, false), [["A", "B"], ["C"]], "DR off, MT off");
  check(sort, SVS, sw(true, true, true), [["B"], ["A", "C"]], "IV on");
});

each("13: SV is compared before CNA: an SV VUS before an amp driver, any switches with IV off (SU 213-216)", (sort) => {
  const f: Fixture = { cols: { A: [sv()], B: [cna(2, true)] } };
  for (const [name, s] of ALL_SWITCHES.filter(([, s]) => !s.sortIgnoreVUS)) check(sort, f, s, [["A"], ["B"]], name);
});

each("14: as 13 with IV on: the amp driver before the SV VUS, which counts as unaltered (SU 184-185)", (sort) => {
  const f: Fixture = { cols: { A: [sv()], B: [cna(2, true)] } };
  check(sort, f, sw(true, true, true), [["B"], ["A"]], "MT on");
  check(sort, f, sw(false, true, true), [["B"], ["A"]], "MT off");
});

each("15: germline missense VUS vs unmutated: a tie with IV on, the germline first with IV off (SU 194-206)", (sort) => {
  const f: Fixture = { cols: { A: [mut(MIS, false, true)], B: [] } };
  check(sort, f, sw(true, true, true), [["A", "B"]], "IV on: tie");
  check(sort, f, sw(true, true, false), [["A"], ["B"]], "IV off: A first");
});

each("16: germline trunc driver before somatic trunc driver (SU 191, 194-206)", (sort) => {
  const f: Fixture = { cols: { A: [mut(TRUNC, true, true)], B: [mut(TRUNC, true)] } };
  for (const [name, s] of ALL_SWITCHES.filter(([, s]) => s.sortByDrivers || !s.sortIgnoreVUS)) check(sort, f, s, [["A"], ["B"]], name);
});

each("17: mRNA and protein: high, then low, then none, under every switch (SU 190, 222-226)", (sort) => {
  const mrna: Fixture = { cols: { A: [], B: [], C: [] }, mrna: { A: 3, B: -3 } };
  const prot: Fixture = { cols: { A: [], B: [], C: [] }, prot: { A: 3, B: -3 } };
  for (const [name, s] of ALL_SWITCHES) {
    check(sort, mrna, s, [["A"], ["B"], ["C"]], "mRNA, " + name);
    check(sort, prot, s, [["A"], ["B"], ["C"]], "protein, " + name);
  }
});

each("18: not profiled comes after profiled under every switch (SU 235)", (sort) => {
  // A not profiled for TP53, B profiled and unaltered, C a missense VUS
  const f: Fixture = { cols: { A: [], B: [], C: [mut(MIS)] }, notProfiled: ["A"] };
  for (const [name, s] of ALL_SWITCHES) {
    const ivEff = !!s.sortIgnoreVUS && !!s.sortByDrivers;
    check(sort, f, s, ivEff ? [["B", "C"], ["A"]] : [["C"], ["B"], ["A"]], name);
  }
});

each("19: a cell with a missense driver and a trunc VUS sorts as missense, after a trunc-only VUS, with MT on, DR off (DAT 42-55, 242; SU 147-158)", (sort) => {
  const f: Fixture = { cols: { A: [mut(MIS, true), mut(TRUNC)], B: [mut(TRUNC)] } };
  check(sort, f, sw(true, false, false), [["B"], ["A"]], "MT on, DR off");
  check(sort, f, sw(true, true, false), [["A"], ["B"]], "MT on, DR on: missense driver first");
});

each("20: Mutation Type is off in effect when colour by type is off (DU 1013-1019)", (sort) => {
  // colorByType false with MT left on: sorts as row 4 (MT off, DR on)
  check(sort, MUTS, { colorByType: false, ...sw(true, true, false) }, [["B", "C"], ["A", "D"], ["E"]], "colorByType off, MT on = row 4");
  check(sort, MUTS, { colorByType: false, ...sw(true, false, false) }, [["A", "B", "C", "D"], ["E"]], "colorByType off, MT on, DR off = row 5");
});

each("21: Driver (and so Ignore VUS) is off in effect with no driver annotation (RVO 802-804, DU 1021-1038)", (sort) => {
  // nothing is a driver; DR on alone cannot be told from off on mutations, so IV on shows it:
  // in effect off, the VUS still rank by type before the unaltered E
  const f: Fixture = { cols: { A: [mut(MIS)], B: [mut(TRUNC)], E: [] } };
  check(sort, f, sw(true, true, true), [["B"], ["A"], ["E"]], "MT on, DR on, IV on", NO_DRIVERS);
  check(sort, f, sw(false, true, true), [["A", "B"], ["E"]], "MT off, DR on, IV on", NO_DRIVERS);
  const c: Fixture = { cols: { A: [cna(2)], B: [cna(-2)], E: [] } };
  check(sort, c, sw(true, true, true), [["A"], ["B"], ["E"]], "CNA, IV on", NO_DRIVERS);
});

each("22: UI disabled rules and tooltip (OC 638-683, 717-775, 162-164)", () => {}, {
  skip: "UI-only: the menu's disabled state and tooltip live in OncoprintFigure.tsx, which exports no rule function; needs a browser test" });

test("23: Ignore VUS changes no count: VUS columns stay drawn and counted (no sortIgnoreVUS in OncoprintUtils / oncoprintjs) [engine]", () => {
  for (const m of ["forward", "reversed"] as const) {
    const off = build(MUTS, m, sw(true, true, false)).tracks.find((t) => t.label === "TP53")!;
    const on = build(MUTS, m, sw(true, true, true)).tracks.find((t) => t.label === "TP53")!;
    assert.equal(on.altered, 4, "A-D altered with IV on");
    assert.deepEqual([on.altered, on.profiled, on.driverAltered, on.freqPct, on.driverPct], [off.altered, off.profiled, off.driverAltered, off.freqPct, off.driverPct]);
  }
});

test("24: a switch change re-orders the columns and changes no cell (DU 1218-1238) [engine]", () => {
  const cellsOf = (display: DisplaySpec) => {
    const c = build(MUTS, "forward", display), t = c.tracks.find((x) => x.label === "TP53")!;
    return Object.fromEntries(c.columns.map((p, i) => [p, t.cells[i]]));
  };
  const base = cellsOf(sw(true, true, false));
  for (const [name, s] of ALL_SWITCHES) assert.deepEqual(cellsOf(s), base, name);
});
