// The pathways view's runner (lib/views/pathways/run.ts), driven with hand-made participants: per
// pathway the share of a cohort's profiled samples with a member altered, its most-altered members
// with their own panel-aware denominators, and between two cohorts Fisher tests with BH q
// (lib/views/pathways/doc.ts, types.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPathways } from "../lib/views/pathways/run.ts";
import { fisherExact, benjaminiHochberg } from "../lib/stats.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { PathwaysResult } from "../lib/views/pathways/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type GC = { profiled: number; altered: number; driver: number };
/** per cohort name: gene → counts, and set name → {profiled, altered, driver} */
type CohortData = { genes: Record<string, GC>; sets: Record<string, GC> };

function participant(id: string, data: Record<string, CohortData>) {
  return {
    instance: { id, mode: "patient-level", label: id, conn: PRIMARY },
    async geneCounts(def: { name: string }, genes: string[]) {
      const d = data[def.name]?.genes ?? {};
      return genes.filter((g) => d[g]).map((g) => ({ gene: g, ...d[g] }));
    },
    async viewAggregate(name: string, def: { name: string }, build: (c: string, s: string, d: string) => unknown) {
      build("SELECT 1 AS pid, 's1' AS sid", id, "db");
      assert.equal(name, "pathways:sets:" + def.name);
      return Object.entries(data[def.name]?.sets ?? {}).map(([set_name, c]) => ({ set_name, ...c }));
    },
  };
}
const remote = (id: string) => ({ instance: { id, mode: "aggregate-only", label: id, conn: PRIMARY } });

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});

function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>, pin: string | null = "v4.20"): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0], name: n }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const pw = (r: ViewResult) => (r as unknown as { pathways: PathwaysResult }).pathways;
const run = (view: Record<string, unknown>, c: ViewRun) => runPathways({ kind: "pathways", ...view } as never, c);
const gc = (profiled: number, altered: number, driver: number): GC => ({ profiled, altered, driver });

// TP53 pathway (TP53 MDM2 MDM4 ATM CHEK2 RPS6KA3): RPS6KA3 on no panel
const TP53_A: CohortData = {
  genes: { TP53: gc(100, 50, 40), MDM2: gc(100, 10, 8), MDM4: gc(80, 4, 2), ATM: gc(100, 6, 1), CHEK2: gc(90, 0, 0) },
  sets: { TP53: gc(100, 60, 45) },
};
const TP53_B: CohortData = {
  genes: { TP53: gc(100, 10, 5), MDM2: gc(100, 12, 10), MDM4: gc(80, 3, 3), ATM: gc(100, 5, 2), CHEK2: gc(90, 1, 1) },
  sets: { TP53: gc(100, 25, 15) },
};

describe("pathways: refusals", () => {
  const one = () => ctx({ A: cohort({ s1: 100 }) }, { s1: participant("s1", { A: TP53_A }) });
  const err = async (view: Record<string, unknown>, c = one()) => (await run(view, c)).error!;
  test("at most four cohorts", async () => {
    const c = ctx(Object.fromEntries(["A", "B", "C", "D", "E"].map((n) => [n, cohort({ s1: 5 })])), { s1: participant("s1", {}) });
    assert.match(await err({}, c), /at most 4 cohorts; this asks for 5/);
  });
  test("measure, pin and topGenes", async () => {
    assert.match(await err({ measure: "vus" }), /measure is "driver" or "any"; got "vus"/);
    assert.match(await err({}, ctx({ A: cohort({ s1: 100 }) }, { s1: participant("s1", { A: TP53_A }) }, null)), /no OncoKB annotation pin.*measure: "any"/);
    assert.match(await err({ topGenes: 0 }), /topGenes is 1 to 12; got 0/);
    assert.match(await err({ topGenes: 13 }), /topGenes is 1 to 12; got 13/);
  });
  test("an unknown pathway names the canonical ten", async () => {
    assert.match(await err({ pathways: ["TP53", "Apoptosis"] }), /unknown pathway “Apoptosis” — the canonical ten are RTK-RAS, PI3K, TP53, .*; use sets for your own/);
  });
  test("custom sets: count, name, genes, size, symbols, duplicate names", async () => {
    const s = (name: string, genes: string[]) => ({ name, genes });
    assert.match(await err({ sets: Array.from({ length: 5 }, (_, i) => s("S" + i, ["TP53"])) }), /at most 4 custom sets/);
    assert.match(await err({ sets: [s(" ", ["TP53"])] }), /set 1 needs a name/);
    assert.match(await err({ sets: [s("Mine", [])] }), /set “Mine” has no genes/);
    assert.match(await err({ sets: [s("Big", Array.from({ length: 41 }, (_, i) => "G" + i))] }), /at most 40 genes; this asks for 41.*\(set “Big”\)/);
    assert.match(await err({ sets: [s("Bad", ["tp53", "not-ok!", "_X"])] }), /not a gene symbol: NOT-OK!, _X \(set “Bad”\)/);
    assert.match(await err({ sets: [s("TP53", ["TP53"])] }), /two sets are named “TP53”/);
    assert.match(await err({ sets: [s("Mine", ["TP53"]), s("Mine", ["KRAS"])] }), /two sets are named “Mine”/);
  });
  test("nothing to draw", async () => assert.match(await err({ pathways: [] }), /no pathway or set to draw/));
  test("empty cohorts are named (the genes are not the problem), and no answering participant", async () => {
    const one0 = ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 3 }) }, { s1: participant("s1", {}) });
    assert.match(await err({}, one0), /cohort “A” is empty — check its definition/);
    const two0 = ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 0 }) }, { s1: participant("s1", {}) });
    assert.match(await err({}, two0), /cohort “A” and “B” are empty/);
    assert.match(await err({}, ctx({ A: cohort({ r1: 3 }) }, { r1: remote("r1") })), /no participant can answer: r1 is a remote peer/);
  });
  test("no sample profiled for any member gene", async () => {
    const r = await run({ pathways: ["TP53"] }, ctx({ A: cohort({ s1: 100 }) }, { s1: participant("s1", {}) }));
    assert.equal(r.error, "no sample in this cohort was profiled for any gene in these pathways");
  });
});

describe("pathways: one cohort", () => {
  test("drivers: the pathway's share over its own denominator, the top members, the rest pooled, the unprofiled listed", async () => {
    const r = await run({ pathways: ["TP53"], topGenes: 2 }, ctx({ A: cohort({ s1: 100 }) }, { s1: participant("s1", { A: TP53_A }) }));
    const o = pw(r);
    assert.equal(o.measure, "driver");
    assert.equal(r.annotation, "OncoKB v4.20");
    const row = o.rows[0];
    assert.equal(row.name, "TP53"); assert.equal(row.source, "Sanchez-Vega 2018");
    assert.deepEqual(row.cells, [{ cohort: "A", profiled: 100, altered: 45, pct: 45 }]);
    assert.equal(row.genes, 6); assert.equal(row.profiledGenes, 5);
    assert.deepEqual(row.top.map((t) => [t.gene, t.role, t.cells[0].pct]), [["TP53", "TSG", 40], ["MDM2", "OG", 8]]);
    assert.equal(row.otherAltered, 2, "MDM4 and ATM are altered but not drawn; CHEK2 is not altered");
    assert.deepEqual(row.notProfiled, ["RPS6KA3"]);
    assert.equal(row.p, undefined);
    assert.match(r.caveat!, /OncoKB driver \(v4\.20\)/);
    assert.match(r.caveat!, /1 member-gene slots were on no participating panel/);
    assert.doesNotMatch(r.caveat!, /Fisher/);
    assert.ok(r.method, "a method record");
  });

  test("measure any counts every alteration; a custom set is drawn after the canonical ones", async () => {
    const data: CohortData = { genes: { ...TP53_A.genes, KRAS: gc(50, 20, 18) }, sets: { TP53: gc(100, 60, 45), Mine: gc(50, 20, 18) } };
    const r = await run({ pathways: ["TP53"], measure: "any", sets: [{ name: "Mine", genes: ["kras", "KRAS", "NRAS"] }] },
      ctx({ A: cohort({ s1: 100 }) }, { s1: participant("s1", { A: data }) }, null));
    const o = pw(r);
    assert.equal(r.annotation, undefined);
    assert.deepEqual(o.rows.map((x) => [x.name, x.source, x.cells[0].altered]), [["TP53", "Sanchez-Vega 2018", 60], ["Mine", "document", 20]]);
    const mine = o.rows[1];
    assert.equal(mine.genes, 2, "duplicate members count once");
    assert.deepEqual(mine.top.map((t) => [t.gene, t.role, t.cells[0].pct]), [["KRAS", null, 40]]);
    assert.deepEqual(mine.notProfiled, ["NRAS"]);
    assert.deepEqual(o.rows[0].top.map((t) => t.gene).slice(0, 2), ["TP53", "MDM2"]);
    assert.match(r.caveat!, /any alteration .* drivers or not/);
  });

  test("a set no sample was profiled for has no percentage", async () => {
    const r = await run({ pathways: ["TP53", "NRF2"] }, ctx({ A: cohort({ s1: 100 }) }, { s1: participant("s1", { A: TP53_A }) }));
    const nrf2 = pw(r).rows.find((x) => x.name === "NRF2")!;
    assert.deepEqual(nrf2.cells, [{ cohort: "A", profiled: 0, altered: 0, pct: null }]);
    assert.deepEqual(nrf2.notProfiled, ["NFE2L2", "KEAP1", "CUL3"]);
  });
});

describe("pathways: two cohorts and several studies", () => {
  test("Fisher per pathway and per member gene, BH q across pathways and across genes", async () => {
    const r = await run({ pathways: ["TP53", "NRF2"] }, ctx({ A: cohort({ s1: 100 }), B: cohort({ s1: 100 }) }, { s1: participant("s1", { A: TP53_A, B: TP53_B }) }));
    const [tp53, nrf2] = pw(r).rows;
    const p = fisherExact(45, 55, 15, 85);
    assert.equal(tp53.p, p);
    assert.equal(tp53.q, p, "the only pathway tested: q equals p");
    assert.equal(nrf2.p, undefined, "unprofiled in both: not tested");
    // genes tested: every member profiled in both
    const genes = ["TP53", "MDM2", "MDM4", "ATM", "CHEK2"];
    const ps = genes.map((g) => { const a = TP53_A.genes[g], b = TP53_B.genes[g]; return fisherExact(a.driver, a.profiled - a.driver, b.driver, b.profiled - b.driver); });
    const qs = benjaminiHochberg(ps);
    for (const t of tp53.top) assert.equal(t.q, qs[genes.indexOf(t.gene)], t.gene);
    assert.equal(tp53.top[0].gene, "TP53");
    assert.ok(tp53.top[0].q! < 0.001);
    assert.match(r.caveat!, /Two-sided Fisher tests; q is Benjamini–Hochberg/);
    assert.ok(r.method);
  });

  test("a cohort's counts add across its studies; a remote peer is left out and named", async () => {
    const r = await run({ pathways: ["TP53"], measure: "any" }, ctx({ A: cohort({ s1: 100, s2: 100, r1: 5 }) },
      { s1: participant("s1", { A: TP53_A }), s2: participant("s2", { A: TP53_B }), r1: remote("r1") }));
    const o = pw(r);
    assert.deepEqual(o.rows[0].cells, [{ cohort: "A", profiled: 200, altered: 85, pct: 42.5 }]);
    assert.deepEqual(o.rows[0].top[0].cells[0], { cohort: "A", profiled: 200, altered: 60, pct: 30 });
    assert.deepEqual(o.excluded, [{ study: "r1", reason: "a remote peer, which does not serve this view's aggregates yet" }]);
    assert.deepEqual(r.studies, ["s1", "s2", "r1"]);
    assert.match(r.caveat!, /summed across 3 studies; overlap is not deduplicated/);
    assert.match(r.caveat!, /Left out: r1/);
  });
});
