// The plot view's runner (lib/views/plot/run.ts) on the paths test/plot-layers.test.ts,
// plot-points.test.ts and plot-violin-pooled.test.ts leave: an axis refused before anything runs,
// copy-number levels in their own order, a colour and ring key from the drawn cases, the caption
// when the cohort is drawn as density, and the federated scatter, contingency table and box pooled
// from per-site aggregates. The resolvers are hand-made fakes that record what they are asked.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot } from "../lib/views/plot/run.ts";
import { CATEGORY_CAP, POINTS_CAP, DEFAULT_BINS, type PlotData } from "../lib/plot.ts";
import { pearsonFromMoments, regressionFromMoments } from "../lib/stats.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResultOf } from "../lib/types.ts";

type Box = ViewResultOf<"plot">;
type BoxRow = { g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number };
type Calls = string[];

const evaluated = (studies: string[], count = 100): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count, samples: count, mode: "patient-level" }])), count, samples: count, text: "" });

async function run(resolvers: Record<string, unknown>, view: Record<string, unknown>, extra: Partial<ViewRun> = {}): Promise<Box> {
  const studies = Object.keys(resolvers);
  const c = {
    doc: { cohorts: { All: { all: [] } } },
    cohorts: { All: evaluated(studies) }, resolvers, vNames: ["All"], vStudies: studies,
    participationFor: (s: string[]) => ({ studies: s.map((x) => ({ study: x, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
    ...extra,
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], x: { source: "clinical", attribute: "X" }, y: { source: "clinical", attribute: "Y" }, points: [], ...view };
  const r = await runPlot(v as never, c);
  return "result" in (r as object) ? (r as { result: Box }).result : r as Box;
}

const boxData = (groups: string[], n = 10): PlotData => ({ shape: "box", n: n * groups.length, x: { label: "CNA", kind: "cat" }, y: { label: "mRNA", kind: "num" },
  groups: groups.map((g) => ({ g, n, lo: 0, hi: 10, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 })), overlay: "none" });
const scatterData = (n: number): PlotData => ({ shape: "scatter", n, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
  extent: { x0: 0, x1: 1, y0: 0, y1: 1 }, grid: DEFAULT_BINS, bins: [{ bx: 0, by: 0, n: Math.ceil(n / 2) }, { bx: 1, by: 1, n: Math.floor(n / 2) }],
  stats: { pearson: 0.2, spearman: 0.2, slope: 1, intercept: 0, pPearson: 0.4, pSpearman: 0.4 } });

/** one local participant: its plot canned, its case-level answers canned, every call recorded */
function local(data: () => PlotData, calls: Calls, o: { points?: unknown[]; scatterPoints?: unknown[]; mode?: "patient-level" | "aggregate-only" } = {}) {
  const r: Record<string, unknown> = {
    instance: { id: "local", mode: o.mode ?? "patient-level", conn: { db: "db" }, label: "local" },
    plot: async (_def: unknown, spec: unknown) => { calls.push("plot " + JSON.stringify(spec)); return data(); },
  };
  if ((o.mode ?? "patient-level") === "patient-level") {
    r.plotPoints = async () => { calls.push("points"); return o.points ?? []; };
    r.plotScatterPoints = async () => { calls.push("scatterPoints"); return o.scatterPoints ?? []; };
  }
  return r;
}

describe("plot: an axis is refused before anything runs", () => {
  test("a profile the study does not hold, named with the axis", async () => {
    const calls: Calls = [];
    const r = await run({ s1: local(() => boxData(["A"]), calls) }, { x: { source: "profile", profile: "nope", gene: "TP53" } });
    assert.match(r.error!, /^x axis: s1 has no profile 'nope'; it has none a plot axis can read/);
    assert.deepEqual(calls, [], "the plot is not asked");
  });

  test("a generic-assay entity the study does not have, with what it has instead", async () => {
    const calls: Calls = [];
    const s1 = { ...local(() => boxData(["A"]), calls),
      viewMeta: async (label: string) => label === "assay:entities" ? [{ entity: "B_CELLS", total: 1 }, { entity: "T_CELLS", total: 1 }] : [],
      viewAggregate: async () => [] };
    const r = await run({ s1 }, { y: { source: "assay", profileType: "IMMUNE", entity: "NK_CELLS" } });
    assert.equal(r.error, "y axis: s1's IMMUNE has no entity 'NK_CELLS'; it has B_CELLS, T_CELLS");
    assert.deepEqual(calls, []);
  });

  test("a point layer that is not an object", async () => {
    const r = await run({ s1: local(() => boxData(["A"]), []) }, { points: [7] });
    assert.match(r.error!, /points: each layer is an object/);
  });
});

describe("plot: one study", () => {
  test("a box grouped by a discrete copy-number profile runs from deep deletion to amplification, anything else after", async () => {
    const data = () => boxData(["Amplification", "Other", "Diploid", "Deep deletion", "Gain"]);
    const r = await run({ s1: local(data, []) }, { x: { source: "molecular", profileType: "cna", gene: "TP53", discrete: true, label: "TP53: CNA" } });
    assert.deepEqual(r.plot!.groups!.map((g) => g.g), ["Deep deletion", "Diploid", "Gain", "Amplification", "Other"]);
  });

  test("the levels keep the plot's order when the category is not a discrete profile, or the shape is not a box", async () => {
    const cont = await run({ s1: local(() => boxData(["Amplification", "Diploid"]), []) }, { x: { source: "molecular", profileType: "mrna", gene: "TP53" } });
    assert.deepEqual(cont.plot!.groups!.map((g) => g.g), ["Amplification", "Diploid"]);
    const clin = await run({ s1: local(() => boxData(["Amplification", "Diploid"]), []) }, {});
    assert.deepEqual(clin.plot!.groups!.map((g) => g.g), ["Amplification", "Diploid"]);
  });

  test("the bins asked for reach the participant; unset, the plot's own default", async () => {
    const calls: Calls = [];
    await run({ s1: local(() => scatterData(4), calls) }, { bins: [30, 20] });
    assert.deepEqual(JSON.parse(calls[0].slice(5)).bins, [30, 20]);
    const c2: Calls = [];
    await run({ s1: local(() => scatterData(4), c2) }, {});
    assert.equal(JSON.parse(c2[0].slice(5)).bins, undefined);
  });

  test("a box's drawn cases make the colour key, and the ring key after it", async () => {
    const pts = [{ id: "P1", g: "A", v: 1, c: "Missense", r: "Amplified" }, { id: "P2", g: "A", v: 2, c: "Missense", r: "" },
      { id: "P3", g: "A", v: 3, c: "Truncating", r: "Amplified" }];
    const r = await run({ s1: local(() => boxData(["A"], 3), [], { points: pts }) },
      { colorBy: { source: "clinical", attribute: "C" }, ringBy: { source: "clinical", attribute: "R" } });
    const p = r.plot!;
    assert.equal(p.overlay, "points");
    assert.deepEqual(p.pointSet, { rule: "all", drawn: 3 });
    assert.deepEqual(p.legend!.map((l) => [l.label, !!l.ring]), [["Missense", false], ["Truncating", false], ["Amplified", true]]);
  });

  test("a participant that has no cases to give leaves a box as density, and the caption says the quartiles are over every value", async () => {
    const calls: Calls = [];
    const r = await run({ s1: local(() => boxData(["A"], 3), calls, { points: [] }) }, {});
    assert.ok(calls.includes("points"));
    assert.equal(r.plot!.points, undefined);
    assert.equal(r.plot!.pointSet, undefined);
    assert.match(r.note!, /Drawn as a density per group; the quartiles are over every value\./);
  });

  test("a scatter with no cases to give is drawn as density, its cells counted in the caption", async () => {
    const r = await run({ s1: local(() => scatterData(1), [], { scatterPoints: [] }) }, { unit: "patient" });
    assert.equal(r.plot!.xyPoints, undefined);
    assert.match(r.note!, /Drawn as density: 1 patient counted into 2 cells\. The coefficients are over every patient/);
  });

  test("an aggregate-only participant names itself in the caption as the reason no case is a point", async () => {
    const r = await run({ s1: local(() => scatterData(20), [], { mode: "aggregate-only" }) }, {});
    assert.equal(r.plot!.pointSet!.rule, "none");
    assert.match(r.note!, /Drawn as density: 20 samples counted into 2 cells.* No case is drawn as a point: s1 may not show individual cases\./);
  });
});

/** a federated participant: canned aggregates per method */
function fed(o: {
  kinds?: { xk: string; yk: string; shape: string };
  extent?: { n: number; x0: number; x1: number; y0: number; y1: number };
  bins?: { bx: number; by: number; n: number }[];
  moments?: { n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number };
  cells?: { cx: string; cy: string; n: number }[];
  boxRows?: BoxRow[];
  points?: unknown[];
  coverage?: { total: number; nx: number; ny: number; multi?: number };
  mode?: "patient-level" | "aggregate-only";
}, calls: Calls = []) {
  const r: Record<string, unknown> = {
    instance: { id: "local", mode: o.mode ?? "patient-level", conn: { db: "db" }, label: "site" },
    plotAxisKinds: async () => { const k = o.kinds ?? { xk: "num", yk: "num", shape: "scatter" }; return { ...k, xLabel: "X label", yLabel: "Y label" }; },
    plotExtent: async () => o.extent ?? { n: 0, x0: 0, x1: 0, y0: 0, y1: 0 },
    plotBinCounts: async (_d: unknown, _s: unknown, _xk: unknown, _yk: unknown, bins: unknown, extent: unknown) => {
      calls.push("bins " + JSON.stringify(bins) + " " + JSON.stringify(extent)); return o.bins ?? [];
    },
    plotMoments: async () => o.moments ?? { n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 },
    plotTableCells: async () => o.cells ?? [],
    plotBoxRows: async () => o.boxRows ?? [],
    plotViolinCounts: async () => { calls.push("violin"); return []; },
    plotCoverage: async () => o.coverage ?? { total: 0, nx: 0, ny: 0 },
  };
  if ((o.mode ?? "patient-level") === "patient-level") {
    r.plotPoints = async () => o.points ?? [];
    r.plotScatterPoints = async () => [];
  }
  return r;
}

describe("plot: several studies, pooled from per-site aggregates", () => {
  test("a participant without the federated plot is named, and nothing is pooled", async () => {
    const r = await run({ s1: fed({}), peer1: { instance: { id: "peer", mode: "aggregate-only", conn: { db: "db" }, label: "peer" } } }, {});
    assert.equal(r.error, "a federated plot needs every participant to support it, and peer1 does not yet (a remote federation peer, most likely).");
  });

  test("an ordered-cases axis is refused", async () => {
    const r = await run({ s1: fed({ kinds: { xk: "num", yk: "num", shape: "waterfall" } }), s2: fed({}) }, {});
    assert.match(r.error!, /a waterfall\) is not implemented yet/);
  });

  test("scatter: one shared extent, cells summed, Pearson and the line from the pooled sums, no Spearman", async () => {
    const calls: Calls = [];
    const m1 = { n: 3, sx: 6, sy: 7, sxy: 16, sxx: 14, syy: 21 }, m2 = { n: 2, sx: 9, sy: 5, sxy: 24, sxx: 41, syy: 13 };
    const r = await run({
      s1: fed({ extent: { n: 3, x0: 1, x1: 3, y0: 1, y1: 4 }, bins: [{ bx: 0, by: 0, n: 2 }, { bx: 5, by: 5, n: 1 }], moments: m1,
        coverage: { total: 4, nx: 3, ny: 4 } }, calls),
      s2: fed({ extent: { n: 2, x0: 4, x1: 5, y0: 2, y1: 3 }, bins: [{ bx: 0, by: 0, n: 1 }, { bx: 9, by: 2, n: 1 }], moments: m2,
        coverage: { total: 2, nx: 2, ny: 2 } }, calls),
      s3: fed({ extent: { n: 0, x0: -99, x1: 99, y0: -99, y1: 99 } }, calls),
    }, { bins: [10, 10] });
    const p = r.plot!;
    assert.equal(p.shape, "scatter");
    assert.equal(p.n, 5);
    assert.deepEqual(p.extent, { x0: 1, x1: 5, y0: 1, y1: 4 }, "a site with no cases does not widen the extent");
    assert.equal(calls.filter((x) => x === "bins [10,10] " + JSON.stringify(p.extent)).length, 3, "every site bins against the same grid and extent");
    assert.deepEqual(p.bins!.map((b) => [b.bx, b.by, b.n]).sort(), [[0, 0, 3], [5, 5, 1], [9, 2, 1]]);
    const pooled = { n: 5, sx: 15, sy: 12, sxy: 40, sxx: 55, syy: 34 };
    assert.equal(p.stats!.pearson, pearsonFromMoments(pooled).r);
    assert.equal(p.stats!.slope, regressionFromMoments(pooled).slope);
    assert.equal(p.stats!.spearman, null);
    assert.deepEqual(p.coverage, { total: 6, nx: 5, ny: 6 });
    assert.match(r.note!, /3 studies pooled \(s1, s2, s3\)\. Each site reports six sums/);
    assert.match(r.note!, /Spearman rank correlation is not reported for a federated plot/);
    assert.deepEqual(r.studies, ["s1", "s2", "s3"]);
  });

  test("scatter: no case with both axes anywhere", async () => {
    const r = await run({ s1: fed({}), s2: fed({}) }, { unit: "patient" });
    assert.equal(r.plot!.n, 0);
    assert.equal(r.plot!.note, "no patient has a value on both axes");
  });

  test("contingency table: the cells add across sites, largest first, and the patients with several samples are summed", async () => {
    const kinds = { xk: "cat", yk: "cat", shape: "table" };
    const r = await run({
      s1: fed({ kinds, cells: [{ cx: "Male", cy: "Yes", n: 3 }, { cx: "Female", cy: "No", n: 2 }], coverage: { total: 5, nx: 5, ny: 5, multi: 1 } }),
      s2: fed({ kinds, cells: [{ cx: "Male", cy: "Yes", n: 4 }, { cx: "Male", cy: "No", n: 5 }], coverage: { total: 9, nx: 9, ny: 9 } }),
    }, { unit: "patient" });
    const p = r.plot!;
    assert.equal(p.shape, "table");
    assert.equal(p.n, 14);
    assert.deepEqual(p.cells, [{ cx: "Male", cy: "Yes", n: 7 }, { cx: "Male", cy: "No", n: 5 }, { cx: "Female", cy: "No", n: 2 }]);
    assert.deepEqual(p.coverage, { total: 14, nx: 14, ny: 14, multi: 1 });
    assert.match(r.note!, /^1 patient has more than one sample/);
    assert.match(r.note!, /Contingency counts are exact sums/);
  });

  test("contingency table: empty, and past the category cap", async () => {
    const kinds = { xk: "cat", yk: "cat", shape: "table" };
    const empty = await run({ s1: fed({ kinds }), s2: fed({ kinds }) }, {});
    assert.equal(empty.plot!.note, "no sample has a value on both axes");
    const many = Array.from({ length: CATEGORY_CAP + 1 }, (_, i) => ({ cx: "c" + i, cy: "Yes", n: 1 }));
    const wide = await run({ s1: fed({ kinds, cells: many }), s2: fed({ kinds }) }, {});
    assert.match(wide.error!, new RegExp("this pair has " + (CATEGORY_CAP + 1) + " distinct categories on one axis and " + CATEGORY_CAP));
  });

  test("box: past the category cap is refused", async () => {
    const kinds = { xk: "cat", yk: "num", shape: "box" };
    const rows = Array.from({ length: CATEGORY_CAP + 1 }, (_, i) => ({ g: "g" + i, n: 1, lo: 0, hi: 1, q1: 0, median: 0, q3: 1 }));
    const r = await run({ s1: fed({ kinds, boxRows: rows }), s2: fed({ kinds }) }, {});
    assert.match(r.error!, new RegExp("more than " + CATEGORY_CAP + " groups on the categorical axis"));
  });

  test("box: every site's cases concatenate into points, with the colour and ring keys", async () => {
    const kinds = { xk: "cat", yk: "num", shape: "box" };
    const calls: Calls = [];
    const row = (n: number): BoxRow[] => [{ g: "A", n, lo: 0, hi: 9, q1: 2, median: 4, q3: 6 }];
    const r = await run({
      s1: fed({ kinds, boxRows: row(2), points: [{ id: "P1", g: "A", v: 1, c: "Yes", r: "Ring" }, { id: "P2", g: "A", v: 2, c: "Yes", r: "" }] }, calls),
      s2: fed({ kinds, boxRows: row(1), points: [{ id: "P1", g: "A", v: 3, c: "No", r: "" }] }, calls),
    }, { colorBy: { source: "clinical", attribute: "C" }, ringBy: { source: "clinical", attribute: "R" } });
    const p = r.plot!;
    assert.equal(p.points!.length, 3, "two studies' equal ids stay two cases");
    assert.equal(p.overlay, "points");
    assert.deepEqual(p.legend!.map((l) => [l.label, !!l.ring]), [["Yes", false], ["No", false], ["Ring", true]]);
    assert.ok(!calls.includes("violin"), "with every case a point, no density is asked for");
  });

  test("box: more cases than the figure draws leaves the points out and draws the pooled density", async () => {
    const kinds = { xk: "cat", yk: "num", shape: "box" };
    const calls: Calls = [];
    const many = Array.from({ length: POINTS_CAP }, (_, i) => ({ id: "P" + i, g: "A", v: i }));
    const rows: BoxRow[] = [{ g: "A", n: POINTS_CAP, lo: 0, hi: 9, q1: 2, median: 4, q3: 6 }];
    const r = await run({ s1: fed({ kinds, boxRows: rows, points: many }, calls), s2: fed({ kinds, boxRows: rows, points: [{ id: "Q", g: "A", v: 1 }] }, calls) }, {});
    assert.equal(r.plot!.points, undefined);
    assert.equal(r.plot!.overlay, "violin");
    assert.equal(calls.filter((x) => x === "violin").length, 2);
  });

  // Every case is a point "from a participant that may show cases" (doc.ts), and a view is drawn over
  // every patient of its cohorts or not at all (CLAUDE.md invariant 10); run.ts:560 instead lets a
  // closed site contribute no cases and still marks the open site's cases as pointSet rule "all".
  test("box: a site that may not show cases means no case is drawn as a point, and the density is", {
    todo: "run.ts:560-566 draws the open site's cases alone as rule \"all\", silently missing the closed site's cases" }, async () => {
    const kinds = { xk: "cat", yk: "num", shape: "box" };
    const calls: Calls = [];
    const rows: BoxRow[] = [{ g: "A", n: 2, lo: 0, hi: 9, q1: 2, median: 4, q3: 6 }];
    const r = await run({ s1: fed({ kinds, boxRows: rows, points: [{ id: "P", g: "A", v: 1 }] }, calls), s2: fed({ kinds, boxRows: rows, mode: "aggregate-only" }, calls) }, {});
    assert.equal(r.plot!.points, undefined);
    assert.equal(r.plot!.overlay, "violin");
  });
  test("box: a peer that refuses its cases leaves the points out, and the pooled density is drawn", async () => {
    const kinds = { xk: "cat", yk: "num", shape: "box" };
    const calls: Calls = [];
    const rows: BoxRow[] = [{ g: "A", n: 2, lo: 0, hi: 9, q1: 2, median: 4, q3: 6 }];
    const peer = { ...fed({ kinds, boxRows: rows }, calls), instance: { id: "peer", mode: "aggregate-only", conn: { db: "db" }, label: "peer" },
      plotPoints: async () => { throw new Error("its rules do not share plot cases"); }, plotScatterPoints: async () => [] };
    const r = await run({ s1: fed({ kinds, boxRows: rows, points: [{ id: "P", g: "A", v: 1 }] }, calls), peer1: peer }, {});
    assert.equal(r.plot!.points, undefined);
    assert.equal(r.plot!.overlay, "violin");
    assert.equal(calls.filter((x) => x === "violin").length, 2);
  });
});
