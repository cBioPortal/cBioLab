// The federation API's own contract (lib/federation-api.ts, app/api/federation/v1/[op]): ops are
// looked up, their input checked before anything runs, refusals answered rather than thrown; the
// client posts to <base>/<op>.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { answerFederation } from "../lib/federation-api.ts";
import { remoteCatalog } from "../lib/federation-remote.ts";

describe("answering a call", () => {
  test("an unknown op is 404, naming it", async () => {
    const r = await answerFederation("run_analysis", {});
    assert.equal(r.status, 404);
    assert.match((r.body as { error: string }).error, /no federation op 'run_analysis'/);
  });
  test("input is checked before the op runs: a malformed request is 400, naming the field", async () => {
    const r = await answerFederation("aggregates", { study: "s" });
    assert.equal(r.status, 400);
    assert.match((r.body as { error: string }).error, /bad request for aggregates: cohort/);
  });
});

describe("the client", () => {
  test("posts the arguments as JSON to <base>/<op>, and reports a refusal by its error", async () => {
    const real = globalThis.fetch;
    const seen: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ error: "study 's1' is not held by this instance" }), { status: 422, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await assert.rejects(remoteCatalog("s1", "http://peer.invalid/api/federation/v1/"), /peer rejected: study 's1' is not held by this instance/);
      assert.deepEqual(seen, [{ url: "http://peer.invalid/api/federation/v1/catalog", body: { study: "s1" } }]);
    } finally { globalThis.fetch = real; }
  });
});
