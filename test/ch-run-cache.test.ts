// The gate's run cache (CH_RUN_CACHE, lib/ch.ts): within one run a statement is sent to the
// database once and every later ask — from any script — is answered from the run's folder; a
// failed statement is not kept. And the OncoKB pin: callers arriving together share one lookup.
// The database is a stub `fetch` that counts what reaches it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CLICKHOUSE_URL = "http://stub.invalid";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.CLICKHOUSE_DB = "db";
delete process.env.ONCOKB_PIN;
const { chQuery } = await import("../lib/ch.ts");
const { oncokbPin } = await import("../lib/annotation.ts");

let sent: string[] = [];
let fail = false;
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const q = String(init.body);
  sent.push(q);
  await new Promise((r) => setTimeout(r, 5));
  if (fail) return new Response("Code: 60. DB::Exception: no such table", { status: 404 });
  const v = /oncokb_version/.test(q) ? { oncokb_version: "v4.2" } : { n: sent.length };
  return new Response(JSON.stringify({ meta: [], data: [v], rows: 1 }));
}) as typeof fetch;

test("with CH_RUN_CACHE a statement reaches the database once per run, and a failure is asked again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ch-run-cache-"));
  process.env.CH_RUN_CACHE = dir;
  try {
    sent = [];
    const a = await chQuery("SELECT 1 AS n");
    const b = await chQuery("SELECT 1 AS n");
    assert.equal(sent.length, 1, "the second ask is answered from the run's folder");
    assert.deepEqual(a.data, b.data);
    await chQuery("SELECT 2 AS n");
    assert.equal(sent.length, 2, "another statement is its own entry");
    assert.equal(readdirSync(dir).length, 2, "one file per statement, no temporary files left");

    fail = true;
    await assert.rejects(chQuery("SELECT 3 AS n"));
    fail = false;
    await chQuery("SELECT 3 AS n");
    assert.equal(sent.length, 4, "the failed statement was not kept, so it is sent again");
  } finally {
    delete process.env.CH_RUN_CACHE;
    rmSync(dir, { recursive: true, force: true });
  }
  sent = [];
  await chQuery("SELECT 1 AS n");
  await chQuery("SELECT 1 AS n");
  assert.equal(sent.length, 2, "without CH_RUN_CACHE nothing is kept");
});

test("callers asking for the OncoKB pin together share one lookup", async () => {
  sent = [];
  const pins = await Promise.all(Array.from({ length: 10 }, () => oncokbPin()));
  assert.deepEqual(new Set(pins), new Set(["v4.2"]));
  assert.equal(sent.filter((q) => /oncokb_version/.test(q)).length, 1);
});
