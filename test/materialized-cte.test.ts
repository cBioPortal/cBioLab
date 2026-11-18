// CLICKHOUSE_MATERIALIZED_CTE (lib/ch.ts cte, postToDatabase; lib/plot.ts's WITH clauses), from
// its rule's case table:
//
//   A1  flag unset                        cte(n, s) = `n AS (s)`
//   A2  flag "1"                          cte(n, s) = `n AS MATERIALIZED (s)`
//   A3  flag "true" / "0" / "yes" / ""    cte(n, s) = `n AS (s)`; read at each call, not at load
//   B1  statement holds ` AS MATERIALIZED (`   sent with enable_materialized_cte=1
//   B2  statement without it                   sent without that setting
//   C1  flag off: each plot builder's WITH is the plain `name AS (…)` it always was, no MATERIALIZED
//   C2  flag on: exactly its top-level cohort/cases/xs/ys/vs/gs/cs/rs are MATERIALIZED, nothing
//       else in the statement changes
//
// The rows these statements return with the flag on and off are compared on the fixture study in
// test/plot-materialized-fixture.test.ts. The database here is a stub `fetch` that records URLs.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cteCases, materializedNames } from "./support/plot-cte-cases.ts";

delete process.env.CH_RUN_CACHE;
delete process.env.CLICKHOUSE_MATERIALIZED_CTE;
const ch = await import("../lib/ch.ts");

const CONN = { id: "stub", url: "http://stub.invalid", user: "u", password: "p", db: "db", label: "stub" };
const FLAG = "CLICKHOUSE_MATERIALIZED_CTE";
const withFlag = <T>(v: string | undefined, fn: () => T): T => {
  const was = process.env[FLAG];
  if (v === undefined) delete process.env[FLAG]; else process.env[FLAG] = v;
  try { return fn(); } finally { if (was === undefined) delete process.env[FLAG]; else process.env[FLAG] = was; }
};
afterEach(() => { delete process.env[FLAG]; });

describe("A: cte(name, sql)", () => {
  const cte = (n: string, s: string): string => (ch as unknown as { cte: (n: string, s: string) => string }).cte(n, s);
  test("A1 flag unset: `name AS (sql)` exactly", () => {
    assert.equal(withFlag(undefined, () => cte("cohort", "SELECT pid, sid FROM t")), "cohort AS (SELECT pid, sid FROM t)");
  });
  test("A2 flag \"1\": `name AS MATERIALIZED (sql)` exactly", () => {
    assert.equal(withFlag("1", () => cte("xs", "SELECT id, v FROM x")), "xs AS MATERIALIZED (SELECT id, v FROM x)");
  });
  for (const v of ["true", "0", "yes", "", " 1", "1 "]) {
    test("A3 flag " + JSON.stringify(v) + ": plain `name AS (sql)`", () => {
      assert.equal(withFlag(v, () => cte("vs", "SELECT 1")), "vs AS (SELECT 1)");
    });
  }
  test("A3 read at each call: the same loaded module follows the flag as it changes", () => {
    assert.equal(withFlag(undefined, () => cte("a", "1")), "a AS (1)");
    assert.equal(withFlag("1", () => cte("a", "1")), "a AS MATERIALIZED (1)");
    assert.equal(withFlag("0", () => cte("a", "1")), "a AS (1)");
    assert.equal(withFlag("1", () => cte("a", "1")), "a AS MATERIALIZED (1)");
  });
});

describe("B: the statement's setting", () => {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  const stub = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ meta: [], data: [], rows: 0 }));
  }) as typeof fetch;
  const send = async (sql: string) => {
    urls.length = 0;
    globalThis.fetch = stub;
    try { await ch.chQuery(sql, CONN); } finally { globalThis.fetch = realFetch; }
    assert.equal(urls.length, 1);
    return new URL(urls[0]).searchParams;
  };

  test("B1 a statement holding ` AS MATERIALIZED (` is sent with enable_materialized_cte=1", async () => {
    const p = await send("WITH a AS MATERIALIZED (SELECT 1 AS x) SELECT x FROM a");
    assert.equal(p.get("enable_materialized_cte"), "1");
    assert.equal(p.get("cancel_http_readonly_queries_on_client_close"), "1", "the settings every statement carries are kept");
  });
  test("B1 whatever the flag says at send time: the statement's text decides", async () => {
    const p = await withFlag(undefined, () => send("WITH a AS MATERIALIZED (SELECT 1 AS x) SELECT x FROM a"));
    assert.equal(p.get("enable_materialized_cte"), "1");
  });
  for (const sql of ["WITH a AS (SELECT 1 AS x) SELECT x FROM a", "SELECT 'AS MATERIALIZED' AS x", "SELECT 1 AS materialized"]) {
    test("B2 without ` AS MATERIALIZED (` no setting is added: " + sql, async () => {
      const p = await withFlag("1", () => send(sql));
      assert.equal(p.has("enable_materialized_cte"), false);
    });
  }
  test("B a plot statement built with the flag on carries the setting; built with it off, does not", async () => {
    const c = cteCases(axes())[0];
    assert.equal((await send(withFlag("1", c.sql))).get("enable_materialized_cte"), "1");
    assert.equal((await send(withFlag(undefined, c.sql))).has("enable_materialized_cte"), false);
  });
});

function axes(unit: "patient" | "sample" = "patient") {
  return {
    ctx: { study: "s", db: "db", unit, cohortSql: "SELECT pid, sid FROM db.cohort_rows" },
    num1: { source: "clinical", attribute: "AGE" }, num2: { source: "clinical", attribute: "TMB" },
    cat1: { source: "clinical", attribute: "CANCER_TYPE" }, cat2: { source: "clinical", attribute: "SEX" },
    whiskers: [{ g: "A", loWhisker: 1, hiWhisker: 9 }, { g: "B", loWhisker: 2, hiWhisker: 5 }],
    extent: { x0: 0, x1: 100, y0: 0, y1: 10 },
  } as Parameters<typeof cteCases>[0];
}

describe("C: the plot builders' WITH clauses", () => {
  for (const unit of ["patient", "sample"] as const) {
    for (const c of cteCases(axes(unit))) {
      test("C1 flag off, " + unit + ": " + c.name + " declares its CTEs plainly", () => {
        const off = withFlag(undefined, c.sql);
        assert.doesNotMatch(off, /MATERIALIZED/);
        assert.ok(off.startsWith("WITH cohort AS (SELECT pid, sid FROM db.cohort_rows),\n"), off.slice(0, 120));
        for (const n of c.materialized) assert.match(off, new RegExp("(^WITH |,\\n {5})" + n + " AS \\("), n);
      });
      test("C2 flag on, " + unit + ": " + c.name + " materializes " + c.materialized.join(", ") + " and changes nothing else", () => {
        const off = withFlag(undefined, c.sql), on = withFlag("1", c.sql);
        assert.deepEqual(materializedNames(on), c.materialized);
        const names = c.materialized.join("|");
        assert.equal(on, off.replace(new RegExp("(^WITH |,\\n {5})(" + names + ") AS \\(", "g"), "$1$2 AS MATERIALIZED ("));
        assert.equal(on.split(" AS MATERIALIZED (").length - 1, c.materialized.length, "no CTE inside an axis or cohort is materialized");
      });
      test("C2 flag \"true\", " + unit + ": " + c.name + " is the flag-off statement", () => {
        assert.equal(withFlag("true", c.sql), withFlag(undefined, c.sql));
      });
    }
  }
});
