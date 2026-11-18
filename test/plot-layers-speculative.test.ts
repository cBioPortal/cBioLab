// A plot's point layers computed ahead of need (lib/views/plot/run.ts pointLayers, cohortLayer),
// from the rule's case table. Every answer must be the one the strictly sequential algorithm
// gives: layer i runs on the budget layers 0..i-1 left, and a case two layers share is drawn by the
// first.
//
//   D1a  layer 0 draws points           -> layer 1 is computed on the budget left (its early, full-budget answer is not used)
//   D1b  layers before draw no points   -> the early answer is used, the layer is not asked again
//   D1c  40 random layer lists (cohort sizes around the cap, shared cases, rule layers), with random delays: layers,
//        points, drawn/shared/sharedOwners, budget and why equal to the sequential answers recorded
//        from the code before the change (test/fixtures/plot-layers-sequential.json)
//   D1d  every point layer starts at once: the second layer's first query is issued before the first layer's finish
//   D2   a big cohort layer then an outliers layer on a box: the outliers query is issued before the cohort layer's queries finish
//   D3a  cohort layer, inPlot > budget, cases may be shown: the aggregate (box rows / bins) starts beside the points
//   D3b  cohort layer, inPlot <= budget: the aggregate is asked only after the points do not fit, and not at all when they do
//   D4a  an early computation that rejects and is never used: no unhandled rejection, the answer is unaffected
//   D4b  one that rejects and is used: the view fails with its error, as before
//   D5   a cohort layer's plotHighlightCount is asked once per layer per run, though the layer is computed twice
//
// The participants are fakes that answer from a list of case ids per cohort, record each call as it
// starts and ends, and wait as long as a test says.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { runPlot } from "../lib/views/plot/run.ts";
import { POINTS_CAP } from "../lib/plot.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { PlotData, ViewResultOf } from "../lib/types.ts";

const GOLDEN = new URL("./fixtures/plot-layers-sequential.json", import.meta.url);
const CAP = POINTS_CAP;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- unhandled rejections anywhere in this file fail it ------------------------------------------
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };
process.on("unhandledRejection", onUnhandled);
after(() => { process.off("unhandledRejection", onUnhandled); });
/** lets every timer and promise a run left behind settle, so a stray rejection has fired */
const drain = async () => { for (let i = 0; i < 5; i++) { await sleep(10); await new Promise((r) => setImmediate(r)); } };

// ---- the fake participant ------------------------------------------------------------------------
type Shape = "scatter" | "box";
interface CohortCases { ids: string[]; failPoints?: (cap: number) => boolean; failAgg?: boolean }
interface SiteOpts {
  shape: Shape;
  cohorts: Record<string, CohortCases>;
  /** the cases a ranked layer (extremes, trend) and a box's outliers rank from */
  ranked?: string[]; outliers?: string[];
  /** how long a call waits before answering, by its label ("points R", "count R", "boxRows R", "ranked", "outliers") */
  delay?: (label: string, cap?: number) => number | Promise<void>;
  /** the plotted cohort's size */
  n?: number;
}
const scatter = (n: number): PlotData => ({ shape: "scatter", n, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
  extent: { x0: 0, x1: 100, y0: 0, y1: 50 }, grid: [240, 160], bins: [{ bx: 1, by: 1, n }],
  stats: { pearson: 0.1, spearman: 0.1, slope: 0.5, intercept: 1, pPearson: 0.5, pSpearman: 0.5 } });
const box = (n: number): PlotData => ({ shape: "box", n, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "TMB", kind: "num" },
  groups: [{ g: "A", n: Math.ceil(n / 2), lo: 0, hi: 30, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 },
    { g: "B", n: Math.floor(n / 2), lo: 0, hi: 30, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }], overlay: "none" });
const num = (id: string) => Number(id.replace(/\D/g, "")) || 0;
const pointOf = (shape: Shape, id: string) => shape === "box"
  ? { id, g: num(id) % 2 ? "B" : "A", v: num(id) % 37 }
  : { id, x: num(id) % 100, y: (num(id) * 7) % 50 };

function site(o: SiteOpts, events: string[]) {
  const nameOf = (h: unknown) => (h as { name: string }).name;
  const call = async <T>(label: string, answer: () => T, cap?: number): Promise<T> => {
    events.push("start " + label + (cap != null ? " cap=" + cap : ""));
    const d = o.delay?.(label, cap);
    if (typeof d === "number") { if (d > 0) await sleep(d); } else if (d) await d;
    try { return answer(); } finally { events.push("end " + label + (cap != null ? " cap=" + cap : "")); }
  };
  const cohort = (h: unknown) => {
    const c = o.cohorts[nameOf(h)];
    assert.ok(c, "no cohort " + nameOf(h));
    return c;
  };
  return {
    instance: { mode: "patient-level", conn: { db: "db" }, label: "s" },
    plot: async () => (o.shape === "box" ? box : scatter)(o.n ?? 1000),
    plotAxisKinds: async () => ({}),
    plotPoints: async () => [{ id: "P1", g: "A", v: 5 }],
    plotScatterPoints: async () => [{ id: "P1", x: 10, y: 5 }],
    plotHighlightCount: (_d: unknown, h: unknown) => call("count " + nameOf(h), () => cohort(h).ids.length),
    plotHighlightPoints: (_d: unknown, h: unknown, _s: unknown, _xk: unknown, _yk: unknown, cap: number) =>
      call("points " + nameOf(h), () => {
        const c = cohort(h);
        if (c.failPoints?.(cap)) throw new Error("points of " + nameOf(h) + " failed at cap " + cap);
        // as the database answers: at most cap + 1 rows, so an overflow is seen
        return c.ids.slice(0, cap + 1).map((id) => pointOf(o.shape, id));
      }, cap),
    plotHighlightBins: (_d: unknown, h: unknown) => call("bins " + nameOf(h), () => {
      if (cohort(h).failAgg) throw new Error("bins of " + nameOf(h) + " failed");
      return [{ bx: 2, by: 3, n: cohort(h).ids.length }];
    }),
    plotHighlightBoxRows: (_d: unknown, h: unknown) => call("boxRows " + nameOf(h), () => {
      if (cohort(h).failAgg) throw new Error("box rows of " + nameOf(h) + " failed");
      return [{ g: "A", n: cohort(h).ids.length, lo: 1, hi: 9, q1: 3, median: 5, q3: 7 }];
    }),
    plotRankedPoints: () => call("ranked", () => (o.ranked || []).map((id) => pointOf(o.shape, id))),
    plotOutlierPoints: (_d: unknown, _s: unknown, cap: number) => call("outliers", () => {
      const all = (o.outliers || []).map((id) => ({ id, g: num(id) % 2 ? "B" : "A", v: 11 + (num(id) % 97) }))
        .sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
      return { points: all.slice(0, cap), total: all.length };
    }, cap),
  };
}

const evaluated = (count: number): EvaluatedCohort =>
  ({ studies: ["s"], perStudy: { s: { sql: "", count, samples: count, mode: "patient-level" } }, count, samples: count, text: "" });

async function run(o: SiteOpts, points: unknown[], events: string[] = []): Promise<ViewResultOf<"plot">> {
  const names = Object.keys(o.cohorts);
  const cohorts: Record<string, EvaluatedCohort> = { All: evaluated(o.n ?? 1000), ...Object.fromEntries(names.map((n) => [n, evaluated(o.cohorts[n].ids.length)])) };
  const c = {
    doc: { cohorts: Object.fromEntries(Object.keys(cohorts).map((n) => [n, { all: [], name: n }])) },
    cohorts, resolvers: { s: site(o, events) }, vNames: ["All"], vStudies: ["s"],
    participationFor: (studies: string[]) => ({ studies: studies.map((s) => ({ study: s, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const view = { kind: "plot", unit: "patient", cohorts: ["All"], x: { source: "clinical", attribute: o.shape === "box" ? "CANCER_TYPE" : "AGE" },
    y: { source: "clinical", attribute: "TMB" }, points };
  const r = await runPlot(view as never, c);
  return ("result" in (r as object) ? (r as { result: ViewResultOf<"plot"> }).result : r) as ViewResultOf<"plot">;
}
const ids = (prefix: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => prefix + (from + i));
const at = (events: string[], e: string) => { const i = events.indexOf(e); assert.ok(i >= 0, "no event " + e + " in " + events.join("; ")); return i; };
const pointCaps = (events: string[], name: string) => events.filter((e) => e.startsWith("start points " + name + " ")).map((e) => Number(e.split("cap=")[1]));

// ---- D1: the answers are the sequential ones -----------------------------------------------------
describe("D1 the layers equal the sequential algorithm's", () => {
  test("D1a a layer after one that drew points is computed on the budget left, not its early full-budget answer", async () => {
    const events: string[] = [];
    // layer 0 draws 5 cases; layer 1 holds CAP - 2, which fits the full budget but not the CAP - 5 left
    const r = await run({ shape: "scatter", cohorts: { R: { ids: ids("P", 5) }, S: { ids: ids("Q", CAP - 2) } } },
      [{ cohort: "R" }, { cohort: "S" }], events);
    const [a, b] = r.plot!.layers!;
    assert.equal(a.shown, "points");
    assert.equal(a.drawn, 5);
    assert.equal(b.shown, "density", "the second layer does not fit the " + (CAP - 5) + " points left");
    assert.equal(b.why, "more cases than the " + (CAP - 5).toLocaleString("en-US") + " points the earlier layers left");
    assert.ok(pointCaps(events, "S").includes(CAP - 5), "S was asked on the budget left: " + pointCaps(events, "S"));
  });

  test("D1a a rule layer after a cohort layer that drew points is judged against the budget left", async () => {
    const r = await run({ shape: "scatter", cohorts: { R: { ids: ids("P", CAP - 1) } }, ranked: ids("X", 6) },
      [{ cohort: "R" }, { rule: "extremes", axis: "y", n: 3 }]);
    const [a, b] = r.plot!.layers!;
    assert.equal(a.drawn, CAP - 1);
    assert.equal(b.shown, "none");
    assert.equal(b.why, "6 cases, more than the 1 points the earlier layers left");
  });

  test("D1b layers before that drew no points leave the full budget, and the early answer is the one used", async () => {
    const events: string[] = [];
    // R has more cases than the cap: density, no points, so S is answered on the full budget
    const r = await run({ shape: "scatter", cohorts: { R: { ids: ids("P", CAP + 5) }, S: { ids: ids("Q", 7) } } },
      [{ cohort: "R" }, { cohort: "S" }], events);
    const [a, b] = r.plot!.layers!;
    assert.equal(a.shown, "density");
    assert.equal(a.why, "more than " + CAP.toLocaleString("en-US") + " cases, too many to draw as points");
    assert.equal(b.shown, "points");
    assert.equal(b.drawn, 7);
    assert.deepEqual(pointCaps(events, "S"), [CAP], "S asked once, on the full budget");
  });

  test("D1b a rule layer that draws nothing leaves the full budget to the next", async () => {
    const r = await run({ shape: "box", cohorts: { R: { ids: ids("P", CAP) } } }, [{ rule: "trend" }, { cohort: "R" }]);
    const [a, b] = r.plot!.layers!;
    assert.equal(a.shown, "none");
    assert.equal(b.shown, "points");
    assert.equal(b.drawn, CAP);
  });

  test("D1b shared cases: the later layer draws only its own, owners name the earlier layer, and the budget falls by what was drawn", async () => {
    const events: string[] = [];
    const r = await run({ shape: "scatter", cohorts: { R: { ids: ["P1", "P2", "P3"] }, S: { ids: ["P2", "P3", "P4"] }, T: { ids: ids("Z", CAP - 4) } } },
      [{ cohort: "R" }, { cohort: "S" }, { cohort: "T" }], events);
    const [a, b, c] = r.plot!.layers!;
    assert.deepEqual(a.points!.map((p) => p.id), ["P1", "P2", "P3"]);
    assert.deepEqual(b.points!.map((p) => p.id), ["P4"]);
    assert.deepEqual(b.shared!.map((p) => p.id), ["P2", "P3"]);
    assert.deepEqual(b.sharedOwners, [0, 0]);
    assert.equal(b.drawn, 1);
    assert.equal(b.n, 3);
    // 4 drawn, CAP - 4 left: T fits exactly
    assert.equal(c.shown, "points");
    assert.equal(c.drawn, CAP - 4);
    assert.ok(pointCaps(events, "T").includes(CAP - 4));
  });

  test("D1d every point layer starts at once: the second layer's count is asked before the first layer's points return", async () => {
    const events: string[] = [];
    await run({ shape: "scatter", cohorts: { R: { ids: ids("P", 3) }, S: { ids: ids("Q", 3) } },
      delay: (l) => (l === "points R" ? 60 : 0) }, [{ cohort: "R" }, { cohort: "S" }], events);
    assert.ok(at(events, "start count S") < at(events, "end points R cap=" + CAP), events.join("; "));
  });
});

describe("D1c the layers equal the sequential answers recorded from the code before the change", () => {
  // random layer lists, answered with random delays, against the answers the sequential code gave
  const scenarios = makeScenarios(40);
  const golden: Record<string, string> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, "utf8")) : {};
  const record = process.env.RECORD_PLOT_LAYERS_SEQUENTIAL === "1";
  const recorded: Record<string, string> = {};
  after(() => { if (record) writeFileSync(GOLDEN, JSON.stringify(recorded, null, 1) + "\n"); });
  for (const s of scenarios) {
    test("D1c " + s.id + ": " + s.label, async () => {
      const r = await run(s.site, s.points);
      const got = summary(r);
      if (record) { recorded[s.id] = got; return; }
      assert.ok(golden[s.id], "no recorded sequential answer for " + s.id + " (RECORD_PLOT_LAYERS_SEQUENTIAL=1 on the code before the change)");
      assert.equal(got, golden[s.id]);
    });
  }

});

// ---- D2 ------------------------------------------------------------------------------------------
describe("D2 concurrency across layers", () => {
  test("a big cohort layer then an outliers layer on a box: the outliers query is issued before the cohort layer's queries finish", async () => {
    const events: string[] = [];
    const r = await run({ shape: "box", n: 50_000, cohorts: { R: { ids: ids("P", CAP + 100) } }, outliers: ids("O", 30),
      delay: (l) => (l.startsWith("count R") || l.startsWith("points R") || l.startsWith("boxRows R") ? 40 : 0) },
    [{ cohort: "R" }, { rule: "outliers" }], events);
    const lastCohortEnd = Math.max(...events.map((e, i) => (/^end (count|points|boxRows) R/.test(e) ? i : -1)));
    assert.ok(at(events, "start outliers cap=" + CAP) < lastCohortEnd, events.join("; "));
    const [a, b] = r.plot!.layers!;
    assert.equal(a.shown, "boxes");
    assert.equal(b.shown, "points");
    assert.equal(b.n, 30);
  });
});

// ---- D3 ------------------------------------------------------------------------------------------
describe("D3 a cohort layer's aggregate form", () => {
  for (const shape of ["box", "scatter"] as const) {
    const agg = shape === "box" ? "boxRows" : "bins";
    test("D3a " + shape + ", more cases in the plot than the budget: " + agg + " starts beside the points", async () => {
      const events: string[] = [];
      const r = await run({ shape, cohorts: { R: { ids: ids("P", CAP + 1) } }, delay: (l) => (l === "points R" ? 50 : 0) },
        [{ cohort: "R" }], events);
      assert.ok(at(events, "start " + agg + " R") < at(events, "end points R cap=" + CAP), events.join("; "));
      assert.equal(r.plot!.layers![0].shown, shape === "box" ? "boxes" : "density");
      assert.equal(r.plot!.layers![0].n, CAP + 1);
    });
    test("D3a " + shape + ", more cases than the budget but the points fit after all: drawn as points", async () => {
      const events: string[] = [];
      // the count says CAP + 1 but the points query answers 2 (as when cases lack an axis value)
      const o: SiteOpts = { shape, cohorts: { R: { ids: ids("P", CAP + 1) } } };
      const s = site(o, events);
      const r = await runWith(o, s, (sx) => { sx.plotHighlightPoints = async () => [pointOf(shape, "P1"), pointOf(shape, "P2")]; });
      assert.equal(r.plot!.layers![0].shown, "points");
      assert.equal(r.plot!.layers![0].n, 2);
    });
    test("D3b " + shape + ", in-plot count within the budget and the points fit: no aggregate is asked", async () => {
      const events: string[] = [];
      const r = await run({ shape, cohorts: { R: { ids: ids("P", CAP) } } }, [{ cohort: "R" }], events);
      assert.equal(r.plot!.layers![0].shown, "points");
      assert.ok(!events.some((e) => e.startsWith("start " + agg)), events.join("; "));
    });
    test("D3b " + shape + ", in-plot count within the budget but the points do not fit: the aggregate is asked after the points", async () => {
      const events: string[] = [];
      const o: SiteOpts = { shape, cohorts: { R: { ids: ids("P", 10) } }, delay: (l) => (l === "points R" ? 30 : 0) };
      const r = await runWith(o, site(o, events), (sx) => {
        const real = sx.plotHighlightPoints;
        sx.plotHighlightPoints = async (...a: Parameters<typeof real>) => { await real(...a); return ids("P", CAP + 1).map((id) => pointOf(shape, id)); };
      });
      assert.ok(at(events, "start " + agg + " R") > at(events, "end points R cap=" + CAP), events.join("; "));
      assert.equal(r.plot!.layers![0].shown, shape === "box" ? "boxes" : "density");
    });
  }
});

/** run with a participant the test adjusts first */
async function runWith(o: SiteOpts, s: ReturnType<typeof site>, adjust: (s: Record<string, any>) => void): Promise<ViewResultOf<"plot">> {
  adjust(s as Record<string, any>);
  const names = Object.keys(o.cohorts);
  const cohorts: Record<string, EvaluatedCohort> = { All: evaluated(o.n ?? 1000), ...Object.fromEntries(names.map((n) => [n, evaluated(o.cohorts[n].ids.length)])) };
  const c = {
    doc: { cohorts: Object.fromEntries(Object.keys(cohorts).map((n) => [n, { all: [], name: n }])) },
    cohorts, resolvers: { s }, vNames: ["All"], vStudies: ["s"],
    participationFor: (studies: string[]) => ({ studies: studies.map((x) => ({ study: x, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const view = { kind: "plot", unit: "patient", cohorts: ["All"], x: { source: "clinical", attribute: o.shape === "box" ? "CANCER_TYPE" : "AGE" },
    y: { source: "clinical", attribute: "TMB" }, points: names.map((n) => ({ cohort: n })) };
  const r = await runPlot(view as never, c);
  return ("result" in (r as object) ? (r as { result: ViewResultOf<"plot"> }).result : r) as ViewResultOf<"plot">;
}

// ---- D4 ------------------------------------------------------------------------------------------
describe("D4 rejections", () => {
  test("D4a a layer whose early full-budget computation fails, but which is recomputed on the budget left: no unhandled rejection, same answer", async () => {
    const before = unhandled.length;
    const r = await run({ shape: "scatter", cohorts: { R: { ids: ids("P", 3) }, S: { ids: ids("Q", 4), failPoints: (cap) => cap === CAP } },
      delay: (l) => (l === "points R" ? 20 : 0) }, [{ cohort: "R" }, { cohort: "S" }]);
    await drain();
    assert.equal(r.error, undefined, String(r.error));
    assert.equal(r.plot!.layers![1].shown, "points");
    assert.equal(r.plot!.layers![1].drawn, 4);
    assert.equal(unhandled.length, before, "unhandled: " + unhandled.slice(before).map(String).join("; "));
  });

  test("D4a an aggregate started beside the points that fails, when the points fit: no unhandled rejection, drawn as points", async () => {
    const before = unhandled.length;
    const o: SiteOpts = { shape: "box", cohorts: { R: { ids: ids("P", CAP + 1), failAgg: true } } };
    const r = await runWith(o, site(o, []), (sx) => { sx.plotHighlightPoints = async () => { await sleep(10); return [pointOf("box", "P1")]; }; });
    await drain();
    assert.equal(r.error, undefined, String(r.error));
    assert.equal(r.plot!.layers![0].shown, "points");
    assert.equal(unhandled.length, before, "unhandled: " + unhandled.slice(before).map(String).join("; "));
  });

  test("D4b the first layer's failure is the view's error, as before", async () => {
    const r = await run({ shape: "scatter", cohorts: { R: { ids: ids("P", 3), failPoints: () => true }, S: { ids: ids("Q", 4) } } },
      [{ cohort: "R" }, { cohort: "S" }]);
    await drain();
    assert.match(String(r.error), /points of R failed at cap 10000/);
  });

  test("D4b a later layer's failure, on the full budget the earlier ones left, is the view's error", async () => {
    const r = await run({ shape: "scatter", cohorts: { R: { ids: ids("P", CAP + 1) }, S: { ids: ids("Q", 4), failPoints: () => true } } },
      [{ cohort: "R" }, { cohort: "S" }]);
    await drain();
    assert.match(String(r.error), /points of S failed at cap 10000/);
  });

  test("D4b an aggregate that fails when it is needed is the view's error", async () => {
    const r = await run({ shape: "box", cohorts: { R: { ids: ids("P", CAP + 1), failAgg: true } } }, [{ cohort: "R" }]);
    await drain();
    assert.match(String(r.error), /box rows of R failed/);
  });
});

// ---- D5 ------------------------------------------------------------------------------------------
describe("D5 a cohort layer's count", () => {
  test("asked once per layer, though the layer is computed on the full budget and again on the budget left", async () => {
    const events: string[] = [];
    await run({ shape: "scatter", cohorts: { R: { ids: ids("P", 3) }, S: { ids: ids("Q", 4) }, T: { ids: ids("Z", 5) } } },
      [{ cohort: "R" }, { cohort: "S" }, { cohort: "T" }], events);
    for (const n of ["R", "S", "T"]) assert.equal(events.filter((e) => e === "start count " + n).length, 1, n + ": " + events.join("; "));
  });
});

// ---- D1c scenarios -------------------------------------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function makeScenarios(count: number): { id: string; label: string; site: SiteOpts; points: unknown[] }[] {
  const out: { id: string; label: string; site: SiteOpts; points: unknown[] }[] = [];
  const sizes = [0, 1, 3, 40, CAP - 30, CAP - 1, CAP, CAP + 1, 2 * CAP];
  const starts = [0, 2, 20, 9990];
  for (let k = 0; k < count; k++) {
    const r = rng(1000 + k);
    const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
    const shape: Shape = r() < 0.5 ? "scatter" : "box";
    const nLayers = 1 + Math.floor(r() * 4);
    const cohorts: Record<string, CohortCases> = {};
    const points: unknown[] = [];
    const parts: string[] = [];
    for (let i = 0; i < nLayers; i++) {
      const kind = pick(["cohort", "cohort", "extremes", "trend", "outliers"]);
      if (kind === "cohort") {
        const name = "C" + i, size = pick(sizes), from = pick(starts);
        cohorts[name] = { ids: ids("P", size, from) };
        points.push({ cohort: name });
        parts.push(name + "(" + size + "@" + from + ")");
      } else if (kind === "outliers") {
        points.push({ rule: "outliers", ...(r() < 0.3 ? { n: pick([1, 5]) } : {}) });
        parts.push("outliers");
      } else {
        const n = pick([1, 5, 50]);
        points.push(kind === "trend" ? { rule: "trend", n } : { rule: "extremes", axis: "y", n });
        parts.push(kind + " " + n);
      }
    }
    const delays = new Map<string, number>();
    const site: SiteOpts = {
      shape, n: pick([500, 20_000]), cohorts, ranked: ids("P", pick([4, 60, 600]), pick(starts)), outliers: ids("P", pick([3, 40, CAP + 50]), pick(starts)),
      // a fixed delay per call label, drawn from the scenario's own sequence
      delay: (label) => { if (!delays.has(label)) delays.set(label, Math.floor(r() * 4)); return delays.get(label)!; },
    };
    out.push({ id: "s" + k, label: shape + " " + parts.join(", "), site, points });
  }
  return out;
}

/** a run's layers and caption, as a readable head and a hash of the whole */
function summary(r: ViewResultOf<"plot">): string {
  if (r.error) return "error " + r.error;
  const ls = r.plot!.layers || [];
  const head = ls.map((l) => [l.kind, l.shown, l.n, l.drawn, l.inPlot, l.points?.length, l.shared?.length, l.why].map((x) => x ?? "-").join("|")).join(" / ");
  return head + " #" + createHash("sha256").update(JSON.stringify({ ls, note: r.note })).digest("hex").slice(0, 16);
}
