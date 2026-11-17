// A scatter over several studies reports Spearman's rho over the pooled pairs, ranked as one set with
// tied values sharing their average rank, as the portal does client-side (PLT-STM-5, PLT-STM-6,
// PLT-MD-2), whenever every site can hand over its pairs; Pearson's r over the pooled sums is
// reported unrounded. The resolvers are fakes holding each site's pairs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot/run.ts";
import { spearmanRho } from "../lib/plot.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResultOf } from "../lib/types.ts";

const near = (got: number | null | undefined, want: number, tol: number, what: string) =>
  assert.ok(got != null && Math.abs(got - want) <= tol, what + ": " + got + " is not " + want);
const nearRel = (got: number | null | undefined, want: number, rel: number, what: string) =>
  assert.ok(got != null && Math.abs(got - want) <= rel * Math.abs(want), what + ": " + got + " is not " + want);

describe("spearmanRho: Pearson's r of the average ranks", () => {
  const S1x = [1, 2, 2, 3, 4, 4, 4, 7], S1y = [2, 1, 3, 3, 5, 0, 5, 9];
  const cases: [string, number[], number[], number | null][] = [
    ["S1", S1x, S1y, 0.5777400584843706],
    ["S2", [...S1x].reverse(), [...S1y].reverse(), 0.5777400584843706],
    ["S3", [1, 2, 3, 4, 5], [1, 4, 9, 16, 25], 1],
    ["S4", [1, 2], [3, 1], -1],
    ["S5", [3, 3, 3], [1, 2, 3], null],
    ["S6", [1], [1], null],
    ["S7", [], [], null],
  ];
  for (const [id, x, y, want] of cases) {
    test(id + ": x " + JSON.stringify(x) + ", y " + JSON.stringify(y), () => {
      const ix = [...x], iy = [...y];
      const got = spearmanRho(x, y);
      assert.deepEqual(x, ix, "x is not reordered in place"); assert.deepEqual(y, iy, "y is not reordered in place");
      if (want === null) { assert.equal(got, null); return; }
      near(got, want, 1e-12, "rho");
    });
  }
});

type Pair = [number, number];

/** the six sums of a site's pairs, as its plot:moments query returns them */
function momentsOf(pairs: Pair[]) {
  return pairs.reduce((a, [x, y]) => ({ n: a.n + 1, sx: a.sx + x, sy: a.sy + y, sxy: a.sxy + x * y, sxx: a.sxx + x * x, syy: a.syy + y * y }),
    { n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 });
}

/** a site of a pooled scatter: patient-level hands over its pairs (or null past its cap), aggregate-only only its sums and cells */
function site(name: string, mode: "patient-level" | "aggregate-only", pairs: Pair[], o: { pastCap?: boolean } = {}) {
  const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]);
  const r: Record<string, unknown> = {
    instance: { id: "local", mode, conn: { db: "db" }, label: mode },
    plotAxisKinds: async () => ({ xk: "num", yk: "num", shape: "scatter", xLabel: "X", yLabel: "Y" }),
    plotExtent: async () => ({ n: pairs.length, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }),
    plotBinCounts: async (_d: unknown, _s: unknown, _xk: unknown, _yk: unknown, bins: [number, number],
      e: { x0: number; x1: number; y0: number; y1: number }) => {
      const at = (v: number, lo: number, hi: number, k: number) => hi > lo ? Math.min(k - 1, Math.floor((v - lo) / (hi - lo) * k)) : 0;
      const cells = new Map<string, { bx: number; by: number; n: number }>();
      for (const [x, y] of pairs) {
        const bx = at(x, e.x0, e.x1, bins[0]), by = at(y, e.y0, e.y1, bins[1]), k = bx + "," + by;
        const c = cells.get(k);
        if (c) c.n++; else cells.set(k, { bx, by, n: 1 });
      }
      return [...cells.values()];
    },
    plotMoments: async () => momentsOf(pairs),
    plotCoverage: async () => ({ total: pairs.length, nx: 0, ny: 0 }),
  };
  if (mode === "patient-level") {
    r.plotScatterPoints = async () => o.pastCap ? null : pairs.map(([x, y], i) => ({ id: name + "-" + i, x, y }));
    r.plotPoints = async () => [];
    r.plotOutlierPoints = async () => ({ points: [], total: 0 });
    r.plotRankedPoints = async () => [];
    r.plotHighlightPoints = async () => [];
  }
  return r;
}

const evaluated = (studies: string[]): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count: 10, samples: 10, mode: "patient-level" }])), count: 10, samples: 10, text: "" });

async function run(resolvers: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<ViewResultOf<"plot">> {
  const studies = Object.keys(resolvers);
  const c = {
    doc: { cohorts: { All: { all: [] } } },
    cohorts: { All: evaluated(studies) }, resolvers, vNames: ["All"], vStudies: studies,
    participationFor: (s: string[]) => ({ studies: s.map((x) => ({ study: x, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], x: { source: "clinical", attribute: "X" }, y: { source: "clinical", attribute: "Y" }, ...extra };
  const r = await runPlot(v as never, c);
  return "result" in (r as object) ? (r as { result: ViewResultOf<"plot"> }).result : r as ViewResultOf<"plot">;
}

const A: Pair[] = [[1, 2], [2, 2], [2, 1], [3, 4], [5, 6]];
const B: Pair[] = [[4, 3], [4, 5], [6, 5], [7, 8], [8, 7], [9, 9]];

const SPEARMAN = 0.9357798165137615, P_SPEARMAN = 2.2988775935973766e-05;
const PEARSON = 0.9348437317698366, P_PEARSON = 2.4501932727152883e-05;

const NOT_REPORTED = /Spearman[^.]*not reported/i;

const statsOf = (r: ViewResultOf<"plot">) => {
  assert.equal(r.error, undefined);
  assert.equal(r.plot!.n, 11);
  assert.ok(r.plot!.stats, "the plot has statistics");
  return r.plot!.stats!;
};

describe("a scatter pooled across studies", () => {
  test("R1: every site patient-level: Spearman's rho and its p are over the pooled pairs", async () => {
    const st = statsOf(await run({ study_a: site("study_a", "patient-level", A), study_b: site("study_b", "patient-level", B) }));
    near(st.spearman, SPEARMAN, 1e-12, "spearman");
    nearRel(st.pSpearman, P_SPEARMAN, 1e-6, "pSpearman");
  });

  test("R2: every site patient-level: Pearson's r is unrounded and its p is from it", async () => {
    const st = statsOf(await run({ study_a: site("study_a", "patient-level", A), study_b: site("study_b", "patient-level", B) }));
    near(st.pearson, PEARSON, 1e-12, "pearson, not rounded to 4 decimals");
    nearRel(st.pPearson, P_PEARSON, 1e-6, "pPearson");
  });

  test("R3: with the pooled pairs, the caption does not say Spearman is not reported", async () => {
    const r = await run({ study_a: site("study_a", "patient-level", A), study_b: site("study_b", "patient-level", B) });
    assert.equal(r.error, undefined);
    assert.doesNotMatch(r.plot!.note || "", NOT_REPORTED);
  });

  test("R4: one site aggregate-only: no Spearman, Pearson still exact, and the caption names the site", async () => {
    const r = await run({ study_a: site("study_a", "patient-level", A), study_b: site("study_b", "aggregate-only", B) });
    const st = statsOf(r);
    assert.equal(st.spearman, null); assert.equal(st.pSpearman, null);
    near(st.pearson, PEARSON, 1e-12, "pearson");
    assert.match(r.plot!.note!, NOT_REPORTED);
    assert.match(r.plot!.note!, /study_b/);
  });

  test("R5: a site past its cap (plotScatterPoints null): no Spearman, and the caption says so", async () => {
    const r = await run({ study_a: site("study_a", "patient-level", A), study_b: site("study_b", "patient-level", B, { pastCap: true }) });
    const st = statsOf(r);
    assert.equal(st.spearman, null);
    assert.match(r.plot!.note!, NOT_REPORTED);
  });

  test("R6: the method record has no \"No Spearman\" step and checks pSpearman; with a site aggregate-only it keeps the step", async () => {
    const r = await run({ study_a: site("study_a", "patient-level", A), study_b: site("study_b", "patient-level", B) });
    assert.equal(r.error, undefined);
    assert.ok(r.method, "a method record");
    assert.ok(!r.method.steps.some((s) => s.title === "No Spearman"), "no \"No Spearman\" step");
    assert.ok(r.method.check && "plot:pSpearman" in r.method.check, "a plot:pSpearman check");
    const r4 = await run({ study_a: site("study_a", "patient-level", A), study_b: site("study_b", "aggregate-only", B) });
    assert.ok(r4.method!.steps.some((s) => s.title === "No Spearman"), "the aggregate-only case keeps the \"No Spearman\" step");
  });
});
