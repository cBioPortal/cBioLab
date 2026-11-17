// A box over several studies is computed over the pooled values, by the one rule the portal applies
// (calculateBoxPlotModel, PLT-STM-8 / PLT-MD-2), whenever every site can hand over its values; only
// when one cannot are the quartiles the size-weighted approximation, and then the caption says so.
// The resolvers are fakes holding each site's values.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot/run.ts";
import { portalBox } from "../lib/plot.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResultOf } from "../lib/types.ts";
import type { PlotGroup } from "../lib/plot.ts";

describe("portalBox: a box over the values themselves", () => {
  const cases: [string, number[], { n: number; lo: number; hi: number; q1: number; median: number; q3: number } | null][] = [
    ["P1", [468.29], { n: 1, lo: 468.29, hi: 468.29, q1: 468.29, median: 468.29, q3: 468.29 }],
    ["P2", [3, 1], { n: 2, lo: 1, hi: 3, q1: 1, median: 2, q3: 3 }],
    ["P3", [5, 1, 3], { n: 3, lo: 1, hi: 5, q1: 1, median: 3, q3: 3 }],
    ["P4", [4, 1, 3, 2], { n: 4, lo: 1, hi: 4, q1: 1, median: 2.5, q3: 3 }],
    ["P5", [60, 10, 50, 20, 40, 30], { n: 6, lo: 10, hi: 60, q1: 20, median: 35, q3: 50 }],
    ["P6", [7, 6, 5, 4, 3, 2, 1], { n: 7, lo: 1, hi: 7, q1: 2, median: 4, q3: 5 }],
    ["P7", [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], { n: 10, lo: 1, hi: 10, q1: 3, median: 5.5, q3: 8 }],
    ["P8", [5, 5, 5, 1, 1, 9, 9, 9], { n: 8, lo: 1, hi: 9, q1: 1, median: 5, q3: 9 }],
    ["P9", [-2.5, -1, 0, 4], { n: 4, lo: -2.5, hi: 4, q1: -2.5, median: -0.5, q3: 0 }],
    ["P10", [], null],
  ];
  for (const [id, values, want] of cases) {
    test(id + ": " + JSON.stringify(values), () => {
      const input = [...values];
      const got = portalBox(values);
      assert.deepEqual(values, input, "the input is not reordered in place");
      if (want === null) { assert.equal(got, null); return; }
      assert.ok(got);
      for (const k of ["n", "lo", "hi", "q1", "median", "q3"] as const) assert.equal(got[k], want[k], k);
    });
  }
});

type BoxRow = { g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number };

/** one site's rows for its own values, by the same rule its database applies */
function rowsOf(values: Record<string, number[]>): BoxRow[] {
  return Object.entries(values).map(([g, vs]) => {
    const s = [...vs].sort((a, b) => a - b), n = s.length, at = (k: number) => s[Math.max(1, k) - 1];
    return { g, n, lo: s[0], hi: s[n - 1], q1: at(Math.round(n / 4)),
      median: n % 2 ? at((n + 1) / 2) : (at(n / 2) + at(n / 2 + 1)) / 2, q3: at(Math.round(3 * n / 4)) };
  });
}

/** a site of a pooled box: patient-level hands over its values (or null past its cap), aggregate-only only its rows */
function site(name: string, mode: "patient-level" | "aggregate-only", values: Record<string, number[]>, o: { pastCap?: boolean } = {}) {
  const rows = rowsOf(values);
  const r: Record<string, unknown> = {
    instance: { id: "local", mode, conn: { db: "db" }, label: mode },
    plotAxisKinds: async () => ({ xk: "cat", yk: "num", shape: "box", xLabel: "CNA", yLabel: "mRNA" }),
    plotBoxRows: async () => rows,
    plotCoverage: async () => ({ total: rows.reduce((a, x) => a + x.n, 0), nx: 0, ny: 0 }),
    plotViolinCounts: async () => [],
  };
  if (mode === "patient-level") {
    r.plotPoints = async () => o.pastCap ? null
      : Object.entries(values).flatMap(([g, vs]) => vs.map((v, i) => ({ id: name + "-" + g + "-" + i, g, v })));
    r.plotScatterPoints = async () => [];
    r.plotOutlierPoints = async () => ({ points: [], total: 0 });
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
  const v = { kind: "plot", cohorts: ["All"], x: { source: "clinical", attribute: "CNA" }, y: { source: "clinical", attribute: "MRNA" }, ...extra };
  const r = await runPlot(v as never, c);
  return "result" in (r as object) ? (r as { result: ViewResultOf<"plot"> }).result : r as ViewResultOf<"plot">;
}

const A = { Diploid: [1, 2, 3, 4] };
const B = { Diploid: [10, 20, 30, 40, 50, 60] };

const group = (r: ViewResultOf<"plot">, g: string): PlotGroup => {
  assert.equal(r.error, undefined);
  const found = r.plot!.groups!.find((x) => x.g === g);
  assert.ok(found, "group " + g);
  return found;
};

const close = (got: number, want: number, what: string) =>
  assert.ok(Math.abs(got - want) < 1e-9, what + ": " + got + " is not " + want);

/** the method steps that call the quartiles an approximation */
const approxSteps = (r: ViewResultOf<"plot">) =>
  (r.method?.steps || []).filter((s) => /quartile/i.test(JSON.stringify(s)) && /approximation/i.test(JSON.stringify(s)));

describe("a box pooled across studies", () => {
  test("R1: every site patient-level: the quartiles are over the pooled values, not weighted", async () => {
    const r = await run({ a: site("a", "patient-level", A), b: site("b", "patient-level", B) });
    const d = group(r, "Diploid");
    assert.equal(d.n, 10); assert.equal(d.lo, 1); assert.equal(d.hi, 60);
    assert.equal(d.q1, 3, "s[3] of the pooled values, not the weighted 12.4");
    assert.equal(d.median, 15, "(10 + 20) / 2, not the weighted 22");
    assert.equal(d.q3, 40, "s[8], not the weighted 31.2");
    assert.equal(d.loWhisker, 1); assert.equal(d.hiWhisker, 60);
  });

  test("R2: allPoints: false still takes the quartiles over the pooled values, and draws no points", async () => {
    const r = await run({ a: site("a", "patient-level", A), b: site("b", "patient-level", B) }, { allPoints: false });
    const d = group(r, "Diploid");
    assert.equal(d.q1, 3); assert.equal(d.median, 15); assert.equal(d.q3, 40);
    assert.equal(r.plot!.points, undefined);
    assert.notEqual(r.plot!.overlay, "points");
  });

  test("R3: one site aggregate-only: the quartiles are the size-weighted approximation and the caption says so", async () => {
    const r = await run({ a: site("a", "aggregate-only", A), b: site("b", "patient-level", B) });
    const d = group(r, "Diploid");
    assert.equal(d.n, 10); assert.equal(d.lo, 1); assert.equal(d.hi, 60);
    close(d.q1, 12.4, "q1"); close(d.median, 22, "median"); close(d.q3, 31.2, "q3");
    assert.match(r.plot!.note!, /approximation/);
  });

  test("R4: a site past its cap (plotPoints null) falls back to the approximation, and the caption says so", async () => {
    const r = await run({ a: site("a", "patient-level", A), b: site("b", "patient-level", B, { pastCap: true }) });
    const d = group(r, "Diploid");
    assert.equal(d.n, 10); assert.equal(d.lo, 1); assert.equal(d.hi, 60);
    close(d.q1, 12.4, "q1"); close(d.median, 22, "median"); close(d.q3, 31.2, "q3");
    assert.match(r.plot!.note!, /approximation/);
  });

  test("R5: with the pooled values, the caption says the quartiles are over them, not an approximation", async () => {
    const r = await run({ a: site("a", "patient-level", A), b: site("b", "patient-level", B) });
    assert.equal(r.error, undefined);
    assert.doesNotMatch(r.plot!.note!, /approximation/);
    assert.match(r.plot!.note!, /pooled values|every study.s values together/, "the caption says the quartiles are over the values themselves");
  });

  test("R6: a group present at only one site is boxed over that site's values", async () => {
    const r = await run({ a: site("a", "patient-level", A), b: site("b", "patient-level", { ...B, Gain: [5, 6, 7] }) });
    const g = group(r, "Gain");
    assert.equal(g.n, 3); assert.equal(g.q1, 5); assert.equal(g.median, 6); assert.equal(g.q3, 6);
    const d = group(r, "Diploid");
    assert.equal(d.q1, 3); assert.equal(d.median, 15); assert.equal(d.q3, 40);
  });

  test("R7: the method record calls the quartiles an approximation only when they are one", async () => {
    const exact = await run({ a: site("a", "patient-level", A), b: site("b", "patient-level", B) });
    assert.equal(exact.error, undefined);
    assert.ok(exact.method?.steps.length, "a method record");
    assert.deepEqual(approxSteps(exact), []);
    const approx = await run({ a: site("a", "aggregate-only", A), b: site("b", "patient-level", B) });
    assert.ok(approxSteps(approx).length, "the aggregate-only run's method names the approximation");
  });
});
