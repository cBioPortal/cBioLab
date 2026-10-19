// The routing table (lib/federation.ts studyRouting) is built once however many callers ask for
// it at once: a cold /api/studies looks up every study's route together, and each lookup starting
// its own build sent hundreds of queries — over a simulated peer, hundreds of MCP calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { studyRouting } from "../lib/federation.ts";

test("concurrent lookups on a cold process share one routing build", async () => {
  const env = { LOOPBACK_PEER: "b", LOOPBACK_PEER_URL: "http://loop.invalid/api/mcp", CLICKHOUSE2_URL: "http://ch.invalid", CLICKHOUSE2_USER: "u",
    CLICKHOUSE2_PASSWORD: "p", CLICKHOUSE2_DB: "peer_db", CLICKHOUSE2_LABEL: "PEER" };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const realFetch = globalThis.fetch;
  let studyLists = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.method === "tools/call" && body.params.name === "federated_studies") studyLists++;
    await new Promise((r) => setTimeout(r, 20));   // an answer takes a moment, so the callers overlap
    const result = body.method === "tools/call" ? { structuredContent: { studies: [{ id: "s1", name: "S1" }] } } : {};
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const maps = await Promise.all(Array.from({ length: 50 }, () => studyRouting()));
    assert.equal(studyLists, 1, "one build asked the peer for its studies once, not once per caller");
    assert.ok(maps.every((m) => m === maps[0]), "every caller got the same answer");
    assert.equal(maps[0].get("s1")?.id, "b");
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  }
});
