// A plot's highlight cohorts: which participant is asked for what, when a highlight falls back
// from points to an aggregate, how sites pool, and what is refused before anything is queried.
// The resolvers are fakes that record their calls, so the test can say what was NOT asked.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot.ts";
import { highlightCohortSql, plotHighlightCountSql, plotScatterPointsSql, axisSelect, POINTS_CAP, HIGHLIGHT_COLORS } from "../lib/plot.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { PlotData, ViewResult } from "../lib/types.ts";

type Calls = string[];
const EXTENT = { x0: 0, x1: 100, y0: 0, y1: 50 };
const scatter = (): PlotData => ({ shape: "scatter", n: 1000, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
  extent: { ...EXTENT }, grid: [240, 160], bins: [{ bx: 1, by: 1, n: 1000 }],
  stats: { pearson: 0.1, spearman: 0.1, slope: 1, intercept: 0, pPearson: 0.5, pSpearman: 0.5 } });
const box = (): PlotData => ({ shape: "box", n: 1000, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "TMB", kind: "num" },
  groups: [{ g: "A", n: 1000, lo: 0, hi: 10, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }], overlay: "none" });

/** a participant: patient-level or aggregate-only, answering with canned values and recording each call */
function fake(mode: "patient-level" | "aggregate-only", calls: Calls, o: {
  data?: () => PlotData; count?: number; points?: unknown[] | null; bins?: { bx: number; by: number; n: number }[];
  boxRows?: { g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number }[];
} = {}) {
  const r: Record<string, unknown> = {
    instance: { mode, conn: { db: "db" }, label: mode },
    plot: async () => { calls.push("plot"); return (o.data || scatter)(); },
    plotAxisKinds: async () => ({}),
    plotHighlightCount: async () => { calls.push("count"); return o.count ?? 10; },
    plotHighlightBins: async (_d: unknown, _h: unknown, _s: unknown, _xk: unknown, _yk: unknown, grid: unknown, extent: unknown) => {
      calls.push("bins " + JSON.stringify(grid) + " " + JSON.stringify(extent)); return o.bins || [{ bx: 2, by: 3, n: 7 }];
    },
    plotHighlightBoxRows: async () => { calls.push("boxRows"); return o.boxRows || [{ g: "A", n: 7, lo: 1, hi: 9, q1: 3, median: 5, q3: 7 }]; },
  };
  // the case-level method exists only where the entitlement does, exactly as on the real resolvers
  if (mode === "patient-level") {
    r.plotScatterPoints = async () => [{ id: "P1", x: 10, y: 5 }];
    r.plotPoints = async () => [{ id: "P1", g: "A", v: 5 }];
  }
  if (mode === "patient-level")
    r.plotHighlightPoints = async (_d: unknown, _h: unknown, _s: unknown, _xk: unknown, _yk: unknown, cap: number) => {
      calls.push("points cap=" + cap);
      return o.points === undefined ? [{ id: "P1", x: 10, y: 5 }, { id: "P2", x: 20, y: 8 }] : o.points;
    };
  return r;
}

const evaluated = (studies: string[], count: number): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count, mode: "patient-level" }])), count, text: "" });

function run(resolvers: Record<string, unknown>, opts: {
  highlight?: unknown; plotStudies?: string[]; hl?: Record<string, EvaluatedCohort>;
} = {}): Promise<ViewResult> {
  const plotStudies = opts.plotStudies || Object.keys(resolvers);
  const cohorts: Record<string, EvaluatedCohort> = { All: evaluated(plotStudies, 1000), ...(opts.hl || { R: evaluated(plotStudies, 10) }) };
  const c = {
    doc: { cohorts: Object.fromEntries(Object.keys(cohorts).map((n) => [n, { all: [] }])) },
    cohorts, resolvers, vNames: ["All"], vStudies: plotStudies,
    participationFor: (studies: string[]) => ({ studies: studies.map((s) => ({ study: s, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const view = { kind: "plot", cohorts: ["All"], x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "TMB" },
    ...(opts.highlight !== undefined ? { highlight: opts.highlight } : { highlight: ["R"] }) };
  return runPlot(view as never, c).then((r) => ("result" in (r as object) ? (r as { result: ViewResult }).result : r as ViewResult));
}

describe("a highlight on one study", () => {
  test("an entitled participant with few enough cases answers with points, in the first colour", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls) });
    const h = r.plot!.highlights![0];
    assert.equal(h.shown, "points");
    assert.equal(h.points!.length, 2);
    assert.equal(h.n, 2);
    assert.equal(h.color, HIGHLIGHT_COLORS[0]);
    assert.ok(calls.includes("points cap=" + POINTS_CAP));
    assert.ok(!calls.some((x) => x.startsWith("bins")), "points answered it, so no aggregate was asked for");
    assert.match(r.note!, /“R”: 10 patients, 2 patients drawn as points/);
    assert.match(r.note!, /statistics are over the whole plotted cohort/);
  });

  test("past the cap the same cases come back as cells on the plot's own grid and extent, never the first 5,000", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls, { points: null }) });
    const h = r.plot!.highlights![0];
    assert.equal(h.shown, "density");
    assert.equal(h.points, undefined);
    assert.deepEqual(h.bins, [{ bx: 2, by: 3, n: 7 }]);
    assert.equal(h.n, 7);
    assert.ok(calls.includes("bins [240,160] " + JSON.stringify(EXTENT)), "the highlight is binned on the scatter's grid: " + calls.join("; "));
    assert.match(r.note!, /drawn as shaded cells \(more than 5,000 cases/);
  });

  test("an aggregate-only participant is never asked for points, and its highlight is an aggregate", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("aggregate-only", calls) });
    const h = r.plot!.highlights![0];
    assert.equal(h.shown, "density");
    assert.ok(!calls.some((x) => x.startsWith("points")));
    assert.match(h.why!, /may not show individual cases/);
  });

  test("on a box plot the fallback is a box per group", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("aggregate-only", calls, { data: box }) });
    const h = r.plot!.highlights![0];
    assert.equal(h.shown, "boxes");
    assert.equal(h.groups![0].median, 5);
    assert.equal(h.n, 7);
  });

  test("a contingency table counts a highlight and draws nothing for it", async () => {
    const calls: Calls = [];
    const table = (): PlotData => ({ shape: "table", n: 5, x: { label: "A", kind: "cat" }, y: { label: "B", kind: "cat" }, cells: [{ cx: "a", cy: "b", n: 5 }] });
    const r = await run({ s: fake("patient-level", calls, { data: table }) });
    assert.equal(r.plot!.highlights![0].shown, "none");
    assert.ok(!calls.some((x) => x.startsWith("points") || x.startsWith("bins")));
    assert.doesNotMatch(r.note!, /statistics are over/, "nothing is drawn, so there is nothing to tell apart from the statistics");
  });

  test("a highlight's patients outside the plotted cohort are counted, and said so", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls, { count: 6 }) });
    assert.equal(r.plot!.highlights![0].inPlot, 6);
    assert.match(r.note!, /6 of its 10 patients in the plotted cohort/);
  });

  test("no highlight, no highlight queries", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls) }, { highlight: [] });
    assert.deepEqual(calls, ["plot"]);
    assert.equal(r.plot!.highlights, undefined);
  });
});

describe("a highlight across studies", () => {
  test("one study that may not show cases turns the whole highlight into an aggregate, pooled across sites", async () => {
    const a: Calls = [], b: Calls = [];
    const fed = { a: fake("patient-level", a, { bins: [{ bx: 1, by: 1, n: 3 }] }), b: fake("aggregate-only", b, { bins: [{ bx: 1, by: 1, n: 4 }, { bx: 5, by: 5, n: 1 }] }) };
    // the federated path asks each site for its extent etc.; give the fakes what it needs
    for (const r of Object.values(fed)) Object.assign(r, {
      plotAxisKinds: async () => ({ xk: "num", yk: "num", shape: "scatter", xLabel: "AGE", yLabel: "TMB" }),
      plotExtent: async () => ({ n: 500, x0: 0, x1: 100, y0: 0, y1: 50 }),
      plotBinCounts: async () => [{ bx: 1, by: 1, n: 500 }],
      plotMoments: async () => ({ n: 500, sx: 1, sy: 1, sxy: 1, sxx: 2, syy: 2 }),
      plotCoverage: async () => ({ total: 500, nx: 500, ny: 500 }),
    });
    const r = await run(fed, { hl: { R: evaluated(["a", "b"], 20) } });
    const h = r.plot!.highlights![0];
    assert.equal(h.shown, "density", "never half points, half cells");
    assert.ok(!a.some((x) => x.startsWith("points")), "the entitled site is not asked for points it could not be drawn beside");
    assert.deepEqual(h.bins!.sort((p, q) => p.bx - q.bx), [{ bx: 1, by: 1, n: 7 }, { bx: 5, by: 5, n: 1 }]);
    assert.equal(h.inPlot, 20, "each site's count is summed");
    assert.match(h.why!, /^b may not show/);
  });

  test("a highlight defined in a study the plot does not draw has none of its patients in the plot", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls) }, { hl: { R: evaluated(["elsewhere"], 9) } });
    const h = r.plot!.highlights![0];
    assert.equal(h.inPlot, 0);
    assert.equal(h.shown, "none");
    assert.ok(!calls.includes("count"), "no study of the plot holds it, so none is asked");
  });
});

describe("what is refused before anything runs", () => {
  for (const [highlight, re] of [
    [["nope"], /no cohort named “nope”/],
    [["All"], /is the plotted cohort itself/],
    [["R", "R"], /named twice/],
    [["R", "R2", "R3", "R4", "R5"], /at most 4/],
    ["R", /a list of cohort names/],
  ] as [unknown, RegExp][]) {
    test(JSON.stringify(highlight), async () => {
      const calls: Calls = [];
      const hl = Object.fromEntries(["R", "R2", "R3", "R4", "R5"].map((n) => [n, evaluated(["s"], 1)]));
      const r = await run({ s: fake("patient-level", calls) }, { highlight, hl });
      assert.match(r.error!, re);
      assert.deepEqual(calls, [], "refused before the plot itself was queried");
    });
  }
});

describe("the SQL a highlight adds", () => {
  const ctx = { study: "x", db: "db", unit: "sample" as const, cohortSql: "SELECT pid FROM p" };
  test("a highlight narrows the plotted cohort; it never widens it", () => {
    const sql = highlightCohortSql("SELECT pid FROM plotted", "SELECT pid FROM hl");
    assert.match(sql, /^SELECT pid FROM \(SELECT pid FROM plotted\) WHERE pid IN \(SELECT pid FROM \(SELECT pid FROM hl\)\)$/);
  });
  test("its count is a count", () => {
    assert.match(plotHighlightCountSql("SELECT pid FROM a", "SELECT pid FROM b"), /^SELECT count\(\) AS n FROM /);
  });
  test("a scatter's points carry their ids, and ask for one more than the cap so an overflow is seen", () => {
    const x = axisSelect({ source: "clinical", attribute: "AGE" }, ctx, "num");
    const sql = plotScatterPointsSql(x, x, ctx.cohortSql, 100);
    assert.match(sql, /SELECT xs\.id AS id, xs\.v AS x, ys\.v AS y/);
    assert.match(sql, /LIMIT 101$/);
  });
});
