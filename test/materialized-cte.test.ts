// Materialized WITH subqueries (lib/ch.ts cte, postToDatabase, materializedCteSupported; lib/plot.ts's
// WITH clauses), from the rule's case table:
//
//   A1  cte(n, s, false)                  `n AS (s)` exactly
//   A2  cte(n, s, true)                   `n AS MATERIALIZED (s)` exactly
//   A3  pure: CLICKHOUSE_MATERIALIZED_CTE ("1", "0", unset) changes neither answer
//   B1  statement holds ` AS MATERIALIZED (`   sent with enable_materialized_cte=1
//   B2  statement without it                   sent without that setting
//   C1  a builder given a cohort SQL string, or a context whose `materialized` is absent or false:
//       plain `name AS (…)` throughout, the three forms byte-identical, whatever the env var says
//   C2  a context with `materialized: true`: exactly its top-level cohort/cases/xs/ys/vs/gs/cs/rs are
//       MATERIALIZED, nothing else in the statement changes (plotCoverageSql reads its AxisCtx's)
//   D1  materializedCteSupported: CLICKHOUSE_MATERIALIZED_CTE "0" → false, "1" → true, neither sends a statement
//   D2  unset or any other value → one statement asks the server (its answer: the fixture file)
//   D3  asked once per connection (id + url + db) per process, concurrent callers included; a connection
//       differing in any of the three is asked separately
//   D4  a check that fails → false, and the next call asks again
//   D5  a ChTransport set → false, nothing sent, whatever CLICKHOUSE_MATERIALIZED_CTE says
//
// The rows these statements return, materialized and plain, are compared on the fixture study in
// test/plot-materialized-fixture.test.ts, which also runs D2/D3/D4 against a real server and the
// resolver end to end (E). The database here is a stub `fetch` that records what it is sent.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cteCases, materializedNames, cohortArg, PLAIN_FORMS, type CaseAxes } from "./support/plot-cte-cases.ts";
import type { ChConn } from "../lib/ch.ts";

delete process.env.CH_RUN_CACHE;
delete process.env.CLICKHOUSE_MATERIALIZED_CTE;
const ch = await import("../lib/ch.ts");

const CONN: ChConn = { id: "stub", url: "http://stub.invalid", user: "u", password: "p", db: "db", label: "stub" };
const FLAG = "CLICKHOUSE_MATERIALIZED_CTE";
const withFlag = <T>(v: string | undefined, fn: () => T): T => {
  const was = process.env[FLAG];
  if (v === undefined) delete process.env[FLAG]; else process.env[FLAG] = v;
  try { return fn(); } finally { if (was === undefined) delete process.env[FLAG]; else process.env[FLAG] = was; }
};
afterEach(() => { delete process.env[FLAG]; });

// a stub database: every statement it is sent, by URL and body; answers as `reply` says
interface Sent { url: string; body: string }
const sent: Sent[] = [];
const realFetch = globalThis.fetch;
let reply: () => Response = () => new Response(JSON.stringify({ meta: [], data: [], rows: 0 }));
async function withStub<T>(fn: () => Promise<T>): Promise<T> {
  sent.length = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    sent.push({ url: String(url), body });
    return reply();
  }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}

describe("A: cte(name, sql, materialized)", () => {
  test("A1 materialized false: `name AS (sql)` exactly", () => {
    assert.equal(ch.cte("cohort", "SELECT pid, sid FROM t", false), "cohort AS (SELECT pid, sid FROM t)");
  });
  test("A2 materialized true: `name AS MATERIALIZED (sql)` exactly", () => {
    assert.equal(ch.cte("xs", "SELECT id, v FROM x", true), "xs AS MATERIALIZED (SELECT id, v FROM x)");
  });
  for (const v of [undefined, "1", "0", "true", ""]) {
    test("A3 the env var " + (v === undefined ? "unset" : JSON.stringify(v)) + " changes neither answer", () => {
      assert.equal(withFlag(v, () => ch.cte("vs", "SELECT 1", false)), "vs AS (SELECT 1)");
      assert.equal(withFlag(v, () => ch.cte("vs", "SELECT 1", true)), "vs AS MATERIALIZED (SELECT 1)");
    });
  }
});

describe("B: the statement's setting", () => {
  const send = async (sql: string) => {
    const r = await withStub(async () => { await ch.chQuery(sql, CONN); return sent.slice(); });
    assert.equal(r.length, 1);
    return new URL(r[0].url).searchParams;
  };

  test("B1 a statement holding ` AS MATERIALIZED (` is sent with enable_materialized_cte=1", async () => {
    const p = await send("WITH a AS MATERIALIZED (SELECT 1 AS x) SELECT x FROM a");
    assert.equal(p.get("enable_materialized_cte"), "1");
    assert.equal(p.get("cancel_http_readonly_queries_on_client_close"), "1", "the settings every statement carries are kept");
  });
  test("B1 whatever the env var says at send time: the statement's text decides", async () => {
    for (const v of [undefined, "0"]) {
      const p = await withFlag(v, () => send("WITH a AS MATERIALIZED (SELECT 1 AS x) SELECT x FROM a"));
      assert.equal(p.get("enable_materialized_cte"), "1", "env " + v);
    }
  });
  for (const sql of ["WITH a AS (SELECT 1 AS x) SELECT x FROM a", "SELECT 'AS MATERIALIZED' AS x", "SELECT 1 AS materialized"]) {
    test("B2 without ` AS MATERIALIZED (` no setting is added: " + sql, async () => {
      const p = await withFlag("1", () => send(sql));
      assert.equal(p.has("enable_materialized_cte"), false);
    });
  }
  test("B a plot statement built materialized carries the setting; built plain, does not", async () => {
    const a = axes(), c = cteCases(a)[0];
    assert.equal((await send(c.sql(cohortArg(a.ctx.cohortSql, "context, materialized true")))).get("enable_materialized_cte"), "1");
    for (const form of PLAIN_FORMS)
      assert.equal((await send(c.sql(cohortArg(a.ctx.cohortSql, form)))).has("enable_materialized_cte"), false, form);
  });
});

function axes(unit: "patient" | "sample" = "patient"): CaseAxes {
  return {
    ctx: { study: "s", db: "db", unit, cohortSql: "SELECT pid, sid FROM db.cohort_rows" },
    num1: { source: "clinical", attribute: "AGE" }, num2: { source: "clinical", attribute: "TMB" },
    cat1: { source: "clinical", attribute: "CANCER_TYPE" }, cat2: { source: "clinical", attribute: "SEX" },
    whiskers: [{ g: "A", loWhisker: 1, hiWhisker: 9 }, { g: "B", loWhisker: 2, hiWhisker: 5 }],
    extent: { x0: 0, x1: 100, y0: 0, y1: 10 },
  } as CaseAxes;
}

describe("C: the plot builders' WITH clauses", () => {
  for (const unit of ["patient", "sample"] as const) {
    const a = axes(unit), co = a.ctx.cohortSql;
    for (const c of cteCases(a)) {
      test("C1 plain, " + unit + ": " + c.name + " declares its CTEs plainly, the same text for a string or a context without materialized", () => {
        const str = c.sql(cohortArg(co, "sql string"));
        assert.doesNotMatch(str, /MATERIALIZED/);
        assert.ok(str.startsWith("WITH cohort AS (SELECT pid, sid FROM db.cohort_rows),\n"), str.slice(0, 120));
        for (const n of c.materialized) assert.match(str, new RegExp("(^WITH |,\\n {5})" + n + " AS \\("), n);
        for (const form of PLAIN_FORMS) assert.equal(c.sql(cohortArg(co, form)), str, form);
      });
      test("C1 plain, " + unit + ": " + c.name + " ignores the env var", () => {
        const str = c.sql(cohortArg(co, "sql string"));
        for (const v of ["1", "0"])
          for (const form of PLAIN_FORMS) assert.equal(withFlag(v, () => c.sql(cohortArg(co, form))), str, "env " + v + ", " + form);
        assert.equal(withFlag("0", () => c.sql(cohortArg(co, "context, materialized true"))), c.sql(cohortArg(co, "context, materialized true")),
          "env 0 does not turn a materialized context plain");
      });
      test("C2 materialized, " + unit + ": " + c.name + " materializes " + c.materialized.join(", ") + " and changes nothing else", () => {
        const off = c.sql(cohortArg(co, "sql string")), on = c.sql(cohortArg(co, "context, materialized true"));
        assert.deepEqual(materializedNames(on), c.materialized);
        const names = c.materialized.join("|");
        assert.equal(on, off.replace(new RegExp("(^WITH |,\\n {5})(" + names + ") AS \\(", "g"), "$1$2 AS MATERIALIZED ("));
        assert.equal(on.split(" AS MATERIALIZED (").length - 1, c.materialized.length, "no CTE inside an axis or cohort is materialized");
      });
    }
  }
});

describe("D: materializedCteSupported(conn)", () => {
  // a connection no other case has used, so the module's per-process answer cannot leak between cases
  let k = 0;
  const fresh = (over: Partial<ChConn> = {}): ChConn => ({ ...CONN, id: "d" + (++k), ...over });
  const ok = () => new Response(JSON.stringify({ meta: [], data: [], rows: 0 }));
  afterEach(() => { reply = ok; ch.setChTransport(null); });

  for (const [v, want] of [["0", false], ["1", true]] as const) {
    test("D1 env " + JSON.stringify(v) + " → " + want + ", no statement sent", async () => {
      const conn = fresh();
      const r = await withStub(() => withFlag(v, () => ch.materializedCteSupported(conn)));
      assert.equal(r, want);
      assert.deepEqual(sent, []);
    });
  }
  test("D1 the env var is read at each call: \"0\" then \"1\" on one connection, still nothing sent", async () => {
    const conn = fresh();
    await withStub(async () => {
      assert.equal(await withFlag("0", () => ch.materializedCteSupported(conn)), false);
      assert.equal(await withFlag("1", () => ch.materializedCteSupported(conn)), true);
      assert.equal(await withFlag("0", () => ch.materializedCteSupported(conn)), false);
    });
    assert.deepEqual(sent, []);
  });
  for (const v of [undefined, "true", "yes", "", " 1"]) {
    test("D2 env " + (v === undefined ? "unset" : JSON.stringify(v)) + ": one statement goes to the connection's server", async () => {
      const conn = fresh();
      await withStub(() => withFlag(v, () => ch.materializedCteSupported(conn)));
      assert.equal(sent.length, 1);
      assert.ok(sent[0].url.startsWith(conn.url), sent[0].url);
    });
  }
  test("D3 a second call for the same connection sends nothing and gets the same answer", async () => {
    const conn = fresh();
    await withStub(async () => {
      const first = await ch.materializedCteSupported(conn);
      const second = await ch.materializedCteSupported(conn);
      assert.equal(second, first);
    });
    assert.equal(sent.length, 1);
    // nor a third, from a copy of the connection: id, url and db are what identify it
    await withStub(() => ch.materializedCteSupported({ ...conn, label: "another label", password: "q" }));
    assert.equal(sent.length, 0);
  });
  test("D3 callers at the same time share one question", async () => {
    const conn = fresh();
    const rs = await withStub(() => Promise.all([1, 2, 3].map(() => ch.materializedCteSupported(conn))));
    assert.equal(new Set(rs).size, 1);
    assert.equal(sent.length, 1);
  });
  for (const field of ["id", "url", "db"] as const) {
    test("D3 a connection differing only in its " + field + " is asked separately", async () => {
      const conn = fresh();
      await withStub(() => ch.materializedCteSupported(conn));
      assert.equal(sent.length, 1);
      const other = { ...conn, [field]: field === "url" ? "http://other.invalid" : conn[field] + "-other" };
      await withStub(() => ch.materializedCteSupported(other));
      assert.equal(sent.length, 1, "asked of " + field + " " + other[field]);
      await withStub(() => ch.materializedCteSupported(other));
      assert.equal(sent.length, 0, "and remembered for it too");
    });
  }
  test("D4 a check that fails answers false, and the next call asks again", async () => {
    const conn = fresh();
    reply = () => new Response("Code: 999. DB::Exception: the check failed", { status: 500 });
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    assert.ok(sent.length >= 1);
    reply = ok;
    await withStub(() => ch.materializedCteSupported(conn));
    assert.equal(sent.length, 1, "asked again after the failure");
    await withStub(() => ch.materializedCteSupported(conn));
    assert.equal(sent.length, 0, "a check that answered is remembered");
  });
  test("D4 a check whose fetch throws answers false, and the next call asks again", async () => {
    const conn = fresh();
    reply = () => { throw new TypeError("fetch failed: the socket closed"); };
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    reply = ok;
    await withStub(() => ch.materializedCteSupported(conn));
    assert.equal(sent.length, 1, "asked again after the failure");
  });
  test("D5 with a ChTransport set: false, and nothing reaches the transport or the database", async () => {
    const conn = fresh();
    const viaTransport: string[] = [];
    ch.setChTransport(async (st, send) => { viaTransport.push(st.query); return send(); });
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    assert.deepEqual(viaTransport, []);
    assert.deepEqual(sent, []);
  });
  test("D5 with a ChTransport set, CLICKHOUSE_MATERIALIZED_CTE=1 still answers false: recorded answers are keyed by the plain statements", async () => {
    const conn = fresh();
    ch.setChTransport(async (_st, send) => send());
    process.env[FLAG] = "1";
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    assert.deepEqual(sent, []);
  });
});
