// The enrichment view (lib/views/enrichment/run.ts), cBioPortal's Genomic Alterations tab, driven with
// hand-made participants that answer its three count queries. Its rules, from the legacy code and the
// 2026-11-13 decisions (PORTAL-PARITY.md, "cBioLab bugs found by the parity audit"):
//   - every altered gene profiled in each cohort is tested, so BH divides by all of them; minAltered
//     only decides which are listed (CMM-STM-7);
//   - "Genes with highest frequency in any group" ranks every tested gene by its highest altered share,
//     a stable sort over the table's order (EnrichmentsUtil compareByAlterationPercentage; CMM-BP-2).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runEnrichment } from "../lib/views/enrichment/run.ts";
import { enrichmentSvg } from "../lib/views/enrichment/figure.ts";
import { fisherExact } from "../lib/stats.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation } from "../lib/types.ts";

/** per cohort: whole-exome samples, and per gene the altered samples and (panel) samples profiled */
type Site = Record<string, { wes: number; altered: Record<string, number>; panel?: Record<string, number> }>;

function ctx(site: Site): ViewRun {
  const vNames = Object.keys(site);
  const resolver = {
    instance: { id: "s1", mode: "patient-level", label: "s1", conn: {} },
    viewAggregate: async (label: string, def: { name: string }) => {
      const c = site[def.name];
      if (label.startsWith("enrichment:altered:")) return Object.entries(c.altered).map(([gene, altered]) => ({ gene, altered }));
      if (label.startsWith("enrichment:panels:")) return Object.entries(c.panel || {}).map(([gene, profiled]) => ({ gene, profiled }));
      if (label.startsWith("enrichment:wes:")) return [{ n: c.wes }];
      throw new Error("unexpected " + label);
    },
    viewAggregateMany: async () => [],
    viewMeta: async () => [],
  };
  const cohorts: Record<string, EvaluatedCohort> = Object.fromEntries(vNames.map((n) => [n, {
    studies: ["s1"], count: 100, samples: 100, text: "", perStudy: { s1: { sql: "", count: 100, samples: 100, mode: "patient-level" } } }]));
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { name: n }])), views: [] } as never,
    cohorts, resolvers: { s1: resolver } as never, vNames, vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = async (site: Site, view: object = {}) => (await runEnrichment({ kind: "enrichment", alteration: "sv", ...view } as never, ctx(site))) as any;
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), a + " ≠ " + b);

describe("enrichment: every altered gene is tested; minAltered only lists (CMM-STM-7)", () => {
  // A: 100 whole-exome samples. B: 100 samples on a panel listing PUM1, RARE, PAIR, not ONLY_A.
  const site: Site = {
    A: { wes: 100, altered: { PUM1: 30, RARE: 1, PAIR: 2, ONLY_A: 4 } },
    B: { wes: 0, altered: { PUM1: 5, PAIR: 2 }, panel: { PUM1: 100, RARE: 100, PAIR: 100 } },
  };
  test("a gene altered once is tested and counted in q, but not listed; one not profiled in B is not tested", async () => {
    const v = await run(site);
    const e = v.enrichment;
    assert.equal(e.tested, 3, "PUM1, RARE and PAIR");
    assert.equal(e.untested, 1, "ONLY_A: B's panel does not list it");
    assert.equal(e.hidden, 2, "RARE (1) and PAIR (2 + 2): under 5 altered samples");
    assert.deepEqual(e.rows.map((g: any) => g.gene), ["PUM1"]);
    // BH over the 3 tested: PUM1 has the smallest p, rank 1 → q = 3p (the old rule, testing PUM1 alone, gave q = p)
    const p = fisherExact(30, 70, 5, 95);
    close(e.rows[0].p, p);
    close(e.rows[0].q, 3 * p);
    assert.match(v.caveat, /2 tested genes have fewer than 5 altered samples across the cohorts and are not listed, though counted in q\./);
    assert.match(v.caveat, /1 altered gene was not tested: not profiled in one of the cohorts\./);
    const step = v.method.steps.find((s: any) => /^Profiled = panel/.test(s.title));
    assert.deepEqual(step.params, [["tested", "3"], ["not tested", "1"], ["tested, not listed", "2"]]);
    assert.match(v.method.python, /if g\["altered"\]\.sum\(\) == 0 or \(g\["profiled"\] == 0\)\.any\(\):/);
  });
  test("minAltered 1 lists every tested gene, with the same q", async () => {
    const e = (await run(site, { minAltered: 1 })).enrichment;
    // PAIR and RARE both have p = 1 (up to rounding)
    assert.deepEqual(e.rows.map((g: any) => g.gene).sort(), ["PAIR", "PUM1", "RARE"]);
    assert.equal(e.rows[0].gene, "PUM1");
    close(e.rows[0].q, 3 * fisherExact(30, 70, 5, 95));
    assert.equal(e.hidden, 0);
  });
  test("no altered gene profiled in each cohort is refused in words", async () => {
    const v = await run({ A: { wes: 10, altered: { X: 2 } }, B: { wes: 0, altered: {}, panel: {} } });
    assert.equal(v.error, "no gene had a structural variant in these cohorts, profiled in each of them");
  });
});

describe("enrichment: \"Genes with highest frequency in any group\" ranks every tested gene (CMM-BP-2)", () => {
  // 320 genes 10 % vs 0 % (p ≈ 0.0013 each, so they fill the 300 listed rows) and MUC16 at 40 % in both
  // (p = 1, so past the rows): the bar plot is over every tested gene, so MUC16 leads it
  const genes = Array.from({ length: 320 }, (_, i) => "G" + String(i).padStart(3, "0"));
  const site: Site = {
    A: { wes: 100, altered: { ...Object.fromEntries(genes.map((g) => [g, 10])), MUC16: 40, SYNE1: 12 } },
    B: { wes: 100, altered: { MUC16: 40, SYNE1: 9 } },
  };
  test("the highest share in any group, over every tested gene, ties in the table's order", async () => {
    const v = await run(site);
    const e = v.enrichment;
    assert.equal(e.rows.length, 300);
    assert.ok(!e.rows.some((g: any) => g.gene === "MUC16"), "MUC16 (p = 1) is past the 300 most significant");
    assert.deepEqual(e.topFrequency.map((g: any) => g.gene), ["MUC16", "SYNE1", "G000", "G001", "G002", "G003", "G004", "G005", "G006", "G007"]);
    const svg = enrichmentSvg(v, { width: 1100 })!;
    assert.match(svg, /<title>MUC16 in A: 40(\.0)?% \(40 \/ 100\)<\/title>/, "the bar plot draws MUC16");
  });
});
