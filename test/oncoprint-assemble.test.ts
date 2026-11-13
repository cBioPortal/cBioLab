// The pure assembler: rows in, contract out, with no database. Cell bits, NOT_PROFILED
// from coverage, driver bit, panel-aware frequencies, clinical typing, group order and
// the staircase sort are all asserted on a fixture small enough to check by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { assembleContract, normalizeDisplay, BITS, NOT_PROFILED, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";

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
  coverage: [{ pid: "P1", genes: ["TP53", "KRAS"] }, { pid: "P2", genes: ["TP53", "KRAS"] }, { pid: "P3", genes: ["TP53", "KRAS"] }, { pid: "P4", genes: ["TP53"] }, { pid: "P5", genes: ["TP53"] }],
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

test("cells: bitmask, driver bit, NOT_PROFILED from coverage", () => {
  const c = assembleContract(input());
  const byLabel = Object.fromEntries(c.tracks.map((t) => [t.label, t]));
  const col = (p: string) => c.columns.indexOf(p);
  assert.equal(byLabel.TP53.cells[col("P1")], BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER);
  assert.equal(byLabel.TP53.cells[col("P2")], BITS.TRUNCATING);
  assert.equal(byLabel.KRAS.cells[col("P2")], BITS.AMP | BITS.DRIVER | BITS.CNA_DRIVER);
  assert.equal(byLabel.KRAS.cells[col("P3")], 0, "gain is below the high-level threshold");
  assert.equal(byLabel.KRAS.cells[col("P4")], NOT_PROFILED, "P4's panel does not cover KRAS");
  assert.equal(byLabel.TP53.cells[col("P5")], BITS.SV | BITS.DRIVER | BITS.SV_DRIVER);
  assert.equal(byLabel.KRAS.cells[col("P5")], NOT_PROFILED);
  assert.equal(c.stats.offPanel, undefined, "no call here falls outside its column's panels");
});

test("a call on a cell no panel covers is not drawn, and not in the %, as cBioPortal's results view", () => {
  // P6's panel covers TP53 only; P7 is in no coverage row at all. Their KRAS and TP53 calls are
  // off-panel: the portal counts a column altered only where it was also sequenced for the gene.
  const i = input();
  i.groups = [{ name: "A", pids: ["P1", "P2", "P3", "P6", "P7"] }];
  i.coverage = [...i.coverage, { pid: "P6", genes: ["TP53"] }];
  i.events = [...i.events,
    ev("P6", "KRAS", "cna", undefined, 2, true),                     // driver, off-panel
    ev("P7", "TP53", "structural_variant", undefined, undefined, true),
    ev("P7", "KRAS", "mutation", "Missense_Mutation", undefined, false)];  // VUS, off-panel
  const c = assembleContract(i);
  const byLabel = Object.fromEntries(c.tracks.map((t) => [t.label, t]));
  const col = (p: string) => c.columns.indexOf(p);
  assert.equal(byLabel.KRAS.cells[col("P6")], NOT_PROFILED, "an off-panel driver does not make the cell profiled");
  assert.equal(byLabel.TP53.cells[col("P6")], 0, "the covered gene stays profiled and unaltered");
  assert.equal(byLabel.TP53.cells[col("P7")], NOT_PROFILED, "nor does a call on a column with no panel at all");
  assert.equal(byLabel.KRAS.cells[col("P7")], NOT_PROFILED, "nor an off-panel VUS");
  assert.equal(byLabel.TP53.profiled, 4); assert.equal(byLabel.TP53.altered, 2, "P1 and P2; P7's SV is not counted");
  assert.equal(byLabel.KRAS.profiled, 3); assert.equal(byLabel.KRAS.altered, 1, "P2's amp; P6's is not counted");
  assert.equal(c.stats.offPanel, 3, "every call left out is counted, so the caption can say so");
  // hiding unknown significance does not turn an off-panel VUS into evidence of profiling either
  const h = assembleContract({ ...i, display: { ...i.display, hideVUS: true } as AssembleInput["display"] });
  assert.equal(h.tracks.find((t) => t.label === "KRAS")!.cells[h.columns.indexOf("P7")], NOT_PROFILED);
  assert.equal(h.stats.offPanel, 3);
  // a merged row is profiled where ANY member is, so P6's KRAS amp draws there (TP53 covers the
  // column), while KRAS's own row leaves it out — the call is still counted as left out of a row
  const m = assembleContract({ ...i, genes: [{ label: "either", genes: ["TP53", "KRAS"] }, "KRAS"] });
  assert.equal(m.tracks.find((t) => t.label === "either")!.cells[m.columns.indexOf("P6")], BITS.AMP | BITS.DRIVER | BITS.CNA_DRIVER);
  assert.equal(m.tracks.find((t) => t.label === "KRAS")!.cells[m.columns.indexOf("P6")], NOT_PROFILED);
  assert.equal(m.stats.offPanel, 3);
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
  // group B = P4 (profiled, not altered), P5 (altered) -> 1 of 2 -- and 2+1 = 3, 3+2 = 5,
  // matching the pooled numbers above exactly
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

test("clinical typing: every value its own category, numeric only past 10 distinct values, absent attribute labelled", () => {
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
  assert.equal(num.bar, true, "a numeric clinical row is drawn as bars, as in the portal");
  const fga = assembleContract({ ...input(), groups: [{ name: "A", pids }],
    clinical: [{ attr: "FRACTION_GENOME_ALTERED", values: new Map(pids.map((p, i) => [p, String(0.1 + i * 0.02)])) },
      { attr: "MUTATION_COUNT", values: new Map(pids.map((p, i) => [p, String(i * i)])) }] });
  const f = fga.tracks.find((t) => t.label === "FRACTION_GENOME_ALTERED")!;
  assert.deepEqual([f.min, f.max], [0, 1], "a fraction of the genome is drawn over 0..1");
  assert.equal(fga.tracks.find((t) => t.label === "MUTATION_COUNT")!.logScale, true, "mutation counts on a log scale");
  assert.equal(num.cells[wide.columns.indexOf("P12")], 255);
  assert.equal(num.cells[wide.columns.indexOf("P1")], 0);
  const st = wide.tracks.find((t) => t.label === "ST")!;
  assert.equal(st.categories!.length, 9, "nine values, nine categories: no Other, as in the portal");
  assert.ok(!st.categories!.includes("Other"));
});

test("groups keep their order and the staircase sorts within each group", () => {
  const c = assembleContract(input());
  assert.deepEqual(c.groups, [{ name: "A", start: 0, count: 3 }, { name: "B", start: 3, count: 2 }]);
  // A: P1 (missense driver) vs P2 (truncating VUS + KRAS amp driver): TP53 is the first gene, and
  // as in the portal every driver mutation ranks above every VUS one, whatever the class
  assert.deepEqual(c.columns.slice(0, 3), ["P1", "P2", "P3"]);
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
  assert.equal(t.cells[col("P2")], BITS.TRUNCATING | BITS.AMP | BITS.DRIVER | BITS.CNA_DRIVER, "both members' bits land in one cell");
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
  assert.equal(row.cells[col("P2")], BITS.AMP | BITS.DRIVER | BITS.CNA_DRIVER);
  assert.equal(row.cells[col("P1")], BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER, "a driver is kept");
  assert.equal(c.stats.hiddenVus, 1);
});

test("hiding unknown significance leaves a covered cell profiled", () => {
  const i = input();
  i.display = { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all", colorByType: true,
    hideVUS: true, annotate: "oncokb", whiteBackground: false };
  const c = assembleContract(i);
  const tp53 = c.tracks.find((t) => t.label === "TP53")!;
  const col = (p: string) => c.columns.indexOf(p);
  assert.equal(tp53.cells[col("P2")], 0, "the passenger truncation is gone, the column stays profiled");
  assert.equal(tp53.profiled, 5);
  assert.equal(tp53.altered, 2, "P1 and P5, both drivers");
});

test("germline: the stripe marks the mutation the cell shows when it is germline, and hiding germline drops it from the %", () => {
  const i = input();
  const g = (pid: string, gene: string, mt: string, driver: boolean, germ: boolean) => ({ ...ev(pid, gene, "mutation", mt, undefined, driver), germ });
  i.events = [
    g("P1", "TP53", "Missense_Mutation", true, true),        // germline driver: shown, striped
    g("P2", "TP53", "Missense_Mutation", false, true),       // germline VUS missense ...
    g("P2", "TP53", "Nonsense_Mutation", false, false),      // ... under a somatic VUS truncation, which the cell shows: no stripe
    g("P3", "TP53", "Missense_Mutation", false, true),       // germline VUS ...
    g("P3", "TP53", "Nonsense_Mutation", true, false),       // ... beside a somatic driver: the driver is drawn, no stripe
    g("P4", "TP53", "Splice_Site", false, true),             // germline VUS alone: striped
  ];
  const c = assembleContract(i);
  const tp53 = c.tracks.find((t) => t.label === "TP53")!;
  const col = (p: string) => c.columns.indexOf(p);
  assert.equal(tp53.cells[col("P1")], BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER | BITS.GERMLINE);
  assert.equal(tp53.cells[col("P2")], BITS.MISSENSE | BITS.TRUNCATING, "truncating outranks missense, and it is somatic");
  assert.equal(tp53.cells[col("P3")], BITS.TRUNCATING | BITS.DRIVER | BITS.MUT_DRIVER);
  assert.equal(tp53.cells[col("P4")], BITS.SPLICE | BITS.GERMLINE);
  assert.equal(c.stats.hiddenGermline, undefined);

  const h = assembleContract({ ...i, display: { ...(i.display || {}), hideGermline: true } as AssembleInput["display"] });
  const t = h.tracks.find((x) => x.label === "TP53")!;
  assert.equal(t.cells[h.columns.indexOf("P1")], 0, "the germline driver is gone; the column stays profiled");
  assert.equal(t.cells[h.columns.indexOf("P4")], 0);
  assert.equal(t.cells[h.columns.indexOf("P2")], BITS.TRUNCATING);
  assert.equal(t.altered, 2, "P2 and P3, the somatic calls");
  assert.equal(h.stats.hiddenGermline, 4, "every germline mutation, the ones under a somatic call too");
  // a structural variant or a copy-number call is never germline, whatever its row says
  const sv = assembleContract({ ...input(), events: [{ ...ev("P5", "TP53", "structural_variant", undefined, undefined, true), germ: true }],
    display: { hideGermline: true } as AssembleInput["display"] });
  assert.equal(sv.tracks.find((x) => x.label === "TP53")!.cells[sv.columns.indexOf("P5")], BITS.SV | BITS.DRIVER | BITS.SV_DRIVER);
});

test("the portal's staircase: CNA then mutation per row, every driver before every VUS, not profiled last (ONC-ST-1, ONC-ST-2)", () => {
  const pids = ["A", "B", "C", "D", "E", "F", "G"];
  const c = assembleContract({
    ...input(), genes: ["TP53", "KRAS"], groups: [{ name: "all", pids }], clinical: [], derived: [],
    events: [
      ev("A", "TP53", "mutation", "Nonsense_Mutation", undefined, false),    // VUS truncating
      ev("B", "TP53", "mutation", "Missense_Mutation", undefined, true),     // driver missense
      ev("C", "TP53", "cna", undefined, 2, false),                           // VUS amplification
      ev("D", "TP53", "cna", undefined, 2, false),                           // VUS amplification + driver missense
      ev("D", "TP53", "mutation", "Missense_Mutation", undefined, true),
      ev("E", "TP53", "cna", undefined, -2, true),                           // driver deep deletion
      ev("G", "KRAS", "mutation", "Missense_Mutation", undefined, true)      // TP53 not profiled, KRAS altered
    ],
    coverage: [...["A", "B", "C", "D", "E", "F"].map((pid) => ({ pid, genes: ["TP53", "KRAS"] })), { pid: "G", genes: ["KRAS"] }]
  });
  // a driver deep deletion before every VUS amplification; an amplification with a missense before
  // one without; a driver missense before a VUS truncation; the column not profiled for TP53 after
  // the unaltered one, though its KRAS row is altered
  assert.deepEqual(c.columns, ["E", "D", "C", "B", "A", "F", "G"]);
});

test("the id tie-break is the portal's natural order of the bare case id", () => {
  const pids = ["TCGA-AA-3864", "TCGA-AA-A00N", "P10", "P2"];
  const c = assembleContract({ ...input(), genes: ["TP53"], groups: [{ name: "all", pids }], clinical: [], derived: [], events: [],
    coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })) });
  assert.deepEqual(c.columns, ["P2", "P10", "TCGA-AA-A00N", "TCGA-AA-3864"]);
});

test("the Sort switches: Driver off ranks by class alone, Ignore VUS orders as if VUS were absent (ONC-SO-1, ONC-ST-3)", () => {
  const pids = ["A", "B", "C"];
  const build = (display: Record<string, unknown>) => assembleContract({
    ...input(), genes: ["TP53"], groups: [{ name: "all", pids }], clinical: [], derived: [],
    events: [ev("A", "TP53", "mutation", "Nonsense_Mutation", undefined, false), ev("B", "TP53", "mutation", "Missense_Mutation", undefined, true)],
    coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })), display: normalizeDisplay(display) });
  assert.deepEqual(build({}).columns, ["B", "A", "C"], "default: the driver missense before the VUS truncation");
  assert.deepEqual(build({ sortByDrivers: false }).columns, ["A", "B", "C"], "Driver off: truncating before missense");
  assert.deepEqual(build({ sortByMutationType: false, sortByDrivers: false }).columns, ["A", "B", "C"], "neither: mutated before not, then the id");
  const ignored = build({ sortIgnoreVUS: true });
  assert.deepEqual(ignored.columns, ["B", "A", "C"], "Ignore VUS: the VUS column ties the unaltered one, then the id");
  assert.equal(ignored.tracks.find((t) => t.label === "TP53")!.cells[1], BITS.TRUNCATING, "the VUS is still drawn");
  assert.deepEqual(normalizeDisplay({}).sortIgnoreVUS, undefined, "defaults are not echoed");
  assert.equal(normalizeDisplay({ sortIgnoreVUS: true }).sortIgnoreVUS, true);
  assert.throws(() => normalizeDisplay({ sortByDrivers: "no" as unknown as boolean }), /display.sortByDrivers must be true or false/);
});

test("heatmap rows: the portal's fixed ranges by profile, whatever the data's spread (ONC-TT-5, ONC-TT-6)", () => {
  const vals = (xs: number[]) => new Map(["P1", "P2", "P3"].map((p, i): [string, number] => [p + "|TP53", xs[i]]));
  const c = assembleContract({ ...input(), genes: ["TP53"], groups: [{ name: "all", pids: ["P1", "P2", "P3"] }], clinical: [], derived: [],
    heatmap: [{ profileType: "rna_seq_v2_mrna", genes: ["TP53"], values: vals([120, 4000, 950]) },
      { profileType: "methylation_hm450", genes: ["TP53"], values: vals([0.1, 0.5, 0.9]) }] } as never);
  const [rna, meth] = c.tracks.filter((t) => t.kind === "heatmap");
  assert.deepEqual([rna.ramp, rna.min, rna.max], ["expression", -3, 3], "raw expression on the portal's -3..3, as it draws it");
  assert.deepEqual([meth.ramp, meth.min, meth.max], ["methylation", 0, 1]);
});

test("a numeric clinical track carries its exact values, and sorts by them, not by the drawing code", () => {
  const pids = Array.from({ length: 12 }, (_, i) => "P" + (i + 1));
  // P1 and P2 differ by less than one of the 256 drawing steps of a 0..1000 range
  const vals = new Map(pids.map((p, i): [string, string] => [p, String(i === 0 ? 500.4 : i === 1 ? 500.3 : i * 80)]));
  const c = assembleContract({ ...input(), groups: [{ name: "all", pids }], clinical: [{ attr: "TMB", values: vals }],
    sort: [{ track: "TMB", dir: "asc" }] });
  const t = c.tracks.find((x) => x.label === "TMB")!;
  assert.equal(t.cells[c.columns.indexOf("P1")], t.cells[c.columns.indexOf("P2")], "one drawing code");
  assert.ok(c.columns.indexOf("P2") < c.columns.indexOf("P1"), "500.3 before 500.4");
  assert.equal(t.values![c.columns.indexOf("P1")], Math.fround(500.4));
});

test("a heatmap row carries its exact values, after the patient's collapse and the profile's transform", () => {
  const c = assembleContract({ ...input(), heatmap: [{ profileType: "mrna_zscore", genes: ["TP53"], isVaf: false,
    values: new Map([["P1|TP53", 1.234567], ["P2|TP53", -0.5], ["P4|TP53", 2]]) }] });
  const t = c.tracks.find((x) => x.kind === "heatmap")!;
  const at = (p: string) => t.values![c.columns.indexOf(p)];
  assert.equal(at("P1"), Math.fround(1.234567)); assert.equal(at("P2"), Math.fround(-0.5)); assert.equal(at("P4"), 2);
  assert.equal(at("P3"), null, "no value: null in the contract");
});

// O3: SortUtils getClinicalTrackSortComparator (mandatory = the value alone, preferred = the value
// then the natural id) and oncoprintmodel sortByTracks (every track's mandatory value before any
// track's preferred one): a tie on a key goes to the next key, and only a tie on every key goes to
// the id, ordered in the first key's direction (PrecomputedComparator multiplies the whole
// preferred comparison, id included, by the sort direction).
const tieInput = (sort: { track: string; dir: "asc" | "desc" }[], arm: Record<string, string>): AssembleInput => {
  const pids = Array.from({ length: 14 }, (_, i) => "Q" + String(i + 1).padStart(2, "0"));
  // Q01..Q11 are 10..110; Q12..Q14 equal Q05's 50, written three ways: more than 10 distinct values, so numeric
  const tmb = new Map(pids.map((p, i): [string, string] => [p, i < 11 ? String((i + 1) * 10) : ["50.0", "5e1", "50"][i - 11]]));
  return { genes: ["TP53"], groups: [{ name: "all", pids }], studies: ["s"], events: [], coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })),
    isDriver: () => false, annotationSource: "t", heatmap: [], derived: [], lineGap: 0, sort,
    clinical: [{ attr: "TMB", values: tmb }, { attr: "ARM", values: new Map(Object.entries(arm)) }] };
};

test("equal numeric values go to the next sort key, not to the id (SortUtils 333-345, 362-365)", () => {
  // ARM: a three times, b twice, c once, so its categories' order is a, b, c however it is derived
  const arm = { Q01: "a", Q02: "a", Q03: "b", Q05: "c", Q12: "a", Q13: "b" };   // Q14 has no ARM
  const asc = assembleContract(tieInput([{ track: "TMB", dir: "asc" }, { track: "ARM", dir: "asc" }], arm));
  assert.equal(asc.tracks.find((t) => t.label === "TMB")!.numeric, true, "the fixture's TMB is a numeric track");
  assert.deepEqual(asc.columns, ["Q01", "Q02", "Q03", "Q04", "Q12", "Q13", "Q05", "Q14", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11"],
    "50, 50.0 and 5e1 tie; ARM a, b, c, then no ARM");
  const armDesc = assembleContract(tieInput([{ track: "TMB", dir: "asc" }, { track: "ARM", dir: "desc" }], arm));
  assert.deepEqual(armDesc.columns.slice(4, 8), ["Q05", "Q13", "Q12", "Q14"], "the second key's own direction; no value still last");
});

test("a numeric sort compares exact values, finer than float32 (SortUtils 252-267)", { todo: "values travel as float32 (docs/PORTAL-PARITY.md, ONC-TT-12)" }, () => {
  // 1.00000001 and 1.00000002 are one float32, two doubles; the portal compares the doubles
  const pids = Array.from({ length: 12 }, (_, i) => "R" + String(i + 1).padStart(2, "0"));
  const vals = new Map(pids.map((p, i): [string, string] => [p, i === 0 ? "1.00000002" : i === 1 ? "1.00000001" : String(i * 10)]));
  assert.equal(Math.fround(1.00000002), Math.fround(1.00000001));
  for (const dir of ["asc", "desc"] as const) {
    const c = assembleContract({ genes: ["TP53"], groups: [{ name: "all", pids }], studies: ["s"], events: [], coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })),
      isDriver: () => false, annotationSource: "t", heatmap: [], derived: [], lineGap: 0, sort: [{ track: "V", dir }], clinical: [{ attr: "V", values: vals }] });
    const pick = c.columns.filter((p) => p === "R01" || p === "R02");
    assert.deepEqual(pick, dir === "asc" ? ["R02", "R01"] : ["R01", "R02"], dir);
  }
});

test("MUTATION_COUNT with no value stays no value (the portal shows 0, DataUtils 655-658: docs/PORTAL-PARITY.md ONC-TT-12)", () => {
  const pids = Array.from({ length: 12 }, (_, i) => "M" + String(i + 1).padStart(2, "0"));
  // M12 has no MUTATION_COUNT: it may never have been sequenced, so it is not shown as 0 mutations
  const counts = new Map(pids.slice(0, 11).map((p, i): [string, string] => [p, String(i + 1)]));
  const c = assembleContract({ genes: ["TP53"], groups: [{ name: "all", pids }], studies: ["s"], events: [], coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })),
    isDriver: () => false, annotationSource: "t", heatmap: [], derived: [], lineGap: 0, sort: [{ track: "MUTATION_COUNT", dir: "asc" }],
    clinical: [{ attr: "MUTATION_COUNT", values: counts }, { attr: "OTHER", values: new Map(counts) }] });
  const mc = c.tracks.find((t) => t.label === "MUTATION_COUNT")!, other = c.tracks.find((t) => t.label === "OTHER")!;
  assert.equal(mc.values![c.columns.indexOf("M12")], null, "MUTATION_COUNT: no value");
  assert.equal(c.columns[c.columns.length - 1], "M12", "and it sorts last, as no value does");
  assert.equal(other.values![c.columns.indexOf("M12")], null, "another attribute: no value");
});

test("a numeric clinical value is a number only when its whole text is one (the portal's parseFloat reads 12abc as 12: docs/PORTAL-PARITY.md ONC-TT-12)", () => {
  // a sample column's value, or a patient row's, reaches the track as the stored text
  const pids = Array.from({ length: 40 }, (_, i) => "N" + String(i + 1).padStart(2, "0"));   // enough that 90 % parse either way
  const raw = ["12abc", "0x10", "1e3", ">90", ".5", "1,5"];
  const vals = new Map(pids.map((p, i): [string, string] => [p, i < raw.length ? raw[i] : String(i * 3)]));
  const c = assembleContract({ genes: ["TP53"], groups: [{ name: "all", pids }], studies: ["s"], events: [], coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })),
    isDriver: () => false, annotationSource: "t", heatmap: [], derived: [], lineGap: 0, sort: [], clinical: [{ attr: "V", values: vals }] });
  const t = c.tracks.find((x) => x.label === "V")!;
  assert.equal(t.numeric, true);
  const at = (i: number) => t.values![c.columns.indexOf(pids[i])];
  assert.deepEqual(raw.map((_, i) => at(i)), [null, null, 1000, null, 0.5, null], "12abc, 0x10, 1e3, >90, .5, 1,5");
});

test("the mutation spectrum row: six counts per column, sorted by its largest share, carried with its column (ONC-TT-3, ONC-STM-6)", () => {
  const pids = ["A", "B", "C", "D"];
  const spec = new Map([["A", "1,0,9,0,0,0"], ["B", "8,0,2,0,0,0"], ["C", "0,0,0,0,0,0"], ["D", "0,0,6,0,0,0"]]);
  const c = assembleContract({ ...input(), genes: ["TP53"], groups: [{ name: "all", pids }], derived: [], events: [],
    coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })), clinical: [{ attr: "MUTATION_SPECTRUM", values: spec }],
    sort: [{ track: "MUTATION_SPECTRUM", dir: "asc" }] });
  const t = c.tracks.find((x) => x.label === "MUTATION_SPECTRUM")!;
  assert.deepEqual(t.stack, ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"]);
  // B's largest is C>A (the first category); A (90 % C>T) before D (100 % C>T); C, all zero, has no data and goes last
  assert.deepEqual(c.columns, ["B", "A", "D", "C"]);
  assert.deepEqual(Array.from(t.cells), [0, 1, 2, -1], "a cell names its own column");
  assert.deepEqual(Array.from(t.values!).slice(0, 12), [8, 0, 2, 0, 0, 0, 1, 0, 9, 0, 0, 0], "each column's counts moved with it");
});
