// The germline view's runner (lib/views/germline/run.ts), driven with hand-made participants: per
// gene, carriers of a GERMLINE call among the patients sequenced for the gene, their somatic second
// hits against non-carriers' rate (Fisher, BH per cohort), and optionally OS by carrier status
// (lib/views/germline/types.ts). The per-row arithmetic (germAdd) is in test/germline.test.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGermline } from "../lib/views/germline/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { GermlineResult } from "../lib/views/germline/types.ts";
import { fisherExact } from "../lib/stats.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
type Answers = { carriers?: Row[]; counts?: Row[]; survival?: Row[]; ascn?: Row[] | Error };
type Fake = Record<string, unknown>;

/** a site answering each of the view's queries from `a`, recording the labels and genes asked for */
function site(a: Answers, asked: string[] = [], sql: string[] = []): Fake {
  return {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    // a resolver builds the statement for its own study and database before running it
    viewAggregate: async (label: string, _def: unknown, build: (c: string, s: string, d: string) => string) => {
      asked.push(label);
      sql.push(build("SELECT 1 AS pid", "s1", "db"));
      if (label.startsWith("germline:carriers:")) return a.carriers ?? [];
      if (label.startsWith("germline:counts:")) return a.counts ?? [];
      if (label.startsWith("germline:survival:")) return a.survival ?? [];
      throw new Error("unexpected " + label);
    },
    viewMeta: async (label: string, build: (s: string, d: string) => string) => {
      asked.push(label);
      sql.push(build("s1", "db"));
      if (a.ascn instanceof Error) throw a.ascn;
      return a.ascn ?? [];
    },
  };
}
const remote = (): Fake => ({ instance: { id: "peer", mode: "aggregate-only", label: "peer", conn: PRIMARY } });

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
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies, requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const germ = (r: ViewResult) => (r as unknown as { germline: GermlineResult }).germline;
const run = (view: Record<string, unknown>, c: ViewRun) => runGermline({ kind: "germline", ...view } as never, c);
const one = (a: Answers, n = 20) => ctx({ A: cohort({ s1: n }) }, { s1: site(a) });

// BRCA2: 4 sequenced carriers, 3 with a second hit (2 somatic, 1 deep deletion); 16 sequenced non-carriers, 2 with a somatic hit;
// 1 carrier whose panel lacks the gene. TP53: 1 carrier.
const COUNTS: Row[] = [
  { gene: "BRCA2", mp: 1, carrier: 1, som: 1, cp: 1, del: 0, n: 2 },
  { gene: "BRCA2", mp: 1, carrier: 1, som: 0, cp: 1, del: 1, n: 1 },
  { gene: "BRCA2", mp: 1, carrier: 1, som: 0, cp: 0, del: 0, n: 1 },
  { gene: "BRCA2", mp: 1, carrier: 0, som: 1, cp: 1, del: 0, n: 2 },
  { gene: "BRCA2", mp: 1, carrier: 0, som: 0, cp: 1, del: 0, n: 14 },
  { gene: "BRCA2", mp: 0, carrier: 1, som: 0, cp: 0, del: 0, n: 1 },
  { gene: "TP53", mp: 1, carrier: 1, som: 1, cp: 0, del: 0, n: 1 },
  { gene: "TP53", mp: 1, carrier: 0, som: 1, cp: 0, del: 0, n: 5 },
  { gene: "OTHER", mp: 1, carrier: 1, som: 1, cp: 0, del: 0, n: 9 },
];
const CARRIERS: Row[] = [{ gene: "BRCA2", carriers: 4 }, { gene: "TP53", carriers: 1 }, { gene: "ATM", carriers: 3 }];

describe("germline: refusals", () => {
  const err = async (view: Record<string, unknown>, c = one({ carriers: CARRIERS })) => {
    const r = await run(view, c);
    assert.ok(r.error, "expected a refusal");
    return r.error;
  };
  test("more than 4 cohorts", async () => {
    const five = Object.fromEntries(["A", "B", "C", "D", "E"].map((n) => [n, cohort({ s1: 3 })]));
    assert.match(await err({}, ctx(five, { s1: site({}) })), /at most 4 cohorts; this asks for 5/);
  });
  test("minCarriers outside 1..10000", async () => {
    assert.equal(await err({ minCarriers: 0 }), "minCarriers is 1 to 10000");
    assert.equal(await err({ minCarriers: 10001 }), "minCarriers is 1 to 10000");
  });
  test("more than 60 genes, or one that is not a gene symbol", async () => {
    assert.match(await err({ genes: Array.from({ length: 61 }, (_, i) => "G" + i) }), /at most 60 genes; this asks for 61/);
    assert.equal(await err({ genes: ["BRCA2", "bad gene"] }), "'BAD GENE' is not a gene symbol");
    assert.equal(await err({ survival: { gene: "no good" } }), "survival.gene 'NO GOOD' is not a gene symbol");
  });
  test("every cohort empty", async () => {
    assert.equal(await err({}, one({}, 0)), "nothing to count: the cohort is empty");
    assert.equal(await err({}, ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 0 }) }, { s1: site({}) })), "nothing to count: every cohort is empty");
  });
  test("no participant serves the aggregates", async () =>
    assert.match(await err({}, ctx({ A: cohort({ p: 3 }) }, { p: remote() })), /no participant can answer: p is a remote peer/));
  test("no germline call at all", async () => {
    assert.match(await err({}, one({ carriers: [] })), /no patient of “A” has a germline call/);
    assert.match(await err({}, ctx({ A: cohort({ s1: 3 }), B: cohort({ s1: 3 }) }, { s1: site({}) })), /no patient of these cohorts has a germline call/);
  });
  test("no gene reaches minCarriers: the most-carried genes are listed", async () =>
    assert.equal(await err({ minCarriers: 5 }), "no gene has 5 or more germline carriers in a cohort; the most are BRCA2 (4), ATM (3), TP53 (1)"));
  test("too many genes reach minCarriers", async () => {
    const many = Array.from({ length: 61 }, (_, i) => ({ gene: "G" + i, carriers: 3 }));
    assert.match(await err({}, one({ carriers: many })), /61 genes have 3 or more carriers; .* at most 60 genes; .* raise minCarriers or name the genes/);
  });
});

describe("germline: counts and the second-hit test", () => {
  test("default genes are those with ≥ minCarriers carriers, most carried first; counts are among the sequenced only", async () => {
    const asked: string[] = [];
    const r = await run({}, ctx({ A: cohort({ s1: 20 }) }, { s1: site({ carriers: CARRIERS, counts: COUNTS }, asked) }));
    const g = germ(r);
    assert.equal(r.error, undefined);
    assert.deepEqual(g.genes, ["BRCA2", "ATM"]);
    assert.equal(g.minCarriers, 3);
    assert.equal(g.chosen, "every gene with ≥ 3 carriers");
    const [p] = g.panels;
    assert.equal(p.cohort, "A"); assert.equal(p.patients, 20);
    const brca2 = p.genes.find((x) => x.gene === "BRCA2")!;
    assert.deepEqual({ ...brca2, p: undefined, q: undefined }, {
      gene: "BRCA2", sequenced: 20, carriers: 4, outsidePanel: 1, carrierSomatic: 2, carrierCnaProfiled: 3, carrierDeletion: 1, carrierEither: 3,
      noncarriers: 16, noncarrierSomatic: 2, noncarrierCnaProfiled: 16, noncarrierDeletion: 0, noncarrierEither: 2, p: undefined, q: undefined });
    assert.equal(brca2.p, fisherExact(3, 1, 2, 14));
    // a gene with no rows: no carriers, so no test
    const atm = p.genes.find((x) => x.gene === "ATM")!;
    assert.equal(atm.carriers, 0); assert.equal(atm.p, null); assert.equal(atm.q, null);
    // with one gene tested, BH leaves its p unchanged
    assert.equal(brca2.q, brca2.p);
    assert.equal(p.genes[0].gene, "BRCA2", "sorted by carriers");
    assert.ok(!asked.some((l) => l.startsWith("germline:survival")), "no survival asked without survival.gene");
    assert.equal(g.survival, undefined);
    assert.equal(g.loh, "not assessed");
    assert.match(r.caveat!, /1 carrier whose tumour panel does not list the gene are left out/);
  });

  test("named genes are used as given (trimmed, uppercased, deduplicated), with no 'chosen'", async () => {
    const sql: string[] = [];
    const g = germ(await run({ genes: [" tp53", "TP53", "brca2"] }, ctx({ A: cohort({ s1: 20 }) }, { s1: site({ carriers: CARRIERS, counts: COUNTS }, [], sql) })));
    assert.ok(sql.some((s) => /count\(\) AS n/.test(s) && s.includes("'TP53'") && s.includes("'BRCA2'")), "the counts query names exactly the genes asked for");
    assert.deepEqual(g.genes, ["TP53", "BRCA2"]);
    assert.equal(g.chosen, undefined);
    const tp53 = g.panels[0].genes.find((x) => x.gene === "TP53")!;
    assert.equal(tp53.carriers, 1); assert.equal(tp53.noncarriers, 5);
    assert.ok(g.panels[0].genes.every((x) => x.gene !== "OTHER"), "rows of genes not asked for are ignored");
  });

  test("with nothing outside a panel the caveat says so; FACETS studies are named for LOH; a failing ascn lookup is not fatal", async () => {
    const counts = COUNTS.filter((r) => r.mp);
    const r = await run({ genes: ["BRCA2"] }, one({ carriers: CARRIERS, counts, ascn: [{ study: "s1" }] }));
    assert.match(r.caveat!, /none fell outside a panel/);
    assert.match(germ(r).loh, /^not used; s1 has allele-specific copy number/);
    const failed = await run({ genes: ["BRCA2"] }, one({ carriers: CARRIERS, counts, ascn: new Error("no table") }));
    assert.equal(failed.error, undefined);
    assert.equal(germ(failed).loh, "not assessed");
  });

  test("several studies: counts summed per cohort, studies listed, the remote one left out", async () => {
    const c = ctx({ A: cohort({ s1: 20, s2: 20, p: 5 }), B: cohort({ s2: 20 }) },
      { s1: site({ carriers: CARRIERS, counts: COUNTS }), s2: site({ carriers: CARRIERS, counts: COUNTS }), p: remote() });
    const r = await run({ genes: ["BRCA2"] }, c);
    const g = germ(r);
    assert.deepEqual(g.panels.map((p) => [p.cohort, p.genes[0].carriers]), [["A", 8], ["B", 4]]);
    assert.deepEqual(r.studies, ["s1", "s2", "p"]);
    assert.deepEqual(g.excluded, [{ study: "p", reason: "a remote peer, which does not serve this view's aggregates yet" }]);
    assert.match(r.caveat!, /summed across 3 studies; overlap is not deduplicated/);
    assert.match(r.caveat!, /Left out: p/);
  });
});

describe("germline: survival by carrier status", () => {
  const surv = (carrier: number, n: number, t: number, dead: number) => ({ carrier, n, t, dead });
  test("a survival gene not among the genes is added; KM per group and a log-rank when each has ≥ 5", async () => {
    const survival = [surv(1, 3, 10, 1), surv(1, 3, 20, 0), surv(0, 4, 30, 1), surv(0, 4, 50, 0)];
    const asked: string[] = [];
    const r = await run({ genes: ["TP53"], survival: { gene: "brca2" } }, ctx({ A: cohort({ s1: 20 }) }, { s1: site({ carriers: CARRIERS, counts: COUNTS, survival }, asked) }));
    const g = germ(r);
    assert.deepEqual(g.genes, ["TP53", "BRCA2"]);
    assert.ok(asked.includes("germline:survival:A"));
    const [s] = g.survival!;
    assert.equal(s.gene, "BRCA2");
    assert.deepEqual(s.curves.map((c) => c.group), ["BRCA2 carriers", "non-carriers"]);
    assert.ok(s.logrank, "6 carriers and 8 non-carriers are enough to test");
    assert.equal(s.noTest, undefined);
    assert.match(r.caveat!, /Overall survival of the patients sequenced for BRCA2/);
  });
  test("fewer than 5 in a group: curves but no test, and why", async () => {
    const survival = [surv(1, 2, 10, 1), surv(0, 6, 30, 1)];
    const [s] = germ(await run({ genes: ["BRCA2"], survival: { gene: "BRCA2" } }, one({ carriers: CARRIERS, counts: COUNTS, survival }))).survival!;
    assert.equal(s.logrank, null);
    assert.equal(s.noTest, "fewer than 5 patients with OS in a group (2 carriers, 6 non-carriers)");
  });
});
