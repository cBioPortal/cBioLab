// CLICKHOUSE_MATERIALIZED_CTE on the fixture study: every plot builder whose WITH clause the flag
// changes (test/support/plot-cte-cases.ts) is run against test/fixtures/peer-study on connection b,
// built once with the flag off and once with it on, and must return the same rows (in the same
// order where its SQL fixes one, else as the same multiset). Case table rows:
//
//   C3  flag on vs off, every builder, patient and sample unit, whole study and a sub-cohort: same rows
//   B3  the flag-on statements reach the database with enable_materialized_cte=1, the flag-off ones without
//
// Runs when CLICKHOUSE2_* point at the fixture (`npm run peer-db` prints the lines; scripts/gate.sh
// sets them) and is skipped otherwise. If the database does not accept `AS MATERIALIZED` with
// enable_materialized_cte=1, it is skipped naming the database's version.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { secondary, chQuery, type ChConn } from "../lib/ch.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { cohortSubquery } from "../lib/sql-kinds.ts";
import { plotBoxSql, axisSelect } from "../lib/plot.ts";
import { cteCases, type CaseAxes } from "./support/plot-cte-cases.ts";
import type { CohortDef } from "../lib/types.ts";

const FIXTURE = "cbiolab_peer_fixture";
const FLAG = "CLICKHOUSE_MATERIALIZED_CTE";
const noDb = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? false : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";

// every URL a statement was sent to, by the statement's text
const sentTo = new Map<string, string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (typeof init?.body === "string") sentTo.set(init.body, String(url));
  return realFetch(url, init);
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
async function built(flag: string | undefined, sql: () => string): Promise<string> {
  const was = process.env[FLAG];
  if (flag === undefined) delete process.env[FLAG]; else process.env[FLAG] = flag;
  try { return sql(); } finally { if (was === undefined) delete process.env[FLAG]; else process.env[FLAG] = was; }
}

const COHORTS: [string, CohortDef | null][] = [
  ["whole study", null],
  ["female patients", { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] } as unknown as CohortDef],
];

for (const unit of ["patient", "sample"] as const) {
  for (const [cohortName, def] of COHORTS) {
    describe("C3 " + unit + " plot of the " + cohortName + ": the flag changes no row", () => {
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
          const off = await built(undefined, c.sql), on = await built("1", c.sql);
          assert.notEqual(on, off, "the flag changed the statement");
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
