// Every listed gene on the Genomic Alterations table, volcano and frequency scatter, and the per-gene row
// values (lib/views/enrichment/rows.ts, run.ts, figure.ts). Written from the legacy sources:
//   - cbioportal-frontend@cd8c6df src/pages/resultsView/enrichments/EnrichmentsUtil.tsx getAlterationRowData
//     (altered % = altered / profiled; log2 ratio = log2(%g1 / %g2), no pseudocount; enriched in = g1 if
//     logRatio > 0 else g2; ≥3 groups: highest altered %, first on ties);
//   - AlterationEnrichmentsContainer.tsx: the table gets every row, no cap; MiniScatterChart /
//     MiniFrequencyScatterChart draw every row with a p-value;
//   - docs/legacy-spec/21-comparison-molecular.md CMM-STM-3, CMM-AL-5 ("22 871 rows"), CMM-FS, CMM-BP-2.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { enrichmentRow, toColumns, fromColumns } from "../lib/views/enrichment/rows.ts";
import { runEnrichment } from "../lib/views/enrichment/run.ts";
import { withEveryRow, enrichmentChartsSvg } from "../lib/views/enrichment/figure.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation } from "../lib/types.ts";

/** per cohort: whole-exome samples, and per gene the altered samples and (panel) samples profiled */
type Site = Record<string, { wes: number; altered: Record<string, number>; panel?: Record<string, number> }>;

function ctx(site: Site, cytobands: Record<string, string> = {}): ViewRun {
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
    viewMeta: async () => Object.entries(cytobands).map(([gene, cytoband]) => ({ gene, cytoband })),
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
const run = async (site: Site, view: object = {}, cytobands: Record<string, string> = {}) =>
  (await runEnrichment({ kind: "enrichment", alteration: "sv", allRows: true, ...view } as never, ctx(site, cytobands))) as any;
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), a + " ≠ " + b);

/** n genes on whole-exome cohorts of 100, each with a distinct (A, B) altered pair, all ≥ 10 altered */
function bigSite(n: number): Site {
  const A: Record<string, number> = {}, B: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const g = "G" + String(i).padStart(4, "0");
    A[g] = 5 + (i % 50);
    B[g] = 5 + Math.floor(i / 50);
  }
  return { A: { wes: 100, altered: A }, B: { wes: 100, altered: B } };
}
const cytobandsFor = (site: Site) => Object.fromEntries(Object.keys(site.A.altered).filter((_g, i) => i % 3 !== 0).map((g, i) => [g, "1p" + i]));

describe("row values (getAlterationRowData; CMM-STM-3)", () => {
  test("4: altered share is altered / profiled; pct ×100 to 1 decimal; null when nothing profiled", () => {
    const r = enrichmentRow("X", ["A", "B", "C"], [1, 2, 0], [3, 8, 0], 0.01, 0.02, "7q31");
    assert.equal(r.gene, "X");
    assert.equal(r.cytoband, "7q31");
    assert.deepEqual(r.cells.map((c) => c.cohort), ["A", "B", "C"]);
    assert.deepEqual(r.cells.map((c) => [c.altered, c.profiled]), [[1, 3], [2, 8], [0, 0]]);
    assert.equal(r.cells[0].pct, 33.3);
    assert.equal(r.cells[1].pct, 25);
    assert.equal(r.cells[2].pct, null);
    assert.equal(r.p, 0.01);
    assert.equal(r.q, 0.02);
  });
  test("4: altered 0 of a profiled cohort is 0%", () => {
    const r = enrichmentRow("X", ["A", "B"], [0, 3], [10, 10], 0.5, 0.5);
    assert.equal(r.cells[0].pct, 0);
  });
  test("5: share1 > share2 > 0 → log2(share1/share2) > 0, enriched in group 1", () => {
    const r = enrichmentRow("X", ["A", "B"], [30, 5], [100, 50], 0.01, 0.02);
    close(r.log2Ratio as number, Math.log2(0.3 / 0.1));
    assert.ok((r.log2Ratio as number) > 0);
    assert.equal(r.enrichedIn, "A");
  });
  test("6: share1 < share2 → log2 ratio < 0, enriched in group 2", () => {
    const r = enrichmentRow("X", ["A", "B"], [5, 30], [100, 100], 0.01, 0.02);
    close(r.log2Ratio as number, Math.log2(0.05 / 0.3));
    assert.ok((r.log2Ratio as number) < 0);
    assert.equal(r.enrichedIn, "B");
  });
  test("7: equal shares → log2 ratio 0, enriched in group 2 (logRatio > 0 is false)", () => {
    const r = enrichmentRow("X", ["A", "B"], [10, 20], [50, 100], 1, 1);
    assert.equal(r.log2Ratio, 0);
    assert.equal(r.enrichedIn, "B");
  });
  test("8: share2 = 0, share1 > 0 → ratio +∞ (null), enriched in group 1", () => {
    const r = enrichmentRow("X", ["A", "B"], [10, 0], [100, 100], 0.001, 0.002);
    assert.equal(r.log2Ratio, null);
    assert.equal(r.enrichedIn, "A");
  });
  test("9: share1 = 0, share2 > 0 → ratio −∞ (null), enriched in group 2", () => {
    const r = enrichmentRow("X", ["A", "B"], [0, 10], [100, 100], 0.001, 0.002);
    assert.equal(r.log2Ratio, null);
    assert.equal(r.enrichedIn, "B");
  });
  test("10: three groups, shares 0.2, 0.5, 0.5 → the first with the highest share; no log2 ratio", () => {
    const r = enrichmentRow("X", ["A", "B", "C"], [20, 50, 25], [100, 100, 50], 0.01, 0.02);
    assert.equal(r.enrichedIn, "B");
    assert.equal(r.log2Ratio ?? undefined, undefined);
  });
});

describe("columns ↔ rows (ours)", () => {
  test("11, 12: rows rebuilt from columns equal the originals, order kept; no cytoband → \"\" and none on the rebuilt row", () => {
    const groups = ["A", "B"];
    const rows = [
      enrichmentRow("TP53", groups, [40, 10], [100, 100], 1e-6, 1e-5, "17p13.1"),
      enrichmentRow("NOBAND", groups, [0, 10], [100, 90], 0.001, 0.003),
      enrichmentRow("CDH1", groups, [5, 5], [100, 100], 1, 1, "16q22.1"),
      enrichmentRow("ZERO", groups, [0, 0], [0, 10], 1, 1),
    ];
    const c = toColumns(rows);
    assert.deepEqual(c.gene, ["TP53", "NOBAND", "CDH1", "ZERO"]);
    assert.deepEqual(c.cytoband, ["17p13.1", "", "16q22.1", ""]);
    assert.deepEqual(c.altered, [[40, 10], [0, 10], [5, 5], [0, 0]]);
    assert.deepEqual(c.profiled, [[100, 100], [100, 90], [100, 100], [0, 10]]);
    assert.deepEqual(c.p, [1e-6, 0.001, 1, 1]);
    assert.deepEqual(c.q, [1e-5, 0.003, 1, 1]);
    const back = fromColumns(c, groups);
    assert.deepEqual(back, rows);
    assert.equal("cytoband" in back[1] && back[1].cytoband !== undefined, false);
  });
  test("11: three groups round-trip", () => {
    const groups = ["A", "B", "C"];
    const rows = [
      enrichmentRow("X", groups, [20, 50, 25], [100, 100, 50], 0.01, 0.02, "1p36"),
      enrichmentRow("Y", groups, [1, 0, 3], [10, 10, 0], 0.5, 0.6),
    ];
    assert.deepEqual(fromColumns(toColumns(rows), groups), rows);
  });
});

describe("every listed gene (CMM-AL-5, CMM-FS)", () => {
  test("1, 2: 350 listed genes → rows ≤ 300 most significant, all carries every one, most significant first", async () => {
    const site = bigSite(350);
    const e = (await run(site, {}, cytobandsFor(site))).enrichment;
    assert.equal(e.tested, 350);
    assert.equal(e.hidden ?? 0, 0);
    assert.ok(e.rows.length <= 300, "rows " + e.rows.length);
    assert.ok(e.all, "all is present");
    assert.equal(e.all.gene.length, 350);
    assert.deepEqual([...e.all.gene].sort(), Object.keys(site.A.altered).sort());
    for (let i = 1; i < e.all.p.length; i++) assert.ok(e.all.p[i - 1] <= e.all.p[i], "p order at " + i);
    // rows are the head of all, value for value
    const every = fromColumns(e.all, e.groups);
    assert.deepEqual(every.slice(0, e.rows.length), e.rows);
    // the columns carry the counts the resolver answered
    const i = e.all.gene.indexOf("G0123");
    assert.deepEqual(e.all.altered[i], [site.A.altered.G0123, site.B.altered.G0123]);
    assert.deepEqual(e.all.profiled[i], [100, 100]);
  });
  test("2: genes under minAltered are tested but not in all", async () => {
    const site = bigSite(350);
    site.A.altered.RARE = 1;
    const e = (await run(site)).enrichment;
    assert.equal(e.tested, 351);
    assert.equal(e.hidden, 1);
    assert.equal(e.all.gene.length, 350);
    assert.ok(!e.all.gene.includes("RARE"));
  });
  test("all only when the view asks for every row (allRows): an agent's run carries the 300", async () => {
    const e = (await run(bigSite(350), { allRows: undefined })).enrichment;
    assert.equal(e.rows.length, 300);
    assert.equal(e.all, undefined);
    assert.equal(e.grid.unlisted, undefined);
  });
  test("a tested gene under minAltered stays on the page's volcano as density beside every listed point", async () => {
    const site = bigSite(350);
    site.A.altered.RARE = 1;
    const e = (await run(site)).enrichment;
    const total = (cells: [number, number, number][]) => cells.reduce((a, c) => a + c[2], 0);
    assert.equal(total(e.grid.unlisted), 1, "RARE, the one unlisted tested gene");
    assert.equal(total(e.grid.cells), 351 - e.rows.length, "the server figure's density: every tested gene past the 300");
    const page = withEveryRow(e);
    assert.equal(page.rows.length, 350);
    assert.equal(total(page.grid!.cells), 1);
    assert.equal(page.grid!.unlisted, undefined);
  });
  test("3: ≤ 300 listed genes → no all; rows are every listed gene", async () => {
    const site = bigSite(10);
    const e = (await run(site)).enrichment;
    assert.equal(e.all, undefined);
    assert.equal(e.rows.length, 10);
    assert.deepEqual(e.rows.map((r: any) => r.gene).sort(), Object.keys(site.A.altered).sort());
  });
  test("13: the frequency bar plot ranks every tested gene, listed or not", async () => {
    // RAREHI: 2 of 2 panel samples in B → 100%, but under minAltered so not listed
    const A: Record<string, number> = {}, Bp: Record<string, number> = {}, Ba: Record<string, number> = {};
    for (let i = 0; i < 10; i++) { A["G" + i] = 10 + i; Ba["G" + i] = 5; Bp["G" + i] = 100; }
    A.RAREHI = 0; Ba.RAREHI = 2; Bp.RAREHI = 2;
    const e = (await run({ A: { wes: 100, altered: A }, B: { wes: 0, altered: Ba, panel: Bp } })).enrichment;
    assert.ok(!e.rows.some((r: any) => r.gene === "RAREHI"));
    assert.equal(e.topFrequency[0].gene, "RAREHI");
  });
});

describe("withEveryRow and the charts (ours, row 14)", () => {
  test("withEveryRow rebuilds rows from all and drops all; unchanged without all", async () => {
    const site = bigSite(350);
    const e = (await run(site, {}, cytobandsFor(site))).enrichment;
    const w = withEveryRow(e);
    assert.equal(w.rows.length, 350);
    assert.equal(w.all, undefined);
    assert.deepEqual(w.rows, fromColumns(e.all, e.groups));
    const small = (await run(bigSite(10))).enrichment;
    assert.deepEqual(withEveryRow(small), small);
  });
  test("the frequency scatter names how many genes it draws; drawing every row draws more points", async () => {
    const e = (await run(bigSite(350))).enrichment;
    const top = enrichmentChartsSvg(e, { width: 1200 });
    const every = enrichmentChartsSvg(withEveryRow(e), { width: 1200 });
    assert.match(top, /the 300 most significant genes/);
    assert.doesNotMatch(top, /all 350 listed genes/);
    assert.match(every, /all 350 listed genes/);
    const circles = (s: string) => (s.match(/<circle/g) || []).length;
    assert.ok(circles(every) > circles(top), circles(every) + " ≤ " + circles(top));
  });
  test("thousands separator in the count", async () => {
    const e = (await run(bigSite(1200))).enrichment;
    assert.match(enrichmentChartsSvg(withEveryRow(e), { width: 1200 }), /all 1,200 listed genes/);
  });
  test("≤ 300 listed genes: the scatter draws every one and says so", async () => {
    const e = (await run(bigSite(10))).enrichment;
    assert.match(enrichmentChartsSvg(e, { width: 1200 }), /all 10 listed genes/);
  });
});
