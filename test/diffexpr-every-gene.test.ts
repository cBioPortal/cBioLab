// Every tested gene in the diffexpr view's table and volcano, as cBioPortal's Group Comparison
// mRNA / Protein / DNA Methylation tabs: cbioportal-frontend@cd8c6df
// src/pages/resultsView/enrichments/ExpressionEnrichmentsContainer.tsx hands the table every row,
// and MiniScatterChart draws every row with a p (brca Basal vs LumA RNA-seq: 20,026 genes).
// docs/legacy-spec/21-comparison-molecular.md CMM-GN, CMM-EX-5. The runner keeps `points` (the
// most significant ≤1,500 and the labelled genes) and adds `all`, every tested gene as columns, when
// more were tested; lib/views/diffexpr/rows.ts converts between genes and columns.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runDiffexpr } from "../lib/views/diffexpr/run.ts";
import { toColumns, fromColumns, withEveryGene } from "../lib/views/diffexpr/rows.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { DiffexprResult, DiffexprGene } from "../lib/views/diffexpr/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Moments = { gene: string; n: number; sx: number; sxx: number };
/** cohort → gene → values, as one site holds them */
type Values = Record<string, Record<string, number[]>>;

const moments = (gene: string, xs: number[]): Moments => ({ gene, n: xs.length, sx: xs.reduce((a, b) => a + b, 0), sxx: xs.reduce((a, b) => a + b * b, 0) });

type Fake = Record<string, unknown>;
/** a site answering the moments query from `values`; the warehouse knows UP's cytoband only */
function site(values: Values): Fake {
  return {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    viewAggregate: async (label: string, _def: unknown, build: (c: string, s: string, d: string) => string) => {
      build("SELECT 1 AS pid", "s1", "db");
      const cohort = label.replace("diffexpr:moments:", "");
      return Object.entries(values[cohort] ?? {}).map(([g, xs]) => moments(g, xs));
    },
    viewMeta: async (label: string, build: (s: string, d: string) => string) => {
      build("s1", "db");
      return label === "cytobands" ? [{ gene: "UP", cytoband: "1p36.33" }] : [];
    },
  };
}

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});

function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, Fake>): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: studies.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: ["mrna_zscores"], gaProfiles: [] }),
  };
}
const de = (r: ViewResult) => (r as unknown as { diffexpr: DiffexprResult }).diffexpr;
const run = (view: Record<string, unknown>, c: ViewRun) => runDiffexpr({ kind: "diffexpr", profileType: "mrna_zscores", geneSets: [], allRows: true, ...view } as never, c);

/** `count` genes (G0…, the first named UP), each with its own shift of the first cohort, so each its own t and p */
function profile(count: number, cohorts: number): Values {
  const names = Array.from({ length: count }, (_, i) => (i === 0 ? "UP" : "G" + i));
  const spread = [0, 1, 2, 3, 4].map((k) => k * 0.5);
  const out: Values = {};
  for (let c = 0; c < cohorts; c++) {
    const name = String.fromCharCode(65 + c);
    out[name] = Object.fromEntries(names.map((g, i) => [g, spread.map((v, k) => v + (c === 0 ? (i % 2 ? -1 : 1) * (i + 1) * 0.002 : c * 0.01) + (c > 0 && k === 4 ? i * 0.0001 : 0))]));
  }
  return out;
}
const runOn = async (count: number, cohorts: number, view: Record<string, unknown> = {}) => {
  const values = profile(count, cohorts);
  const names = Object.keys(values);
  const r = await run(view, ctx(Object.fromEntries(names.map((n) => [n, cohort({ s1: 5 })])), { s1: site(values) }));
  assert.equal(r.error, undefined);
  return de(r);
};

describe("diffexpr: every tested gene (CMM-GN, CMM-EX-5)", () => {
  test("more genes tested than points hold: `all` lists every tested gene, most significant first", async () => {
    const d = await runOn(1600, 2);
    assert.equal(d.tested, 1600);
    assert.ok(d.points.length <= 1500 + d.labels.length, `points ${d.points.length}`);
    assert.ok(d.points.length < d.tested);
    const all = d.all!;
    assert.ok(all, "expected `all`");
    assert.equal(all.gene.length, 1600);
    assert.equal(new Set(all.gene).size, 1600);
    for (const k of ["cytoband", "n", "mean", "sd", "effect", "p", "q"] as const) assert.equal(all[k]!.length, 1600, k);
    for (let i = 1; i < all.p.length; i++) assert.ok(all.p[i - 1] <= all.p[i], `p out of order at ${i}`);
    // per gene, per cohort in groups order
    for (let i = 0; i < 1600; i++) {
      assert.equal(all.n[i].length, 2); assert.equal(all.mean[i].length, 2); assert.equal(all.sd[i].length, 2);
      // each to 3 places, so their difference to within a rounding step of each
      assert.ok(Math.abs(all.effect![i] - (all.mean[i][0] - all.mean[i][1])) <= 0.0015, all.gene[i]);
    }
    // cytoband "" when the warehouse does not know it
    assert.equal(all.cytoband[all.gene.indexOf("UP")], "1p36.33");
    assert.equal(all.cytoband[all.gene.indexOf("G1")], "");
  });

  // `all` carries means, SDs and differences to 3 places and p, q to 4 significant digits (one more than the page writes)
  const sig4 = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 5e-4 * Math.abs(b), what + ": " + a + " vs " + b);
  const places3 = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 5e-4 + 1e-12, what + ": " + a + " vs " + b);
  test("the numbers in `all` are the runner's numbers for the same gene in `points`, rounded as the page reads them", async () => {
    const d = await runOn(1600, 2);
    const all = d.all!;
    for (const g of d.points) {
      const i = all.gene.indexOf(g.gene);
      assert.ok(i >= 0, g.gene);
      sig4(all.p[i], g.p, g.gene); sig4(all.q[i], g.q, g.gene);
      assert.deepEqual(all.n[i], g.n, g.gene);
      g.mean.forEach((m, k) => places3(all.mean[i][k], m, g.gene)); g.sd.forEach((x, k) => places3(all.sd[i][k], x, g.gene));
      places3(all.effect![i], g.effect!, g.gene);
      assert.equal(all.cytoband[i], g.cytoband ?? "", g.gene);
    }
  });

  test("three cohorts: `all` has every gene with no effect column", async () => {
    const d = await runOn(1600, 3);
    const all = d.all!;
    assert.ok(all, "expected `all`");
    assert.equal(all.gene.length, d.tested);
    assert.equal(all.effect, undefined);
    assert.equal(all.n[0].length, 3);
    for (const g of d.points) {
      const i = all.gene.indexOf(g.gene);
      sig4(all.p[i], g.p, g.gene); sig4(all.q[i], g.q, g.gene); g.mean.forEach((m, k) => places3(all.mean[i][k], m, g.gene));
    }
  });

  test("without allRows (an agent's run) no `all`, however many genes", async () => {
    const d = await runOn(1600, 2, { allRows: undefined });
    assert.equal(d.all, undefined);
    assert.ok(d.points.length < d.tested);
  });

  test("no more genes tested than points hold: no `all`", async () => {
    const d = await runOn(20, 2);
    assert.equal(d.tested, 20);
    assert.equal(d.points.length, 20);
    assert.equal(d.all, undefined);
  });
});

describe("diffexpr rows: columns ↔ genes", () => {
  const two: DiffexprGene[] = [
    { gene: "UP", n: [5, 4], mean: [2, 0.5], sd: [0.3, 0.4], effect: 1.5, t: 6.1, p: 0.0001, q: 0.002, cytoband: "1p36.33" },
    { gene: "DOWN", n: [3, 6], mean: [-1, 0.2], sd: [0.1, 0.2], effect: -1.2, t: -4, p: 0.003, q: 0.01 },
  ];
  const three: DiffexprGene[] = [
    { gene: "A1", n: [5, 4, 3], mean: [1, 2, 3], sd: [0.1, 0.2, 0.3], f: 9.5, p: 0.001, q: 0.004, cytoband: "17q21" },
    { gene: "B2", n: [4, 4, 4], mean: [0, 0, 0.1], sd: [1, 1, 1], f: 0.2, p: 0.8, q: 0.8 },
  ];
  const strip = (g: DiffexprGene) => ({ gene: g.gene, n: g.n, mean: g.mean, sd: g.sd, effect: g.effect, p: g.p, q: g.q, cytoband: g.cytoband ?? "" });

  test("two cohorts: columns hold each gene row by row, effect included, cytoband \"\" when unknown", () => {
    const c = toColumns(two, true);
    assert.deepEqual(c.gene, ["UP", "DOWN"]);
    assert.deepEqual(c.cytoband, ["1p36.33", ""]);
    assert.deepEqual(c.n, [[5, 4], [3, 6]]);
    assert.deepEqual(c.mean, [[2, 0.5], [-1, 0.2]]);
    assert.deepEqual(c.sd, [[0.3, 0.4], [0.1, 0.2]]);
    assert.deepEqual(c.effect, [1.5, -1.2]);
    assert.deepEqual(c.p, [0.0001, 0.003]);
    assert.deepEqual(c.q, [0.002, 0.01]);
  });

  test("two cohorts round trip: every field back but t", () => {
    const back = fromColumns(toColumns(two, true));
    assert.equal(back.length, 2);
    back.forEach((g, i) => {
      assert.deepEqual(strip(g), strip(two[i]));
      assert.equal(g.t, undefined);
      assert.equal(g.f, undefined);
    });
  });

  test("three cohorts: no effect column, round trip without f or effect", () => {
    const c = toColumns(three, false);
    assert.equal(c.effect, undefined);
    assert.deepEqual(c.n, [[5, 4, 3], [4, 4, 4]]);
    assert.deepEqual(c.cytoband, ["17q21", ""]);
    const back = fromColumns(c);
    back.forEach((g, i) => {
      assert.deepEqual(strip(g), strip(three[i]));
      assert.equal(g.effect, undefined);
      assert.equal(g.f, undefined);
      assert.equal(g.t, undefined);
    });
  });
});

describe("diffexpr rows: withEveryGene", () => {
  test("points become every gene from `all`, `all` goes, nothing pooled, the grid's cells emptied with its axes kept", async () => {
    const d = await runOn(1600, 2);
    assert.ok(d.all && d.grid);
    const w = withEveryGene(d);
    assert.equal(w.all, undefined);
    assert.equal(w.points.length, 1600);
    assert.deepEqual(w.points.map((g) => g.gene), d.all.gene);
    assert.deepEqual(w.points, fromColumns(d.all));
    assert.equal(w.pooledSignificant, 0);
    assert.deepEqual(w.grid!.cells, []);
    assert.equal(w.grid!.xMax, d.grid.xMax);
    assert.equal(w.grid!.yMax, d.grid.yMax);
    // the rest of the result is untouched
    assert.equal(w.tested, d.tested); assert.equal(w.significant, d.significant);
    assert.deepEqual(w.groups, d.groups); assert.deepEqual(w.labels, d.labels);
  });

  test("a result without `all` is unchanged", async () => {
    const d = await runOn(20, 2);
    assert.deepEqual(withEveryGene(d), d);
  });
});
