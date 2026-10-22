// Which cases a plot draws as points: every case at or under the cap; over it the default outliers
// layer (a box's values beyond its whiskers, a scatter's sparse cells); none from a participant
// that may not show cases. The resolvers are fakes that record their calls, so the test can say
// what was asked of whom, and what was NOT.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot.ts";
import { POINTS_CAP, OUTLIER_CELL_MAX, sparseCellMax } from "../lib/plot.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { PlotData, ViewResultOf } from "../lib/types.ts";

const CAP = POINTS_CAP.toLocaleString("en-US");
const EXTENT = { x0: 0, x1: 100, y0: 0, y1: 50 };
const scatter = (n: number, bins: { bx: number; by: number; n: number }[]): PlotData => ({
  shape: "scatter", n, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
  extent: { ...EXTENT }, grid: [240, 160], bins,
  stats: { pearson: 0.1, spearman: 0.1, slope: 1, intercept: 0, pPearson: 0.5, pSpearman: 0.5 } });
const box = (n: number): PlotData => ({ shape: "box", n, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "TMB", kind: "num" },
  groups: [{ g: "A", n, lo: 0, hi: 100, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 12 }], overlay: "violin", violin: [] });

type Call = { m: string; cap?: number; extra?: unknown };
function fake(mode: "patient-level" | "aggregate-only", calls: Call[], data: () => PlotData, answers: {
  all?: unknown[] | null; outliers?: unknown[] | null;
} = {}) {
  const r: Record<string, unknown> = {
    instance: { mode, conn: { db: "db" }, label: mode },
    plot: async () => data(),
  };
  if (mode === "patient-level") {
    r.plotScatterPoints = async (_d: unknown, _s: unknown, cap?: number, sparse?: unknown) => {
      calls.push({ m: "scatterPoints", cap, extra: sparse });
      return sparse ? (answers.outliers === undefined ? [{ id: "o1", x: 99, y: 49 }] : answers.outliers)
        : (answers.all === undefined ? [{ id: "a1", x: 1, y: 1 }, { id: "a2", x: 2, y: 2 }] : answers.all);
    };
    r.plotPoints = async (_d: unknown, _s: unknown, cap?: number, outside?: unknown) => {
      calls.push({ m: "boxPoints", cap, extra: outside });
      return outside ? (answers.outliers === undefined ? [{ id: "o1", g: "A", v: 90 }] : answers.outliers)
        : (answers.all === undefined ? [{ id: "a1", g: "A", v: 3 }] : answers.all);
    };
  }
  return r;
}

const evaluated = (studies: string[], count: number): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count, mode: "patient-level" }])), count, text: "" });

async function run(resolver: Record<string, unknown>, view: Record<string, unknown> = {}): Promise<ViewResultOf<"plot">> {
  const c = {
    doc: { cohorts: { All: { all: [] } } },
    cohorts: { All: evaluated(["s"], 1000) }, resolvers: { s: resolver }, vNames: ["All"], vStudies: ["s"],
    participationFor: (studies: string[]) => ({ studies: studies.map((s) => ({ study: s, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "TMB" }, ...view };
  const r = await runPlot(v as never, c);
  return "result" in (r as object) ? (r as { result: ViewResultOf<"plot"> }).result : r as ViewResultOf<"plot">;
}

describe("sparseCellMax: the cell threshold for a scatter's outlier points", () => {
  test("the largest threshold whose cases fit under the cap, never above the maximum", () => {
    const bins = [{ n: 1 }, { n: 1 }, { n: 2 }, { n: 3 }, { n: 50 }];
    assert.equal(sparseCellMax(bins, 100, 3), 3, "1+1+2+3 = 7 cases fit");
    assert.equal(sparseCellMax(bins, 4, 3), 2, "1+1+2 = 4 fit; adding the 3 does not");
    assert.equal(sparseCellMax(bins, 100, 2), 2, "held to the maximum asked for");
    assert.equal(sparseCellMax(bins, 1, 3), 0, "the lone cases alone are 2, more than 1: none is drawn");
    assert.equal(sparseCellMax([{ n: 50 }], 100, 3), 3, "no sparse cell at all draws nothing, at any threshold");
  });
});

describe("a scatter's points", () => {
  test("at or under the cap every case is a point and no subset is asked for", async () => {
    const calls: Call[] = [];
    const r = await run(fake("patient-level", calls, () => scatter(2, [{ bx: 0, by: 0, n: 2 }])));
    assert.deepEqual(r.plot!.pointSet, { rule: "all", drawn: 2 });
    assert.equal(r.plot!.xyPoints!.length, 2);
    assert.deepEqual(calls.map((c) => [c.m, c.extra]), [["scatterPoints", undefined]]);
  });

  test("over the cap the cases in sparse cells are points, against the plot's own grid and extent", async () => {
    const calls: Call[] = [];
    const n = POINTS_CAP + 1000;
    const bins = [{ bx: 0, by: 0, n: n - 4 }, { bx: 5, by: 5, n: 1 }, { bx: 9, by: 9, n: 3 }];
    const r = await run(fake("patient-level", calls, () => scatter(n, bins)));
    assert.equal(calls.length, 1, "over the cap the every-case query is not run");
    assert.deepEqual(calls[0].extra, { grid: [240, 160], extent: EXTENT, cellMax: OUTLIER_CELL_MAX });
    assert.equal(calls[0].cap, POINTS_CAP);
    assert.deepEqual(r.plot!.pointSet, { rule: "none", drawn: 0, why: "more than " + CAP + " cases" });
    const l = r.plot!.layers![0];
    assert.deepEqual([l.kind, l.shown, l.n, l.drawn, l.cellMax], ["outliers", "points", 1, 1, OUTLIER_CELL_MAX]);
    assert.match(r.note!, /outliers: 1 sample in cells holding at most 3, left unshaded under them/);
    assert.match(r.note!, /coefficients are over every sample/);
  });

  test("when even the lone cases are more than the cap, none is drawn and the caption says why", async () => {
    const calls: Call[] = [];
    const lone = Array.from({ length: POINTS_CAP + 1 }, (_, i) => ({ bx: i % 240, by: Math.floor(i / 240), n: 1 }));
    const r = await run(fake("patient-level", calls, () => scatter(POINTS_CAP + 1, lone)));
    assert.equal(calls.length, 0, "nothing is fetched to be thrown away");
    assert.equal(r.plot!.pointSet!.rule, "none");
    assert.equal(r.plot!.xyPoints, undefined);
    assert.equal(r.plot!.layers![0].shown, "none");
    assert.match(r.note!, new RegExp("outliers: not drawn, the cases alone in a cell are more than the " + CAP + " points left to draw"));
  });

  test("an aggregate-only participant is never asked, and the caption names it", async () => {
    const calls: Call[] = [];
    const r = await run(fake("aggregate-only", calls, () => scatter(10, [{ bx: 0, by: 0, n: 10 }])));
    assert.equal(calls.length, 0);
    assert.deepEqual(r.plot!.pointSet, { rule: "none", drawn: 0, why: "s may not show individual cases" });
    assert.match(r.note!, /No case is drawn as a point: s may not show individual cases/);
    assert.match(r.note!, /outliers: not drawn, s may not show individual cases/);
  });

  test("allPoints: false and no layers ask for none", async () => {
    const calls: Call[] = [];
    const r = await run(fake("patient-level", calls, () => scatter(10, [{ bx: 0, by: 0, n: 10 }])), { allPoints: false, points: [] });
    assert.equal(calls.length, 0);
    assert.equal(r.plot!.pointSet!.rule, "none");
    assert.equal(r.plot!.layers, undefined);
  });
});

describe("a box's points", () => {
  test("at or under the cap every value is a point", async () => {
    const calls: Call[] = [];
    const r = await run(fake("patient-level", calls, () => box(10)));
    assert.deepEqual(r.plot!.pointSet, { rule: "all", drawn: 1 });
    assert.equal(r.plot!.overlay, "points");
    assert.deepEqual(calls.map((c) => c.m), ["boxPoints"]);
  });

  test("over the cap the values beyond each group's whiskers are points over the violin", async () => {
    const calls: Call[] = [];
    const r = await run(fake("patient-level", calls, () => box(POINTS_CAP + 1)));
    assert.equal(calls.length, 1, "over the cap the every-value query is not run");
    assert.deepEqual(calls[0].extra, [{ g: "A", n: POINTS_CAP + 1, lo: 0, hi: 100, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 12 }]);
    assert.equal(r.plot!.overlay, "violin", "the violin stays: the outliers are drawn over it");
    assert.equal(r.plot!.pointSet!.rule, "none");
    assert.deepEqual([r.plot!.layers![0].kind, r.plot!.layers![0].drawn], ["outliers", 1]);
    assert.match(r.note!, /outliers: 1 value beyond the whiskers/);
  });

  test("more outliers than the cap: none, never the first POINTS_CAP", async () => {
    const calls: Call[] = [];
    const r = await run(fake("patient-level", calls, () => box(POINTS_CAP * 3), { outliers: null }));
    assert.equal(r.plot!.points, undefined);
    assert.equal(r.plot!.layers![0].shown, "none");
    assert.match(r.note!, new RegExp("outliers: not drawn, more than " + CAP + " values lie beyond the whiskers"));
  });
});
