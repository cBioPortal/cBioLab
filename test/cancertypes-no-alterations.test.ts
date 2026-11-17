// Cancer Types Summary for a gene with no alterations, as the legacy portal's
// (docs/legacy-spec/02-cancer-types-summary.md CTS-GT-4, CTS-MD-9, CTS-MD-10).
//
// Case table:
//   N1  cancertypesUnaltered: a gene whose perGene entry has altered 0 in the only panel is grey (true)
//   N2  cancertypesUnaltered: a gene whose perGene entry has altered > 0 is not grey (false)
//   N3  cancertypesUnaltered: a gene 0 in one panel and 2 in another is not grey (false)
//   N4  cancertypesUnaltered: a gene 0 in every one of two panels is grey (true)
//   N5  cancertypesUnaltered(null): All tab, every panel's altered 0 is grey (true)
//   N6  cancertypesUnaltered(null): All tab, a panel with altered > 0 is not grey (false)
//   N7  cancertypesUnaltered: a one-gene result (no perGene) reads the panel's altered (0 -> true, >0 -> false)
//   N8  cancertypesUnaltered: a gene with no perGene entry in a multi-gene panel is false
//   N9  figure: a gene unaltered in every panel: its tab says "There are no alterations in this gene.", no bars, no legend
//   N10 figure: the altered gene's tab draws bars and no "no alterations" text
//   N11 figure: All tab with panel altered 0 shows the no-alterations text, no bars
//   N12 figure: a source with no groups to draw shows "No category passes the filters." instead (check comes first)
//   N13 figure header (title: true): a gene tab uses its perGene entry's altered / profiled; All uses the panel's
//   N14 figure: a gene 0 in this panel but altered in another draws its (0%) bars, no no-alterations message
//   N15 cancertypesUnprofiled: true when profiled 0 in every panel (gene or null), false when any panel has some
//   N16 geneSource: the gene's perGene entry; the panel itself for null or a gene with no entry
import { test } from "node:test";
import assert from "node:assert/strict";
import { cancertypesPanelSvg, cancertypesUnaltered, cancertypesUnprofiled, geneSource } from "../lib/views/cancertypes/figure.ts";
import type { CancertypesGroup, CancertypesPanel, CancertypesResult } from "../lib/views/cancertypes/types.ts";

const grp = (key: string, label: string, profiled: number, mutation: number, amp = 0, samples = profiled): CancertypesGroup =>
  ({ key, label, samples, profiled, altered: mutation + amp, mutation, amp, homdel: 0, sv: 0, multiple: 0 });

const NO_ALT = "There are no alterations in this gene.";
const NO_CAT = "No category passes the filters.";
const barTitle = /<title>[^<]*\(\d+ \/ \d+ /;
const legendMutation = />Mutation</;

const panel = (cohort: string, kras: number, nras: number): CancertypesPanel => ({
  cohort, samples: 200, profiled: 200, altered: kras + nras,
  groups: [grp("a", "A", 100, kras), grp("b", "B", 100, nras)], categories: 2, minSamples: 10,
  perGene: [
    { gene: "KRAS", altered: kras, profiled: 100, groups: [grp("a", "A", 100, kras), grp("b", "B", 100, 0)], categories: 2, minSamples: 10 },
    { gene: "NRAS", altered: nras, profiled: 100, groups: [grp("a", "A", 100, 0), grp("b", "B", 100, nras)], categories: 2, minSamples: 10 },
  ],
});

const result = (panels: CancertypesPanel[], genes = ["KRAS", "NRAS"]): CancertypesResult => ({
  groupBy: "CANCER_TYPE", measure: "any", genes, minSamples: null, minAltered: 0, show: "frequency", unit: "sample", panels,
});

const two = result([panel("all", 30, 0)]);
const split = result([panel("s1", 5, 0), panel("s2", 5, 2)]);
const bothZero = result([panel("s1", 5, 0), panel("s2", 7, 0)]);
const allZero = result([panel("s1", 0, 0), panel("s2", 0, 0)]);
const onePanel = (altered: number): CancertypesResult => result([{ cohort: "all", samples: 100, profiled: 100, altered,
  groups: [grp("a", "A", 100, altered)], categories: 1, minSamples: 10 }], ["KRAS"]);

test("N1 a gene with 0 altered in its perGene entry is grey", () => {
  assert.equal(cancertypesUnaltered(two, "NRAS"), true);
});
test("N2 a gene with alterations is not grey", () => {
  assert.equal(cancertypesUnaltered(two, "KRAS"), false);
});
test("N3 a gene 0 in one panel and 2 in another is not grey", () => {
  assert.equal(cancertypesUnaltered(split, "NRAS"), false);
});
test("N4 a gene 0 in every panel is grey", () => {
  assert.equal(cancertypesUnaltered(bothZero, "NRAS"), true);
});
test("N5 All Queried Genes with every panel's altered 0 is grey", () => {
  assert.equal(cancertypesUnaltered(allZero, null), true);
});
test("N6 All Queried Genes with some panel altered is not grey", () => {
  assert.equal(cancertypesUnaltered(two, null), false);
  assert.equal(cancertypesUnaltered(bothZero, null), false);
});
test("N7 a one-gene result (no perGene) reads the panel's altered", () => {
  assert.equal(cancertypesUnaltered(onePanel(0), "KRAS"), true);
  assert.equal(cancertypesUnaltered(onePanel(4), "KRAS"), false);
});
test("N8 a gene with no perGene entry in a multi-gene panel is not grey", () => {
  assert.equal(cancertypesUnaltered(two, "BRAF"), false);
});
test("N9 the unaltered gene's figure says so and draws no bars or legend", () => {
  const { body } = cancertypesPanelSvg(two, 0, { gene: "NRAS" });
  assert.ok(body.includes(NO_ALT));
  assert.ok(!barTitle.test(body), "no bars");
  assert.ok(!legendMutation.test(body), "no legend");
  assert.ok(!body.includes(NO_CAT));
});
test("N10 an altered gene's figure draws as before", () => {
  const { body } = cancertypesPanelSvg(two, 0, { gene: "KRAS" });
  assert.ok(!body.includes(NO_ALT));
  assert.ok(barTitle.test(body), "bars drawn");
});
test("N11 the All tab with panel altered 0 shows the no-alterations text", () => {
  const { body } = cancertypesPanelSvg(allZero, 0);
  assert.ok(body.includes(NO_ALT));
  assert.ok(!barTitle.test(body), "no bars");
  assert.ok(!legendMutation.test(body), "no legend");
});
test("N12 no groups to draw shows the filter text, not the no-alterations text", () => {
  const p = panel("all", 30, 0);
  const empty = result([{ ...p, perGene: [p.perGene![0], { ...p.perGene![1], groups: [] }] }]);
  const g = cancertypesPanelSvg(empty, 0, { gene: "NRAS" }).body;
  assert.ok(g.includes(NO_CAT) && !g.includes(NO_ALT));
  const all = cancertypesPanelSvg(result([{ ...panel("all", 0, 0), groups: [] }]), 0).body;
  assert.ok(all.includes(NO_CAT) && !all.includes(NO_ALT));
});
test("N13 a gene tab's header counts its entry's altered / profiled; All counts the panel's", () => {
  assert.ok(cancertypesPanelSvg(two, 0, { gene: "NRAS", title: true }).body.includes("NRAS · 0 of 100 profiled samples altered (0%)"));
  const all = cancertypesPanelSvg(two, 0, { gene: null, title: true }).body;
  assert.ok(all.includes("30 of 200 profiled samples altered"), "All: the panel's numbers");
  assert.ok(!all.includes("· 0 of 100 profiled"));
});
test("N14 a gene 0 in this panel but altered in another draws its bars, no message", () => {
  const { body } = cancertypesPanelSvg(split, 0, { gene: "NRAS" });
  assert.ok(!body.includes(NO_ALT));
  assert.ok(barTitle.test(body), "0% bars drawn");
  assert.ok(!body.includes(NO_CAT));
});
test("N15 cancertypesUnprofiled: profiled 0 in every panel, not in any", () => {
  const unprof = (pn: CancertypesPanel): CancertypesPanel => ({ ...pn, profiled: 0,
    perGene: pn.perGene!.map((e) => e.gene === "NRAS" ? { ...e, profiled: 0 } : e) });
  const none = result([unprof(panel("s1", 5, 0)), unprof(panel("s2", 5, 0))]);
  assert.equal(cancertypesUnprofiled(none, "NRAS"), true);
  assert.equal(cancertypesUnprofiled(none, "KRAS"), false);
  const some = result([unprof(panel("s1", 5, 0)), panel("s2", 5, 0)]);
  assert.equal(cancertypesUnprofiled(some, "NRAS"), false);
  assert.equal(cancertypesUnprofiled(result([{ ...panel("s1", 0, 0), profiled: 0 }, { ...panel("s2", 0, 0), profiled: 0 }]), null), true);
  assert.equal(cancertypesUnprofiled(some, null), false);
});
test("N16 geneSource: the gene's entry, else the panel", () => {
  const pn = two.panels[0];
  assert.equal(geneSource(pn, "NRAS"), pn.perGene![1]);
  assert.equal(geneSource(pn, null), pn);
  assert.equal(geneSource(pn, "BRAF"), pn);
});
