// Written from docs/legacy-spec/parity/density-cases.md section R (the plot view's `range`, cBioLab's
// own rules), one test per row named by its id, without reference to the implementation. The
// harnesses are those of test/view-plot.test.ts (fake resolvers for runPlot),
// test/federation-api-ops.test.ts (a stand-in warehouse answering the peer's `plot` op) and
// test/federation-remote-resolver.test.ts (a stand-in fetch for the remote resolver).
import { test, describe, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";

// lib/ch.ts reads these at import
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.ONCOKB_PIN = "v-test";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE", "FEDERATION_DISCLOSE_PATIENTS", "FEDERATION_ACCEPT_PATIENT_LEVEL",
  "FEDERATION_HIDE_SQL", "AGGREGATE_ONLY_INSTANCES", "STUDY_DENY", "STUDY_ALLOW_RESTRICTED", "AGGREGATE_ONLY_STUDIES"]) delete process.env[k];

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const { answerFederation } = await import("../lib/federation-api.ts");
const { plotRangeOf } = await import("../lib/plot.ts");
const { runPlot } = await import("../lib/views/plot/run.ts");
const { RemoteAggregateResolver } = await import("../lib/federation-remote.ts");
type ViewRun = import("../lib/views/run.ts").ViewRun;
type EvaluatedCohort = import("../lib/views/run.ts").EvaluatedCohort;
type PlotData = import("../lib/plot.ts").PlotData;

const FGA = "FRACTION_GENOME_ALTERED", MC = "MUTATION_COUNT";

// ---- the stand-in warehouse (federation-api-ops harness) ----
type Rows = Record<string, unknown>[];
let sent: string[] = [];
let answers: [RegExp, Rows][] = [];
const on = (re: RegExp, rows: Rows) => { answers.push([re, rows]); };
setChTransport(async ({ query }) => {
  sent.push(query);
  let data: Rows = [];
  if (/SELECT cancer_study_identifier AS id, name FROM fed_a\.cancer_study/.test(query)) data = [{ id: "s1", name: "Study one" }];
  else for (const [re, rows] of answers) if (re.test(query)) { data = rows; break; }
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));
const realLog = console.log;
before(() => { console.log = () => {}; });
after(() => { console.log = realLog; });
beforeEach(() => { sent = []; answers = []; });

const errorOf = (r: { body: unknown }) => (r.body as { error: string }).error;
const okBody = (r: { status: number; body: unknown }) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body as Record<string, any>; };

/** the peer's whole-plot op over FGA × MC (or the axes given), answered from canned rows */
const wholePlot = (spec: Record<string, unknown>) => answerFederation("plot", { study: "s1", cohort: { all: [] }, op: "plot",
  spec: { x: { source: "clinical", attribute: FGA }, y: { source: "clinical", attribute: MC }, unit: "sample", bins: [44, 38], ...spec } });
const cannedScatter = (ext: { n: number; x0: number; x1: number; y0: number; y1: number }) => {
  on(/AS a, upper\(cam\.datatype\) AS dt/, [{ a: FGA, dt: "NUMBER" }, { a: MC, dt: "NUMBER" }]);
  on(/AS x1, min\(y\) AS y0/, [ext]);
  on(/AS pearson/, [{ n: ext.n, pearson: 0.5, spearman: 0.5, slope: 1, intercept: 0 }]);
  on(/AS bx/, [{ bx: 8, by: 1, n: ext.n, minX: ext.x0, maxX: ext.x1, minY: ext.y0, maxY: ext.y1 }]);
  on(/AS total/, [{ total: ext.n, nx: ext.n, ny: ext.n }]);
};
/** the bins statement's extent CTE `e` */
/** an extent CTE column holding the literal `v`: `v AS x0` or `any(v) x0` */
const fixedEnd = (v: number, col: string) => new RegExp("(^|[^\\d.])(any\\()?" + v + "(\\))?( AS)? " + col + "\\b");
const binsExtentCte = () => {
  const q = sent.find((s) => /AS bx/.test(s));
  assert.ok(q, "a bins query was sent");
  const m = q.match(/e AS \(SELECT ([^\n]*)\)/);
  assert.ok(m, "the bins query has an extent CTE e: " + q);
  return m[1];
};

// ---- R1 ----

describe("R1 range checked", () => {
  const LIN = { x: false, y: false };

  test("R1 absent: none", () => {
    assert.equal(plotRangeOf(undefined, LIN), undefined);
    assert.equal(plotRangeOf(null, LIN), undefined);
  });

  test("R1 {x: {min: 0, max: 1}} kept as given; an end left out stays out", () => {
    assert.deepEqual(plotRangeOf({ x: { min: 0, max: 1 } }, LIN), { x: { min: 0, max: 1 } });
    const r = plotRangeOf({ y: { min: 0 } }, LIN)!;
    assert.deepEqual(r, { y: { min: 0 } });
    assert.equal("max" in r.y!, false, "no max is invented");
    assert.deepEqual(plotRangeOf({ x: { min: 0, max: 1 }, y: { min: 0 } }, LIN), { x: { min: 0, max: 1 }, y: { min: 0 } });
    assert.deepEqual(plotRangeOf({ x: { max: 5 } }, LIN), { x: { max: 5 } });
    // the ends are in the attribute's own units even on a log axis: not converted here
    assert.deepEqual(plotRangeOf({ y: { min: 0, max: 99 } }, { x: false, y: true }), { y: { min: 0, max: 99 } });
  });

  test("R1 an end that is not a finite number is refused, naming it", () => {
    // (null is not listed: the table does not say whether a JSON null end is "left out" or refused)
    for (const bad of ["0", NaN, Infinity, -Infinity, true, {}]) {
      assert.throws(() => plotRangeOf({ x: { min: bad } }, LIN), (e: Error) => e.message.includes("range.x.min must be a finite number"),
        "x.min " + String(bad));
    }
    assert.throws(() => plotRangeOf({ y: { max: "1" } }, LIN), (e: Error) => e.message.includes("range.y.max must be a finite number"));
    assert.throws(() => plotRangeOf({ x: { min: 0, max: Infinity } }, LIN), (e: Error) => e.message.includes("range.x.max must be a finite number"));
  });

  test("R1 min not below max is refused, naming the axis", () => {
    assert.throws(() => plotRangeOf({ x: { min: 1, max: 1 } }, LIN), (e: Error) => e.message.includes("range.x: min must be below max"));
    assert.throws(() => plotRangeOf({ x: { min: 2, max: 1 } }, LIN), (e: Error) => e.message.includes("range.x: min must be below max"));
    assert.throws(() => plotRangeOf({ y: { min: 5, max: 0 } }, LIN), (e: Error) => e.message.includes("range.y: min must be below max"));
  });

  test("R1 an end below 0 on a log axis is refused (and allowed on a linear one)", () => {
    assert.throws(() => plotRangeOf({ y: { min: -1 } }, { x: false, y: true }), (e: Error) => /range\.y/.test(e.message), "y.min −1 on log y");
    assert.throws(() => plotRangeOf({ x: { min: -5, max: -1 } }, { x: true, y: false }), (e: Error) => /range\.x/.test(e.message), "x on log x");
    assert.deepEqual(plotRangeOf({ y: { min: 0 } }, { x: false, y: true }), { y: { min: 0 } }, "0 is not below 0");
    assert.deepEqual(plotRangeOf({ y: { min: -1 } }, LIN), { y: { min: -1 } }, "a linear axis may start below 0");
    assert.deepEqual(plotRangeOf({ y: { min: -1 } }, { x: true, y: false }), { y: { min: -1 } }, "only the log axis is held to 0");
  });

  test("R1 a refused range refuses the view, before anything runs", async () => {
    const calls: string[] = [];
    const r = await runView({ s1: localSite(calls) }, { range: { x: { min: 1, max: 0 } } });
    assert.match(r.error ?? "", /range\.x: min must be below max/);
    assert.deepEqual(calls, [], "the plot is not asked");
  });
});

// ---- R2: one study ----

describe("R2 one study's scatter", () => {
  test("R2 FGA data 0.2 to 0.4 with range x 0 to 1: the extent is 0 to 1 and the bins are cut between those ends", async () => {
    cannedScatter({ n: 2, x0: 0.2, x1: 0.4, y0: 1, y1: 2 });
    const r = okBody(await wholePlot({ range: { x: { min: 0, max: 1 } } })).result;
    assert.deepEqual(r.extent, { x0: 0, x1: 1, y0: 1, y1: 2 });
    const e = binsExtentCte();
    assert.match(e, fixedEnd(0, "x0"), "the fixed start is in the bins' extent: " + e);
    assert.match(e, fixedEnd(1, "x1"), "the fixed end is in the bins' extent: " + e);
  });

  test("R2 without range the extent is the data's own (0.2 to 0.4)", async () => {
    cannedScatter({ n: 2, x0: 0.2, x1: 0.4, y0: 1, y1: 2 });
    const r = okBody(await wholePlot({})).result;
    assert.deepEqual(r.extent, { x0: 0.2, x1: 0.4, y0: 1, y1: 2 });
    const e = binsExtentCte();
    assert.match(e, /min\(x\) x0, max\(x\) x1/, e);
  });

  test("R2 a fixed end on a Log Scale axis is log10(1 + v), as that axis carries", async () => {
    // MC 4 .. 99 on log: the data's extent in the engine's units is log10(5) .. 2; range y from 0 → log10(1) = 0
    cannedScatter({ n: 2, x0: 0.2, x1: 0.4, y0: Math.log10(5), y1: 2 });
    const r = okBody(await wholePlot({ y: { source: "clinical", attribute: MC, log: true }, range: { x: { min: 0, max: 1 }, y: { min: 0 } } })).result;
    assert.deepEqual(r.extent, { x0: 0, x1: 1, y0: 0, y1: 2 });
  });
});

// ---- R3: pooled from two sites (view-plot harness) ----

const evaluated = (studies: string[], count = 100): EvaluatedCohort =>
  ({ studies, perStudy: Object.fromEntries(studies.map((s) => [s, { sql: "", count, samples: count, mode: "patient-level" }])), count, samples: count, text: "" }) as never;

async function runView(resolvers: Record<string, unknown>, view: Record<string, unknown>) {
  const studies = Object.keys(resolvers);
  const c = {
    doc: { cohorts: { All: { all: [] } } },
    cohorts: { All: evaluated(studies) }, resolvers, vNames: ["All"], vStudies: studies,
    participationFor: (s: string[]) => ({ studies: s.map((x) => ({ study: x, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], unit: "sample", x: { source: "clinical", attribute: FGA }, y: { source: "clinical", attribute: MC },
    points: [], allPoints: false, ...view };
  const r = await runPlot(v as never, c);
  return ("result" in (r as object) ? (r as { result: unknown }).result : r) as { error?: string; plot?: PlotData; note?: string };
}

function localSite(calls: string[]) {
  return {
    instance: { id: "local", mode: "patient-level", conn: { db: "db" }, label: "local" },
    plot: async (_d: unknown, spec: unknown) => { calls.push("plot " + JSON.stringify(spec)); throw new Error("not expected"); },
    plotPoints: async () => [], plotScatterPoints: async () => [],
  };
}

type Cell = { bx: number; by: number; n: number; minX?: number; maxX?: number; minY?: number; maxY?: number };
function site(o: { extent: { n: number; x0: number; x1: number; y0: number; y1: number }; bins: Cell[]; m: { n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number } },
  calls: string[]) {
  return {
    instance: { id: "local", mode: "patient-level", conn: { db: "db" }, label: "site" },
    plotAxisKinds: async () => ({ xk: "num", yk: "num", shape: "scatter", xLabel: "Fraction Genome Altered", yLabel: "Mutation Count" }),
    plotExtent: async () => o.extent,
    plotBinCounts: async (_d: unknown, _s: unknown, _xk: unknown, _yk: unknown, bins: unknown, extent: unknown) => {
      calls.push("bins " + JSON.stringify(bins) + " " + JSON.stringify(extent)); return o.bins;
    },
    plotMoments: async () => o.m,
    plotTableCells: async () => [], plotBoxRows: async () => [], plotViolinCounts: async () => [],
    plotCoverage: async () => ({ total: o.extent.n, nx: o.extent.n, ny: o.extent.n }),
    plotPoints: async () => [], plotScatterPoints: async () => [],
  };
}
const A = { extent: { n: 1, x0: 0.19, x1: 0.19, y0: 2, y1: 2 }, m: { n: 1, sx: 0.19, sy: 2, sxy: 0.38, sxx: 0.0361, syy: 4 } };
const B = { extent: { n: 1, x0: 0.2, x1: 0.2, y0: 3, y1: 3 }, m: { n: 1, sx: 0.2, sy: 3, sxy: 0.6, sxx: 0.04, syy: 9 } };
const RANGE = { x: { min: 0, max: 1 }, y: { min: 0 } };

describe("R3 a scatter pooled from two sites", () => {
  test("R3 (0.19, 2) at one site and (0.2, 3) at the other: one cell (8, 1) of count 2 with both sites' extremes", async () => {
    const calls: string[] = [];
    const r = await runView({
      s1: site({ ...A, bins: [{ bx: 8, by: 1, n: 1, minX: 0.19, maxX: 0.19, minY: 2, maxY: 2 }] }, calls),
      s2: site({ ...B, bins: [{ bx: 8, by: 1, n: 1, minX: 0.2, maxX: 0.2, minY: 3, maxY: 3 }] }, calls),
    }, { range: RANGE, bins: [44, 38] });
    assert.equal(r.error, undefined, String(r.error));
    const p = r.plot!;
    assert.equal(p.n, 2);
    assert.deepEqual(p.bins, [{ bx: 8, by: 1, n: 2, minX: 0.19, maxX: 0.2, minY: 2, maxY: 3 }]);
  });

  test("R3 the pooled extent takes the fixed ends, and every site bins against it", async () => {
    const calls: string[] = [];
    const r = await runView({
      s1: site({ ...A, bins: [{ bx: 8, by: 1, n: 1, minX: 0.19, maxX: 0.19, minY: 2, maxY: 2 }] }, calls),
      s2: site({ ...B, bins: [{ bx: 8, by: 1, n: 1, minX: 0.2, maxX: 0.2, minY: 3, maxY: 3 }] }, calls),
    }, { range: RANGE, bins: [44, 38] });
    const want = { x0: 0, x1: 1, y0: 0, y1: 3 };
    assert.deepEqual(r.plot!.extent, want, "x fixed 0..1, y from 0 to the pooled largest");
    const binCalls = calls.filter((c) => c.startsWith("bins "));
    assert.equal(binCalls.length, 2);
    for (const c of binCalls) assert.deepEqual(JSON.parse(c.slice(c.indexOf("] ") + 2)), want, c);
  });

  test("R3 a site that reports no extremes (an older peer) leaves them to the other", async () => {
    const r = await runView({
      s1: site({ ...A, bins: [{ bx: 8, by: 1, n: 1, minX: 0.19, maxX: 0.19, minY: 2, maxY: 2 }] }, []),
      s2: site({ ...B, bins: [{ bx: 8, by: 1, n: 1 }] }, []),
    }, { range: RANGE, bins: [44, 38] });
    assert.deepEqual(r.plot!.bins, [{ bx: 8, by: 1, n: 2, minX: 0.19, maxX: 0.19, minY: 2, maxY: 2 }]);
    // and the other way round: the older peer first
    const r2 = await runView({
      s1: site({ ...A, bins: [{ bx: 8, by: 1, n: 1 }] }, []),
      s2: site({ ...B, bins: [{ bx: 8, by: 1, n: 1, minX: 0.2, maxX: 0.2, minY: 3, maxY: 3 }] }, []),
    }, { range: RANGE, bins: [44, 38] });
    assert.deepEqual(r2.plot!.bins, [{ bx: 8, by: 1, n: 2, minX: 0.2, maxX: 0.2, minY: 3, maxY: 3 }]);
  });

  test("R3 without range the pooled extent is the sites' own", async () => {
    const r = await runView({
      s1: site({ ...A, bins: [{ bx: 0, by: 0, n: 1 }] }, []),
      s2: site({ ...B, bins: [{ bx: 43, by: 37, n: 1 }] }, []),
    }, { bins: [44, 38] });
    assert.deepEqual(r.plot!.extent, { x0: 0.19, x1: 0.2, y0: 2, y1: 3 });
  });
});

// ---- R4: a plot sent to a peer ----

type Call = { op: string; body: Record<string, any> };
const withPeer = async (answer: (op: string, body: Record<string, unknown>) => unknown, fn: (calls: Call[]) => Promise<void>) => {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ op: String(url).split("/").pop()!, body });
    return new Response(JSON.stringify(answer(String(url).split("/").pop()!, body)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { await fn(calls); } finally { globalThis.fetch = original; }
};

describe("R4 a plot sent to a peer", () => {
  const OQL = { all: [{ kind: "oql", q: "TP53: MUT" }] } as never;
  const INST = { id: "peer", mode: "aggregate-only", label: "test peer", conn: PRIMARY } as never;

  test("R4 the caller: the range travels with the axes in the plot op's spec", async () => {
    await withPeer((_op, body) => ({ op: body.op, result: { piece: body.op }, cohortSql: null, queries: null }), async (calls) => {
      const r = new RemoteAggregateResolver("s1", "http://peer.invalid/api/federation/v1", INST);
      const spec = { x: { source: "clinical", attribute: FGA }, y: { source: "clinical", attribute: MC, log: true }, unit: "sample",
        bins: [44, 38], range: { x: { min: 0, max: 1 }, y: { min: 0 } } } as never;
      await r.plot(OQL, spec);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].op, "plot");
      assert.equal(calls[0].body.op, "plot");
      assert.deepEqual(calls[0].body.spec.range, { x: { min: 0, max: 1 }, y: { min: 0 } });
      assert.deepEqual(calls[0].body.spec.x, { source: "clinical", attribute: FGA });
      assert.deepEqual(calls[0].body.spec.y, { source: "clinical", attribute: MC, log: true });
    });
  });

  test("R4 the caller: a plot with no range sends none", async () => {
    await withPeer((_op, body) => ({ op: body.op, result: {}, cohortSql: null, queries: null }), async (calls) => {
      const r = new RemoteAggregateResolver("s1", "http://peer.invalid/api/federation/v1", INST);
      await r.plot(OQL, { x: { source: "clinical", attribute: FGA }, y: { source: "clinical", attribute: MC }, unit: "sample" } as never);
      assert.equal("range" in calls[0].body.spec, false);
    });
  });

  test("R4 the peer: a range in the spec reaches the SQL", async () => {
    cannedScatter({ n: 2, x0: 0.2, x1: 0.4, y0: 1, y1: 2 });
    const r = okBody(await wholePlot({ range: { x: { min: 0, max: 1 } } })).result;
    assert.deepEqual([r.extent.x0, r.extent.x1], [0, 1]);
    assert.match(binsExtentCte(), fixedEnd(1, "x1"));
  });

  test("R4 the peer checks the range as in R1 before using it", async () => {
    cannedScatter({ n: 2, x0: 0.2, x1: 0.4, y0: 1, y1: 2 });
    const bad = await wholePlot({ range: { x: { min: 1, max: 0 } } });
    assert.equal(bad.status, 422, JSON.stringify(bad.body));
    assert.match(errorOf(bad), /range\.x: min must be below max/);
    assert.equal(sent.filter((q) => /AS bx|AS pearson|AS x1, min\(y\) AS y0/.test(q)).length, 0, "nothing is binned");
    const nan = await wholePlot({ range: { y: { min: "0" } } });
    assert.equal(nan.status, 422);
    assert.match(errorOf(nan), /range\.y\.min must be a finite number/);
    const logNeg = await wholePlot({ y: { source: "clinical", attribute: MC, log: true }, range: { y: { min: -1 } } });
    assert.equal(logNeg.status, 422);
    assert.match(errorOf(logNeg), /range\.y/);
  });
});

test("R1 an axis other than x or y, or one that is not {min, max}, is refused", () => {
  assert.throws(() => plotRangeOf({ z: { min: 1 } }, { x: false, y: false }), /range: no axis z/);
  assert.throws(() => plotRangeOf({ x: null }, { x: false, y: false }), /range\.x: give \{min, max\}/);
  assert.throws(() => plotRangeOf({ y: [0, 1] }, { x: false, y: false }), /range\.y: give \{min, max\}/);
});
