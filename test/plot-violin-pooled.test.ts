// A box pooled across studies draws a density behind its boxes when it draws no points: every site
// bins its values over one shared range, so the counts add. The resolvers are fakes that record
// what they were asked, so the test can say that every site was given the same range and bins.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot, pooledViolinRange } from "../lib/views/plot/run.ts";
import { plotViolinSql, VIOLIN_BINS } from "../lib/plot.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResultOf } from "../lib/types.ts";
import type { PlotGroup } from "../lib/plot.ts";

type BoxRow = { g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number };
type Asked = { bins: number; range: [number, number] };

/** a site of a pooled box: its rows and density bins canned, every violin request recorded */
function site(mode: "patient-level" | "aggregate-only", rows: BoxRow[], bins: { g: string; b: number; n: number; c?: string }[],
  asked: Asked[], o: { peer?: boolean; refuse?: string } = {}) {
  const r: Record<string, unknown> = {
    instance: { id: o.peer ? "peer" : "local", mode, conn: { db: "db" }, label: mode },
    plotAxisKinds: async () => ({ xk: "cat", yk: "num", shape: "box", xLabel: "CNA", yLabel: "mRNA" }),
    plotBoxRows: async () => rows,
    plotCoverage: async () => ({ total: rows.reduce((a, x) => a + x.n, 0), nx: 0, ny: 0 }),
    plotViolinCounts: async (_d: unknown, _s: unknown, _xk: unknown, _yk: unknown, b: number, range: [number, number]) => {
      if (o.refuse) throw new Error(o.refuse);
      asked.push({ bins: b, range });
      return bins;
    },
  };
  if (mode === "patient-level") r.plotPoints = async () => rows.map((x, i) => ({ id: "P" + i, g: x.g, v: x.median }));
  return r;
}

const evaluated = (studies: string[]): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count: 10, mode: "patient-level" }])), count: 10, text: "" });

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

const ROWS_A: BoxRow[] = [{ g: "Diploid", n: 60, lo: 0, hi: 10, q1: 4, median: 5, q3: 6 }];
const ROWS_B: BoxRow[] = [{ g: "Diploid", n: 40, lo: 1, hi: 50, q1: 4, median: 5, q3: 6 },
  { g: "Gain", n: 20, lo: 2, hi: 9, q1: 5, median: 6, q3: 7 }];

describe("pooledViolinRange: the shared range a pooled box's density is binned over", () => {
  const g = (lo: number, hi: number, loWhisker: number, hiWhisker: number): PlotGroup =>
    ({ g: "A", n: 1, lo, hi, q1: 0, median: 0, q3: 0, loWhisker, hiWhisker });

  test("the whiskers, reaching at most one whisker span past them: the axis the figure draws", () => {
    const { range, bins } = pooledViolinRange([g(-100, 1000, 0, 10), g(2, 8, 2, 8)]);
    assert.deepEqual(range, [-10, 20], "an extreme value does not stretch the range past one span");
    assert.equal(bins, 3 * VIOLIN_BINS, "three spans, each cut as finely as a single study's");
  });

  test("no further than the data reaches", () => {
    const { range, bins } = pooledViolinRange([g(0, 10, 0, 10)]);
    assert.deepEqual(range, [0, 10]);
    assert.equal(bins, VIOLIN_BINS);
  });

  test("a group with no spread still gets a range and the default bins", () => {
    const { range, bins } = pooledViolinRange([g(5, 5, 5, 5)]);
    assert.deepEqual(range, [5, 5]);
    assert.equal(bins, VIOLIN_BINS);
  });
});

describe("a pooled box's density", () => {
  test("with no points drawn, every site is asked for the same bins over the same range, and the counts add", async () => {
    const a: Asked[] = [], b: Asked[] = [];
    const r = await run({
      a: site("aggregate-only", ROWS_A, [{ g: "Diploid", b: 3, n: 10 }, { g: "Diploid", b: 4, n: 5 }], a),
      b: site("aggregate-only", ROWS_B, [{ g: "Diploid", b: 3, n: 7 }, { g: "Gain", b: 4, n: 2 }], b),
    });
    assert.equal(r.error, undefined);
    const p = r.plot!;
    assert.equal(p.overlay, "violin");
    assert.equal(a.length, 1); assert.deepEqual(a, b, "one range and one bin count for every site");
    assert.deepEqual(p.violinExtent, a[0].range, "the figure maps a bin through the range it was cut over");
    assert.equal(p.violinBins, a[0].bins);
    const sorted = [...p.violin!].sort((x, y) => x.g.localeCompare(y.g) || x.b - y.b);
    assert.deepEqual(sorted, [{ g: "Diploid", b: 3, n: 17 }, { g: "Diploid", b: 4, n: 5 }, { g: "Gain", b: 4, n: 2 }]);
    assert.match(p.note!, /binned by every site over one shared range/);
    assert.doesNotMatch(p.note!, /does not draw a density/);
  });

  test("with every case drawn as a point, no density is asked for", async () => {
    const a: Asked[] = [], b: Asked[] = [];
    const r = await run({ a: site("patient-level", ROWS_A, [], a), b: site("patient-level", ROWS_B, [], b) });
    assert.equal(r.plot!.overlay, "points");
    assert.equal(a.length + b.length, 0);
  });

  test("allPoints: false draws the density even where the sites could show every case", async () => {
    const a: Asked[] = [], b: Asked[] = [];
    const r = await run({ a: site("patient-level", ROWS_A, [{ g: "Diploid", b: 0, n: 1 }], a),
      b: site("patient-level", ROWS_B, [{ g: "Diploid", b: 0, n: 2 }], b) }, { allPoints: false });
    assert.equal(r.plot!.overlay, "violin");
    assert.deepEqual(r.plot!.violin, [{ g: "Diploid", b: 0, n: 3 }]);
    assert.equal(r.plot!.points, undefined);
  });

  test("coloured: each class keeps its own counts, and the key is made from them", async () => {
    const a: Asked[] = [], b: Asked[] = [];
    const r = await run({
      a: site("aggregate-only", ROWS_A, [{ g: "Diploid", b: 1, n: 4, c: "Female" }, { g: "Diploid", b: 1, n: 3, c: "Male" }], a),
      b: site("aggregate-only", ROWS_B, [{ g: "Diploid", b: 1, n: 1, c: "Female" }], b),
    }, { colorBy: { source: "clinical", attribute: "SEX" } });
    const p = r.plot!;
    assert.deepEqual([...p.violin!].sort((x, y) => x.c!.localeCompare(y.c!)),
      [{ g: "Diploid", b: 1, n: 5, c: "Female" }, { g: "Diploid", b: 1, n: 3, c: "Male" }]);
    assert.deepEqual(p.legend!.map((k) => k.label).sort(), ["Female", "Male"]);
    assert.equal(p.colorLabel, "SEX");
  });

  test("a peer that cannot answer leaves the boxes bare and the caption says why", async () => {
    const a: Asked[] = [], b: Asked[] = [];
    const r = await run({
      a: site("aggregate-only", ROWS_A, [{ g: "Diploid", b: 0, n: 1 }], a),
      b: site("aggregate-only", ROWS_B, [], b, { peer: true, refuse: "unknown op violin" }),
    });
    assert.equal(r.error, undefined, "an older peer does not fail the view");
    assert.equal(r.plot!.overlay, "none");
    assert.equal(r.plot!.violin, undefined, "never one site's density standing in for all of them");
    assert.match(r.plot!.note!, /No density is drawn behind the boxes: unknown op violin\./);
  });

  test("a local site's failure is a real error, not a quiet bare box", async () => {
    const r = await run({
      a: site("aggregate-only", ROWS_A, [], []),
      b: site("aggregate-only", ROWS_B, [], [], { refuse: "ClickHouse timed out" }),
    });
    assert.match(r.error || "", /ClickHouse timed out/);
  });
});

describe("plotViolinSql with a shared range", () => {
  test("bins over the given range and leaves out what lies past it", () => {
    const sql = String(plotViolinSql("SELECT 1 AS id, 1 AS v", "SELECT 1 AS id, 'a' AS v", "SELECT 1", 120, undefined, [-2.5, 7]));
    assert.match(sql, /e AS \(SELECT -2\.5 AS x0, 7 AS x1\)/);
    assert.match(sql, /WHERE x >= x0 AND x <= x1/);
    assert.match(sql, /least\(119,/, "the bin count asked for");
    assert.doesNotMatch(sql, /quantileExact/, "no site cuts its own range");
  });

  test("a single study still cuts its own middle 99% and keeps every value", () => {
    const sql = String(plotViolinSql("SELECT 1 AS id, 1 AS v", "SELECT 1 AS id, 'a' AS v", "SELECT 1"));
    assert.match(sql, /quantileExact\(0\.005\)/);
    assert.doesNotMatch(sql, /WHERE x >= x0/);
  });

  test("a range that is not a pair of finite numbers is refused", () => {
    assert.throws(() => plotViolinSql("a", "b", "c", 40, undefined, [0, Infinity]), /finite/);
  });
});
