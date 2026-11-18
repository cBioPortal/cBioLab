// A box plot's "Filter categories" and "Sort Categories by Median" (PLT-AX-9, PLT-AX-10, PLT-STM-9,
// PLT-BX-1, PLT-AX-1b, PLT-AX-11), as the view's `categories` and `sortByMedian`. Legacy:
// cbioportal-frontend cd8c6df PlotsTab.tsx defaultSortedBoxPlotData (only the selected categories'
// boxes and points, in category order) and boxPlotData (_.sortBy(boxes, d => d.median), stable,
// ascending; median = jStat.median of the raw values); docs/legacy-spec/04-plots.md PLT-AX-9 (cleared
// on a data type or source change, swapped by Swap Axes).
//
// The filter is part of the plot's request (lib/plot.ts plotSelects), so every query counts the kept
// categories alone. The participants here are fakes that answer as that SQL does: each case is a
// (category, value) row, and every query over the pair keeps only the request's categories, as
// keptCategoriesSql does in the database (run against the warehouse by scripts/check-plot-stats.ts,
// F*). Each fake records what it was asked, so a test can say which requests carried the filter.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot/run.ts";
import { withAxis } from "../lib/views/plot/axis-edit.ts";
import { CATEGORY_CAP, DEFAULT_BINS, POINTS_CAP, coverageNote, keptCategoriesSql, plotSelects, portalBox, tukey,
  type PlotData, type PlotGroup, type PlotPoint, type PlotRequest, type PointRank, type Whiskers } from "../lib/plot.ts";
import { toLog } from "../lib/plot-log.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResultOf } from "../lib/types.ts";

type Result = ViewResultOf<"plot">;
type Values = Record<string, number[]>;
type Call = { op: string; categories?: string[] };

/** A n3 median 5; B n2 median 2; C n4 median 9; D n1 median 2 — handed over out of category order */
const VALUES: Values = { C: [8, 9, 9, 10], A: [4, 5, 6], D: [2], B: [1, 3] };
/** cases of the cohort with a category but no value: the coverage's, never the plot's */
const NO_VALUE = 4;

/** one box per category, by the portal's rule, in the order the database hands them back */
function boxesOf(cases: PlotPoint[]): PlotGroup[] {
  const by = new Map<string, number[]>();
  for (const p of cases) (by.get(p.g) ?? by.set(p.g, []).get(p.g)!).push(p.v);
  return [...by.entries()].map(([g, vs]) => { const b = portalBox(vs)!, t = tukey(b.q1, b.q3, b.lo, b.hi); return { g, ...b, ...t }; });
}

/**
 * A participant holding `values` (each category's raw values; log2(v + 1) when `log`). Every query
 * over the pair keeps the request's categories, unless `ignoresFilter` (a peer that predates it).
 */
function site(values: Values, o: { log?: boolean; ignoresFilter?: boolean; peer?: boolean; shape?: "box" | "scatter" | "table";
  highlight?: string[]; highlightPointsNull?: boolean; calls?: Call[]; violinRanges?: [number, number][] } = {}) {
  const t = (v: number) => o.log ? toLog("log2", v) : v;
  const cases: PlotPoint[] = Object.entries(values).flatMap(([g, raw]) => raw.map((v, i) => ({ id: "P-" + g + "-" + i, g, v: t(v) })));
  const calls = o.calls || [];
  const ask = (op: string, spec: PlotRequest) => calls.push({ op, ...(spec.categories ? { categories: spec.categories } : {}) });
  const kept = (spec: PlotRequest) => !spec.categories || o.ignoresFilter ? cases : cases.filter((p) => spec.categories!.includes(p.g));
  const inHighlight = (spec: PlotRequest) => kept(spec).filter((p) => (o.highlight || []).includes(p.id));
  const coverage = { total: cases.length + NO_VALUE, nx: cases.length + NO_VALUE, ny: cases.length };
  const shape = o.shape || "box";
  const labels = shape === "box" ? { xLabel: "CAT", yLabel: "VAL" } : shape === "scatter" ? { xLabel: "AGE", yLabel: "TMB" } : { xLabel: "CAT", yLabel: "STAGE" };
  return {
    instance: { id: o.peer ? "peer" : "local", mode: "patient-level", conn: { db: "db" }, label: "local" },
    plotAxisKinds: async () => { calls.push({ op: "axisKinds" }); return { xk: shape === "scatter" ? "num" : "cat", yk: shape === "table" ? "cat" : "num", shape, ...labels }; },
    plot: async (_d: unknown, spec: PlotRequest): Promise<PlotData> => {
      ask("plot", spec);
      if (shape === "scatter") return { shape, n: 4, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
        extent: { x0: 0, x1: 1, y0: 0, y1: 1 }, grid: DEFAULT_BINS, bins: [{ bx: 0, by: 0, n: 4 }],
        stats: { pearson: 0.2, spearman: 0.2, slope: 1, intercept: 0, pPearson: 0.4, pSpearman: 0.4 } };
      if (shape === "table") return { shape, n: 3, x: { label: "CAT", kind: "cat" }, y: { label: "STAGE", kind: "cat" },
        cells: [{ cx: "A", cy: "T1", n: 2 }, { cx: "B", cy: "T2", n: 1 }] };
      const groups = boxesOf(kept(spec));
      return { shape: "box", n: groups.reduce((a, g) => a + g.n, 0), x: { label: "CAT", kind: "cat" },
        y: { label: "VAL", kind: "num", ...(o.log ? { log: "log2" as const } : {}) }, groups, overlay: "violin", violin: [], coverage };
    },
    plotBoxRows: async (_d: unknown, spec: PlotRequest) => { ask("box", spec); return boxesOf(kept(spec)).map(({ g, n, lo, hi, q1, median, q3 }) => ({ g, n, lo, hi, q1, median, q3 })); },
    plotCoverage: async (_d: unknown, spec: PlotRequest) => { ask("coverage", spec); return coverage; },
    plotViolinCounts: async (_d: unknown, spec: PlotRequest, _xk: unknown, _yk: unknown, _b: number, range: [number, number]) => {
      ask("violin", spec); o.violinRanges?.push(range); return [];
    },
    plotPoints: async (_d: unknown, spec: PlotRequest, cap = POINTS_CAP) => { ask("points", spec); const ps = kept(spec); return ps.length > cap ? null : ps; },
    plotScatterPoints: async () => [],
    plotOutlierPoints: async (_d: unknown, spec: PlotRequest, cap: number, whiskers: Whiskers[]) => {
      ask("outliers", spec);
      const w = new Map(whiskers.map((x) => [x.g, x]));
      const out = kept(spec).filter((p) => w.has(p.g) && (p.v < w.get(p.g)!.loWhisker || p.v > w.get(p.g)!.hiWhisker));
      return { points: out.slice(0, cap), total: out.length };
    },
    plotRankedPoints: async (_d: unknown, spec: PlotRequest, _xk: unknown, _yk: unknown, rank: PointRank) => {
      ask("ranked", spec);
      const by = new Map<string, PlotPoint[]>();
      for (const p of kept(spec)) (by.get(p.g) ?? by.set(p.g, []).get(p.g)!).push(p);
      return [...by.values()].flatMap((ps) => { const s = [...ps].sort((a, b) => a.v - b.v); return [...new Set([...s.slice(0, rank.n), ...s.slice(-rank.n)])]; });
    },
    plotHighlightCount: async () => (o.highlight || []).length,
    plotHighlightPoints: async (_d: unknown, _h: unknown, spec: PlotRequest) => { ask("highlightPoints", spec); return o.highlightPointsNull ? null : inHighlight(spec); },
    plotHighlightBoxRows: async (_d: unknown, _h: unknown, spec: PlotRequest) => { ask("highlightBox", spec); return boxesOf(inHighlight(spec)); },
    plotHighlightBins: async () => [],
  };
}

const evaluated = (studies: string[]): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count: 100, samples: 100, mode: "patient-level" }])), count: 100, samples: 100, text: "" });

/** the view over cohort All, drawn by one participant per study */
async function run(resolvers: Record<string, unknown>, view: Record<string, unknown>): Promise<Result> {
  const studies = Object.keys(resolvers);
  const c = {
    doc: { cohorts: { All: { all: [] }, Some: { all: [] } } },
    cohorts: { All: evaluated(studies), Some: evaluated(studies) }, resolvers, vNames: ["All"], vStudies: studies,
    participationFor: (s: string[]) => ({ studies: s.map((x) => ({ study: x, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], unit: "patient", points: [],
    x: { source: "clinical", attribute: "CAT" }, y: { source: "clinical", attribute: "VAL" }, ...view };
  const r = await runPlot(v as never, c);
  return "result" in (r as object) ? (r as { result: Result }).result : r as Result;
}

const runBox = (view: Record<string, unknown>, o: Parameters<typeof site>[1] = {}, values: Values = VALUES) =>
  run({ s1: site(values, o) }, o.log ? { y: { source: "clinical", attribute: "VAL", log: true }, ...view } : view);

const order = (r: Result) => {
  assert.equal(r.error, undefined);
  return r.plot!.groups!.map((g) => g.g);
};
const caption = (r: Result) => [r.note, r.plot?.note].filter(Boolean).join(" ");

describe("plotSelects: the filter is in the request every query reads", () => {
  const ctx = { study: "s", unit: "sample" as const, cohortSql: "SELECT 1 AS pid, 1 AS sid" };
  const spec = (categories?: string[]): PlotRequest =>
    ({ x: { source: "clinical", attribute: "CAT" }, y: { source: "clinical", attribute: "VAL" }, ...(categories ? { categories } : {}) });

  test("Q1 a box narrows its categorical axis's select, whichever axis it is, and leaves the numeric one", () => {
    const open = plotSelects(spec(), ctx, "cat", "num");
    const f = plotSelects(spec(["Colon", "Rectal"]), ctx, "cat", "num");
    assert.equal(f.xSel, keptCategoriesSql(open.xSel, ["Colon", "Rectal"]));
    assert.equal(f.ySel, open.ySel);
    const g = plotSelects(spec(["Colon"]), ctx, "num", "cat");
    assert.equal(g.ySel, keptCategoriesSql(plotSelects(spec(), ctx, "num", "cat").ySel, ["Colon"]));
  });

  test("Q2 no categories or an empty list reads the axes as they are", () => {
    assert.deepEqual(plotSelects(spec([]), ctx, "cat", "num"), plotSelects(spec(), ctx, "cat", "num"));
  });

  test("Q3 categories on a scatter or a table is refused", () => {
    assert.throws(() => plotSelects(spec(["A"]), ctx, "num", "num"), /box plot.*scatter/);
    assert.throws(() => plotSelects(spec(["A"]), ctx, "cat", "cat"), /box plot.*contingency table/);
  });

  test("Q4 every data query of a filtered box carries the categories; coverage and the category count do not", async () => {
    const calls: Call[] = [];
    const r = await runBox({ categories: ["C", "A"], points: [{ rule: "outliers" }, { rule: "extremes", axis: "y", n: 1 }] }, { calls });
    assert.equal(r.error, undefined);
    for (const op of ["plot", "points", "outliers", "ranked"]) {
      const asked = calls.filter((x) => x.op === op);
      assert.ok(asked.length, op + " was asked");
      assert.ok(asked.every((x) => x.categories?.join() === "C,A"), op + " carried the filter: " + JSON.stringify(asked));
    }
    assert.deepEqual(calls.filter((x) => x.op === "box"), [{ op: "box" }], "every category counted once, without the filter");
  });
});

describe("a box plot's categories filter", () => {
  test("F1: categories [\"C\",\"A\"] keeps A and C in category order, and only their points", async () => {
    const r = await runBox({ categories: ["C", "A"] });
    assert.deepEqual(order(r), ["A", "C"], "category order, not the list's order");
    const gs = new Set(r.plot!.points!.map((p) => p.g));
    assert.deepEqual([...gs].sort(), ["A", "C"], "points only of the kept groups");
    assert.equal(r.plot!.points!.length, 7);
  });

  test("F2: categories [] or absent draws all four, unchanged", async () => {
    for (const view of [{ categories: [] }, {}]) {
      const r = await runBox(view);
      assert.deepEqual(order(r), ["A", "B", "C", "D"], JSON.stringify(view));
      assert.equal(r.plot!.n, 10);
      assert.equal(r.plot!.points!.length, 10);
      assert.equal(r.plot!.filtered, undefined);
    }
  });

  test("F3: categories [\"Z\"], none present: no groups, the filter still offered, and the caption says none of the chosen categories is in the plot", async () => {
    const r = await runBox({ categories: ["Z"] });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.plot!.groups ?? [], []);
    assert.deepEqual(r.plot!.points ?? [], []);
    assert.deepEqual(r.plot!.categoryOptions, ["A", "B", "C", "D"], "the categories stay on offer, so the filter can be undone");
    assert.match(caption(r), /none of the (chosen|selected) categories/i);
    assert.match(caption(r), /\bZ\b/, "the caption names what was asked for");
  });

  test("F4: categories [\"A\",\"B\"]: n is the kept groups' n, and the caption names what was kept", async () => {
    const r = await runBox({ categories: ["A", "B"] });
    assert.deepEqual(order(r), ["A", "B"]);
    assert.equal(r.plot!.n, 5);
    const cap = caption(r);
    assert.match(cap, /Filter categories: 2 of 4 categories/);
    assert.match(cap, /\bA\b/);
    assert.match(cap, /\bB\b/);
  });

  test("F5: what the filter offers is every category, alphabetical, filtered or not; a chosen one the cohort lacks is named", async () => {
    assert.deepEqual((await runBox({})).plot!.categoryOptions, ["A", "B", "C", "D"]);
    const r = await runBox({ categories: ["B", "Z"] });
    assert.deepEqual(r.plot!.categoryOptions, ["A", "B", "C", "D"]);
    assert.deepEqual(order(r), ["B"]);
    assert.match(caption(r), /“Z” is not a category of CAT here/);
  });
});

describe("a filtered box's coverage (blocking 1)", () => {
  // 10 cases with both values (A 3, B 2, C 4, D 1) of 14 in the cohort; the filter keeps A and B, 5 cases
  test("C1 one study: the caption counts the cases with both values before the filter, and says what the filter kept", async () => {
    const r = await runBox({ categories: ["A", "B"] });
    assert.equal(r.plot!.n, 5);
    assert.deepEqual(r.plot!.filtered, { categories: ["A", "B"], paired: 10 });
    const cap = caption(r);
    assert.match(cap, /10 of 14 patients have a value on both axes \(4 have no VAL\)/);
    assert.doesNotMatch(cap, /\b5 of 14\b/, "the cases the filter leaves out have both values");
    assert.match(cap, /5 of the 10 patients with a value on both axes/);
  });

  test("C2 several studies: the same, pooled", async () => {
    const r = await run({ s1: site({ A: [1, 2], B: [3] }), s2: site({ A: [4], C: [5, 6, 7] }) }, { categories: ["A"] });
    assert.equal(r.error, undefined);
    assert.equal(r.plot!.n, 3);
    assert.deepEqual(r.plot!.filtered, { categories: ["A"], paired: 7 });
    assert.match(caption(r), /7 of 15 patients have a value on both axes/);
    assert.match(caption(r), /1 of 3 categories of CAT drawn \(“A”\), 3 of the 7 patients/);
  });

  test("C3 coverageNote reads the pairs before the filter only when there is one", () => {
    const d = (filtered?: PlotData["filtered"]): PlotData => ({ shape: "box", n: 5, x: { label: "CAT", kind: "cat" }, y: { label: "VAL", kind: "num" },
      coverage: { total: 14, nx: 14, ny: 10 }, ...(filtered ? { filtered } : {}) });
    assert.equal(coverageNote(d(), "sample"), "5 of 14 samples have a value on both axes (4 have no VAL); only those are drawn.");
    assert.equal(coverageNote(d({ categories: ["A"], paired: 10 }), "sample"), "10 of 14 samples have a value on both axes (4 have no VAL); only those can be drawn.");
    assert.equal(coverageNote({ ...d({ categories: ["A"], paired: 14 }), coverage: { total: 14, nx: 14, ny: 14 } }, "sample"), "");
  });
});

describe("a filtered box's point layers and density (blocking 2)", () => {
  test("L1 an outliers layer is chosen among the kept categories, and its count is what it draws", async () => {
    // A and B each hold one value far past their whiskers; the filter keeps A
    const r = await runBox({ categories: ["A"], points: [{ rule: "outliers" }] }, {}, { A: [4, 5, 5, 5, 6, 60], B: [1, 2, 2, 2, 3, 90] });
    assert.equal(r.error, undefined);
    const layer = r.plot!.layers!.find((l) => l.kind === "outliers")!;
    assert.deepEqual(layer.points!.map((p) => "g" in p ? p.g + ":" + p.v : "?"), ["A:60"]);
    assert.equal(layer.n, 1);
    assert.equal(layer.of, undefined, "no other outlier to leave out");
    assert.match(caption(r), /outliers: 1 value beyond the whiskers/);
  });

  test("L2 an extremes layer ranks the kept categories alone: n is what it draws", async () => {
    const r = await runBox({ categories: ["A", "C"], points: [{ rule: "extremes", axis: "y", n: 1 }] });
    const layer = r.plot!.layers![0];
    const groups = new Set(layer.points!.map((p) => "g" in p ? p.g : "?"));
    assert.deepEqual([...groups].sort(), ["A", "C"]);
    assert.equal(layer.n, layer.points!.length);
    assert.equal(layer.n, 4, "A's and C's top and bottom");
  });

  test("L3 a cohort layer drawn as boxes has boxes for the kept categories only", async () => {
    const r = await run({ s1: site(VALUES, { highlight: ["P-A-0", "P-B-0", "P-C-0"], highlightPointsNull: true }) },
      { categories: ["A", "C"], points: [{ cohort: "Some" }] });
    assert.equal(r.error, undefined);
    const layer = r.plot!.layers![0];
    assert.equal(layer.shown, "boxes");
    assert.deepEqual(layer.groups!.map((g) => g.g).sort(), ["A", "C"]);
    assert.equal(layer.n, 2);
  });

  test("L4 points or density is decided over the kept categories: a filter under the points cap draws every kept case", async () => {
    const big = Array.from({ length: POINTS_CAP + 1 }, (_, i) => i % 97);
    const all = await runBox({}, {}, { A: [1, 2, 3], BIG: big });
    assert.equal(all.plot!.pointSet?.rule, "none", "over the cap, unfiltered");
    const r = await runBox({ categories: ["A"] }, {}, { A: [1, 2, 3], BIG: big });
    assert.equal(r.plot!.pointSet?.rule, "all");
    assert.equal(r.plot!.points!.length, 3);
    assert.doesNotMatch(caption(r), /Drawn as a density/);
  });

  test("L5 several studies: the shared density range is cut over the kept categories alone", async () => {
    const ranges: [number, number][] = [];
    const r = await run({ s1: site({ A: [1, 2, 3], WIDE: [-1000, 0, 1000] }, { violinRanges: ranges }), s2: site({ A: [2, 4], WIDE: [5] }, { violinRanges: ranges }) },
      { categories: ["A"], allPoints: false });
    assert.equal(r.error, undefined);
    assert.ok(ranges.length === 2, "each site binned its density");
    for (const [lo, hi] of ranges) assert.ok(lo >= 1 && hi <= 4, "the range spans A's values, not WIDE's: " + lo + ".." + hi);
    assert.deepEqual(r.plot!.violinExtent, ranges[0]);
  });
});

describe("settings left from another pair of axes (blocking 3)", () => {
  test("A1 changing either axis drops the filter and the median order; the rest of the view is kept, the old one untouched", () => {
    const v = { kind: "plot" as const, x: { source: "clinical" as const, attribute: "CAT" }, y: { source: "clinical" as const, attribute: "VAL" },
      unit: "patient" as const, categories: ["A"], sortByMedian: true, regression: true };
    const nx = withAxis(v, "x", { source: "clinical", attribute: "SEX" });
    assert.deepEqual(nx, { kind: "plot", x: { source: "clinical", attribute: "SEX" }, y: v.y, unit: "patient", regression: true });
    const ny = withAxis(v, "y", { source: "clinical", attribute: "AGE" });
    assert.equal(ny.categories, undefined);
    assert.equal(ny.sortByMedian, undefined);
    assert.deepEqual(v.categories, ["A"], "the old view is not changed");
  });

  test("A2 on a scatter or a table, categories and sortByMedian are refused before any value is read", async () => {
    for (const [shape, extra, word] of [["scatter", { x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "TMB" } }, "scatter"],
      ["table", { y: { source: "clinical", attribute: "STAGE" } }, "contingency table"]] as const) {
      for (const [view, named] of [[{ sortByMedian: true }, /^sortByMedian applies to a box plot/], [{ categories: ["A"] }, /^categories applies to a box plot/],
        [{ categories: ["A"], sortByMedian: true }, /^categories and sortByMedian apply to a box plot/]] as const) {
        const calls: Call[] = [];
        const r = await run({ s1: site(VALUES, { shape, calls }) }, { ...extra, ...view });
        assert.match(r.error ?? "", named, shape + " " + JSON.stringify(view));
        assert.match(r.error ?? "", new RegExp("drawn as a " + word));
        assert.deepEqual(calls.map((x) => x.op), ["axisKinds"], "nothing but the axes' kinds was asked");
      }
    }
  });

  test("A3 a plot by cohort refuses a leftover categories or sortByMedian, before any cohort is plotted", async () => {
    for (const view of [{ categories: ["A"] }, { sortByMedian: true }]) {
      const calls: Call[] = [];
      const r = await run({ s1: site(VALUES, { calls }) }, { x: { source: "cohort" }, cohorts: ["All", "Some"], ...view });
      assert.match(r.error ?? "", /a plot by cohort draws one box per cohort/, JSON.stringify(view));
      assert.deepEqual(calls, [], "no cohort was plotted");
    }
    const ok = await run({ s1: site(VALUES) }, { x: { source: "cohort" }, cohorts: ["All", "Some"], categories: [] });
    assert.equal(ok.error, undefined, "an empty list is no filter");
  });

  test("A4 a participant that answers every category under a filter (one that predates it) is refused, by name", async () => {
    const r = await run({ s1: site(VALUES, { ignoresFilter: true, peer: true }) }, { categories: ["A"] });
    assert.match(r.error ?? "", /^s1 answered a box for "[BCD]", a category the view's filter leaves out: .*predates Filter categories/);
    const f = await run({ s1: site(VALUES), s2: site({ A: [1], E: [2] }, { ignoresFilter: true, peer: true }) }, { categories: ["A"] });
    assert.match(f.error ?? "", /^s2 answered a box for "E"/);
  });
});

describe("a box plot sorted by median", () => {
  test("S1: sortByMedian orders B, D, A, C (B and D tie at 2: category order kept)", async () => {
    const r = await runBox({ sortByMedian: true });
    assert.deepEqual(order(r), ["B", "D", "A", "C"]);
    assert.equal(r.plot!.sortedByMedian, true);
  });

  test("S2: on a log axis the order is by the raw medians, from the points converted back", async () => {
    assert.deepEqual(order(await runBox({ sortByMedian: true }, { log: true })), ["B", "D", "A", "C"]);
  });

  test("S2b: on a log axis an even count's raw median, not the log-space mean of its middle two, decides the order", async () => {
    // P [1, 100]: raw median 50.5, log-space median (1 + 6.658) / 2 = 3.829 (about 13.2 converted back); Q [20, 21, 22]: raw 21, log2(22) = 4.459
    const plain = await runBox({}, { log: true }, { P: [1, 100], Q: [20, 21, 22] });
    const at = (g: string) => plain.plot!.groups!.find((x) => x.g === g)!.median;
    assert.ok(Math.abs(at("P") - 3.829) < 1e-3 && Math.abs(at("Q") - 4.459) < 1e-3, "the boxes carry log-space medians");
    const r = await runBox({ sortByMedian: true }, { log: true }, { P: [1, 100], Q: [20, 21, 22] });
    assert.deepEqual(order(r), ["Q", "P"], "raw medians 21 < 50.5; the boxes' own log medians would give P, Q");
  });

  test("S3: sortByMedian with categories [\"C\",\"B\"] orders B, C", async () => {
    assert.deepEqual(order(await runBox({ sortByMedian: true, categories: ["C", "B"] })), ["B", "C"]);
  });

  test("S5: with no points drawn, the order comes from each box's own median, and the caption says it is approximate", async () => {
    const r = await runBox({ sortByMedian: true, allPoints: false }, { log: true });
    assert.equal(r.plot!.points, undefined, "no points drawn");
    assert.deepEqual(order(r), ["B", "D", "A", "C"]);
    assert.match(caption(r), /Boxes are ordered by their median, lowest first\. The values are not drawn as points, so each box is ordered by its own median rather than its raw values', and the order is approximate: two close medians can swap\./);
    const drawn = await runBox({ sortByMedian: true }, { log: true });
    assert.match(caption(drawn), /Boxes are ordered by their median, lowest first\./);
    assert.doesNotMatch(caption(drawn), /approximate/, "from the raw values when every value is drawn");
  });

  test("S4: several studies: the pooled boxes are sorted", async () => {
    const r = await run({ s1: site({ A: [9, 9], B: [1] }), s2: site({ A: [8], B: [2, 3] }) }, { sortByMedian: true });
    assert.deepEqual(order(r), ["B", "A"]);
  });
});

describe("validation", () => {
  test("V1: categories not an array of strings, or more than CATEGORY_CAP entries, is refused with the limit named", async () => {
    assert.equal(CATEGORY_CAP, 150);
    for (const bad of ["A", [1, 2], ["A", 3], { A: true }]) {
      const r = await runBox({ categories: bad });
      assert.match(r.error ?? "", /categories/, JSON.stringify(bad));
    }
    const many = Array.from({ length: CATEGORY_CAP + 1 }, (_, i) => "G" + i);
    const r = await runBox({ categories: many });
    assert.match(r.error ?? "", /categories/);
    assert.match(r.error ?? "", /\b150\b/, "the limit is named");
    const atCap = await runBox({ categories: many.slice(0, CATEGORY_CAP) });
    assert.doesNotMatch(atCap.error ?? "", /150/, "exactly the cap is allowed");
  });

  test("V2: sortByMedian that is not true or false is refused before anything is asked", async () => {
    const calls: Call[] = [];
    const r = await runBox({ sortByMedian: "yes" }, { calls });
    assert.equal(r.error, "sortByMedian: give true or false");
    assert.deepEqual(calls, []);
  });
});

describe("method / caption", () => {
  test("M1: with sortByMedian, the caption and the method say the boxes are ordered by their median, lowest first", async () => {
    const r = await runBox({ sortByMedian: true });
    assert.match(caption(r), /ordered by their median, lowest first/i);
    assert.ok(r.method!.steps.some((s) => /by median, lowest first/.test(s.title)));
    const plain = await runBox({});
    assert.doesNotMatch(caption(plain), /lowest first/i, "only when sorted");
    assert.ok(!plain.method!.steps.some((s) => /median, lowest first|chosen categories/.test(s.title)));
  });

  test("M2: a filtered box's method names the categories its queries kept", async () => {
    const r = await runBox({ categories: ["A", "B"] });
    const step = r.method!.steps.find((s) => s.title === "Only the chosen categories");
    assert.ok(step, "a step for the filter");
    assert.deepEqual(step!.params, [["categories", "A, B"]]);
    assert.match(step!.detail, /5 patients in them, of the 10 with a value on both axes/);
  });
});
