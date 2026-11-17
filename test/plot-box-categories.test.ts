// A box plot's "Filter categories" and "Sort Categories by Median" (PLT-AX-9, PLT-AX-10, PLT-STM-9,
// PLT-BX-1), as the view's `categories` and `sortByMedian`. Legacy: cbioportal-frontend cd8c6df
// PlotsTab.tsx defaultSortedBoxPlotData (only the selected categories' boxes, in category order) and
// boxPlotData (_.sortBy(boxes, d => d.median), stable, ascending; median = jStat.median of the raw
// values). The resolver is a single-study patient-level fake: `plot()` hands back the boxes,
// `plotPoints()` the values behind them in the plotted units.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot/run.ts";
import { CATEGORY_CAP, DEFAULT_BINS, type PlotData, type PlotGroup, type PlotPoint } from "../lib/plot.ts";
import { toLog } from "../lib/plot-log.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResultOf } from "../lib/types.ts";

type Result = ViewResultOf<"plot">;

/** A n3 median 5; B n2 median 2; C n4 median 9; D n1 median 2 — handed over out of category order */
const VALUES: Record<string, number[]> = { C: [8, 9, 9, 10], A: [4, 5, 6], D: [2], B: [1, 3] };

const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** the boxes and points of VALUES, in raw units or each value as log2(v + 1) */
function boxOf(log: boolean, values: Record<string, number[]> = VALUES): { data: PlotData; points: PlotPoint[] } {
  const t = (v: number) => log ? toLog("log2", v) : v;
  const groups: PlotGroup[] = Object.entries(values).map(([g, raw]) => {
    const vs = raw.map(t), s = [...vs].sort((a, b) => a - b);
    return { g, n: vs.length, lo: s[0], hi: s[s.length - 1], q1: s[0], median: median(vs), q3: s[s.length - 1], loWhisker: s[0], hiWhisker: s[s.length - 1] };
  });
  const points = Object.entries(values).flatMap(([g, raw]) => raw.map((v, i) => ({ id: "P-" + g + "-" + i, g, v: t(v) })));
  const n = groups.reduce((a, g) => a + g.n, 0);
  return { data: { shape: "box", n, x: { label: "CAT", kind: "cat" }, y: { label: "VAL", kind: "num", ...(log ? { log: "log2" as const } : {}) }, groups, overlay: "none" }, points };
}

const scatterData = (): PlotData => ({ shape: "scatter", n: 4, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
  extent: { x0: 0, x1: 1, y0: 0, y1: 1 }, grid: DEFAULT_BINS, bins: [{ bx: 0, by: 0, n: 4 }],
  stats: { pearson: 0.2, spearman: 0.2, slope: 1, intercept: 0, pPearson: 0.4, pSpearman: 0.4 } });
const tableData = (): PlotData => ({ shape: "table", n: 3, x: { label: "CAT", kind: "cat" }, y: { label: "STAGE", kind: "cat" },
  cells: [{ cx: "A", cy: "T1", n: 2 }, { cx: "B", cy: "T2", n: 1 }] });

/** one local patient-level participant */
function local(data: () => PlotData, points: PlotPoint[] = []) {
  return {
    instance: { id: "local", mode: "patient-level", conn: { db: "db" }, label: "local" },
    plot: async () => data(),
    plotPoints: async () => points,
    plotScatterPoints: async () => [],
  };
}

const evaluated = (studies: string[]): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count: 100, samples: 100, mode: "patient-level" }])), count: 100, samples: 100, text: "" });

async function run(resolver: unknown, view: Record<string, unknown>): Promise<Result> {
  const c = {
    doc: { cohorts: { All: { all: [] } } },
    cohorts: { All: evaluated(["s1"]) }, resolvers: { s1: resolver }, vNames: ["All"], vStudies: ["s1"],
    participationFor: (s: string[]) => ({ studies: s.map((x) => ({ study: x, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], unit: "patient", points: [],
    x: { source: "clinical", attribute: "CAT" }, y: { source: "clinical", attribute: "VAL" }, ...view };
  const r = await runPlot(v as never, c);
  return "result" in (r as object) ? (r as { result: Result }).result : r as Result;
}

const runBox = (view: Record<string, unknown>, log = false, values: Record<string, number[]> = VALUES) => {
  const { data, points } = boxOf(log, values);
  return run(local(() => structuredClone(data), structuredClone(points)), log ? { y: { source: "clinical", attribute: "VAL", log: true }, ...view } : view);
};

const order = (r: Result) => {
  assert.equal(r.error, undefined);
  return r.plot!.groups!.map((g) => g.g);
};
const caption = (r: Result) => [r.note, r.plot?.note].filter(Boolean).join(" ");

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
    }
  });

  test("F3: categories [\"Z\"], none present: no groups, and the caption says none of the chosen categories is in the plot", async () => {
    const r = await runBox({ categories: ["Z"] });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.plot!.groups ?? [], []);
    assert.deepEqual(r.plot!.points ?? [], []);
    assert.match(caption(r), /none of the (chosen|selected) categories/i);
    assert.match(caption(r), /\bZ\b/, "the caption names what was asked for");
  });

  test("F4: categories [\"A\",\"B\"]: n is the kept groups' n, and the caption names what was kept", async () => {
    const r = await runBox({ categories: ["A", "B"] });
    assert.deepEqual(order(r), ["A", "B"]);
    assert.equal(r.plot!.n, 5);
    const cap = caption(r);
    assert.match(cap, /categor/i, "the caption speaks of the filter");
    assert.match(cap, /\bA\b/);
    assert.match(cap, /\bB\b/);
  });
});

describe("a box plot sorted by median", () => {
  test("S1: sortByMedian orders B, D, A, C (B and D tie at 2: category order kept)", async () => {
    assert.deepEqual(order(await runBox({ sortByMedian: true })), ["B", "D", "A", "C"]);
  });

  test("S2: on a log axis the order is by the raw medians, from the points converted back", async () => {
    const r = await runBox({ sortByMedian: true }, true);
    assert.deepEqual(order(r), ["B", "D", "A", "C"]);
  });

  test("S2b: on a log axis an even count's raw median, not the log-space mean of its middle two, decides the order", async () => {
    // P [1, 100]: raw median 50.5, log-space median (1 + 6.658) / 2 = 3.829 (about 13.2 converted back); Q [20, 21, 22]: raw 21, log2(22) = 4.459
    const { data } = boxOf(true, { P: [1, 100], Q: [20, 21, 22] });
    const at = (g: string) => data.groups!.find((x) => x.g === g)!.median;
    assert.ok(Math.abs(at("P") - 3.829) < 1e-3 && Math.abs(at("Q") - 4.459) < 1e-3, "the box rows carry log-space medians");
    const r = await runBox({ sortByMedian: true }, true, { P: [1, 100], Q: [20, 21, 22] });
    assert.deepEqual(order(r), ["Q", "P"], "raw medians 21 < 50.5; the boxes' own log medians would give P, Q");
  });

  test("S3: sortByMedian with categories [\"C\",\"B\"] orders B, C", async () => {
    assert.deepEqual(order(await runBox({ sortByMedian: true, categories: ["C", "B"] })), ["B", "C"]);
  });

  test("S4: sortByMedian on a scatter or a table is refused", async () => {
    const sc = await run(local(scatterData), { sortByMedian: true, x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "TMB" } });
    assert.match(sc.error ?? "", /sortByMedian applies to a box plot/);
    const tb = await run(local(tableData), { sortByMedian: true, y: { source: "clinical", attribute: "STAGE" } });
    assert.match(tb.error ?? "", /sortByMedian applies to a box plot/);
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
});

describe("method / caption", () => {
  test("M1: with sortByMedian, the caption says the boxes are ordered by their median, lowest first", async () => {
    const r = await runBox({ sortByMedian: true });
    assert.equal(r.error, undefined);
    assert.match(caption(r), /median/i);
    assert.match(caption(r), /lowest first/i);
    const plain = await runBox({});
    assert.doesNotMatch(caption(plain), /lowest first/i, "only when sorted");
  });
});

describe("a box plot's categories filter and its point layers", () => {
  test("L1 an outliers layer draws no case of a category the filter leaves out", async () => {
    // A and B each hold one value far past their whiskers; the filter keeps A
    const values = { A: [4, 5, 5, 5, 6, 60], B: [1, 2, 2, 2, 3, 90] };
    // the participant answers with every far value it holds, as a layer that does not follow the filter would
    const { data, points } = boxOf(false, values);
    const res = { ...local(() => structuredClone(data), structuredClone(points)),
      plotOutlierPoints: async () => ({ points: [{ id: "P-A-5", g: "A", v: 60 }, { id: "P-B-5", g: "B", v: 90 }], total: 2 }) };
    const r = await run(res, { categories: ["A"], points: [{ rule: "outliers" }] });
    assert.equal(r.error, undefined);
    const layer = (r.plot!.layers || []).find((l) => l.kind === "outliers");
    assert.ok(layer, "an outliers layer is drawn");
    const groups = new Set([...(layer!.points || []), ...(layer!.shared || [])].map((p) => ("g" in p ? p.g : "?")));
    assert.ok(!groups.has("B"), "no case of B: " + [...groups].join(", "));
  });
});
