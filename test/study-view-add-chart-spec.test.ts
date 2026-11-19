// Written from docs/legacy-spec/parity/add-chart-cases.md (one test per row these pure functions
// cover, named by its id) without reference to the implementation.
// Covered elsewhere, not here (UI): AC3 (the Freq column header and its tooltip).
import { test } from "node:test";
import assert from "node:assert/strict";
import { portalFreq } from "../lib/chart/format.ts";
import { chartFreq, addChartLines, bulkButtons, withoutAttribute, assayTabLabel, assayTabs, geneChartProfiles, geneChartsChanged, SPECIAL_CHART_KEYS, specialChartsShown, genomicChartLines, type AddChartRow } from "../lib/study-view-add-chart.ts";
import type { Clause, Leaf } from "../lib/types.ts";

const row = (key: string, name: string, samples: number, checked = false): AddChartRow => ({ key, name, samples, checked });

// ---- AC1 ----

test("AC1 Freq: samples with data × 100 ÷ selected samples", () => {
  assert.equal(chartFreq(1084, 1084), 100);
  assert.equal(chartFreq(1050, 1084), 1050 * 100 / 1084);
  assert.equal(chartFreq(0, 10), 0);
});

test("AC1 Freq: a patient attribute counted per sample may exceed the patients, not capped", () => {
  assert.equal(chartFreq(6, 4), 150);
});

test("AC1 Freq: no selected sample → NaN", () => {
  assert.ok(Number.isNaN(chartFreq(5, 0)));
});

// ---- AC2 ----

test("AC2 Freq text: portalFreq over chartFreq", () => {
  assert.equal(portalFreq(chartFreq(1083, 1084)), "99.9%");
  assert.equal(portalFreq(chartFreq(1, 2000)), "<0.1%");
  assert.equal(portalFreq(chartFreq(0, 5)), "0%");
  assert.equal(portalFreq(chartFreq(3, 0)), "NA");
});

// ---- AC4 ----

test("AC4 Order: each line carries freq = chartFreq(samples, selected)", () => {
  const lines = addChartLines([row("a", "A", 10), row("b", "B", 40), row("c", "C", 0)], 80);
  const byKey = Object.fromEntries(lines.map(l => [l.key, l]));
  assert.equal(lines.length, 3);
  assert.equal(byKey.a.freq, chartFreq(10, 80));
  assert.equal(byKey.b.freq, chartFreq(40, 80));
  assert.equal(byKey.c.freq, chartFreq(0, 80));
});

test("AC4 Order: Freq highest first, ties by name (localeCompare)", () => {
  const lines = addChartLines([
    row("os", "Overall Survival", 50),
    row("sex", "Sex", 100),
    row("tmb", "TMB", 75),
    row("age", "Age", 100),
    row("st", "Stage", 50),
  ], 100);
  assert.deepEqual(lines.map(l => l.key), ["age", "sex", "tmb", "os", "st"]);
});

test("AC4 Order: input not mutated; every other field kept", () => {
  const rows = [row("b", "B", 1, true), row("a", "A", 3, false)];
  const before = structuredClone(rows);
  const lines = addChartLines(rows, 4);
  assert.deepEqual(rows, before);
  assert.deepEqual(lines.map(({ key, name, samples, checked }) => ({ key, name, samples, checked })),
    [{ key: "a", name: "A", samples: 3, checked: false }, { key: "b", name: "B", samples: 1, checked: true }]);
});

// ---- AC5 ----

test("AC5 Disabled: an unchecked row with Freq 0 is disabled; others are not", () => {
  const lines = addChartLines([row("z", "Zero", 0), row("h", "Half", 5), row("f", "Full", 10)], 10);
  const byKey = Object.fromEntries(lines.map(l => [l.key, l]));
  assert.equal(byKey.z.freq, 0);
  assert.equal(byKey.z.disabled, true);
  assert.equal(byKey.h.disabled, false);
  assert.equal(byKey.f.disabled, false);
  assert.equal(lines[lines.length - 1].key, "z");
});

test("AC5 Disabled: with no selected sample every Freq is NaN, none disabled, ordered by name", () => {
  const lines = addChartLines([row("s", "Sex", 0), row("a", "Age", 3), row("m", "Mutation Count", 7)], 0);
  for (const l of lines) {
    assert.ok(Number.isNaN(l.freq), `${l.key} freq`);
    assert.equal(l.disabled, false, `${l.key} disabled`);
  }
  assert.deepEqual(lines.map(l => l.key), ["a", "m", "s"]);
});

// ---- AC6 / AC7 ----

const five = () => addChartLines([
  row("a", "A", 9),
  row("b", "B", 0),
  row("c", "C", 7),
  row("d", "D", 5),
  row("e", "E", 3),
], 10);

test("AC6 Select all: nothing checked → N is the shown rows (disabled too), keys the enabled shown rows in shown order", () => {
  const all = five();
  const shown = all.filter(l => ["a", "b", "c"].includes(l.key));
  const r = bulkButtons(shown, all);
  assert.deepEqual(r.selectAll, { n: 3, keys: ["a", "c"] });
});

test("AC7 Deselect all: hidden when nothing is checked", () => {
  const all = five();
  const shown = all.filter(l => ["a", "b", "c"].includes(l.key));
  assert.equal(bulkButtons(shown, all).deselectAll, null);
});

test("AC7 Deselect all: with something checked, unchecks every shown row (checked or not) in shown order", () => {
  const all = five().map(l => ({ ...l, checked: l.key === "c" || l.key === "e" }));
  const shown = all.filter(l => ["d", "c", "a", "b"].includes(l.key));
  assert.deepEqual(bulkButtons(shown, all).deselectAll, shown.map(l => l.key));
});

test("AC6 Select all: hidden when every row of the whole list is checked", () => {
  const all = addChartLines([row("a", "A", 9, true), row("c", "C", 7, true), row("d", "D", 5, true)], 10);
  assert.equal(bulkButtons(all.slice(0, 2), all).selectAll, null);
  assert.equal(bulkButtons(all, all).selectAll, null);
});

test("AC6 Select all: every enabled row checked but a disabled row exists → still shown", () => {
  const all = five().map(l => ({ ...l, checked: !l.disabled }));
  const r = bulkButtons(all, all);
  assert.notEqual(r.selectAll, null);
  assert.equal(r.selectAll?.n, 5);
  assert.deepEqual(r.selectAll?.keys, all.filter(l => !l.disabled).map(l => l.key));
});

test("AC6/AC7: search keeps nothing, nothing checked → Select all (0), no Deselect all", () => {
  const all = five();
  assert.deepEqual(bulkButtons([], all), { selectAll: { n: 0, keys: [] }, deselectAll: null });
});

// ---- AC8 ----

const sexF: Leaf = { kind: "clinical", attribute: "SEX", values: ["Female"] };
const sexM: Leaf = { kind: "clinical", attribute: "SEX", values: ["Male"] };
const ageRange: Leaf = { kind: "clinical", attribute: "AGE", range: { gte: 40, lt: 50 } };
const stage: Leaf = { kind: "clinical", attribute: "STAGE", values: ["II"] };
const tp53: Leaf = { kind: "oql", q: "TP53: MUT" };
const kras: Leaf = { kind: "alteration", gene: "KRAS" };

test("AC8 Unchecking clears the filter: removes a top-level clinical clause on the attribute", () => {
  assert.deepEqual(withoutAttribute([sexF, ageRange], "SEX"), [ageRange]);
  assert.deepEqual(withoutAttribute([sexF, ageRange], "AGE"), [sexF]);
});

test("AC8 Unchecking clears the filter: removes a negated clinical clause on the attribute", () => {
  assert.deepEqual(withoutAttribute([{ not: { kind: "clinical", attribute: "SEX", values: ["NA"] } }, stage], "SEX"), [stage]);
});

test("AC8 Unchecking clears the filter: removes an any of clinical clauses all on the attribute", () => {
  assert.deepEqual(withoutAttribute([{ any: [sexF, sexM] }, stage], "SEX"), [stage]);
});

test("AC8 Unchecking clears the filter: keeps an any mixing the attribute with another", () => {
  const mixed: Clause = { any: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }, { kind: "clinical", attribute: "AGE", range: { gte: 40 } }] };
  assert.deepEqual(withoutAttribute([mixed], "SEX"), [mixed]);
});

test("AC8 Unchecking clears the filter: keeps other attributes and non-clinical clauses, in order, input not mutated", () => {
  const all: Clause[] = [tp53, sexF, stage, { not: kras }, ageRange, sexM];
  const before = structuredClone(all);
  assert.deepEqual(withoutAttribute(all, "SEX"), [tp53, stage, { not: kras }, ageRange]);
  assert.deepEqual(all, before);
  assert.deepEqual(withoutAttribute(all, "OS_STATUS"), before);
});

test("AC8 Unchecking clears the filter: empty input → []", () => {
  assert.deepEqual(withoutAttribute([], "SEX"), []);
});

// ---- AC5 (rewritten) / AC10 ----

const urow = (key: string, name: string, samples: number | undefined, checked = false): AddChartRow => ({ key, name, samples, checked });

test("AC5 a checked row with Freq 0 stays enabled, so it can be unchecked", () => {
  const lines = addChartLines([urow("z", "Zero", 0, true), urow("y", "Zero2", 0, false), urow("h", "Half", 5)], 10);
  const byKey = Object.fromEntries(lines.map(l => [l.key, l]));
  assert.equal(byKey.z.freq, 0);
  assert.equal(byKey.z.disabled, false);
  assert.equal(byKey.y.disabled, true);
});

test("AC10 uncounted: samples undefined → Freq NaN, not 0", () => {
  assert.ok(Number.isNaN(chartFreq(undefined, 10)));
});

test("AC10 uncounted: not disabled, sorted after every counted row (0% included)", () => {
  const lines = addChartLines([
    urow("u1", "Aaa", undefined), urow("z", "Zero", 0), urow("h", "Half", 5), urow("u2", "Bbb", undefined, true),
  ], 10);
  const byKey = Object.fromEntries(lines.map(l => [l.key, l]));
  for (const k of ["u1", "u2"]) {
    assert.ok(Number.isNaN(byKey[k].freq), k);
    assert.equal(byKey[k].disabled, false, k);
  }
  assert.deepEqual(lines.slice(0, 2).map(l => l.key).sort(), ["h", "z"]);
  assert.deepEqual(lines.slice(2).map(l => l.key).sort(), ["u1", "u2"]);
});

// STS-OT-2, STS-OT-7: Case Lists and Timeline Events Availability are offered in Add chart, not shown by default
test("the special tables: drawn when checked, or while the draft filters on what they list", () => {
  const none = () => false, all = () => true;
  const ev = { kind: "event", a: { eventType: "Treatment" }, rel: { type: "NONE" } };
  const seq = { kind: "event", a: { eventType: "Treatment" }, b: { eventType: "Surgery" }, rel: { type: "BEFORE", maxDays: 30 } };
  const cl = { kind: "caseList", id: "coadread_all" };
  const cases: [string, (k: string) => boolean, unknown[], boolean, { events: boolean; caseLists: boolean }][] = [
    ["by default neither", none, [], true, { events: false, caseLists: false }],
    ["both checked", all, [], true, { events: true, caseLists: true }],
    ["timeline events checked, but the selection has none", (k) => k === SPECIAL_CHART_KEYS.events, [], false, { events: false, caseLists: false }],
    ["a case-list filter shows Case Lists, as the portal's initial filters do", none, [cl], true, { events: false, caseLists: true }],
    ["an event-type filter keeps its table in view", none, [ev], true, { events: true, caseLists: false }],
    ["a sequence of two events is not this table's filter", none, [seq], true, { events: false, caseLists: false }],
  ];
  for (const [name, checked, leaves, hasEvents, want] of cases) assert.deepEqual(specialChartsShown(checked, leaves, hasEvents), want, name);
});

// STV-AC-5: the gene tab, one chart per gene and profile
test("the gene tab's profiles: mutations and discrete copy number, each with its profiled samples", () => {
  const dt = [{ profile: "mutations", label: "Mutations", alterationType: "MUTATION_EXTENDED", n: 534 },
    { profile: "rna_seq_v2_mrna", label: "mRNA expression", alterationType: "MRNA_EXPRESSION", n: 592 },
    // a continuous copy-number profile listed first: the chart reads the discrete one's levels
    { profile: "linear_cna", label: "Capped relative linear copy-number values", alterationType: "COPY_NUMBER_ALTERATION", n: 592 },
    { profile: "gistic", label: "Putative copy-number alterations from GISTIC", alterationType: "COPY_NUMBER_ALTERATION", n: 592 }];
  assert.deepEqual(geneChartProfiles(dt), [{ kind: "mutation", label: "Mutations (534 samples)" }, { kind: "cna", label: "Putative copy-number alterations from GISTIC (592 samples)" }]);
  assert.deepEqual(geneChartProfiles(dt.slice(1, 3)), [], "no mutation or discrete copy-number profile, nothing to chart a gene from");
});

test("a gene chart added and removed: each kind on its own, the gene counted while either status chart is shown", () => {
  const empty = { genes: [], kinds: {}, types: [] };
  const mut = geneChartsChanged(empty, "KRAS", "MUTATION", true);
  assert.deepEqual(mut, { genes: ["KRAS"], kinds: { KRAS: ["MUTATION"] }, types: [] });
  const both = geneChartsChanged(mut, "KRAS", "CNA", true);
  assert.deepEqual(both.kinds, { KRAS: ["MUTATION", "CNA"] });
  assert.deepEqual(geneChartsChanged(both, "KRAS", "MUTATION", false), { genes: ["KRAS"], kinds: { KRAS: ["CNA"] }, types: [] });
  assert.deepEqual(geneChartsChanged(geneChartsChanged(both, "KRAS", "MUTATION", false), "KRAS", "CNA", false), empty);
  assert.deepEqual(geneChartsChanged(mut, "KRAS", "types", true), { genes: ["KRAS"], kinds: { KRAS: ["MUTATION"] }, types: ["KRAS"] }, "mutation types apart");
  const seven = ["A", "B", "C", "D", "E", "F", "G"].reduce((s, g) => geneChartsChanged(s, g, "CNA", true), empty as Parameters<typeof geneChartsChanged>[0]);
  assert.deepEqual(seven.genes, ["B", "C", "D", "E", "F", "G"], "at most six genes, the earliest dropped");
  assert.equal(seven.kinds.A, undefined);
});

// STV-AC-2, STV-AC-4: the Genomic tab's charts, as the portal lists them (coadread, seen)
test("the Genomic tab: each chart the selection has data for, its Freq the samples with that data, by Freq then name", () => {
  const clinical = [{ key: "sample|FRACTION_GENOME_ALTERED", name: "Fraction Genome Altered", samples: 583, attribute: "FRACTION_GENOME_ALTERED" },
    { key: "sample|MUTATION_COUNT", name: "Mutation Count", samples: 534, attribute: "MUTATION_COUNT" }];
  const lines = genomicChartLines({ mutated: 534, cna: 592, sv: 534 }, 594, { datatypes: true, density: true }, clinical);
  // the portal's seen list: Data Types 100.0%, CNA Genes 99.7%, FGA 98.1%, Mutated Genes 89.9%, Mutation Count 89.9%, SV Genes 89.9%
  assert.deepEqual(lines.map((l) => [l.name, Number.isNaN(l.freq) ? "—" : portalFreq(l.freq)]), [
    ["Data Types", "100.0%"], ["CNA Genes", "99.7%"], ["Fraction Genome Altered", "98.1%"], ["Mutated Genes", "89.9%"], ["Mutation Count", "89.9%"],
    ["Structural Variant Genes", "89.9%"], ["Mutation Count vs Fraction Genome Altered", "—"],
  ]);
  assert.equal(lines.find((l) => l.name === "Mutation Count")!.attribute, "MUTATION_COUNT", "a clinical row's filter is its attribute's");
  // a table without its profile, and charts without data, are not offered
  assert.deepEqual(genomicChartLines({ mutated: 10, cna: 0, sv: 0 }, 10, { datatypes: true, density: false }).map((l) => l.name), ["Data Types", "Mutated Genes"]);
  assert.deepEqual(genomicChartLines({ mutated: 0, cna: 0, sv: 0 }, 0, { datatypes: false, density: false }), []);
});

// STV-AC-2: a tab per generic-assay type, named as the portal names it
test("a generic-assay type's tab: the portal's configured text, else its words capitalised; one per type, by label", () => {
  const cases: [string, string][] = [["ARMLEVEL_CNA", "Arm-level CNA"], ["METHYLATION", "Methylation"], ["MUTATIONAL_SIGNATURE", "Mutational Signature"],
    ["TREATMENT_RESPONSE", "Treatment Response"], ["GENETIC_ANCESTRY", "Genetic Ancestry"], ["PHOSPHOSITE_QUANTIFICATION", "Phosphosite Quantification"], ["Lipidome", "Lipidome"]];
  for (const [t, want] of cases) assert.equal(assayTabLabel(t), want, t);
  // coadread, seen: Arm-level CNA · Genetic Ancestry · Methylation (two methylation profiles, one tab)
  const coadread = [{ type: "GENERIC_ASSAY", assayType: "METHYLATION" }, { type: "GENERIC_ASSAY", assayType: "ARMLEVEL_CNA" },
    { type: "GENERIC_ASSAY", assayType: "METHYLATION" }, { type: "GENERIC_ASSAY", assayType: "GENETIC_ANCESTRY" }, { type: "MRNA_EXPRESSION" }];
  assert.deepEqual(assayTabs(coadread).map((t) => t.label), ["Arm-level CNA", "Genetic Ancestry", "Methylation"]);
});
