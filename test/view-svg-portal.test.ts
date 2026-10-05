// Renderers for the view kinds in lib/views-portal.ts: pure functions of a ViewResult, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg, viewTitle } from "../lib/view-svg.ts";
import { cancertypesPanelSvg } from "../lib/view-svg-portal.ts";
import type { ViewResult, CancertypesGroup } from "../lib/types.ts";

const grp = (key: string, label: string, profiled: number, mutation: number, amp = 0, samples = profiled): CancertypesGroup =>
  ({ key, label, samples, profiled, altered: mutation + amp, mutation, amp, homdel: 0, sv: 0, multiple: 0 });

describe("cancertypes", () => {
  const v: ViewResult = { kind: "cancertypes", cohorts: ["all"], caveat: "samples, not patients",
    cancertypes: { groupBy: "CANCER_TYPE", measure: "any", genes: ["KRAS"], minSamples: 10, show: "frequency", unit: "sample",
      panels: [{ cohort: "all", samples: 300, profiled: 290, altered: 120,
        groups: [grp("pancreatic", "Pancreatic <Cancer>", 100, 80, 2), grp("lung", "Lung", 150, 30, 0, 160)],
        pooled: { ...grp("__pooled__", "3 smaller groups", 40, 8), count: 3 } }] } };
  test("each group shows its altered share over its profiled samples, and its unprofiled total when larger", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("82.0% (82 / 100 samples)"));
    assert.ok(svg.includes("30 / 150 samples, 160 in the group"), "a group with unprofiled samples says so");
    assert.ok(svg.includes("Alteration Frequency"));
  });
  test("a '+' per data type a group was profiled for, and one gene's bars on request", () => {
    const g = (k: string, label: string, n: number, m: number, sv: number) => ({ ...grp(k, label, n, m), profiledFor: { mutation: n, cna: 0, sv } });
    const two: ViewResult = { ...v, cancertypes: { ...v.cancertypes!, genes: ["KRAS", "NRAS"], panels: [{ ...v.cancertypes!.panels[0],
      groups: [g("a", "A", 100, 50, 100), g("b", "B", 100, 10, 0)], pooled: undefined,
      perGene: [{ gene: "KRAS", groups: [g("a", "A", 100, 40, 100)] }, { gene: "NRAS", groups: [g("b", "B", 100, 7, 0)] }] }] } };
    const all = cancertypesPanelSvg(two.cancertypes!, 0);
    assert.ok(all.body.includes("Mutation data") && all.body.includes("Structural variant data") && !all.body.includes("CNA data"));
    assert.equal((all.body.match(/>\+</g) || []).length, 3, "two groups profiled for mutations, one for SVs");
    const nras = cancertypesPanelSvg(two.cancertypes!, 0, { gene: "NRAS" });
    assert.ok(nras.body.includes("B: 7.0% (7 / 100 samples)") && !nras.body.includes("A: "));
  });
  test("pooled small groups are drawn and named, not dropped", () => {
    assert.ok(viewToSvg(v)!.includes("3 smaller groups"));
  });
  test("labels are escaped, the caveat travels, and the title names the genes", () => {
    const svg = viewToSvg(v)!;
    assert.ok(!svg.includes("<Cancer>") && svg.includes("&lt;Cancer&gt;"));
    assert.ok(svg.includes("samples, not patients"));
    assert.match(viewTitle(v), /Cancer types summary — KRAS by CANCER_TYPE/);
  });
  test("mutations and amplifications take the oncoprint's colours", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("#008000") && svg.includes("#e41a1c"));
  });
  test("nothing profiled, no figure", () => {
    assert.equal(viewToSvg({ ...v, cancertypes: { ...v.cancertypes!, panels: [{ ...v.cancertypes!.panels[0], profiled: 0 }] } }), null);
  });
});

describe("overlap", () => {
  const v: ViewResult = { kind: "overlap", cohorts: ["A", "<B>", "C"], caveat: "within a study",
    overlap: { union: 100, sets: [{ name: "A", size: 60 }, { name: "<B>", size: 50 }, { name: "C", size: 10 }],
      intersections: [{ members: ["A"], n: 40 }, { members: ["<B>"], n: 30 }, { members: ["A", "<B>"], n: 20 }, { members: ["C"], n: 10 }] } };
  test("draws every non-empty combination and names how many of the possible there are", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes(">40<") && svg.includes(">20<") && svg.includes(">10<"));
    assert.ok(svg.includes("4 non-empty combinations of 7"));
  });
  test("names are escaped and the title lists the cohorts", () => {
    const svg = viewToSvg(v)!;
    assert.ok(!svg.includes("<B>") && svg.includes("&lt;B&gt;"));
    assert.equal(viewTitle(v), "Cohort overlap — A vs <B> vs C");
  });
  test("no patients, no figure", () => {
    assert.equal(viewToSvg({ ...v, overlap: { ...v.overlap!, union: 0 } }), null);
  });
});

describe("enrichment", () => {
  const gene = (g: string, a: number, b: number, q: number, log2Ratio: number | null = 1) => ({ gene: g, p: q / 2, q, log2Ratio, enrichedIn: a > b ? "A" : "B",
    cells: [{ cohort: "A", altered: a, profiled: 100, pct: a }, { cohort: "B", altered: b, profiled: 100, pct: b }] });
  const v: ViewResult = { kind: "enrichment", cohorts: ["A", "B"], caveat: "hypermutated tumours",
    enrichment: { alteration: "mutation", measure: "any", groups: ["A", "B"], tested: 30, untested: 2, significant: 1, minAltered: 5,
      test: "two-sided Fisher's exact test", rows: [gene("<APC>", 70, 2, 1e-20), gene("KRAS", 40, 80, 1e-10, -1), gene("ZERO", 5, 0, 0.5, null)],
      grid: { xMax: 5, yMax: 25, nx: 80, ny: 50, cells: [[40, 1, 25]] }, labels: ["<APC>", "KRAS"] } };
  test("draws the volcano and the table, escapes gene names and keeps the caveat", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("Log2 Ratio") && svg.includes("70 (70.00%)") && svg.includes("80 (80.00%)"));
    assert.ok(svg.includes("A →") && svg.includes("← B"), "the volcano says which side is which group");
    assert.ok(svg.includes("Genes with highest frequency in any group") && svg.includes("Altered frequency in A (%)"));
    assert.ok(!svg.includes("<APC>") && svg.includes("&lt;APC&gt;"));
    assert.ok(svg.includes("hypermutated tumours"));
  });
  test("says how many genes were tested beyond the rows drawn", () => {
    assert.ok(viewToSvg(v)!.includes("+27 more genes tested"));
  });
  test("three cohorts: the table alone, no volcano", () => {
    const three: ViewResult = { ...v, enrichment: { ...v.enrichment!, groups: ["A", "B", "C"], grid: undefined } };
    const svg3 = viewToSvg(three)!;
    assert.ok(!svg3.includes("Log2 Ratio") && svg3.includes("Genes with highest frequency in any group"));
  });
});

describe("assays", () => {
  const ent = (e: string, a: number, b: number, q: number) => ({ entity: e, name: e + " (named)", p: q / 2, q, statistic: 3, diff: a - b, higherIn: a > b ? "A" : "B",
    cells: [{ cohort: "A", n: 50, mean: a, sd: 0.1 }, { cohort: "B", n: 60, mean: b, sd: 0.1 }] });
  const base = { profileType: "sig", profileName: "Signatures", assayType: "MUTATIONAL_SIGNATURE", unit: "samples" as const, groups: ["A", "B"],
    untested: 0, significant: 1, minN: 3, missing: 4 };
  const numeric: ViewResult = { kind: "assays", cohorts: ["A", "B"], caveat: "read the means too",
    assays: { ...base, datatype: "numeric", tested: 25, test: "Welch's t-test", rows: [ent("<UV>", 0.5, 0.02, 1e-30), ent("Smoking", 0.01, 0.17, 1e-20)],
      grid: { xMax: 0.5, yMax: 50, nx: 80, ny: 50, cells: [] }, labels: ["<UV>"] } };
  test("numeric, two cohorts: a volcano of the difference in means, names escaped, the caveat kept", () => {
    const svg = viewToSvg(numeric)!;
    assert.ok(svg.includes("difference in mean (A − B)") && svg.includes("0.500") && svg.includes("0.170"));
    assert.ok(!svg.includes("<UV>") && svg.includes("&lt;UV&gt; (named)"));
    assert.ok(svg.includes("read the means too") && svg.includes("+23 more entities tested"));
  });
  test("categorical: one 100% bar of values per cohort, with a legend, and no volcano", () => {
    const cell = (cohort: string, gain: number, loss: number) => ({ cohort, n: gain + loss, values: { Gain: gain, Loss: loss } });
    const cat: ViewResult = { kind: "assays", cohorts: ["A", "B"], caveat: "NA left out",
      assays: { ...base, datatype: "categorical", tested: 1, test: "Pearson chi-squared test (cohort × value)", values: ["Gain", "Loss"],
        rows: [{ entity: "13q", name: "13q", p: 1e-9, q: 1e-9, statistic: 40, higherIn: "A", value: "Gain", cells: [cell("A", 30, 10), cell("B", 5, 35)] }], labels: [] } };
    const svg = viewToSvg(cat)!;
    assert.ok(!svg.includes("difference in mean"));
    assert.ok(svg.includes(">Gain<") && svg.includes(">Loss<") && svg.includes("A: Gain 30/40"));
    assert.equal(viewTitle(cat), "Generic assays — Signatures — A vs B");
  });
});

describe("correlates", () => {
  const g = (gene: string, rho: number) => ({ gene, n: 100, rho, rhoP: 1e-10, q: 1e-9, r: rho * 0.9, p: 1e-9 });
  const histogram = Array.from({ length: 40 }, (_, b) => [Math.round((-1 + b * 0.05) * 100) / 100, b === 20 ? 50 : 3] as [number, number]);
  const v: ViewResult = { kind: "correlates", cohorts: ["all"], caveat: "not a regulatory link",
    correlates: { gene: "ESR1", profileType: "mrna", otherProfile: "mrna", cohort: "all", tested: 200, untested: 1, significant: 30, minN: 10, rhoFrom: "rank",
      positive: [g("<FOXA1>", 0.75), g("GATA3", 0.7)], negative: [g("PSAT1", -0.67)], histogram } };
  test("draws the histogram and both lists, escapes names and keeps the caveat", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("Spearman ρ with ESR1") && svg.includes("rise with ESR1") && svg.includes("fall as ESR1 rises"));
    assert.ok(!svg.includes("<FOXA1>") && svg.includes("&lt;FOXA1&gt;") && svg.includes("PSAT1"));
    assert.ok(svg.includes("not a regulatory link") && svg.includes("every one of the 200 genes is in the histogram"));
    assert.equal(viewTitle(v), "Co-expression — ESR1 against every gene — all");
  });
});
