// Materialized WITH subqueries on the fixture study (test/fixtures/peer-study on connection b),
// from the rule's case table (the rest of it is test/materialized-cte.test.ts):
//
//   S6  every builder whose WITH clause a materialized cohort changes (test/support/plot-cte-cases.ts),
//       patient and sample unit, whole study and a sub-cohort: the materialized statement as built,
//       run with chQuery (no setting on the URL), gives the same rows as the plain one (in the same
//       order where its SQL fixes one, else as the same multiset)
//   S6  a statement whose cohort is referenced several times reads fewer rows materialized
//       (X-ClickHouse-Summary's read_rows)
//   S4  the fixture's server answers the check true; a connection with a wrong password answers
//       false, and inside withoutFailedQueries that does not make it throw FailedQueriesError;
//       asked once per connection
//   S5  a resolver's cox and logistic rows never send CTE_CHECK_SQL; its plot does
//   E   a resolver's plot on connection b: env unset, every statement with a WITH clause goes out
//       AS MATERIALIZED with the setting in its text and none on its URL; CLICKHOUSE_MATERIALIZED_CTE=0,
//       all plain; a ChTransport set, all plain; the plot's answer the same in every case
//
// Runs when CLICKHOUSE2_* point at the fixture (`npm run peer-db` prints the lines; scripts/gate.sh
// sets them) and is skipped otherwise. If the database does not run `SETTINGS enable_materialized_cte = 1`,
// the cases that need it are skipped naming the database's version.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ChConn } from "../lib/ch.ts";
import type { PlotRequest } from "../lib/plot.ts";
import { cteCases, cohortArg, MATERIALIZED_SETTING, type CaseAxes } from "./support/plot-cte-cases.ts";
import type { CohortDef } from "../lib/types.ts";

const FIXTURE = "cbiolab_peer_fixture";
const FLAG = "CLICKHOUSE_MATERIALIZED_CTE";
delete process.env.CH_RUN_CACHE;
delete process.env[FLAG];
// the plot's driver-axis pins are not what is under test; set, they are not looked up on the primary database
process.env.GENOME_NEXUS_PIN ||= "fixture-pin";
process.env.GENOME_NEXUS_GRCH38_PIN ||= "fixture-pin";
const { secondary, chQuery, materializedCteSupported, setChTransport, withoutFailedQueries, CTE_CHECK_SQL } = await import("../lib/ch.ts");
const { compileCohortDef } = await import("../lib/cohort2.ts");
const { cohortSubquery } = await import("../lib/sql-kinds.ts");
const { plotBoxSql, axisSelect } = await import("../lib/plot.ts");
const { PatientLevelResolver, AggregateResolver } = await import("../lib/federation.ts");

const noDb = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? false : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";

// every statement on its way to the database, in order, with the read_rows its server reported
interface Sent { url: string; body: string; readRows?: number }
const sent: Sent[] = [];
const sentAs = new Map<string, Sent>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const body = typeof init?.body === "string" ? init.body : "";
  const s: Sent = { url: String(url), body };
  if (body) { sent.push(s); sentAs.set(body, s); }
  const res = await realFetch(url, init);
  const summary = res.headers.get("x-clickhouse-summary");
  if (summary) s.readRows = Number(JSON.parse(summary).read_rows);
  return res;
}) as typeof fetch;
const CHECK_WIRE = CTE_CHECK_SQL + "\nFORMAT JSON";

let conn: ChConn;
let unsupported: string | false = noDb;
before(async () => {
  if (noDb) return;
  conn = secondary()!;
  assert.ok(conn, "CLICKHOUSE2_URL is set but connection b is not configured");
  const v = String((await chQuery<{ v: string }>("SELECT version() AS v", conn)).data[0].v);
  try {
    const r = await chQuery<{ total: number }>("WITH a AS MATERIALIZED (SELECT number AS n FROM numbers(3)) SELECT sum(n) AS total FROM a WHERE n IN (SELECT n FROM a)" + MATERIALIZED_SETTING, conn);
    assert.equal(Number(r.data[0].total), 3);
  } catch (e) {
    unsupported = "ClickHouse " + v + " on connection b does not run `AS MATERIALIZED` with enable_materialized_cte = 1: " + String((e as Error).message).slice(0, 200);
  }
});

const run = async (sql: string) => (await chQuery<Record<string, unknown>>(sql, conn)).data;
const asSet = (rows: Record<string, unknown>[]) => rows.map((r) => JSON.stringify(r)).sort();
const wire = (sql: string) => sql + "\nFORMAT JSON";

const COHORTS: [string, CohortDef | null][] = [
  ["whole study", null],
  ["female patients", { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] } as unknown as CohortDef],
];
const caseAxes = (unit: "patient" | "sample"): CaseAxes => ({
  ctx: { study: FIXTURE, db: "", unit, cohortSql: "" },
  num1: { source: "clinical", attribute: "AGE" }, num2: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" },
  cat1: { source: "clinical", attribute: "CANCER_TYPE" }, cat2: { source: "clinical", attribute: "SEX" },
  whiskers: [], extent: { x0: 30, x1: 90, y0: 0, y1: 1 },
} as CaseAxes);

for (const unit of ["patient", "sample"] as const) {
  for (const [cohortName, def] of COHORTS) {
    describe("S6 " + unit + " plot of the " + cohortName + ": the materialized statement as built gives the plain one's rows", () => {
      // the cases are listed when the file loads; their statements are built inside each test
      const a = caseAxes(unit);
      before(async () => {
        if (unsupported) return;
        a.ctx.db = conn.db;
        a.ctx.cohortSql = cohortSubquery(compileCohortDef(def, { study: FIXTURE, db: conn.db }));
        // each box group gets narrow whiskers, so the outlier query has outliers to order
        const box = await run(plotBoxSql(axisSelect(a.num1, a.ctx, "num"), axisSelect(a.cat1, a.ctx, "cat"), a.ctx.cohortSql));
        assert.ok(box.length >= 2, "the fixture's box has groups to compare: " + box.length);
        a.whiskers.push(...box.map((g) => ({ g: String(g.g), loWhisker: 55, hiWhisker: 70 })));
      });
      for (const c of cteCases(a)) {
        test(c.name, { skip: unsupported }, async (t) => {
          if (unsupported) { t.skip(unsupported); return; }
          const off = c.sql(cohortArg(a.ctx.cohortSql, "sql string")), on = c.sql(cohortArg(a.ctx.cohortSql, "context, materialized true"));
          assert.notEqual(on, off, "materialized changed the statement");
          assert.ok(on.endsWith(MATERIALIZED_SETTING), "the setting is in the statement");
          const [rOff, rOn] = await Promise.all([run(off), run(on)]);
          assert.ok(rOff.length > 0, "the statement returns rows on the fixture, so the comparison says something");
          if (c.ordered) assert.deepEqual(rOn, rOff);
          else assert.deepEqual(asSet(rOn), asSet(rOff));
          // what reached the database: the statement as built, and no setting on either URL
          const sOn = sentAs.get(wire(on)), sOff = sentAs.get(wire(off));
          assert.ok(sOn && sOff, "both statements were seen on their way to the database");
          assert.equal(new URL(sOn.url).searchParams.has("enable_materialized_cte"), false);
          assert.equal(new URL(sOff.url).searchParams.has("enable_materialized_cte"), false);
        });
      }
    });
  }
}

describe("S6 materializing computes a cohort read several times once", () => {
  test("a patient-unit count over two clinical axes reads fewer rows materialized", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    const a = caseAxes("patient");
    a.ctx.db = conn.db;
    // a cohort that itself reads the clinical table, so each inlined copy of it costs a scan
    a.ctx.cohortSql = cohortSubquery(compileCohortDef(COHORTS[1][1], { study: FIXTURE, db: conn.db }));
    const c = cteCases(a).find((x) => x.name === "pairCte via plotCountSql (numeric)")!;
    const off = c.sql(cohortArg(a.ctx.cohortSql, "sql string")), on = c.sql(cohortArg(a.ctx.cohortSql, "context, materialized true"));
    assert.ok(off.split("FROM cohort").length - 1 >= 4, "the cohort is referenced at least four times");
    const [rOff, rOn] = [await run(off), await run(on)];
    assert.deepEqual(rOn, rOff);
    const readOff = sentAs.get(wire(off))?.readRows, readOn = sentAs.get(wire(on))?.readRows;
    assert.ok(readOff !== undefined && readOn !== undefined, "the server reported read_rows for both (X-ClickHouse-Summary)");
    t.diagnostic("read_rows plain " + readOff + ", materialized " + readOn);
    assert.ok(readOn < readOff, "materialized read " + readOn + " rows, plain " + readOff);
  });
});

describe("S4 materializedCteSupported on the fixture's server", () => {
  // each case its own connection to the fixture, so no case reads another's remembered answer
  const as = (id: string, over: Partial<ChConn> = {}): ChConn => ({ ...conn, id: "b-" + id, ...over });
  const asking = async (c: ChConn) => { sent.length = 0; const r = await materializedCteSupported(c); return { r, bodies: sent.map((s) => s.body) }; };

  test("the fixture's server runs the setting: true, by exactly CTE_CHECK_SQL", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    const { r, bodies } = await asking(as("s4-true"));
    assert.equal(r, true);
    assert.deepEqual(bodies, [CHECK_WIRE]);
  });
  test("asked once: a second call sends nothing and answers the same", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    const c = as("s4-once");
    const first = await asking(c), second = await asking(c);
    assert.deepEqual([first.r, first.bodies.length], [true, 1]);
    assert.deepEqual([second.r, second.bodies.length], [true, 0]);
  });
  test("a wrong password: false", { skip: noDb }, async () => {
    const { r, bodies } = await asking(as("s4-badpw", { password: "not-the-password" }));
    assert.equal(r, false);
    assert.ok(bodies.length >= 1 && bodies.every((b) => b === CHECK_WIRE));
  });
  test("a wrong password inside withoutFailedQueries: no FailedQueriesError, the request's own value returned", { skip: noDb }, async () => {
    const bad = as("s4-badpw-req", { password: "not-the-password" });
    const v = await withoutFailedQueries(async () => {
      const [rows, m] = await Promise.all([run("SELECT 41 + 1 AS n"), materializedCteSupported(bad)]);
      return { n: Number(rows[0].n), m };
    });
    assert.deepEqual(v, { n: 42, m: false });
  });
});

describe("S5 only plot paths wait on the check", () => {
  let k = 0;
  // the fixture connection under a name not asked yet, so whether a path asked is visible
  const freshResolver = () => {
    const c: ChConn = { ...conn, id: "b-s5-" + (++k) };
    return { c, r: new PatientLevelResolver(FIXTURE, { oncokbPin: null }, { id: c.id, mode: "patient-level", label: "fixture", conn: c }) };
  };
  /** whether `c` had already been asked: asking it now sends a statement only if it had not (S4d) */
  const alreadyAsked = async (c: ChConn) => { sent.length = 0; await materializedCteSupported(c); return sent.length === 0; };
  /** a statement that asks about the setting, however it is phrased */
  const CHECKISH = /enable_materialized_cte|system\.settings/;
  const AGE = { source: "clinical", attribute: "AGE" } as const, SEX = { source: "clinical", attribute: "SEX" } as const;
  const FGA = { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } as const;

  test("cox rows: computed without asking", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    const { c, r } = freshResolver();
    sent.length = 0;
    const cox = await r.coxRows(null, "OS", [AGE as never, SEX as never]);
    assert.ok(cox.rows.length > 0, "the cox rows were computed: " + cox.rows.length);
    assert.ok(sent.length > 0, "cox sent its statements");
    for (const s of sent) assert.doesNotMatch(s.body, CHECKISH, "cox sent no check");
    for (const s of sent) assert.doesNotMatch(s.body, /MATERIALIZED/);
    assert.equal(await alreadyAsked(c), false, "the connection had not been asked");
  });
  test("logistic rows: computed without asking", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    const { c, r } = freshResolver();
    sent.length = 0;
    const lr = await r.logisticRows(null, SEX as never, [AGE as never]);
    assert.ok(lr.rows.length > 0, "the logistic rows were computed: " + lr.rows.length);
    for (const s of sent) assert.doesNotMatch(s.body, CHECKISH, "logistic sent no check");
    assert.equal(await alreadyAsked(c), false, "the connection had not been asked");
  });
  for (const [what, go] of [
    ["plot (scatter)", (r: InstanceType<typeof PatientLevelResolver>) => r.plot(null, { x: AGE, y: FGA } as PlotRequest)],
    ["plot (box)", (r: InstanceType<typeof PatientLevelResolver>) => r.plot(null, { x: { source: "clinical", attribute: "CANCER_TYPE" }, y: AGE, unit: "sample" } as PlotRequest)],
    ["plotScatterPoints", (r: InstanceType<typeof PatientLevelResolver>) => r.plotScatterPoints(null, { x: AGE, y: FGA } as PlotRequest)],
  ] as const) {
    test(what + " asks, with exactly CTE_CHECK_SQL, and sends materialized statements", { skip: unsupported }, async (t) => {
      if (unsupported) { t.skip(unsupported); return; }
      const { c, r } = freshResolver();
      sent.length = 0;
      await go(r);
      assert.equal(sent.filter((s) => s.body === CHECK_WIRE).length, 1, "the plot asked once");
      assert.ok(sent.some((s) => / AS MATERIALIZED \(/.test(s.body) && s.body.includes(MATERIALIZED_SETTING)), "a statement went out materialized");
      assert.equal(await alreadyAsked(c), true);
    });
  }
});

describe("E a resolver's plot on connection b", () => {
  const SCATTER: PlotRequest = { x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } } as PlotRequest;
  const BOX: PlotRequest = { x: { source: "clinical", attribute: "CANCER_TYPE" }, y: { source: "clinical", attribute: "AGE" }, unit: "sample" } as PlotRequest;
  const PLAIN_TOP = /(^WITH |,\n {5})(cohort|cases|xs|ys|vs|gs|cs|rs) AS \(/g;
  const resolvers = () => ({
    "patient-level": new PatientLevelResolver(FIXTURE, { oncokbPin: null }, { id: conn.id, mode: "patient-level", label: "fixture", conn }),
    "aggregate-only": new AggregateResolver(FIXTURE, { oncokbPin: null }, { id: conn.id, mode: "aggregate-only", label: "fixture", conn }),
  });
  /** the plot, and every statement it sent that has a WITH clause, with whether its URL carried the setting */
  async function plotted(kind: keyof ReturnType<typeof resolvers>, spec: PlotRequest, env: string | undefined) {
    if (env === undefined) delete process.env[FLAG]; else process.env[FLAG] = env;
    try {
      sent.length = 0;
      const data = await resolvers()[kind].plot(null, spec);
      const withs = sent.filter((s) => s.url.startsWith(conn.url) && /^\s*WITH\b/.test(s.body))
        .map((s) => ({ body: s.body, urlSetting: new URL(s.url).searchParams.has("enable_materialized_cte") }));
      return { data, withs };
    } finally { delete process.env[FLAG]; }
  }
  after(() => { setChTransport(null); delete process.env[FLAG]; });

  for (const kind of ["patient-level", "aggregate-only"] as const) {
    for (const [shape, spec] of [["scatter", SCATTER], ["box", BOX]] as const) {
      test("E " + kind + " " + shape + ": env unset → every WITH statement AS MATERIALIZED with the setting in its text; env 0 → plain; same plot", { skip: unsupported }, async (t) => {
        if (unsupported) { t.skip(unsupported); return; }
        const auto = await plotted(kind, spec, undefined);
        assert.ok(auto.withs.length >= 2, "the plot sent its WITH statements: " + auto.withs.length);
        for (const s of auto.withs) {
          assert.match(s.body, / AS MATERIALIZED \(/, s.body.slice(0, 160));
          assert.deepEqual([...s.body.matchAll(PLAIN_TOP)].map((m) => m[2]), [], s.body.slice(0, 160));
          assert.ok(s.body.endsWith(MATERIALIZED_SETTING + "\nFORMAT JSON") || s.body.endsWith(MATERIALIZED_SETTING + "\nFORMAT JSONCompact"), s.body.slice(-120));
          assert.equal(s.urlSetting, false);
        }
        const off = await plotted(kind, spec, "0");
        assert.equal(off.withs.length, auto.withs.length);
        for (const s of off.withs) {
          assert.doesNotMatch(s.body, /MATERIALIZED|enable_materialized_cte/, s.body.slice(0, 160));
          assert.equal(s.urlSetting, false);
        }
        assert.deepEqual(auto.data, off.data, "the same plot either way");
        assert.notEqual(auto.data.n, 0, "the plot has cases, so the comparison says something");
      });
    }
  }
  test("E a ChTransport set → the plot's WITH statements are plain, though the connection answered true", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    assert.equal(await materializedCteSupported(conn), true, "connection b is known to support it");
    const viaTransport: string[] = [];
    setChTransport(async (st, send) => { viaTransport.push(st.query); return send(); });
    try {
      const r = await plotted("patient-level", SCATTER, undefined);
      assert.ok(r.withs.length >= 2);
      for (const s of r.withs) assert.doesNotMatch(s.body, /MATERIALIZED|enable_materialized_cte/, s.body.slice(0, 160));
      assert.ok(viaTransport.length >= r.withs.length, "the statements went through the transport");
    } finally { setChTransport(null); }
  });
});
