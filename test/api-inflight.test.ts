// app/lab/api.ts api.analysis: one request shared by callers that send the same body and query while
// it is in flight. With globalThis.fetch stubbed:
//   C1  two identical calls while the first is in flight → one fetch; both responses readable, same JSON
//   C2  a different body, or a different query → separate fetches
//   C3  once the shared fetch has answered, an identical call fetches again
//   C4  a caller whose signal aborts rejects with an AbortError; the other still gets its response;
//       the shared fetch was not given that signal; a signal already aborted rejects at once
//   C5  a failing fetch rejects every sharer
// api.analysis first attaches uploaded datasets (custom-data-client), which asks /api/auth once; the
// stub answers that as a deployment without sign-in, and only /api/analysis requests are counted.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "../app/lab/api.ts";

type Pending = { url: string; init: RequestInit; resolve: (r: Response) => void; reject: (e: unknown) => void };
let pending: Pending[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (!url.startsWith("/api/analysis")) {
    if (url === "/api/auth") return Promise.resolve(Response.json({ enabled: false, user: null, options: {} }));
    return Promise.resolve(new Response("", { status: 404 }));
  }
  return new Promise<Response>((resolve, reject) => { pending.push({ url, init, resolve, reject }); });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { pending = []; });

const doc = (n: number) => ({ study: "s" + n, cohorts: { Q: { study: "s" + n } }, views: [] }) as never;
const tick = () => new Promise((r) => setTimeout(r, 5));
/** let the calls reach fetch (they first await the uploads' attachment) */
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

test("C1 two identical calls while the first is in flight: one fetch, both responses readable with the same JSON", async () => {
  const a = api.analysis(doc(1));
  const b = api.analysis(doc(1));
  await settle();
  assert.equal(pending.length, 1, "one fetch: " + pending.map((p) => p.url).join(", "));
  pending[0].resolve(Response.json({ ok: 1, views: [] }));
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(await ra.json(), { ok: 1, views: [] });
  assert.deepEqual(await rb.json(), { ok: 1, views: [] });
});

test("C1 a third identical call joining later, still in flight, shares it too; status and headers carried", async () => {
  const a = api.analysis(doc(7), { query: "?x=1" });
  await settle();
  const b = api.analysis(doc(7), { query: "?x=1" });
  await settle();
  assert.equal(pending.length, 1);
  pending[0].resolve(new Response(JSON.stringify({ n: 7 }), { status: 207, headers: { "Content-Type": "application/json", "X-Test": "y" } }));
  for (const r of await Promise.all([a, b])) {
    assert.equal(r.status, 207);
    assert.equal(r.headers.get("X-Test"), "y");
    assert.deepEqual(await r.json(), { n: 7 });
  }
});

test("C2 a different body: separate fetches", async () => {
  const a = api.analysis(doc(1));
  const b = api.analysis(doc(2));
  await settle();
  assert.equal(pending.length, 2);
  for (const p of pending) p.resolve(Response.json({ body: JSON.parse(String(p.init.body)).study }));
  assert.deepEqual(await (await a).json(), { body: "s1" });
  assert.deepEqual(await (await b).json(), { body: "s2" });
});

test("C2 the same body with a different query: separate fetches", async () => {
  const a = api.analysis(doc(3), { query: "?nocache=1" });
  const b = api.analysis(doc(3));
  const c = api.analysis(doc(3), { query: "?other=1" });
  await settle();
  assert.deepEqual(pending.map((p) => p.url).sort(), ["/api/analysis", "/api/analysis?nocache=1", "/api/analysis?other=1"]);
  for (const p of pending) p.resolve(Response.json({ url: p.url }));
  assert.deepEqual(await (await a).json(), { url: "/api/analysis?nocache=1" });
  assert.deepEqual(await (await b).json(), { url: "/api/analysis" });
  assert.deepEqual(await (await c).json(), { url: "/api/analysis?other=1" });
});

test("C3 once the shared fetch has answered, an identical call fetches again", async () => {
  const a = api.analysis(doc(4));
  await settle();
  assert.equal(pending.length, 1);
  pending[0].resolve(Response.json({ round: 1 }));
  assert.deepEqual(await (await a).json(), { round: 1 });
  await settle();
  const b = api.analysis(doc(4));
  await settle();
  assert.equal(pending.length, 2, "a second fetch");
  pending[1].resolve(Response.json({ round: 2 }));
  assert.deepEqual(await (await b).json(), { round: 2 });
});

test("C3 after a failed fetch, an identical call fetches again", async () => {
  const a = api.analysis(doc(8));
  await settle();
  pending[0].reject(new TypeError("network down"));
  await assert.rejects(a);
  await settle();
  const b = api.analysis(doc(8));
  await settle();
  assert.equal(pending.length, 2);
  pending[1].resolve(Response.json({ ok: true }));
  assert.deepEqual(await (await b).json(), { ok: true });
});

test("C4 a caller whose signal aborts rejects with an AbortError; the other still gets its response; the fetch kept no signal of it", async () => {
  const ctl = new AbortController();
  const a = api.analysis(doc(5), { signal: ctl.signal });
  const b = api.analysis(doc(5));
  await settle();
  assert.equal(pending.length, 1);
  const sent = pending[0].init.signal;
  assert.ok(sent !== ctl.signal, "the shared fetch is not given a caller's signal");
  ctl.abort();
  await assert.rejects(a, (e: Error) => e.name === "AbortError");
  assert.ok(!sent || !sent.aborted, "the shared fetch is not aborted");
  pending[0].resolve(Response.json({ kept: true }));
  assert.deepEqual(await (await b).json(), { kept: true });
});

test("C4 the first caller aborting does not cancel the request for a caller that joined it", async () => {
  const ctl = new AbortController();
  const a = api.analysis(doc(9), { signal: ctl.signal });
  await settle();
  const b = api.analysis(doc(9), { signal: new AbortController().signal });
  await settle();
  assert.equal(pending.length, 1);
  ctl.abort();
  await assert.rejects(a, (e: Error) => e.name === "AbortError");
  pending[0].resolve(Response.json({ v: 9 }));
  assert.deepEqual(await (await b).json(), { v: 9 });
});

test("C4 a signal already aborted rejects at once with an AbortError", async () => {
  const ctl = new AbortController();
  ctl.abort();
  const other = api.analysis(doc(6));
  const t0 = Date.now();
  await assert.rejects(api.analysis(doc(6), { signal: ctl.signal }), (e: Error) => e.name === "AbortError");
  assert.ok(Date.now() - t0 < 500, "without waiting for the fetch");
  await settle();
  for (const p of pending) p.resolve(Response.json({}));
  await other;
});

test("C5 a failing fetch rejects every sharer", async () => {
  const a = api.analysis(doc(10));
  const b = api.analysis(doc(10));
  const c = api.analysis(doc(10), { signal: new AbortController().signal });
  await settle();
  assert.equal(pending.length, 1);
  const boom = new TypeError("Failed to fetch");
  pending[0].reject(boom);
  for (const p of [a, b, c]) await assert.rejects(p, (e: Error) => e.message === "Failed to fetch");
});
