// A plot's point layers: which participant is asked for what, when a cohort layer falls back from
// points to an aggregate, how rule layers rank and pool, how layers share the budget and their
// cases, and what is refused before anything is queried. The resolvers are fakes that record their
// calls, so the test can say what was NOT asked.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot.ts";
import { highlightCohortSql, plotHighlightCountSql, plotScatterPointsSql, plotRankedPointsSql, axisSelect, POINTS_CAP, LAYER_COLORS } from "../lib/plot.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { PlotData, ViewResult } from "../lib/types.ts";

type Calls = string[];
const CAP = POINTS_CAP.toLocaleString("en-US");
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
  ranked?: unknown[];
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
    r.plotRankedPoints = async (_d: unknown, _s: unknown, _xk: unknown, _yk: unknown, rank: unknown) => {
      calls.push("ranked " + JSON.stringify(rank)); return o.ranked || [{ id: "P1", x: 10, y: 5 }, { id: "P9", x: 90, y: 45 }];
    };
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
  points?: unknown; plotStudies?: string[]; hl?: Record<string, EvaluatedCohort>; extra?: Record<string, unknown>;
} = {}): Promise<ViewResult> {
  const plotStudies = opts.plotStudies || Object.keys(resolvers);
  const cohorts: Record<string, EvaluatedCohort> = { All: evaluated(plotStudies, 1000), ...(opts.hl || { R: evaluated(plotStudies, 10) }) };
  const c = {
    doc: { cohorts: Object.fromEntries(Object.keys(cohorts).map((n) => [n, { all: [] }])) },
    cohorts, resolvers, vNames: ["All"], vStudies: plotStudies,
    participationFor: (studies: string[]) => ({ studies: studies.map((s) => ({ study: s, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const view = { kind: "plot", unit: "patient", cohorts: ["All"], x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "TMB" },
    points: opts.points !== undefined ? opts.points : [{ cohort: "R" }], ...opts.extra };
  return runPlot(view as never, c).then((r) => ("result" in (r as object) ? (r as { result: ViewResult }).result : r as ViewResult));
}

describe("a highlight on one study", () => {
  test("an entitled participant with few enough cases answers with points, in the first colour", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls) });
    const h = r.plot!.layers![0];
    assert.equal(h.shown, "points");
    assert.equal(h.points!.length, 2);
    assert.equal(h.n, 2);
    assert.equal(h.color, LAYER_COLORS[0]);
    assert.ok(calls.includes("points cap=" + POINTS_CAP));
    assert.ok(!calls.some((x) => x.startsWith("bins")), "points answered it, so no aggregate was asked for");
    assert.match(r.note!, /“R”: 10 patients, 2 patients drawn as points/);
    assert.match(r.note!, /statistics are over the whole plotted cohort/);
  });

  test("past the cap the same cases come back as cells on the plot's own grid and extent, never the first POINTS_CAP", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls, { points: null }) });
    const h = r.plot!.layers![0];
    assert.equal(h.shown, "density");
    assert.equal(h.points, undefined);
    assert.deepEqual(h.bins, [{ bx: 2, by: 3, n: 7 }]);
    assert.equal(h.n, 7);
    assert.ok(calls.includes("bins [240,160] " + JSON.stringify(EXTENT)), "the highlight is binned on the scatter's grid: " + calls.join("; "));
    assert.match(r.note!, new RegExp("drawn as shaded cells \\(more than " + CAP + " cases"));
  });

  test("an aggregate-only participant is never asked for points, and its highlight is an aggregate", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("aggregate-only", calls) });
    const h = r.plot!.layers![0];
    assert.equal(h.shown, "density");
    assert.ok(!calls.some((x) => x.startsWith("points")));
    assert.match(h.why!, /may not show individual cases/);
  });

  test("on a box plot the fallback is a box per group", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("aggregate-only", calls, { data: box }) });
    const h = r.plot!.layers![0];
    assert.equal(h.shown, "boxes");
    assert.equal(h.groups![0].median, 5);
    assert.equal(h.n, 7);
  });

  test("a contingency table counts a highlight and draws nothing for it", async () => {
    const calls: Calls = [];
    const table = (): PlotData => ({ shape: "table", n: 5, x: { label: "A", kind: "cat" }, y: { label: "B", kind: "cat" }, cells: [{ cx: "a", cy: "b", n: 5 }] });
    const r = await run({ s: fake("patient-level", calls, { data: table }) });
    assert.equal(r.error, undefined);
    assert.equal(r.plot!.layers![0].shown, "none");
    assert.ok(!calls.some((x) => x.startsWith("points") || x.startsWith("bins")));
    assert.doesNotMatch(r.note!, /statistics are over/, "nothing is drawn, so there is nothing to tell apart from the statistics");
  });

  test("a highlight's patients outside the plotted cohort are counted, and said so", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls, { count: 6 }) });
    assert.equal(r.plot!.layers![0].inPlot, 6);
    assert.match(r.note!, /6 of its 10 patients in the plotted cohort/);
  });

  test("no highlight, no highlight queries", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls) }, { points: [] });
    assert.deepEqual(calls, ["plot"]);
    assert.equal(r.plot!.layers, undefined);
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
    const h = r.plot!.layers![0];
    assert.equal(h.shown, "density", "never half points, half cells");
    assert.ok(!a.some((x) => x.startsWith("points")), "the entitled site is not asked for points it could not be drawn beside");
    assert.deepEqual(h.bins!.sort((p, q) => p.bx - q.bx), [{ bx: 1, by: 1, n: 7 }, { bx: 5, by: 5, n: 1 }]);
    assert.equal(h.inPlot, 20, "each site's count is summed");
    assert.match(h.why!, /^b may not show/);
  });

  test("a highlight defined in a study the plot does not draw has none of its patients in the plot", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls) }, { hl: { R: evaluated(["elsewhere"], 9) } });
    const h = r.plot!.layers![0];
    assert.equal(h.inPlot, 0);
    assert.equal(h.shown, "none");
    assert.ok(!calls.includes("count"), "no study of the plot holds it, so none is asked");
  });
});

describe("what is refused before anything runs", () => {
  const c = (n: string) => ({ cohort: n });
  for (const [points, re, extra] of [
    [[c("nope")], /no cohort named “nope”/],
    [[c("All")], /is the plotted cohort itself/],
    [[c("R"), c("R")], /named twice/],
    [[c("R"), c("R2"), c("R3"), c("R4"), c("R5")], /at most 4 point layers/],
    ["R", /give a list of layers/],
    [[{ rule: "sideways" }], /unknown rule “sideways”/],
    [[{ rule: "extremes" }], /names its axis/],
    [[{ rule: "trend", n: 0 }], /n is a whole number from 1 to 500/],
    [[{ rule: "trend", n: 501 }], /n is a whole number from 1 to 500/],
    [[], /highlight is now a point layer/, { highlight: ["R"] }],
    [[], /allPoints: give true or false/, { allPoints: "yes" }],
  ] as [unknown, RegExp, Record<string, unknown>?][]) {
    test(JSON.stringify(points) + (extra ? " " + JSON.stringify(extra) : ""), async () => {
      const calls: Calls = [];
      const hl = Object.fromEntries(["R", "R2", "R3", "R4", "R5"].map((n) => [n, evaluated(["s"], 1)]));
      const r = await run({ s: fake("patient-level", calls) }, { points, hl, extra });
      assert.match(r.error!, re);
      assert.deepEqual(calls, [], "refused before the plot itself was queried");
    });
  }
});

describe("rule layers", () => {
  test("extremes ask the entitled study for its top and bottom n on that axis, in the layer's colour", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls) }, { points: [{ rule: "extremes", axis: "y", n: 2 }] });
    const l = r.plot!.layers![0];
    assert.equal(l.kind, "extremes");
    assert.equal(l.label, "top and bottom 2 by TMB");
    assert.equal(l.color, LAYER_COLORS[0]);
    assert.equal(l.shown, "points");
    assert.equal(l.points!.length, 2);
    assert.ok(calls.includes('ranked {"by":"y","n":2}'), calls.join("; "));
    assert.match(r.note!, /Point layers — top and bottom 2 by TMB: 2 patients\./);
  });

  test("trend ranks by distance from the plot's own fitted line, and n defaults to 50", async () => {
    const calls: Calls = [];
    await run({ s: fake("patient-level", calls) }, { points: [{ rule: "trend" }] });
    assert.ok(calls.includes('ranked {"by":"residual","n":50,"slope":1,"intercept":0}'), calls.join("; "));
  });

  test("an axis with no numbers has no extremes, and a box has no fitted line: not drawn, saying why", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls, { data: box }) }, { points: [{ rule: "extremes", axis: "x" }, { rule: "trend" }] });
    assert.deepEqual(r.plot!.layers!.map((l) => [l.shown, l.why]),
      [["none", "CANCER_TYPE is not numeric, so it has no extremes"], ["none", "a fitted line exists only on a scatter"]]);
    assert.ok(!calls.some((x) => x.startsWith("ranked")));
  });

  test("outliers wait for the density: at or under the cap there is none, whether or not every case is drawn", async () => {
    for (const extra of [{}, { allPoints: false }]) {
      const r = await run({ s: fake("patient-level", []) }, { points: [{ rule: "outliers" }], extra });
      assert.deepEqual([r.plot!.layers![0].shown, r.plot!.layers![0].why],
        ["none", "at or under " + CAP + " cases there is no density for them to stand out of"], JSON.stringify(extra));
    }
  });

  test("an aggregate-only participant is asked for no case at all: rule layers are not drawn, and say why", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("aggregate-only", calls) }, { points: [{ rule: "extremes", axis: "y" }] });
    assert.equal(r.plot!.layers![0].shown, "none");
    assert.match(r.plot!.layers![0].why!, /^s may not show individual cases$/);
    assert.ok(!calls.some((x) => x.startsWith("ranked")));
  });
});

describe("rule layers across studies", () => {
  test("each study's own top n pools into the exact overall top n, and two studies' equal ids stay two cases", async () => {
    const a: Calls = [], b: Calls = [];
    const fed = {
      a: fake("patient-level", a, { ranked: [{ id: "P1", x: 1, y: 50 }, { id: "P2", x: 2, y: 3 }] }),
      b: fake("patient-level", b, { ranked: [{ id: "P1", x: 3, y: 40 }, { id: "P3", x: 4, y: 1 }] }),
    };
    for (const r of Object.values(fed)) Object.assign(r, {
      plotAxisKinds: async () => ({ xk: "num", yk: "num", shape: "scatter", xLabel: "AGE", yLabel: "TMB" }),
      plotExtent: async () => ({ n: 500, x0: 0, x1: 100, y0: 0, y1: 50 }),
      plotBinCounts: async () => [{ bx: 1, by: 1, n: 500 }],
      plotMoments: async () => ({ n: 500, sx: 1, sy: 1, sxy: 1, sxx: 2, syy: 2 }),
      plotCoverage: async () => ({ total: 500, nx: 500, ny: 500 }),
    });
    const r = await run(fed, { points: [{ rule: "extremes", axis: "y", n: 1 }], hl: {} });
    const l = r.plot!.layers![0];
    assert.deepEqual(l.points!.map((p) => "y" in p ? p.y : null).sort((x, y) => x! - y!), [1, 50], "the highest of all, and the lowest of all");
    assert.ok(a.includes('ranked {"by":"y","n":1}') && b.includes('ranked {"by":"y","n":1}'), "every study is asked for its own top n");
  });
});

describe("layers together", () => {
  test("a case two layers share is drawn by the first, and the caption counts what the second left to it", async () => {
    const calls: Calls = [];
    const r = await run({ s: fake("patient-level", calls) }, { points: [{ rule: "extremes", axis: "y", n: 1 }, { cohort: "R" }] });
    const [first, second] = r.plot!.layers!;
    assert.deepEqual(first.points!.map((p) => p.id).sort(), ["P1", "P9"]);
    assert.equal(second.color, LAYER_COLORS[1], "colour follows place in the list");
    assert.deepEqual(second.points!.map((p) => p.id), ["P2"], "P1 is the first layer's");
    assert.equal(second.n, 2);
    assert.equal(second.drawn, 1);
    assert.match(r.note!, /2 patients drawn as points \(1 drawn by an earlier layer\)|2 samples drawn as points \(1 drawn by an earlier layer\)/);
  });

  test("the layers share one budget: once it is spent, a cohort layer becomes an aggregate and a rule layer is not drawn", async () => {
    const calls: Calls = [];
    const many = Array.from({ length: POINTS_CAP }, (_, i) => ({ id: "C" + i, x: 1, y: 1 }));
    const r = await run({ s: fake("patient-level", calls, { points: many }) }, {
      points: [{ cohort: "R" }, { rule: "extremes", axis: "y" }, { cohort: "R2" }], hl: { R: evaluated(["s"], 9), R2: evaluated(["s"], 9) } });
    const [a, b, c] = r.plot!.layers!;
    assert.equal(a.drawn, POINTS_CAP);
    assert.equal(b.shown, "none");
    assert.match(b.why!, /more than the 0 points the earlier layers left/);
    assert.equal(c.shown, "density");
    assert.match(c.why!, /the earlier layers used every point the figure draws/);
  });

  test("the default is the outliers alone, and [] draws none", async () => {
    const r = await run({ s: fake("patient-level", []) }, { points: undefined, extra: {} });
    const view = await run({ s: fake("patient-level", []) }, { points: [] });
    assert.equal(view.plot!.layers, undefined);
    assert.ok(r.plot!.layers);
  });
});

describe("the SQL a point layer adds", () => {
  const ctx = { study: "x", db: "db", unit: "sample" as const, cohortSql: "SELECT pid FROM p" };
  test("a highlight narrows the plotted cohort; it never widens it", () => {
    const sql = highlightCohortSql("SELECT pid FROM plotted", "SELECT pid FROM hl");
    assert.match(sql, /^SELECT pid FROM \(SELECT pid FROM plotted\) WHERE pid IN \(SELECT pid FROM \(SELECT pid FROM hl\)\)$/);
  });
  test("its count is a count", () => {
    assert.match(plotHighlightCountSql("SELECT pid FROM a", "SELECT pid FROM b"), /^SELECT count\(\) AS n FROM /);
  });
  test("a ranked layer takes n from each end, per group on a box, and the fit's residual on a scatter", () => {
    const x = axisSelect({ source: "clinical", attribute: "AGE" }, ctx, "num");
    const box2 = plotRankedPointsSql(x, x, ctx.cohortSql, "box", true, { by: "y", n: 7 });
    assert.match(box2, /ORDER BY v DESC, id LIMIT 7 BY g\)\n {2}UNION DISTINCT\n {2}\(SELECT id, y AS g, x AS v FROM pair ORDER BY v ASC, id LIMIT 7 BY g\)/);
    assert.match(plotRankedPointsSql(x, x, ctx.cohortSql, "scatter", true, { by: "residual", n: 3, slope: 2, intercept: 1 }),
      /ORDER BY abs\(y - \(1 \+ 2 \* x\)\) DESC, id LIMIT 3$/);
    assert.match(plotRankedPointsSql(x, x, ctx.cohortSql, "scatter", true, { by: "x", n: 9999 }), /LIMIT 500\)/, "held to the maximum");
  });
  test("a scatter's points carry their ids, and ask for one more than the cap so an overflow is seen", () => {
    const x = axisSelect({ source: "clinical", attribute: "AGE" }, ctx, "num");
    const sql = plotScatterPointsSql(x, x, ctx.cohortSql, 100);
    assert.match(sql, /SELECT xs\.id AS id, xs\.v AS x, ys\.v AS y/);
    assert.match(sql, /LIMIT 101$/);
  });
});

describe("a study served by a peer over MCP", () => {
  /** a peer: its counts answered, its cases only if it shares them (and then possibly refused by it) */
  const peer = (calls: Calls, cases: "none" | "shared" | "refused") => {
    const r = fake("aggregate-only", calls) as Record<string, unknown>;
    r.instance = { id: "peer", mode: "aggregate-only", conn: { db: "db" }, label: "GENIE (via MCP)" };
    if (cases !== "none") {
      const answer = (pts: unknown[]) => async () => {
        calls.push("peer cases");
        if (cases === "refused") throw new Error("the peer serving s does not share plot cases of s (its MCP_DISCLOSE_PATIENTS does not allow it)");
        return pts;
      };
      Object.assign(r, { plotScatterPoints: answer([{ id: "P1", x: 10, y: 5 }]), plotPoints: answer([{ id: "P1", g: "A", v: 5 }]),
        plotRankedPoints: answer([{ id: "P1", x: 10, y: 5 }]), plotHighlightPoints: answer([{ id: "P1", x: 10, y: 5 }, { id: "P2", x: 20, y: 8 }]) });
    }
    return r;
  };

  test("a peer that shares no cases: the plot draws from its counts, and no case is asked for", async () => {
    const calls: Calls = [];
    const r = await run({ s: peer(calls, "none") }, { points: [{ cohort: "R" }, { rule: "extremes", axis: "y" }] });
    assert.equal(r.error, undefined);
    assert.equal(r.plot!.pointSet!.rule, "none");
    assert.match(r.plot!.pointSet!.why!, /s may not show individual cases/);
    assert.equal(r.plot!.layers![0].shown, "density", "the cohort layer is its cells on the plot's grid");
    assert.equal(r.plot!.layers![1].shown, "none");
    assert.ok(!calls.includes("peer cases"));
  });

  test("a peer sharing the plot kind answers the cases like a local participant", async () => {
    const calls: Calls = [];
    const r = await run({ s: peer(calls, "shared") }, { points: [{ cohort: "R" }] });
    assert.equal(r.plot!.pointSet!.rule, "all");
    assert.equal(r.plot!.layers![0].shown, "points");
    assert.ok(calls.includes("peer cases"));
  });

  test("a peer that refuses its cases: the density stays, each layer falls back, and the caption says the peer's reason", async () => {
    const calls: Calls = [];
    const r = await run({ s: peer(calls, "refused") }, { points: [{ cohort: "R" }, { rule: "extremes", axis: "y" }] });
    assert.equal(r.error, undefined, "a refusal of cases does not fail the view");
    assert.equal(r.plot!.pointSet!.rule, "none");
    assert.match(r.plot!.pointSet!.why!, /does not share plot cases/);
    assert.equal(r.plot!.layers![0].shown, "density");
    assert.match(r.plot!.layers![0].why!, /does not share plot cases/);
    assert.equal(r.plot!.layers![1].shown, "none");
    assert.match(r.plot!.layers![1].why!, /does not share plot cases/);
  });
});
