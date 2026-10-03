// Renderers for the view kinds in lib/views-portal.ts: pure functions of a ViewResult, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg, viewTitle } from "../lib/view-svg.ts";
import type { ViewResult, CancertypesGroup } from "../lib/types.ts";

const grp = (key: string, label: string, profiled: number, mutation: number, amp = 0, samples = profiled): CancertypesGroup =>
  ({ key, label, samples, profiled, altered: mutation + amp, mutation, amp, homdel: 0, sv: 0, multiple: 0 });

describe("cancertypes", () => {
  const v: ViewResult = { kind: "cancertypes", cohorts: ["all"], caveat: "samples, not patients",
    cancertypes: { groupBy: "CANCER_TYPE", measure: "any", genes: ["KRAS"], minSamples: 10, show: "frequency",
      panels: [{ cohort: "all", samples: 300, profiled: 290, altered: 120,
        groups: [grp("pancreatic", "Pancreatic <Cancer>", 100, 80, 2), grp("lung", "Lung", 150, 30, 0, 160)],
        pooled: { ...grp("__pooled__", "3 smaller groups", 40, 8), count: 3 } }] } };
  test("each group shows its altered share over its profiled samples, and its unprofiled total when larger", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("82.0%") && svg.includes("82 / 100"));
    assert.ok(svg.includes("30 / 150 of 160"), "a group with unprofiled samples says so");
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
    assert.match(viewTitle(v), /Cohort overlap — A, <B>, C/);
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
    assert.ok(svg.includes("log2 ratio (A / B)") && svg.includes("70.0%") && svg.includes("80.0%"));
    assert.ok(!svg.includes("<APC>") && svg.includes("&lt;APC&gt;"));
    assert.ok(svg.includes("hypermutated tumours"));
  });
  test("says how many genes were tested beyond the rows drawn", () => {
    assert.ok(viewToSvg(v)!.includes("+27 more genes tested"));
  });
  test("three cohorts: the table alone, no volcano", () => {
    const three: ViewResult = { ...v, enrichment: { ...v.enrichment!, groups: ["A", "B", "C"], grid: undefined } };
    assert.ok(!viewToSvg(three)!.includes("log2 ratio"));
  });
});
