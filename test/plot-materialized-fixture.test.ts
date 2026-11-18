// Materialized WITH subqueries on the fixture study (test/fixtures/peer-study on connection b),
// from the rule's case table (the rest of it is test/materialized-cte.test.ts):
//
//   C3  every builder whose WITH clause a materialized cohort changes (test/support/plot-cte-cases.ts),
//       patient and sample unit, whole study and a sub-cohort: materialized and plain give the same rows
//       (in the same order where its SQL fixes one, else as the same multiset)
//   B3  the materialized statements reach the database with enable_materialized_cte=1, the plain ones without
//   D2  env unset: the fixture's server (which has the setting) answers true; a server without the
//       setting (system.settings with that row taken out) answers false
//   D3  the fixture connection is asked once: a second call sends nothing and answers the same
//   D4  a check that fails answers false, and the next call asks again and gets the server's answer
//   E   a resolver's plot on connection b: env unset, every statement with a WITH clause goes out
//       AS MATERIALIZED with the setting; CLICKHOUSE_MATERIALIZED_CTE=0, all plain; a ChTransport set
//       (D5), all plain; the plot's answer the same in every case
//
// Runs when CLICKHOUSE2_* point at the fixture (`npm run peer-db` prints the lines; scripts/gate.sh
// sets them) and is skipped otherwise. If the database does not accept `AS MATERIALIZED` with
// enable_materialized_cte=1, it is skipped naming the database's version.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ChConn } from "../lib/ch.ts";
import type { PlotRequest } from "../lib/plot.ts";
import { cteCases, cohortArg, type CaseAxes } from "./support/plot-cte-cases.ts";
import type { CohortDef } from "../lib/types.ts";

const FIXTURE = "cbiolab_peer_fixture";
const FLAG = "CLICKHOUSE_MATERIALIZED_CTE";
delete process.env.CH_RUN_CACHE;
delete process.env[FLAG];
// the plot's driver-axis pins are not what is under test; set, they are not looked up on the primary database
process.env.GENOME_NEXUS_PIN ||= "fixture-pin";
process.env.GENOME_NEXUS_GRCH38_PIN ||= "fixture-pin";
const { secondary, chQuery, materializedCteSupported, setChTransport } = await import("../lib/ch.ts");
const { compileCohortDef } = await import("../lib/cohort2.ts");
const { cohortSubquery } = await import("../lib/sql-kinds.ts");
const { plotBoxSql, axisSelect } = await import("../lib/plot.ts");
const { PatientLevelResolver, AggregateResolver } = await import("../lib/federation.ts");

const noDb = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? false : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";

// every statement on its way to the database, in order; `intercept` may answer one itself or rewrite it
interface Sent { url: string; body: string }
const sent: Sent[] = [];
const sentTo = new Map<string, string>();
let intercept: ((body: string) => { fail?: true; body?: string }) | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  let body = typeof init?.body === "string" ? init.body : "";
  if (body) { sent.push({ url: String(url), body }); sentTo.set(body, String(url)); }
  const i = body && intercept ? intercept(body) : null;
  if (i?.fail) throw new TypeError("fetch failed: planted by the test");
  if (i?.body) body = i.body;
  return realFetch(url, body ? { ...init, body } : init);
}) as typeof fetch;

let conn: ChConn;
let unsupported: string | false = noDb;
before(async () => {
  if (noDb) return;
  conn = secondary()!;
  assert.ok(conn, "CLICKHOUSE2_URL is set but connection b is not configured");
  const v = String((await chQuery<{ v: string }>("SELECT version() AS v", conn)).data[0].v);
  try {
    const r = await chQuery<{ total: number }>("WITH a AS MATERIALIZED (SELECT number AS n FROM numbers(3)) SELECT sum(n) AS total FROM a WHERE n IN (SELECT n FROM a)", conn);
    assert.equal(Number(r.data[0].total), 3);
  } catch (e) {
    unsupported = "ClickHouse " + v + " on connection b does not run `AS MATERIALIZED` with enable_materialized_cte=1: " + String((e as Error).message).slice(0, 200);
  }
});

const run = async (sql: string) => (await chQuery<Record<string, unknown>>(sql, conn)).data;
const asSet = (rows: Record<string, unknown>[]) => rows.map((r) => JSON.stringify(r)).sort();

const COHORTS: [string, CohortDef | null][] = [
  ["whole study", null],
  ["female patients", { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] } as unknown as CohortDef],
];

for (const unit of ["patient", "sample"] as const) {
  for (const [cohortName, def] of COHORTS) {
    describe("C3 " + unit + " plot of the " + cohortName + ": materializing changes no row", () => {
      // the cases are listed when the file loads; their statements are built inside each test
      const a: CaseAxes = {
        ctx: { study: FIXTURE, db: "", unit, cohortSql: "" },
        num1: { source: "clinical", attribute: "AGE" }, num2: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" },
        cat1: { source: "clinical", attribute: "CANCER_TYPE" }, cat2: { source: "clinical", attribute: "SEX" },
        whiskers: [], extent: { x0: 30, x1: 90, y0: 0, y1: 1 },
      } as CaseAxes;
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
          const [rOff, rOn] = await Promise.all([run(off), run(on)]);
          assert.ok(rOff.length > 0, "the statement returns rows on the fixture, so the comparison says something");
          if (c.ordered) assert.deepEqual(rOn, rOff);
          else assert.deepEqual(asSet(rOn), asSet(rOff));
          // B3: what reached the database
          const urlOn = sentTo.get(on + "\nFORMAT JSON"), urlOff = sentTo.get(off + "\nFORMAT JSON");
          assert.ok(urlOn && urlOff, "both statements were seen on their way to the database");
          assert.equal(new URL(urlOn).searchParams.get("enable_materialized_cte"), "1");
          assert.equal(new URL(urlOff).searchParams.has("enable_materialized_cte"), false);
        });
      }
    });
  }
}

describe("D materializedCteSupported on the fixture's server", () => {
  // each case its own connection to the fixture, so no case reads another's remembered answer
  const as = (id: string): ChConn => ({ ...conn, id: "b-" + id });
  const asking = async (c: ChConn) => { sent.length = 0; const r = await materializedCteSupported(c); return { r, n: sent.length }; };
  after(() => { intercept = null; });

  test("D2 env unset: ClickHouse with enable_materialized_cte answers true", { skip: noDb }, async () => {
    const { r, n } = await asking(as("d2-new"));
    assert.equal(r, true);
    assert.equal(n, 1, "one statement asked it");
  });
  test("D2 env unset: a server without the setting answers false", { skip: noDb }, async () => {
    // an older server: the same system.settings with that row absent, everything else the server's own
    let rewritten = 0;
    intercept = (body) => {
      const b = body.replaceAll("system.settings", "(SELECT * FROM system.settings WHERE name != 'enable_materialized_cte')");
      if (b !== body) rewritten++;
      return { body: b };
    };
    try {
      const { r } = await asking(as("d2-old"));
      assert.equal(rewritten, 1, "the question read system.settings");
      assert.equal(r, false);
    } finally { intercept = null; }
  });
  test("D3 asked once: a second call sends nothing and answers the same", { skip: noDb }, async () => {
    const c = as("d3");
    const first = await asking(c), second = await asking(c);
    assert.deepEqual([first.r, first.n], [true, 1]);
    assert.deepEqual([second.r, second.n], [true, 0]);
  });
  test("D4 a check that fails answers false; the next call asks again and gets the server's answer", { skip: noDb }, async () => {
    const c = as("d4");
    intercept = () => ({ fail: true });
    let first;
    try { first = await asking(c); } finally { intercept = null; }
    assert.equal(first.r, false);
    const second = await asking(c);
    assert.deepEqual([second.r, second.n], [true, 1]);
    const third = await asking(c);
    assert.deepEqual([third.r, third.n], [true, 0]);
  });
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
        .map((s) => ({ body: s.body, setting: new URL(s.url).searchParams.get("enable_materialized_cte") }));
      return { data, withs };
    } finally { delete process.env[FLAG]; }
  }
  after(() => { setChTransport(null); delete process.env[FLAG]; });

  for (const kind of ["patient-level", "aggregate-only"] as const) {
    for (const [shape, spec] of [["scatter", SCATTER], ["box", BOX]] as const) {
      test("E " + kind + " " + shape + ": env unset → every WITH statement AS MATERIALIZED with the setting; env 0 → plain; same plot", { skip: unsupported }, async (t) => {
        if (unsupported) { t.skip(unsupported); return; }
        const auto = await plotted(kind, spec, undefined);
        assert.ok(auto.withs.length >= 2, "the plot sent its WITH statements: " + auto.withs.length);
        for (const s of auto.withs) {
          assert.match(s.body, / AS MATERIALIZED \(/, s.body.slice(0, 160));
          // and none of its top-level cohort/axis subqueries left plain
          assert.deepEqual([...s.body.matchAll(PLAIN_TOP)].map((m) => m[2]), [], s.body.slice(0, 160));
          assert.equal(s.setting, "1");
        }
        const off = await plotted(kind, spec, "0");
        assert.equal(off.withs.length, auto.withs.length);
        for (const s of off.withs) {
          assert.doesNotMatch(s.body, /MATERIALIZED/, s.body.slice(0, 160));
          assert.equal(s.setting, null);
        }
        assert.deepEqual(auto.data, off.data, "the same plot either way");
        assert.notEqual(auto.data.n, 0, "the plot has cases, so the comparison says something");
      });
    }
  }
  test("E with D5: a ChTransport set → the plot's WITH statements are plain, though the connection answered true", { skip: unsupported }, async (t) => {
    if (unsupported) { t.skip(unsupported); return; }
    assert.equal(await materializedCteSupported(conn), true, "connection b is known to support it");
    const viaTransport: string[] = [];
    setChTransport(async (st, send) => { viaTransport.push(st.query); return send(); });
    try {
      const r = await plotted("patient-level", SCATTER, undefined);
      assert.ok(r.withs.length >= 2);
      for (const s of r.withs) assert.doesNotMatch(s.body, /MATERIALIZED/, s.body.slice(0, 160));
      assert.ok(viaTransport.length >= r.withs.length, "the statements went through the transport");
    } finally { setChTransport(null); }
  });
});
