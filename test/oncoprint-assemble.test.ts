// The pure assembler: rows in, contract out, with no database. Cell bits, NOT_PROFILED
// from coverage, driver bit, panel-aware frequencies, clinical typing, group order and
// the staircase sort are all asserted on a fixture small enough to check by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { assembleContract, BITS, NOT_PROFILED, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";

const ev = (pid: string, gene: string, vt: string, mt?: string, cna?: number, driver = false) => ({ pid, gene, vt, mt, cna, driver });
const input = (): AssembleInput => ({
  genes: ["TP53", "KRAS"],
  groups: [{ name: "A", pids: ["P1", "P2", "P3"] }, { name: "B", pids: ["P4", "P5"] }],
  studies: ["s"],
  events: [
    ev("P1", "TP53", "mutation", "Missense_Mutation", undefined, true),
    ev("P2", "TP53", "mutation", "Nonsense_Mutation", undefined, false),
    ev("P2", "KRAS", "cna", undefined, 2, true),
    ev("P3", "KRAS", "cna", undefined, 1),               // low-level gain: not drawn
    ev("P5", "TP53", "structural_variant", undefined, undefined, true),
    ev("P9", "TP53", "mutation", "Missense_Mutation")    // not a column: ignored
  ],
  coverage: [{ pid: "P1", genes: ["TP53", "KRAS"] }, { pid: "P2", genes: ["TP53", "KRAS"] }, { pid: "P3", genes: ["TP53", "KRAS"] }, { pid: "P4", genes: ["TP53"] }],
  isDriver: (r: EventRow & { driver?: boolean }) => !!r.driver,
  annotationSource: "fixture",
  clinical: [
    { attr: "TYPE", values: new Map([["P1", "x"], ["P2", "y"], ["P3", "x"], ["P4", "x"]]) },
    { attr: "AGE", values: new Map<string, string>([...["P1", "P2", "P3", "P4", "P5"].map((p, i): [string, string] => [p, String(40 + i * 3)]), ["Q1", "1"], ["Q2", "2"], ["Q3", "3"], ["Q4", "4"], ["Q5", "5"], ["Q6", "6"]]) },
    { attr: "MISSING", values: new Map() }
  ],
  heatmap: [], derived: [{ label: "treated", pids: new Set(["P2", "P5"]) }],
  sort: [{ track: "genomic", dir: "asc" }], lineGap: 90
});

test("cells: bitmask, driver bit, NOT_PROFILED from coverage, event implies profiled", () => {
  const c = assembleContract(input());
  const byLabel = Object.fromEntries(c.tracks.map((t) => [t.label, t]));
  const col = (p: string) => c.columns.indexOf(p);
  assert.equal(byLabel.TP53.cells[col("P1")], BITS.MISSENSE | BITS.DRIVER);
  assert.equal(byLabel.TP53.cells[col("P2")], BITS.TRUNCATING);
  assert.equal(byLabel.KRAS.cells[col("P2")], BITS.AMP | BITS.DRIVER);
  assert.equal(byLabel.KRAS.cells[col("P3")], 0, "gain is below the high-level threshold");
  assert.equal(byLabel.KRAS.cells[col("P4")], NOT_PROFILED, "P4's panel does not cover KRAS");
  assert.equal(byLabel.TP53.cells[col("P5")], BITS.SV | BITS.DRIVER, "an event on an uncovered patient still draws");
  assert.equal(byLabel.KRAS.cells[col("P5")], NOT_PROFILED);
});

test("frequencies use profiled columns as the denominator", () => {
  const c = assembleContract(input());
  const tp53 = c.tracks.find((t) => t.label === "TP53")!;
  assert.equal(tp53.profiled, 5); assert.equal(tp53.altered, 3); assert.equal(tp53.driverAltered, 2);
  assert.equal(tp53.freqPct, 60); assert.equal(tp53.driverPct, 40);
  const kras = c.tracks.find((t) => t.label === "KRAS")!;
  assert.equal(kras.profiled, 3); assert.equal(kras.freqPct, 33.3);
});

test("clinical typing: categorical with Other, numeric only past 10 distinct values, absent attribute labelled", () => {
  const c = assembleContract(input());
  const type = c.tracks.find((t) => t.label === "TYPE")!;
  assert.deepEqual(type.categories, ["x", "y"]);
  const age = c.tracks.find((t) => t.label === "AGE")!;
  assert.equal(age.numeric, undefined, "five distinct values among the columns is categorical, whatever else the map holds");
  assert.ok(c.tracks.some((t) => t.label === "MISSING (no data)"));
  assert.deepEqual(c.tracks.map((t) => t.kind), ["gene", "gene", "derivedEvent", "clinical", "clinical", "clinical"]);

  const pids = Array.from({ length: 12 }, (_, i) => "P" + (i + 1));
  const wide = assembleContract({ ...input(), groups: [{ name: "A", pids }],
    clinical: [{ attr: "AGE", values: new Map(pids.map((p, i) => [p, String(40 + i * 3)])) }, { attr: "ST", values: new Map(pids.map((p, i) => [p, "s" + (i % 9)])) }] });
  const num = wide.tracks.find((t) => t.label === "AGE")!;
  assert.equal(num.numeric, true); assert.equal(num.min, 40); assert.equal(num.max, 73);
  assert.equal(num.cells[wide.columns.indexOf("P12")], 255);
  assert.equal(num.cells[wide.columns.indexOf("P1")], 0);
  const st = wide.tracks.find((t) => t.label === "ST")!;
  assert.equal(st.categories!.length, 9, "top 8 categories plus Other");
  assert.equal(st.categories![8], "Other");
});

test("groups keep their order and the staircase sorts within each group", () => {
  const c = assembleContract(input());
  assert.deepEqual(c.groups, [{ name: "A", start: 0, count: 3 }, { name: "B", start: 3, count: 2 }]);
  // A: P1 (missense driver) vs P2 (truncating VUS + KRAS amp driver): TP53 is the first gene, truncating outranks missense
  assert.deepEqual(c.columns.slice(0, 3), ["P2", "P1", "P3"]);
  assert.deepEqual(c.columns.slice(3), ["P5", "P4"]);
});

test("declarative sort by a clinical track, missing values last, then the staircase", () => {
  const c = assembleContract({ ...input(), sort: [{ track: "TYPE", dir: "asc" }] });
  assert.deepEqual(c.columns.slice(0, 3), ["P1", "P3", "P2"]);   // x, x, y — within x the staircase: P1 altered before P3
  assert.deepEqual(c.columns.slice(3), ["P4", "P5"]);             // P5 has no TYPE: last
  assert.deepEqual(c.conventions.sort, ["TYPE"]);
  assert.throws(() => assembleContract({ ...input(), sort: [{ track: "NOPE", dir: "asc" }] }), /not a track/);
});

test("the contract carries resolved viewing options, defaulted when the caller gives none", () => {
  assert.deepEqual(assembleContract(input()).display, { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all" });
  const d = { showUnaltered: false, whitespace: true, gaps: "pct" as const, clinicalLegends: "none" as const };
  assert.deepEqual(assembleContract({ ...input(), display: d }).display, d);
});

test("more than one study adds a Study track from studyOf", () => {
  const c = assembleContract({ ...input(), studies: ["s1", "s2"], studyOf: new Map([["P1", "s1"], ["P2", "s1"], ["P3", "s2"], ["P4", "s2"], ["P5", "s2"]]) });
  const st = c.tracks.find((t) => t.label === "Study")!;
  assert.deepEqual(st.categories, ["s1", "s2"]);
  assert.equal(st.cells[c.columns.indexOf("P3")], 1);
  assert.equal(c.study, "s1 + s2");
});
