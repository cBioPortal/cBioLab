// The diffexpr view's runner (lib/views/diffexpr/run.ts), driven with hand-made participants: two
// cohorts compared gene by gene with Welch's t from per-cohort moments (n, Σv, Σv²), which add
// across sites, BH q across genes, and preranked GSEA of the t ranking (lib/views/diffexpr/types.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { defaultLog2, runDiffexpr } from "../lib/views/diffexpr/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { DiffexprResult } from "../lib/views/diffexpr/types.ts";
import { welchT, varianceFromMoments } from "../lib/stats.ts";
import { PRIMARY } from "../lib/ch.ts";

type Moments = { gene: string; n: number; sx: number; sxx: number };
/** cohort → gene → values, as one site holds them */
type Values = Record<string, Record<string, number[]>>;

const moments = (gene: string, xs: number[]): Moments => ({ gene, n: xs.length, sx: xs.reduce((a, b) => a + b, 0), sxx: xs.reduce((a, b) => a + b * b, 0) });

type Fake = Record<string, unknown>;
/** a site answering the moments query from `values` and the gene-set query from `sets` */
function site(values: Values, sets: { set_name: string; genes: string[] }[] = [], asked: string[] = []): Fake {
  return {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    // a resolver builds the statement for its own study and database before running it
    viewAggregate: async (label: string, _def: unknown, build: (c: string, s: string, d: string) => string) => {
      asked.push(label, build("SELECT 1 AS pid", "s1", "db"));
      const cohort = label.replace("diffexpr:moments:", "");
      return Object.entries(values[cohort] ?? {}).map(([g, xs]) => moments(g, xs));
    },
    viewMeta: async (label: string, build: (s: string, d: string) => string) => { asked.push(label, build("s1", "db")); return sets; },
  };
}
const remote = (): Fake => ({ instance: { id: "peer", mode: "aggregate-only", label: "peer", conn: PRIMARY } });

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});

function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, Fake>, profiles: Record<string, string[]> = {}): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: studies.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async (st: string) => ({ profiles: profiles[st] ?? ["mrna_zscores"], gaProfiles: [] }),
  };
}
const de = (r: ViewResult) => (r as unknown as { diffexpr: DiffexprResult }).diffexpr;
const run = (view: Record<string, unknown>, c: ViewRun) => runDiffexpr({ kind: "diffexpr", profileType: "mrna_zscores", geneSets: [], ...view } as never, c);

test("log2 is the default for RNA-seq counts, RSEM, TPM and FPKM, never for z-scores or already-logged values", () => {
  for (const p of ["rna_seq_v2_mrna", "RNASEQ", "tpm", "fpkm_uq", "rsem"]) assert.equal(defaultLog2(p), true, p);
  for (const p of ["rna_seq_v2_mrna_median_Zscores", "mrna_zscores", "rna_seq_log2", "protein_quantification", "methylation_hm450"]) assert.equal(defaultLog2(p), false, p);
});

describe("diffexpr: refusals", () => {
  const two = () => ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }) }, { s1: site({}) });
  const err = async (view: Record<string, unknown>, c = two()) => {
    const r = await run(view, c);
    assert.ok(r.error, "expected a refusal");
    assert.equal(r.kind, "diffexpr");
    return r.error;
  };
  test("not exactly two cohorts", async () => {
    assert.match(await err({}, ctx({ A: cohort({ s1: 5 }) }, { s1: site({}) })), /exactly two cohorts; this one draws 1 — add a second cohort/);
    assert.match(await err({}, ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }), C: cohort({ s1: 5 }) }, { s1: site({}) })), /draws 3 — name two/);
  });
  test("no profileType", async () => assert.match(await err({ profileType: "  " }), /needs profileType/));
  test("label outside 0..40", async () => {
    assert.match(await err({ label: 41 }), /label is 0 to 40 genes; got 41/);
    assert.match(await err({ label: "x" }), /label is 0 to 40/);
  });
  test("more than 12 gene sets, or a name that is not an MSigDB set name", async () => {
    assert.match(await err({ geneSets: Array.from({ length: 13 }, (_, i) => "SET_" + i) }), /at most 12 gene sets; this asks for 13/);
    assert.match(await err({ geneSets: ["HALLMARK_OK", "bad name!"] }), /not an MSigDB set name: BAD NAME!/);
  });
  test("an empty cohort is named, and the profile is said not to be the problem", async () => {
    assert.match(await err({}, ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 0 }) }, { s1: site({}) })), /cohort “B” is empty .* the profile is not the problem/);
    assert.match(await err({}, ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 0 }) }, { s1: site({}) })), /“A” and “B” are empty/);
  });
  test("no participant serves the view's aggregates", async () =>
    assert.match(await err({}, ctx({ A: cohort({ p: 5 }), B: cohort({ p: 5 }) }, { p: remote() })), /no participant can answer: p is a remote peer/));
  test("a study without the profile is named, with the profiles that are there", async () => {
    const c = ctx({ A: cohort({ s1: 5, s2: 5 }), B: cohort({ s1: 5, s2: 5 }) }, { s1: site({}), s2: site({}) },
      { s1: ["mrna_zscores", "rppa"], s2: ["cna"] });
    assert.equal(await err({}, c), "s2 has no mrna_zscores profile — available: cna, mrna_zscores, rppa");
    const both = ctx({ A: cohort({ s1: 5, s2: 5 }), B: cohort({ s1: 5 }) }, { s1: site({}), s2: site({}) }, { s1: [], s2: [] });
    assert.equal(await err({}, both), "s1, s2 have no mrna_zscores profile — available: none");
  });
  test("no gene with three values in both cohorts and some variance", async () => {
    const c = ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }) }, { s1: site({ A: { G1: [1, 2] , G2: [4, 4, 4] }, B: { G1: [1, 2, 3], G2: [4, 4, 4] } }) });
    assert.match(await err({}, c), /no gene had at least 3 samples with a mrna_zscores value in both cohorts \(cohort sizes A 5, B 5\)/);
  });
});

describe("diffexpr: the per-gene test", () => {
  const A = { UP: [5, 6, 7, 6, 5.5], DOWN: [0, 0.5, 1, 0.2], SAME: [1, 2, 3], FEW: [1, 2, 3], FLAT: [2, 2, 2] };
  const B = { UP: [0, 1, 0.5, 0.2, 0.7], DOWN: [4, 5, 6, 5], SAME: [1, 2, 3], FEW: [1, 2], FLAT: [2, 2, 2] };

  test("each gene is Welch's t on its two cohorts' values; too few values or no variance leaves it out", async () => {
    const r = await run({}, ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }) }, { s1: site({ A, B }) }));
    const d = de(r);
    assert.equal(r.error, undefined);
    assert.deepEqual(d.groups, ["A", "B"]);
    assert.equal(d.tested, 3);
    assert.equal(d.skipped, 2);
    const up = d.points.find((g) => g.gene === "UP")!;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(Math.abs(up.effect - (mean(A.UP) - mean(B.UP))) < 1e-12);
    assert.equal(up.nA, 5); assert.equal(up.nB, 5);
    const ma = moments("UP", A.UP), mb = moments("UP", B.UP);
    const w = welchT(5, mean(A.UP), varianceFromMoments(5, ma.sx, ma.sxx), 5, mean(B.UP), varianceFromMoments(5, mb.sx, mb.sxx));
    assert.equal(up.p, w.p);
    assert.ok(up.t > 0);
    assert.ok(de(r).points.find((g) => g.gene === "DOWN")!.effect < 0);
    // labels name both directions; z-scores are compared as stored
    assert.ok(d.labels.includes("UP") && d.labels.includes("DOWN"));
    assert.equal(d.log2, false);
    assert.equal(d.effectLabel, "difference in mean z-score");
    assert.equal(d.gsea, undefined, "geneSets [] skips enrichment");
    assert.match(r.caveat!, /3 genes tested, 2 left out \(fewer than 3 samples/);
    assert.match(r.caveat!, /Z-scores are standardised within each study/);
    // every tested gene is a point or a grid cell, never both, never neither
    const inGrid = d.grid.cells.reduce((a, c) => a + c[2], 0);
    assert.equal(d.points.length + inGrid, d.tested);
  });

  test("q is Benjamini–Hochberg over the tested genes, and up/down count the q < 0.05 genes by sign", async () => {
    const d = de(await run({ label: 0 }, ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }) }, { s1: site({ A, B }) })));
    assert.deepEqual(d.labels, []);
    for (const g of d.points) assert.ok(g.q >= g.p && g.q < 0.05, g.gene);
    assert.equal(d.up + d.down, d.points.filter((g) => g.q < 0.05).length + d.pooledSignificant);
    assert.equal(d.up, 1); assert.equal(d.down, 1);
  });

  test("moments add across sites, so two studies' halves give the same test as one study holding both", async () => {
    const half = (xs: number[], i: number) => xs.filter((_, j) => j % 2 === i);
    const split = (v: Record<string, number[]>, i: number) => Object.fromEntries(Object.entries(v).map(([g, xs]) => [g, half(xs, i)]));
    const one = de(await run({}, ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }) }, { s1: site({ A, B }) })));
    const r = await run({}, ctx({ A: cohort({ s1: 3, s2: 2 }), B: cohort({ s1: 3, s2: 2 }) },
      { s1: site({ A: split(A, 0), B: split(B, 0) }), s2: site({ A: split(A, 1), B: split(B, 1) }) }));
    const two = de(r);
    const up1 = one.points.find((g) => g.gene === "UP")!, up2 = two.points.find((g) => g.gene === "UP")!;
    assert.equal(up2.nA, 5);
    assert.ok(Math.abs(up1.t - up2.t) < 1e-9);
    assert.deepEqual(r.studies, ["s1", "s2"]);
    assert.match(r.caveat!, /pooled across 2 studies with no batch correction/);
  });

  test("a remote participant is left out and said so; log2 defaults on for RNA-seq", async () => {
    const r = await run({ profileType: "rna_seq_v2_mrna" }, ctx({ A: cohort({ s1: 5, p: 4 }), B: cohort({ s1: 5 }) }, { s1: site({ A, B }), p: remote() },
      { s1: ["rna_seq_v2_mrna"] }));
    const d = de(r);
    assert.equal(d.log2, true);
    assert.match(d.effectLabel, /log2 fold change/);
    assert.deepEqual(d.excluded, [{ study: "p", reason: "a remote peer, which does not serve this view's aggregates yet" }]);
    assert.match(r.caveat!, /as log2\(v \+ 1\)/);
    assert.match(r.caveat!, /Left out: p \(a remote peer/);
  });

  test("an explicit log2: false compares as stored, with a plain difference of means", async () => {
    const d = de(await run({ profileType: "protein", log2: false }, ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }) }, { s1: site({ A, B }) }, { s1: ["protein"] })));
    assert.equal(d.log2, false);
    assert.equal(d.effectLabel, "difference in mean value");
  });
});

describe("diffexpr: enrichment", () => {
  // 30 genes, G0 most up in A … G29 most down; each cohort's values spread so every gene has variance
  const genes = Array.from({ length: 30 }, (_, i) => "G" + i);
  const A = Object.fromEntries(genes.map((g, i) => [g, [0, 1, 2, 3].map((k) => (29 - i) / 3 + k * 0.5)]));
  const B = Object.fromEntries(genes.map((g) => [g, [0, 1, 2, 3].map((k) => 5 + k * 0.5)]));
  const TOP = { set_name: "HALLMARK_TOP", genes: genes.slice(0, 10) };

  test("by default every HALLMARK_ set is asked for, ranked by t with the first cohort's higher genes first", async () => {
    const asked: string[] = [];
    const r = await run({ geneSets: undefined }, ctx({ A: cohort({ s1: 4 }), B: cohort({ s1: 4 }) }, { s1: site({ A, B }, [TOP], asked) }));
    const g = de(r).gsea!;
    assert.ok(asked.includes("diffexpr:genesets"));
    assert.ok(asked.some((s) => s.includes("HALLMARK_")), "the default asks for the HALLMARK_ collection");
    assert.equal(g.ranking, "Welch t, A over B");
    assert.equal(g.permutations, 1000);
    assert.equal(g.sets.length, 1);
    assert.equal(g.sets[0].name, "HALLMARK_TOP");
    assert.ok(g.sets[0].nes > 0, "the set of the most up genes is enriched at the top");
    assert.ok(g.sets[0].q >= g.sets[0].p);
    assert.deepEqual(g.skipped, []);
    assert.match(r.caveat!, /preranked GSEA/);
  });

  test("a set with fewer than 10 ranked genes is reported as skipped", async () => {
    const small = { set_name: "HALLMARK_SMALL", genes: genes.slice(0, 4) };
    const g = de(await run({ geneSets: ["hallmark_top", "HALLMARK_SMALL"] }, ctx({ A: cohort({ s1: 4 }), B: cohort({ s1: 4 }) }, { s1: site({ A, B }, [TOP, small]) }))).gsea!;
    assert.deepEqual(g.sets.map((s) => s.name), ["HALLMARK_TOP"]);
    assert.deepEqual(g.skipped, ["HALLMARK_SMALL"]);
  });

  test("a named set the warehouse lacks is refused", async () => {
    const r = await run({ geneSets: ["HALLMARK_NOPE"] }, ctx({ A: cohort({ s1: 4 }), B: cohort({ s1: 4 }) }, { s1: site({ A, B }, []) }));
    assert.match(r.error!, /no MSigDB set named HALLMARK_NOPE in this warehouse/);
  });
});
