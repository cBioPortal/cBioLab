// The oncoprint view's runner (lib/views/oncoprint/run.ts), driven with hand-made participants: its
// columns are patients, so only a patient-level participant (or a peer sharing oncoprint columns)
// draws them, and every other study is named as left out, never silently dropped.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runOncoprint } from "../lib/views/oncoprint/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Fake = Record<string, unknown> & { instance: { id: string; mode: string; label: string; conn: unknown } };
const patientLevel = (extra: Record<string, unknown> = {}): Fake => ({ instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY }, ...extra });
const aggregateOnly = (extra: Record<string, unknown> = {}): Fake => ({ instance: { id: "agg", mode: "aggregate-only", label: "agg site", conn: PRIMARY }, ...extra });

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT '" + st + "_P1' AS patient_id", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});

function ctx(o: { cohorts: Record<string, EvaluatedCohort>; resolvers: Record<string, Fake>; oncoprint?: "svg" | "spec"; defs?: Record<string, unknown> }): ViewRun {
  const vNames = Object.keys(o.cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => o.cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: o.defs ?? Object.fromEntries(vNames.map((n) => [n, { study: o.cohorts[n].studies[0] }])), views: [] } as never,
    cohorts: o.cohorts, resolvers: o.resolvers as never, vNames, vStudies,
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: [], requiresPatientLevel, aggregateOnly: studies.filter((s) => o.resolvers[s].instance.mode !== "patient-level") }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }), oncoprint: o.oncoprint ?? "spec",
  };
}
const unwrap = (r: ViewResult | Untimed): ViewResult => (r instanceof Untimed ? r.result : r);
type Spec = { study: string; studies: string[]; genes: unknown[]; zReference?: Record<string, { mean: number; sd: number; n: number; studies: string[] }>;
  derivedEvents: { label: string }[]; layout: { groupBy: { groups: { name: string }[] } } };

describe("oncoprint: who may draw columns", () => {
  test("no patient-level participant: refused untimed, naming the aggregate-only studies and the patients left out", async () => {
    const r = await runOncoprint({ kind: "oncoprint", genes: ["TP53"] } as never,
      ctx({ cohorts: { A: cohort({ s1: 4, s2: 6 }) }, resolvers: { s1: aggregateOnly(), s2: aggregateOnly() } }));
    assert.ok(r instanceof Untimed, "a refusal before any answer is untimed");
    const v = r.result;
    assert.match(v.error!, /no participating instance permits patient-level access/);
    assert.match(v.error!, /s1, s2 answer with aggregates only/);
    assert.match(v.error!, /all 10 patients/);
    assert.equal(v.participation!.requiresPatientLevel, true);
  });

  test("more than 12 gene rows is refused, naming gene rows", async () => {
    const genes = Array.from({ length: 13 }, (_, i) => "G" + i);
    const v = unwrap(await runOncoprint({ kind: "oncoprint", genes } as never, ctx({ cohorts: { A: cohort({ s1: 3 }) }, resolvers: { s1: patientLevel() } })));
    assert.match(v.error!, /at most 12 gene rows/);
  });

  test("more than 3 derived-cohort rows is refused, naming derived-cohort rows", async () => {
    const v = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["TP53"], derivedCohorts: ["a", "b", "c", "d"] } as never,
      ctx({ cohorts: { A: cohort({ s1: 3 }) }, resolvers: { s1: patientLevel() } })));
    assert.match(v.error!, /at most 3 derived-cohort rows/);
  });
});

describe("oncoprint: the spec the page draws from", () => {
  test("one patient-level study: the spec carries cohort definitions, never SQL, and no cross-study note", async () => {
    const defs = { A: { study: "s1", all: [{ kind: "oql", q: "TP53: MUT" }] }, B: { study: "s1" } };
    const r = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["TP53", "KRAS"], derivedCohorts: ["A", "missing"] } as never,
      ctx({ cohorts: { A: cohort({ s1: 3 }), B: cohort({ s1: 5 }) }, resolvers: { s1: patientLevel() }, defs })));
    const spec = (r as { spec: Spec }).spec;
    assert.equal(spec.study, "s1");
    assert.deepEqual(spec.studies, ["s1"]);
    assert.deepEqual(spec.genes, ["TP53", "KRAS"]);
    assert.deepEqual(spec.layout.groupBy.groups.map((g) => g.name), ["A", "B"]);
    assert.deepEqual(spec.derivedEvents.map((d) => d.label), ["A"], "only cohorts the document defines become rows");
    assert.equal(JSON.stringify(spec).includes("SELECT"), false, "compiled SQL never leaves the server");
    assert.equal(r.note, undefined);
    assert.equal(r.studies, undefined);
  });

  test("an aggregate-only study beside a patient-level one: columns cover only the drawable patients, and the note says how many of how many", async () => {
    const r = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["TP53"] } as never,
      ctx({ cohorts: { A: cohort({ s1: 3, s2: 7 }) }, resolvers: { s1: patientLevel(), s2: aggregateOnly() } })));
    assert.deepEqual(r.studies, ["s1"]);
    assert.match(r.note!, /^columns cover 3 of 10 patients: s2 answer with aggregates only/);
  });

  test("two patient-level studies: a cross-study note naming both, and duplicates are not deduplicated", async () => {
    const r = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["TP53"] } as never,
      ctx({ cohorts: { A: cohort({ s1: 2, s2: 2 }) }, resolvers: { s1: patientLevel(), s2: patientLevel() } })));
    assert.deepEqual(r.studies, ["s1", "s2"]);
    assert.match(r.note!, /^cross-study oncoprint \(s1, s2\): duplicate patients across studies appear as separate columns/);
  });

  test("three patient-level studies plus a withheld one: counted, not listed, then the withheld share after a dash", async () => {
    const r = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["TP53"] } as never,
      ctx({ cohorts: { A: cohort({ s1: 1, s2: 1, s3: 1, s4: 5 }) }, resolvers: { s1: patientLevel(), s2: patientLevel(), s3: patientLevel(), s4: aggregateOnly() } })));
    assert.match(r.note!, /^cross-study oncoprint across 3 studies:/);
    assert.match(r.note!, / — columns cover 3 of 8 patients: s4 answer/);
  });

  test("a peer sharing oncoprint columns draws them, and is named as reached via federation", async () => {
    const peer = aggregateOnly({ oncoprintInputs: async () => ({}) });
    peer.instance.label = "Peer Hospital (shares oncoprint)";
    const r = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["TP53"] } as never,
      ctx({ cohorts: { A: cohort({ p1: 4 }) }, resolvers: { p1: peer } })));
    assert.equal(r.error, undefined);
    assert.match(r.note!, /^the columns of p1 come from Peer Hospital, via federation$/);
  });
});

describe("oncoprint: a federation z-score reference pooled from every participant", () => {
  // site s1 (draws columns): values 1, 2, 3 → n 3, sum 6, sumsq 14; site s2 (aggregate-only): 5, 7 → n 2, sum 12, sumsq 74.
  // Pooled: n 5, mean 18/5 = 3.6; sample variance (Σx² − n·mean²)/(n−1) = (88 − 64.8)/4 = 5.8.
  const moments: Record<string, { gene: string; n: number; sum: number; sumsq: number }[]> = {
    s1: [{ gene: "TP53", n: 3, sum: 6, sumsq: 14 }, { gene: "KRAS", n: 2, sum: 2, sumsq: 2 }, { gene: "EGFR", n: 4, sum: 8, sumsq: 16 }],
    s2: [{ gene: "TP53", n: 2, sum: 12, sumsq: 74 }, { gene: "KRAS", n: 0, sum: 0, sumsq: 0 }],
  };
  const resolvers = () => ({
    s1: patientLevel({ profileMoments: async (_d: unknown, genes: string[]) => moments.s1.filter((m) => genes.includes(m.gene)) }),
    s2: aggregateOnly({ profileMoments: async (_d: unknown, genes: string[]) => moments.s2.filter((m) => genes.includes(m.gene)) }),
  });

  test("the aggregate-only site shapes the reference though it draws no column; too few or constant values define none", async () => {
    const view = { kind: "oncoprint", genes: ["TP53", "KRAS", "EGFR"], heatmap: [
      { profileType: "mrna", reference: "federation" },
      { profileType: "VAF", reference: "federation" },            // allele fractions are never z-scored
      { profileType: "ga", reference: "federation", entities: ["SBS4"] }, // a generic assay's entities are not genes
      { profileType: "other" },                                   // the default reference: the cohort
    ] };
    const r = unwrap(await runOncoprint(view as never, ctx({ cohorts: { A: cohort({ s1: 3, s2: 2 }) }, resolvers: resolvers() })));
    const z = (r as { spec: Spec }).spec.zReference!;
    assert.deepEqual(Object.keys(z), ["mrna|TP53"], "KRAS has n 2 < 3; EGFR's four values are all 2, sd 0");
    assert.equal(z["mrna|TP53"].n, 5);
    assert.ok(Math.abs(z["mrna|TP53"].mean - 3.6) < 1e-12);
    assert.ok(Math.abs(z["mrna|TP53"].sd - Math.sqrt(5.8)) < 1e-12);
    assert.deepEqual(z["mrna|TP53"].studies, ["s1", "s2"]);
  });

  test("a heatmap's own genes are scored instead of the gene rows; no reference at all leaves zReference out", async () => {
    const r = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["KRAS"], heatmap: [{ profileType: "mrna", reference: "federation", genes: ["TP53"] }] } as never,
      ctx({ cohorts: { A: cohort({ s1: 3, s2: 2 }) }, resolvers: resolvers() })));
    assert.deepEqual(Object.keys((r as { spec: Spec }).spec.zReference!), ["mrna|TP53"]);
    const none = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["KRAS"], heatmap: [{ profileType: "mrna", reference: "federation" }] } as never,
      ctx({ cohorts: { A: cohort({ s1: 3, s2: 2 }) }, resolvers: resolvers() })));
    assert.equal((none as { spec: Spec }).spec.zReference, undefined);
  });

  test("a heatmap with no genes to score asks nobody", async () => {
    let asked = 0;
    const s1 = patientLevel({ profileMoments: async () => { asked++; return []; } });
    await runOncoprint({ kind: "oncoprint", genes: [], heatmap: [{ profileType: "mrna", reference: "federation" }] } as never,
      ctx({ cohorts: { A: cohort({ s1: 3 }) }, resolvers: { s1 } }));
    assert.equal(asked, 0);
  });

  test("a site that fails its moments fails the view, rather than shifting every z-score", async () => {
    const s2 = aggregateOnly({ profileMoments: async () => { throw new Error("site down"); } });
    await assert.rejects(runOncoprint({ kind: "oncoprint", genes: ["TP53"], heatmap: [{ profileType: "mrna", reference: "federation" }] } as never,
      ctx({ cohorts: { A: cohort({ s1: 3, s2: 2 }) }, resolvers: { s1: resolvers().s1, s2 } })), /site down/);
  });
});

describe("oncoprint: the server-drawn figure", () => {
  // The columns come from a federation peer (FEDERATION_PEERS), answered over a stubbed fetch, so no
  // warehouse is asked: P1 has a TP53 missense and P2 a KRAS amplification, P3 is unaltered; all
  // three are profiled for both genes. TP53 is altered in 1 of 3 profiled patients (33.3%), KRAS in 1 of 3.
  const URL_ = "http://peer.invalid/api/federation/v1";
  const SHARE = {
    study: "p1", genes: ["TP53", "KRAS"], groups: [["P1", "P2", "P3"]],
    events: [["P1", "TP53", "mutation", "Missense_Mutation", "R175H", ""], ["P2", "KRAS", "cna", "", "", "2"]],
    coverage: [["P1", 3], ["P2", 3], ["P3", 3]], facts: [["P1", 1, 7], ["P2", 2, 7], ["P3", 1, 1]],
    clinical: [], heatmap: [], overlays: [], profileTypes: ["mutations"], assays: [],
    queries: [{ label: "oncoprint:columns", sql: "SELECT 1", ms: 3 }],
  };
  const ENV: Record<string, string> = { FEDERATION_PEERS: "p1=" + URL_, FEDERATION_ACCEPT_PATIENT_LEVEL: "p1:oncoprint", ONCOKB_PIN: "test-pin" };

  test("an SVG with its column count, per-gene percentages and the peer's queries, logged as remote", async () => {
    const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
    Object.assign(process.env, ENV);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(SHARE), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const peer = aggregateOnly({ oncoprintInputs: async () => SHARE });
      peer.instance.label = "Peer";
      const r = unwrap(await runOncoprint({ kind: "oncoprint", genes: ["TP53", "KRAS"], display: { annotate: "none" } } as never,
        ctx({ cohorts: { A: cohort({ p1: 3 }) }, resolvers: { p1: peer }, oncoprint: "svg", defs: { A: { study: "p1" } } })));
      assert.equal(r.error, undefined, String(r.error));
      const v = r as ViewResult & { svg: string; nColumns: number; genes: { gene: string; anyPct: number | null }[] };
      assert.ok(v.svg.startsWith("<svg"));
      assert.equal(v.nColumns, 3);
      assert.deepEqual(v.genes.map((g) => g.gene), ["TP53", "KRAS"]);
      for (const g of v.genes) assert.ok(Math.abs(g.anyPct! - 100 / 3) < 0.1, g.gene + " " + g.anyPct);
      assert.ok(v.queries!.some((q) => q.remote && q.study === "p1"), "the peer's queries are named as run there");
      assert.ok(typeof v.renderMs === "number");
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, val] of Object.entries(saved)) { if (val == null) delete process.env[k]; else process.env[k] = val; }
    }
  });
});
