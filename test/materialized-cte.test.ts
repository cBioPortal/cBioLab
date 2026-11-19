// Materialized WITH subqueries (lib/ch.ts cte, withStatement, postToDatabase, materializedCteSupported;
// lib/plot.ts's WITH clauses; lib/federation.ts's plot contexts), from the rule's case table:
//
//   A1  cte(n, s, false)                  `n AS (s)` exactly
//   A2  cte(n, s, true)                   `n AS MATERIALIZED (s)` exactly
//   A3  pure: CLICKHOUSE_MATERIALIZED_CTE ("1", "0", unset) changes neither answer
//   S1  withStatement(ctes, body, m): "WITH " + ctes joined by ",\n     " + "\n" + body; when m, each
//       entry not marked "inline" is AS MATERIALIZED and the text ends "\nSETTINGS enable_materialized_cte = 1";
//       inline entries never are; not m: neither MATERIALIZED nor SETTINGS anywhere
//   S2  the setting travels in the statement text only: postToDatabase adds no enable_materialized_cte
//       to the URL, whatever the text holds
//   S3  a plot builder given a materialized cohort: the plain statement with exactly cohort and its
//       axis/selection subqueries (cohort, cases, xs, ys, vs, gs, cs, rs) AS MATERIALIZED, its helpers
//       (pair, e, j, c, sparse) left `AS (`, and the setting appended; plain forms (a string, a context
//       with materialized absent or false) have neither MATERIALIZED nor SETTINGS
//   S4a a ChTransport set → false, nothing sent, whatever CLICKHOUSE_MATERIALIZED_CTE says
//   S4b CLICKHOUSE_MATERIALIZED_CTE "0" → false, "1" → true, neither sends anything
//   S4c otherwise exactly CTE_CHECK_SQL goes to that connection; true iff it answers ok = 1; false when
//       it fails for any reason (an exception, an HTTP error, a socket error, ok ≠ 1)
//   S4d asked once per connection (id + url + db) per CTE_CHECK_TTL_MS, concurrent callers included;
//       a connection differing in any of the three is asked separately
//   S4e after CTE_CHECK_TTL_MS asked again, for a true answer and for a failure; a failure is kept
//       as false for the TTL, not asked again on the next call
//   S4f the check is not one of the calling request's queries: a failing check inside
//       withoutFailedQueries(fn) does not make it throw FailedQueriesError
//   S4g the check is not cancelled when the calling request's AbortSignal aborts
//   S5  lib/federation.ts: only plot paths wait on the check — run against the fixture study in
//       test/plot-materialized-fixture.test.ts, where cox and logistic rows can actually be computed
//
// The rows these statements return, materialized and plain, are compared on the fixture study in
// test/plot-materialized-fixture.test.ts (S6). The database here is a stub `fetch` that records what
// it is sent.
import { test, describe, afterEach, beforeEach, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { cteCases, materializedNames, plainNames, expectedMaterialized, cohortArg, PLAIN_FORMS, MATERIALIZED_SETTING, type CaseAxes } from "./support/plot-cte-cases.ts";
import type { ChConn } from "../lib/ch.ts";

delete process.env.CH_RUN_CACHE;
delete process.env.CLICKHOUSE_MATERIALIZED_CTE;
const ch = await import("../lib/ch.ts");

const CONN: ChConn = { id: "stub", url: "http://stub.invalid", user: "u", password: "p", db: "db", label: "stub" };
const FLAG = "CLICKHOUSE_MATERIALIZED_CTE";
const SETTING = "\nSETTINGS enable_materialized_cte = 1";
const withFlag = <T>(v: string | undefined, fn: () => T): T => {
  const was = process.env[FLAG];
  if (v === undefined) delete process.env[FLAG]; else process.env[FLAG] = v;
  try { return fn(); } finally { if (was === undefined) delete process.env[FLAG]; else process.env[FLAG] = was; }
};
afterEach(() => { delete process.env[FLAG]; });

// a stub database: every statement it is sent, by URL, body and signal; answers as `reply` says
interface Sent { url: string; body: string; signal?: AbortSignal | null }
const sent: Sent[] = [];
const realFetch = globalThis.fetch;
const json = (data: unknown[]) => new Response(JSON.stringify({ meta: [], data, rows: data.length }));
const okAnswer = () => json([{ ok: 1 }]);
let reply: (body: string, init?: RequestInit) => Response | Promise<Response> = okAnswer;
async function withStub<T>(fn: () => Promise<T>): Promise<T> {
  sent.length = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    sent.push({ url: String(url), body, signal: init?.signal });
    return reply(body, init);
  }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}
/** the statement text a chQuery of `sql` puts on the wire */
const wire = (sql: string) => sql + "\nFORMAT JSON";

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

describe("S1: withStatement(ctes, body, materialized)", () => {
  const CTES: import("../lib/ch.ts").WithCte[] = [["cohort", "SELECT pid FROM t"], ["xs", "SELECT id, v FROM x"], ["pair", "SELECT x FROM xs", "inline"]];
  test("plain: WITH, the entries joined by `,\\n     `, a newline, the body; no MATERIALIZED, no SETTINGS", () => {
    const s = ch.withStatement(CTES, "SELECT count() FROM pair", false);
    assert.equal(s, "WITH cohort AS (SELECT pid FROM t),\n     xs AS (SELECT id, v FROM x),\n     pair AS (SELECT x FROM xs)\nSELECT count() FROM pair");
    assert.doesNotMatch(s, /MATERIALIZED|SETTINGS/);
  });
  test("materialized: every entry not marked inline is AS MATERIALIZED, and the setting ends the statement", () => {
    assert.equal(ch.withStatement(CTES, "SELECT count() FROM pair", true),
      "WITH cohort AS MATERIALIZED (SELECT pid FROM t),\n     xs AS MATERIALIZED (SELECT id, v FROM x),\n     pair AS (SELECT x FROM xs)\nSELECT count() FROM pair" + SETTING);
  });
  test("an inline entry is never materialized, wherever it sits", () => {
    const s = ch.withStatement([["a", "SELECT 1", "inline"], ["b", "SELECT 2"], ["c", "SELECT 3", "inline"]], "SELECT * FROM b", true);
    assert.equal(s, "WITH a AS (SELECT 1),\n     b AS MATERIALIZED (SELECT 2),\n     c AS (SELECT 3)\nSELECT * FROM b" + SETTING);
  });
  test("all entries inline, materialized: no MATERIALIZED keyword, the setting still ends the statement", () => {
    const s = ch.withStatement([["a", "SELECT 1", "inline"]], "SELECT * FROM a", true);
    assert.equal(s, "WITH a AS (SELECT 1)\nSELECT * FROM a" + SETTING);
  });
  test("one entry, plain and materialized", () => {
    assert.equal(ch.withStatement([["a", "SELECT 1"]], "SELECT * FROM a", false), "WITH a AS (SELECT 1)\nSELECT * FROM a");
    assert.equal(ch.withStatement([["a", "SELECT 1"]], "SELECT * FROM a", true), "WITH a AS MATERIALIZED (SELECT 1)\nSELECT * FROM a" + SETTING);
  });
  for (const v of ["0", "1"]) {
    test("the env var " + v + " changes neither form", () => {
      assert.equal(withFlag(v, () => ch.withStatement(CTES, "SELECT 1", false)), ch.withStatement(CTES, "SELECT 1", false));
      assert.equal(withFlag(v, () => ch.withStatement(CTES, "SELECT 1", true)), ch.withStatement(CTES, "SELECT 1", true));
    });
  }
});

describe("S2: the setting travels in the statement text only", () => {
  const send = async (sql: string) => {
    const r = await withStub(async () => { await ch.chQuery(sql, CONN); return sent.slice(); });
    assert.equal(r.length, 1);
    assert.equal(r[0].body, wire(sql), "the statement is sent as written");
    return new URL(r[0].url).searchParams;
  };
  const MAT = "WITH a AS MATERIALIZED (SELECT 1 AS x)\nSELECT x FROM a";
  for (const sql of [MAT, MAT + SETTING, "WITH a AS (SELECT 1 AS x) SELECT x FROM a", "SELECT 'AS MATERIALIZED (' AS x"]) {
    for (const v of [undefined, "0", "1"]) {
      test("no enable_materialized_cte on the URL, env " + v + ": " + JSON.stringify(sql.slice(0, 50)), async () => {
        const p = await withFlag(v, () => send(sql));
        assert.equal(p.has("enable_materialized_cte"), false);
        assert.equal(p.get("cancel_http_readonly_queries_on_client_close"), "1", "the settings every statement carries are kept");
      });
    }
  }
  test("a plot statement built materialized reaches the database with its setting in the text, none on the URL", async () => {
    const a = axes(), c = cteCases(a)[0];
    const on = c.sql(cohortArg(a.ctx.cohortSql, "context, materialized true"));
    const r = await withStub(async () => { await ch.chQuery(on, CONN); return sent.slice(); });
    assert.ok(r[0].body.startsWith(on), "the text as built");
    assert.ok(r[0].body.includes(SETTING + "\nFORMAT JSON"), "the setting rides in the text, before FORMAT");
    assert.equal(new URL(r[0].url).searchParams.has("enable_materialized_cte"), false);
  });
  test("through a ChTransport, the statement handed over carries the setting in its text", async () => {
    const seen: string[] = [];
    ch.setChTransport(async (st) => { seen.push(st.query); return JSON.stringify({ meta: [], data: [], rows: 0 }); });
    try { await ch.chQuery(MAT + SETTING, CONN); } finally { ch.setChTransport(null); }
    assert.deepEqual(seen, [wire(MAT + SETTING)]);
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

describe("S3: the plot builders' WITH clauses", () => {
  for (const unit of ["patient", "sample"] as const) {
    const a = axes(unit), co = a.ctx.cohortSql;
    for (const c of cteCases(a)) {
      test("plain, " + unit + ": " + c.name + ": every CTE `AS (`, no SETTINGS, the same text for every plain form", () => {
        const str = c.sql(cohortArg(co, "sql string"));
        assert.doesNotMatch(str, /MATERIALIZED|SETTINGS/);
        assert.ok(str.startsWith("WITH cohort AS (SELECT pid, sid FROM db.cohort_rows),\n"), str.slice(0, 120));
        assert.deepEqual(plainNames(str).filter((n) => c.materialized.includes(n)), c.materialized, "its cohort and axes, in order");
        assert.deepEqual(plainNames(str).filter((n) => c.helpers.includes(n)), c.helpers, "its helpers, in order");
        for (const form of PLAIN_FORMS) assert.equal(c.sql(cohortArg(co, form)), str, form);
      });
      test("plain, " + unit + ": " + c.name + " ignores the env var", () => {
        const str = c.sql(cohortArg(co, "sql string")), on = c.sql(cohortArg(co, "context, materialized true"));
        for (const v of ["1", "0"]) {
          for (const form of PLAIN_FORMS) assert.equal(withFlag(v, () => c.sql(cohortArg(co, form))), str, "env " + v + ", " + form);
          assert.equal(withFlag(v, () => c.sql(cohortArg(co, "context, materialized true"))), on, "env " + v + " leaves a materialized context materialized");
        }
      });
      test("materialized, " + unit + ": " + c.name + ": " + c.materialized.join(", ") + " MATERIALIZED, " +
        (c.helpers.length ? c.helpers.join(", ") + " plain, " : "") + "the setting appended, nothing else", () => {
        const off = c.sql(cohortArg(co, "sql string")), on = c.sql(cohortArg(co, "context, materialized true"));
        assert.equal(on, expectedMaterialized(off, c.materialized));
        assert.deepEqual(materializedNames(on), c.materialized);
        assert.deepEqual(plainNames(on), c.helpers, "the helpers stay `AS (`");
        assert.equal(on.split(" AS MATERIALIZED (").length - 1, c.materialized.length, "no CTE inside an axis or the cohort is materialized");
        assert.ok(on.endsWith(MATERIALIZED_SETTING));
        assert.equal(on.split("SETTINGS").length - 1, 1, "one SETTINGS clause");
      });
    }
  }
});

describe("S4: materializedCteSupported(conn)", () => {
  // a connection no other case has used, so the module's remembered answer cannot leak between cases
  let k = 0;
  const fresh = (over: Partial<ChConn> = {}): ChConn => ({ ...CONN, id: "d" + (++k), ...over });
  const fail500 = () => new Response("Code: 115. DB::Exception: Setting enable_materialized_cte is neither a builtin setting nor started with the prefix 'SQL_'. (UNKNOWN_SETTING)", { status: 500 });
  afterEach(() => { reply = okAnswer; ch.setChTransport(null); mock.restoreAll(); });

  test("CTE_CHECK_SQL is the setting itself on a trivial select", () => {
    assert.equal(ch.CTE_CHECK_SQL, "SELECT 1 AS ok\nSETTINGS enable_materialized_cte = 1");
    assert.ok(Number.isFinite(ch.CTE_CHECK_TTL_MS) && ch.CTE_CHECK_TTL_MS > 0);
  });

  test("a: with a ChTransport set: false, and nothing reaches the transport or the database", async () => {
    const conn = fresh();
    const viaTransport: string[] = [];
    ch.setChTransport(async (st, send) => { viaTransport.push(st.query); return send(); });
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    assert.deepEqual(viaTransport, []);
    assert.deepEqual(sent, []);
  });
  test("a: with a ChTransport set, CLICKHOUSE_MATERIALIZED_CTE=1 still answers false", async () => {
    const conn = fresh();
    const viaTransport: string[] = [];
    ch.setChTransport(async (st, send) => { viaTransport.push(st.query); return send(); });
    process.env[FLAG] = "1";
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    assert.deepEqual(viaTransport, []);
    assert.deepEqual(sent, []);
  });

  for (const [v, want] of [["0", false], ["1", true]] as const) {
    test("b: env " + JSON.stringify(v) + " → " + want + ", no statement sent", async () => {
      const conn = fresh();
      const r = await withStub(() => withFlag(v, () => ch.materializedCteSupported(conn)));
      assert.equal(r, want);
      assert.deepEqual(sent, []);
    });
  }
  test("b: the env var is read at each call: \"0\" then \"1\" on one connection, still nothing sent", async () => {
    const conn = fresh();
    await withStub(async () => {
      assert.equal(await withFlag("0", () => ch.materializedCteSupported(conn)), false);
      assert.equal(await withFlag("1", () => ch.materializedCteSupported(conn)), true);
      assert.equal(await withFlag("0", () => ch.materializedCteSupported(conn)), false);
    });
    assert.deepEqual(sent, []);
  });

  for (const v of [undefined, "true", "yes", "", " 1"]) {
    test("c: env " + (v === undefined ? "unset" : JSON.stringify(v)) + ": exactly CTE_CHECK_SQL goes to the connection's server; ok = 1 → true", async () => {
      const conn = fresh();
      const r = await withStub(() => withFlag(v, () => ch.materializedCteSupported(conn)));
      assert.equal(r, true);
      assert.equal(sent.length, 1);
      assert.ok(sent[0].url.startsWith(conn.url), sent[0].url);
      assert.equal(sent[0].body, wire(ch.CTE_CHECK_SQL));
      assert.equal(new URL(sent[0].url).searchParams.has("enable_materialized_cte"), false, "the setting is in the text, not the URL");
    });
  }
  const failures: [string, typeof reply][] = [
    ["an unknown setting (HTTP 500)", fail500],
    ["a user not allowed to change it (HTTP 500)", () => new Response("Code: 452. DB::Exception: Setting enable_materialized_cte should not be changed. (SETTING_CONSTRAINT_VIOLATION)", { status: 500 })],
    ["readonly user (HTTP 500)", () => new Response("Code: 164. DB::Exception: Cannot modify 'enable_materialized_cte' setting in readonly mode. (READONLY)", { status: 500 })],
    ["bad credentials (HTTP 516)", () => new Response("Code: 516. DB::Exception: default: Authentication failed. (AUTHENTICATION_FAILED)", { status: 516 })],
    ["a network error", () => { throw new TypeError("fetch failed: getaddrinfo ENOTFOUND stub.invalid"); }],
    ["a body that is not JSON", () => new Response("not json")],
    ["no rows", () => json([])],
    ["ok = 0", () => json([{ ok: 0 }])],
  ];
  for (const [what, r] of failures) {
    test("c: " + what + " → false, and only CTE_CHECK_SQL was sent", async () => {
      const conn = fresh();
      reply = r;
      assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
      assert.ok(sent.length >= 1);
      for (const s of sent) assert.equal(s.body, wire(ch.CTE_CHECK_SQL));
    });
  }
  test("c: ok answered as the string \"1\" (ClickHouse's JSON for some integer types) → true", async () => {
    const conn = fresh();
    reply = () => json([{ ok: "1" }]);
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), true);
  });

  test("d: a second call for the same connection sends nothing and gets the same answer", async () => {
    const conn = fresh();
    await withStub(async () => {
      assert.equal(await ch.materializedCteSupported(conn), true);
      assert.equal(await ch.materializedCteSupported(conn), true);
    });
    assert.equal(sent.length, 1);
    // nor a third, from a copy of the connection: id, url and db are what identify it
    await withStub(() => ch.materializedCteSupported({ ...conn, label: "another label", password: "q", user: "v" }));
    assert.equal(sent.length, 0);
  });
  test("d: callers at the same time share one question", async () => {
    const conn = fresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    reply = async () => { await gate; return okAnswer(); };
    const rs = await withStub(async () => {
      const ps = [1, 2, 3, 4].map(() => ch.materializedCteSupported(conn));
      await new Promise((r) => setTimeout(r, 10));
      release();
      return Promise.all(ps);
    });
    assert.deepEqual(rs, [true, true, true, true]);
    assert.equal(sent.length, 1);
  });
  test("d: callers at the same time share one failure too", async () => {
    const conn = fresh();
    reply = fail500;
    const rs = await withStub(() => Promise.all([1, 2, 3].map(() => ch.materializedCteSupported(conn))));
    assert.deepEqual(rs, [false, false, false]);
    assert.equal(sent.length, 1);
  });
  for (const field of ["id", "url", "db"] as const) {
    test("d: a connection differing only in its " + field + " is asked separately", async () => {
      const conn = fresh();
      await withStub(() => ch.materializedCteSupported(conn));
      assert.equal(sent.length, 1);
      const other = { ...conn, [field]: field === "url" ? "http://other.invalid" : conn[field] + "-other" };
      reply = fail500;
      assert.equal(await withStub(() => ch.materializedCteSupported(other)), false, "its own answer");
      assert.equal(sent.length, 1, "asked of " + field + " " + other[field]);
      reply = okAnswer;
      await withStub(() => ch.materializedCteSupported(other));
      assert.equal(sent.length, 0, "and remembered for it too");
      assert.equal(await withStub(() => ch.materializedCteSupported(conn)), true, "the first connection keeps its own answer");
      assert.equal(sent.length, 0);
    });
  }

  // e: the clock is Date.now, moved by hand
  const clock = () => {
    let t = 1_800_000_000_000;
    mock.method(Date, "now", () => t);
    return { advance: (ms: number) => { t += ms; } };
  };
  test("e: a true answer is kept for CTE_CHECK_TTL_MS, then asked again", async () => {
    const conn = fresh(), c = clock();
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), true);
    assert.equal(sent.length, 1);
    c.advance(ch.CTE_CHECK_TTL_MS - 1);
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), true);
    assert.equal(sent.length, 0, "within the TTL: not asked");
    c.advance(1);
    reply = fail500;
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false, "after the TTL: the server's new answer");
    assert.equal(sent.length, 1, "after the TTL: asked again");
  });
  test("e: a failure is kept as false for the TTL (not asked again on the next call), then asked again", async () => {
    const conn = fresh(), c = clock();
    reply = fail500;
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    assert.ok(sent.length >= 1);
    reply = okAnswer;
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false, "the failure is remembered");
    assert.equal(sent.length, 0, "the next call does not ask again");
    c.advance(ch.CTE_CHECK_TTL_MS / 2);
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    assert.equal(sent.length, 0);
    c.advance(ch.CTE_CHECK_TTL_MS / 2);
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), true, "after the TTL: asked again and answered");
    assert.equal(sent.length, 1);
  });
  test("e: a network failure is kept for the TTL too", async () => {
    const conn = fresh(), c = clock();
    reply = () => { throw new TypeError("fetch failed: other side closed"); };
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    reply = okAnswer;
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), false);
    assert.equal(sent.length, 0);
    c.advance(ch.CTE_CHECK_TTL_MS);
    assert.equal(await withStub(() => ch.materializedCteSupported(conn)), true);
    assert.equal(sent.length, 1);
  });

  test("f: a failing check inside withoutFailedQueries does not make it throw; the request's own queries' value is returned", async () => {
    const conn = fresh();
    // the request's own statement answers; anything else on the wire (the check, however it is asked) fails
    reply = (body) => body === wire("SELECT 7 AS n") ? json([{ n: 7 }]) : fail500();
    const v = await withStub(() => ch.withoutFailedQueries(async () => {
      const r = await ch.chQuery<{ n: number }>("SELECT 7 AS n", conn);
      const m = await ch.materializedCteSupported(conn);
      return { n: r.data[0].n, m };
    }));
    assert.deepEqual(v, { n: 7, m: false });
    assert.ok(sent.some((s) => s.body !== wire("SELECT 7 AS n")), "the check was asked inside the request");
  });
  test("f: a check that throws (network) inside withoutFailedQueries does not make it throw", async () => {
    const conn = fresh();
    reply = () => { throw new TypeError("fetch failed: ECONNREFUSED"); };
    const v = await withStub(() => ch.withoutFailedQueries(async () => (await ch.materializedCteSupported(conn)) ? "on" : "off"));
    assert.equal(v, "off");
  });
  test("f: a request's own failed query is still counted alongside a failing check", async () => {
    const conn = fresh();
    reply = fail500;
    await assert.rejects(withStub(() => ch.withoutFailedQueries(async () => {
      await ch.materializedCteSupported(conn);
      try { await ch.chQuery("SELECT broken", conn); } catch { /* the engine turns it into a view's error */ }
      return 1;
    })), (e: unknown) => e instanceof ch.FailedQueriesError && e.count === 1);
  });
  test("f: a check started by one request and failing later does not fail another request that shares it", async () => {
    const conn = fresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    reply = async () => { await gate; return fail500(); };
    const [a, b] = await withStub(async () => {
      const pa = ch.withoutFailedQueries(async () => ch.materializedCteSupported(conn));
      const pb = ch.withoutFailedQueries(async () => ch.materializedCteSupported(conn));
      await new Promise((r) => setTimeout(r, 10));
      release();
      return Promise.all([pa, pb]);
    });
    assert.deepEqual([a, b], [false, false]);
  });

  test("g: the check is not cancelled when the calling request aborts", async () => {
    const conn = fresh();
    const ac = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // a database that honours the signal it is given, as fetch does
    reply = (_body, init) => new Promise<Response>((resolve, rejectAnswer) => {
      const sig = init?.signal;
      if (sig?.aborted) { rejectAnswer(new DOMException("This operation was aborted", "AbortError")); return; }
      sig?.addEventListener("abort", () => rejectAnswer(new DOMException("This operation was aborted", "AbortError")));
      // a yes however the check is phrased
      void gate.then(() => resolve(json([{ ok: 1, n: 1 }])));
    });
    const r = await withStub(() => ch.withChContext({ signal: ac.signal }, async () => {
      const p = ch.materializedCteSupported(conn);
      await new Promise((res) => setTimeout(res, 10));
      ac.abort();
      await new Promise((res) => setTimeout(res, 10));
      release();
      return p;
    }));
    assert.equal(r, true, "the check finished and answered despite the request's abort");
    assert.equal(sent.length, 1);
    assert.notEqual(sent[0].signal, ac.signal, "the check was not sent with the request's signal");
  });
  test("g: a request already aborted when it asks still gets the server's answer", async () => {
    const conn = fresh();
    const ac = new AbortController();
    ac.abort();
    reply = () => json([{ ok: 1, n: 1 }]);
    const r = await withStub(() => ch.withChContext({ signal: ac.signal }, () => ch.materializedCteSupported(conn)));
    assert.equal(r, true);
    assert.equal(sent.length, 1);
  });
});

// S4h–S4m: a check the server accepts but never answers, and what the check says when it fails.
//
//   S4h  a stalled check resolves false within about CTE_CHECK_TIMEOUT_MS, not after minutes
//   S4i  when that timeout fires, the stalled HTTP request is cancelled (its AbortSignal aborts)
//   S4j  callers at the same time during a stall all get false from one request; a later call
//        within CTE_CHECK_TTL_MS reuses that false without a new request
//   S4k  a failed check (server error, network error, timeout) warns exactly once, naming the
//        connection's id and never its user or password; a check answered ok = 1 warns not at all;
//        calls served from the remembered answer warn no further
//   S4l  a timed-out check inside withoutFailedQueries does not make it throw
//   S4m  a timed-out check is asked again after CTE_CHECK_TTL_MS
//
// The stalls here wait in real time, so the cases that stall run side by side; each connection has
// its own url, and the stub database below answers by url, so they do not see each other's requests.
const TIMEOUT: number = ch.CTE_CHECK_TIMEOUT_MS ?? 5000;
const realSetTimeout = globalThis.setTimeout;
const LATE = Symbol("no answer");
/** p's value, or LATE when it has none within ms of real time */
const within = <T>(p: Promise<T>, ms: number): Promise<T | typeof LATE> =>
  Promise.race([p, new Promise<typeof LATE>((r) => realSetTimeout(() => r(LATE), ms))]);
const MARGIN = 1500;

let s4k = 0;
/** a connection with its own url and credentials no other case uses */
const secretConn = (): ChConn => {
  const n = ++s4k;
  return { id: "stall" + n, url: "http://stall-" + n + ".invalid", user: "user-secret-" + n, password: "pw-secret-" + n, db: "db", label: "stall " + n };
};
type Handler = (body: string, init?: RequestInit) => Response | Promise<Response>;
interface Routed { body: string; signal?: AbortSignal | null }
const routes = new Map<string, { handler: Handler; sent: Routed[] }>();
/** pending stalls, so a check the code never cancels does not hold its connection slot past this file */
const stalls: (() => void)[] = [];
/** a database that takes the statement and never answers; like fetch, it gives up when the signal aborts */
const stall: Handler = (_body, init) => new Promise<Response>((_, reject) => {
  const fail = () => reject(new DOMException("This operation was aborted", "AbortError"));
  stalls.push(fail);
  const sig = init?.signal;
  if (sig?.aborted) { fail(); return; }
  sig?.addEventListener("abort", fail, { once: true });
});
const route = (conn: ChConn, handler: Handler) => {
  const r = { handler, sent: [] as Routed[] };
  routes.set(new URL(conn.url).host, r);
  return r;
};
const warnings: string[] = [];
const warningsFor = (conn: ChConn) => warnings.filter((w) => w.includes(conn.id));
const assertNoSecrets = (conn: ChConn) => {
  for (const w of warnings) {
    assert.ok(!w.includes(conn.password), "a warning shows the password: " + w);
    assert.ok(!w.includes(conn.user), "a warning shows the user: " + w);
  }
};
let routedFetch: typeof fetch | undefined;
const installRouted = () => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const r = routes.get(new URL(String(url)).host);
    if (!r) throw new TypeError("fetch failed: no stub for " + String(url));
    r.sent.push({ body: typeof init?.body === "string" ? init.body : "", signal: init?.signal });
    return r.handler(typeof init?.body === "string" ? init.body : "", init);
  }) as typeof fetch;
  routedFetch = globalThis.fetch;
  mock.method(console, "warn", (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); });
};
const uninstallRouted = () => {
  if (globalThis.fetch === routedFetch) globalThis.fetch = realFetch;
  mock.restoreAll();
  for (const f of stalls.splice(0)) f();
};

describe("S4h–l: a check that never answers", { concurrency: true }, () => {
  before(installRouted);
  after(uninstallRouted);

  test("CTE_CHECK_TIMEOUT_MS is exported, 5000", () => {
    assert.equal(ch.CTE_CHECK_TIMEOUT_MS, 5000);
  });

  test("h: a stalled check resolves false within about CTE_CHECK_TIMEOUT_MS", { timeout: 30_000 }, async () => {
    const conn = secretConn();
    const r = route(conn, stall);
    const t0 = performance.now();
    const got = await within(ch.materializedCteSupported(conn), TIMEOUT + MARGIN);
    const took = performance.now() - t0;
    assert.equal(got, false, "resolved false within " + (TIMEOUT + MARGIN) + "ms");
    assert.ok(took >= TIMEOUT * 0.8, "it waited for the timeout, not less: " + took + "ms");
    assert.equal(r.sent.length, 1, "the check was sent once");
  });

  test("i: when the timeout fires, the stalled request's AbortSignal is aborted", { timeout: 30_000 }, async () => {
    const conn = secretConn();
    const r = route(conn, stall);
    const got = await within(ch.materializedCteSupported(conn), TIMEOUT + MARGIN);
    assert.equal(got, false);
    assert.equal(r.sent.length, 1);
    const sig = r.sent[0].signal;
    assert.ok(sig, "the request was sent with a signal");
    assert.equal(sig.aborted, true, "the stalled request was cancelled");
  });

  test("j: concurrent callers share one stalled request, all get false; a later call within the TTL reuses it", { timeout: 30_000 }, async () => {
    const conn = secretConn();
    const r = route(conn, stall);
    const ps = [1, 2, 3, 4, 5].map(() => ch.materializedCteSupported(conn));
    const got = await within(Promise.all(ps), TIMEOUT + MARGIN);
    assert.deepEqual(got, [false, false, false, false, false]);
    assert.equal(r.sent.length, 1, "one HTTP request, not one per caller");
    r.handler = okAnswer;
    assert.equal(await within(ch.materializedCteSupported(conn), 1000), false, "the false is remembered");
    assert.equal(r.sent.length, 1, "no new request within the TTL");
  });

  test("k: a timed-out check warns once, with the connection's id and without its user or password; cached calls warn no more", { timeout: 30_000 }, async () => {
    const conn = secretConn();
    route(conn, stall);
    const got = await within(Promise.all([ch.materializedCteSupported(conn), ch.materializedCteSupported(conn)]), TIMEOUT + MARGIN);
    assert.deepEqual(got, [false, false]);
    assert.equal(warningsFor(conn).length, 1, "one warning per check: " + JSON.stringify(warningsFor(conn)));
    assertNoSecrets(conn);
    await ch.materializedCteSupported(conn);
    await ch.materializedCteSupported(conn);
    assert.equal(warningsFor(conn).length, 1, "the remembered answer warns no further");
  });

  test("l: a timed-out check inside withoutFailedQueries does not make it throw", { timeout: 30_000 }, async () => {
    const conn = secretConn();
    route(conn, (body, init) => body === wire("SELECT 7 AS n") ? json([{ n: 7 }]) : stall(body, init));
    const v = await within(ch.withoutFailedQueries(async () => {
      const q = await ch.chQuery<{ n: number }>("SELECT 7 AS n", conn);
      const m = await ch.materializedCteSupported(conn);
      return { n: q.data[0].n, m };
    }), TIMEOUT + MARGIN);
    assert.deepEqual(v, { n: 7, m: false });
  });
});

describe("S4k: what a check that fails or succeeds says", () => {
  beforeEach(() => { warnings.length = 0; installRouted(); });
  afterEach(uninstallRouted);
  const failing: [string, Handler][] = [
    ["a server error (HTTP 500)", () => new Response("Code: 115. DB::Exception: Setting enable_materialized_cte is neither a builtin setting nor started with the prefix 'SQL_'. (UNKNOWN_SETTING)", { status: 500 })],
    ["bad credentials (HTTP 516)", () => new Response("Code: 516. DB::Exception: default: Authentication failed. (AUTHENTICATION_FAILED)", { status: 516 })],
    ["a network error", () => { throw new TypeError("fetch failed: getaddrinfo ENOTFOUND"); }],
  ];
  for (const [what, h] of failing) {
    test("k: " + what + ": exactly one warning, naming the id, not the user or password; none from cached calls", { timeout: 10_000 }, async () => {
      const conn = secretConn();
      route(conn, h);
      assert.deepEqual(await within(Promise.all([ch.materializedCteSupported(conn), ch.materializedCteSupported(conn)]), 3000), [false, false]);
      assert.equal(warningsFor(conn).length, 1, JSON.stringify(warnings));
      assert.equal(warnings.length, 1, "no other warning: " + JSON.stringify(warnings));
      assertNoSecrets(conn);
      await ch.materializedCteSupported(conn);
      assert.equal(warnings.length, 1, "the remembered answer warns no further");
    });
  }
  test("k: a check answered ok = 1 warns not at all, nor do the calls after it", { timeout: 10_000 }, async () => {
    const conn = secretConn();
    route(conn, okAnswer);
    assert.equal(await within(ch.materializedCteSupported(conn), 3000), true);
    assert.equal(await ch.materializedCteSupported(conn), true);
    assert.deepEqual(warnings, []);
  });
});

describe("S4m: a timed-out check is asked again after CTE_CHECK_TTL_MS", () => {
  before(installRouted);
  after(uninstallRouted);
  test("m: false for the TTL after a timeout, then asked again and answered", { timeout: 30_000 }, async () => {
    let t = 1_900_000_000_000;
    mock.method(Date, "now", () => t);
    const conn = secretConn();
    const r = route(conn, stall);
    assert.equal(await within(ch.materializedCteSupported(conn), TIMEOUT + MARGIN), false);
    assert.equal(r.sent.length, 1);
    r.handler = okAnswer;
    t += ch.CTE_CHECK_TTL_MS - 1;
    assert.equal(await within(ch.materializedCteSupported(conn), 1000), false, "still false within the TTL");
    assert.equal(r.sent.length, 1);
    t += 1;
    assert.equal(await within(ch.materializedCteSupported(conn), 3000), true, "asked again after the TTL");
    assert.equal(r.sent.length, 2);
  });
});
