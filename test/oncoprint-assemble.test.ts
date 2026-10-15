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
  assert.equal(byLabel.TP53.cells[col("P1")], BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER);
  assert.equal(byLabel.TP53.cells[col("P2")], BITS.TRUNCATING);
  assert.equal(byLabel.KRAS.cells[col("P2")], BITS.AMP | BITS.DRIVER);
  assert.equal(byLabel.KRAS.cells[col("P3")], 0, "gain is below the high-level threshold");
  assert.equal(byLabel.KRAS.cells[col("P4")], NOT_PROFILED, "P4's panel does not cover KRAS");
  assert.equal(byLabel.TP53.cells[col("P5")], BITS.SV | BITS.DRIVER | BITS.SV_DRIVER, "an event on an uncovered patient still draws");
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

test("byGroup: the same pooled formula, sliced to each group's own columns", () => {
  const c = assembleContract(input());
  const tp53 = c.tracks.find((t) => t.label === "TP53")!;
  // group A = P1 (altered), P2 (altered), P3 (profiled, not altered) -> 2 of 3
  // group B = P4 (profiled, not altered), P5 (altered via an event on an uncovered
  // patient) -> 1 of 2 -- and 2+1 = 3, 3+2 = 5, matching the pooled numbers above exactly
  assert.deepEqual(tp53.byGroup, [
    { group: "A", altered: 2, profiled: 3, freqPct: 66.7, driverPct: 33.3 },
    { group: "B", altered: 1, profiled: 2, freqPct: 50, driverPct: 50 }
  ]);
  const kras = c.tracks.find((t) => t.label === "KRAS")!;
  // group B is NOT_PROFILED for KRAS entirely (P4's panel omits it, P5 has no KRAS
  // event) -- 0 profiled, so freqPct/driverPct are null rather than a division by zero
  assert.deepEqual(kras.byGroup, [
    { group: "A", altered: 1, profiled: 3, freqPct: 33.3, driverPct: 33.3 },
    { group: "B", altered: 0, profiled: 0, freqPct: null, driverPct: null }
  ]);
});

test("byGroup is absent (not an empty array) for a single-group oncoprint", () => {
  const c = assembleContract({ ...input(), groups: [{ name: "everyone", pids: ["P1", "P2", "P3", "P4", "P5"] }] });
  const tp53 = c.tracks.find((t) => t.label === "TP53")!;
  assert.equal(tp53.byGroup, undefined, "one group pooled == the whole thing; a breakdown would just repeat it");
});

test("byGroup is only on gene tracks, not clinical/derived/heatmap rows", () => {
  const c = assembleContract(input());
  const nonGene = c.tracks.filter((t) => t.kind !== "gene");
  assert.ok(nonGene.length > 0, "fixture actually has non-gene tracks to check");
  for (const t of nonGene) assert.equal((t as { byGroup?: unknown }).byGroup, undefined);
});

test("clinical typing: categorical with Other, numeric only past 10 distinct values, absent attribute labelled", () => {
  const c = assembleContract(input());
  const type = c.tracks.find((t) => t.label === "TYPE")!;
  assert.deepEqual(type.categories, ["x", "y"]);
  const age = c.tracks.find((t) => t.label === "AGE")!;
  assert.equal(age.numeric, undefined, "five distinct values among the columns is categorical, whatever else the map holds");
  assert.ok(c.tracks.some((t) => t.label === "MISSING (no data)"));
  assert.deepEqual(c.tracks.map((t) => t.kind), ["clinical", "clinical", "clinical", "derivedEvent", "gene", "gene"], "the portal's order: clinical above the genes");

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
  assert.deepEqual(assembleContract(input()).display, { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all", colorByType: true, hideVUS: false, annotate: "oncokb", whiteBackground: false });
  const d = { showUnaltered: false, whitespace: true, gaps: "pct" as const, clinicalLegends: "none" as const,
    colorByType: true, hideVUS: false, annotate: "oncokb" as const, whiteBackground: false };
  assert.deepEqual(assembleContract({ ...input(), display: d }).display, d);
});

test("sorting by patient id, ascending and descending", () => {
  const asc = assembleContract({ ...input(), sort: [{ track: "id", dir: "asc" }] });
  assert.deepEqual(asc.columns, ["P1", "P2", "P3", "P4", "P5"]);
  const desc = assembleContract({ ...input(), sort: [{ track: "id", dir: "desc" }] });
  assert.deepEqual(desc.columns, ["P3", "P2", "P1", "P5", "P4"], "descending within each group");
  assert.deepEqual(desc.conventions.sort, ["-id"]);
});

test("the unit labels the contract and names what a column is", () => {
  const pt = assembleContract(input());
  assert.equal(pt.unit, "patient");
  assert.match(pt.conventions.column!, /one patient.*collapsed/);
  assert.equal(pt.conventions.frequencyDenominator, "profiled patients");
  const sm = assembleContract({ ...input(), unit: "sample" });
  assert.equal(sm.unit, "sample");
  assert.match(sm.conventions.column!, /one sample.*every sample of a selected patient/);
  assert.equal(sm.conventions.frequencyDenominator, "profiled samples");
  // the assembly itself is unit-agnostic: same rows in, same cells out
  assert.deepEqual(sm.columns, pt.columns);
  assert.deepEqual(sm.tracks.map((t) => t.cells), pt.tracks.map((t) => t.cells));
});

test("more than one study adds the \"Study of origin\" track from studyOf", () => {
  const c = assembleContract({ ...input(), studies: ["s1", "s2"], studyOf: new Map([["P1", "s1"], ["P2", "s1"], ["P3", "s2"], ["P4", "s2"], ["P5", "s2"]]) });
  const st = c.tracks.find((t) => t.label === "Study of origin")!;
  assert.deepEqual(st.categories, ["s1", "s2"]);
  assert.equal(st.cells[c.columns.indexOf("P3")], 1);
  assert.equal(c.study, "s1 + s2");
});

test("profiled-for rows: one per drawn type some columns lack, after the study track, 'No' as no data", () => {
  // bits over PROFILED_TYPES: 1 mutations, 2 CNA, 4 SV, 8 mRNA
  const masks = [{ pid: "P1", mask: 7 }, { pid: "P2", mask: 7 }, { pid: "P3", mask: 1 | 4 }, { pid: "P4", mask: 7 }, { pid: "P5", mask: 7 | 8 }];
  const c = assembleContract({ ...input(), studies: ["s1", "s2"], studyOf: new Map([["P1", "s1"], ["P2", "s1"], ["P3", "s2"], ["P4", "s2"], ["P5", "s2"]]),
    profiled: { types: ["MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION", "STRUCTURAL_VARIANT", "MRNA_EXPRESSION"], masks } });
  const clin = c.tracks.filter((t) => t.kind === "clinical");
  assert.deepEqual(clin.map((t) => t.label).slice(0, 3), ["Study of origin", "Profiled for copy number alterations", "Profiled for mRNA expression"],
    "every column has mutations and SV, so those rows say nothing and are left out, as in the portal");
  const cna = clin[1];
  assert.equal(cna.profiledFor, "COPY_NUMBER_ALTERATION");
  assert.deepEqual(cna.categories, ["Yes"]);
  assert.equal(cna.cells[c.columns.indexOf("P3")], -1);
  assert.equal(cna.cells[c.columns.indexOf("P1")], 0);
  // nobody profiled is as silent as everybody profiled
  const none = assembleContract({ ...input(), profiled: { types: ["PROTEIN_LEVEL"], masks } });
  assert.ok(!none.tracks.some((t) => t.profiledFor));
});

test("# Samples per Patient: a bar row from zero, only when some patient has more than one sample", () => {
  const samples = [{ pid: "P1", n: 1 }, { pid: "P2", n: 3 }, { pid: "P3", n: 1 }, { pid: "P4", n: 2 }, { pid: "P5", n: 1 }];
  const masks = ["P1", "P2", "P3", "P4"].map((pid) => ({ pid, mask: 1 }));
  const c = assembleContract({ ...input(), samples, profiled: { types: ["MUTATION_EXTENDED"], masks } });
  const clin = c.tracks.filter((t) => t.kind === "clinical");
  assert.deepEqual(clin.slice(0, 2).map((t) => t.label), ["# Samples per Patient", "Profiled for mutations"], "the portal's order");
  const t = clin[0];
  assert.ok(t.numeric && t.bar);
  assert.equal(t.min, 0); assert.equal(t.max, 3);
  assert.equal(t.cells[c.columns.indexOf("P2")], 255);
  assert.equal(t.cells[c.columns.indexOf("P1")], 85, "one sample of a most of three is a third of the cell");
  const one = assembleContract({ ...input(), samples: samples.map((r) => ({ ...r, n: 1 })) });
  assert.ok(!one.tracks.some((x) => x.label === "# Samples per Patient"), "nobody with more than one: no row");
  const bySample = assembleContract({ ...input(), unit: "sample", samples });
  assert.ok(!bySample.tracks.some((x) => x.label === "# Samples per Patient"), "a sample column is one sample");
});

// ---- merged gene rows (cBioPortal's `[TP53 MDM2]`) -------------------------

test("a merged row is the OR of its members, and profiled where any member was", () => {
  const i = input();
  i.genes = [{ label: "pathway", genes: ["TP53", "KRAS"] }];
  const c = assembleContract(i);
  const t = c.tracks.find((x) => x.label === "pathway")!;
  const col = (p: string) => c.columns.indexOf(p);
  assert.deepEqual(t.members, ["TP53", "KRAS"]);
  assert.equal(t.cells[col("P1")], BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER);
  assert.equal(t.cells[col("P2")], BITS.TRUNCATING | BITS.AMP | BITS.DRIVER, "both members' bits land in one cell");
  assert.equal(t.cells[col("P4")], 0, "profiled for TP53 only, and unaltered in both");
  assert.equal(t.cells[col("P5")], BITS.SV | BITS.DRIVER | BITS.SV_DRIVER);
});

test("a merged row's denominator is the union of its members' panels", () => {
  const i = input();
  // P4's panel covers TP53 but not KRAS; on its own KRAS is profiled in 3 columns, TP53 in 5
  i.genes = [{ genes: ["TP53", "KRAS"] }];
  const c = assembleContract(i);
  const t = c.tracks.find((x) => x.kind === "gene")!;
  assert.equal(t.label, "TP53 / KRAS", "the default label names the members");
  assert.equal(t.profiled, 5, "union: every column profiled for either gene");
  assert.equal(t.altered, 3, "P1, P2 and P5; P3's low-level gain is not an alteration and P4 has none");
  assert.equal(t.freqPct, 60);
  assert.equal(t.driverPct, 60, "the driver bit is per cell, so P2's driver amplification makes its cell a driver cell");
});

test("a gene can be both merged and drawn on its own, and the rows agree", () => {
  const i = input();
  i.genes = [{ label: "either", genes: ["TP53", "KRAS"] }, "TP53", "KRAS"];
  const c = assembleContract(i);
  const solo = c.tracks.find((t) => t.label === "TP53")!;
  const merged = c.tracks.find((t) => t.label === "either")!;
  assert.equal(c.tracks.filter((t) => t.kind === "gene").length, 3);
  assert.equal(solo.profiled, 5); assert.equal(solo.altered, 3);
  for (let k = 0; k < c.columns.length; k++)
    if (solo.cells[k] > 0) assert.ok((merged.cells[k] & solo.cells[k]) === solo.cells[k], "the merged row carries every bit of its member");
  assert.equal(solo.members, undefined, "a single-gene row names no members");
});

test("the staircase ranks a merged row as one row", () => {
  const i = input();
  i.genes = [{ label: "either", genes: ["TP53", "KRAS"] }];
  const c = assembleContract(i);
  const t = c.tracks.find((x) => x.kind === "gene")!;
  // within group A: P2 (amp, driver) outranks P1 (missense driver) outranks P3 (unaltered)
  assert.deepEqual(c.columns.slice(0, 3), ["P2", "P1", "P3"]);
  assert.ok(t.cells[0] & BITS.AMP);
});

test("a merged row draws its members' overlays too", () => {
  const i = input();
  i.genes = [{ label: "either", genes: ["TP53", "KRAS"] }];
  i.overlays = [{ kind: "mrna", profileType: "rna", threshold: 2, values: new Map([["P3|KRAS", 3.1], ["P1|TP53", -2.5]]) }];
  const c = assembleContract(i);
  const t = c.tracks.find((x) => x.kind === "gene")!;
  const col = (p: string) => c.columns.indexOf(p);
  assert.ok(t.cells[col("P3")] & BITS.MRNA_HIGH, "KRAS expression lands on the merged row");
  assert.ok(t.cells[col("P1")] & BITS.MRNA_LOW);
});

test("hiding unknown significance drops the alteration, not the whole cell", () => {
  const i = input();
  i.genes = [{ label: "either", genes: ["TP53", "KRAS"] }];
  i.display = { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all", colorByType: true,
    hideVUS: true, annotate: "oncokb", whiteBackground: false };
  const c = assembleContract(i);
  const col = (p: string) => c.columns.indexOf(p);
  // P2 has a non-driver TP53 truncation and a driver KRAS amp: the truncation goes, the amp stays.
  // A merged row must not let one gene's driver smuggle another gene's passenger through.
  const row = c.tracks.find((x) => x.kind === "gene")!;
  assert.equal(row.cells[col("P2")], BITS.AMP | BITS.DRIVER);
  assert.equal(row.cells[col("P1")], BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER, "a driver is kept");
  assert.equal(c.stats.hiddenVus, 1);
});

test("hiding unknown significance leaves the cell profiled where the alteration was found", () => {
  const i = input();
  i.display = { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all", colorByType: true,
    hideVUS: true, annotate: "oncokb", whiteBackground: false };
  const c = assembleContract(i);
  const tp53 = c.tracks.find((t) => t.label === "TP53")!;
  const col = (p: string) => c.columns.indexOf(p);
  // P5 is in no coverage row: its only evidence of being assayed is the (driver) SV
  assert.equal(tp53.cells[col("P2")], 0, "the passenger truncation is gone, the column stays profiled");
  assert.equal(tp53.profiled, 5);
  assert.equal(tp53.altered, 2, "P1 and P5, both drivers");
});
