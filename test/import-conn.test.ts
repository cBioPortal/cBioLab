// Local mode's import page hands @cbiolab/importer lib/import-conn.ts's connection, which holds no
// address or credentials of its own: every statement leaves through lib/ch.ts's chWrite, on the
// app's primary connection. lib/ch.ts reads its connection when it loads, so the environment is set
// before it is imported (each test file runs in its own process).
import { test, after } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { CLICKHOUSE_URL: "http://primary.test:8123", CLICKHOUSE_USER: "app", CLICKHOUSE_PASSWORD: "app-pw", CLICKHOUSE_DB: "cbio" });
const { importConn } = await import("../lib/import-conn.ts");
const { exec, query } = await import("@cbiolab/clickhouse");

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

test("the import page's statements go through lib/ch.ts on the primary connection, with nothing of their own", async () => {
  const sent: { url: string; auth: string | null; body: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization"), body: String(init?.body ?? "") });
    return new Response('{"n":3}\n');
  }) as typeof fetch;

  const conn = importConn();
  assert.deepEqual([conn.url, conn.user, conn.password, conn.db], ["", "", "", "cbio"], "no address or credentials of its own");
  assert.deepEqual(await query(conn, "SELECT count() AS n FROM cancer_study"), [{ n: 3 }]);
  await exec(conn, "ALTER TABLE x DELETE WHERE 1");

  assert.equal(sent.length, 2);
  for (const s of sent) {
    assert.ok(s.url.startsWith("http://primary.test:8123/?"), "the primary's address, from lib/ch.ts");
    assert.equal(s.auth, "Basic " + Buffer.from("app:app-pw").toString("base64"), "the primary's credentials, from lib/ch.ts");
    assert.match(s.url, /database=cbio/);
  }
  assert.match(sent[1].url, /mutations_sync=2/, "the client's settings reach chWrite");
});
