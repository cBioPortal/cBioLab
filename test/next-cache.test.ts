// The shared result cache (lib/next-cache.ts), as far as it can be seen outside Next: entries are
// gzipped JSON as base64 text with typed arrays made plain; every read answers directly when the
// cache throws or hands back something unreadable, so a refusal reaches the reader as thrown; the
// data version is every instance's latest import plus the OncoKB pin, asked at most once a minute
// and never remembered when it fails; and an answer over uploaded data or stored id sets never goes
// through the shared cache at all.
//
// `next/cache` exists only under Next, so a loader hook below stands in for it: its cacheLife and
// cacheTag record their calls (and cacheLife throws on request, as it does outside a cached scope).
// The warehouse is a stand-in (setChTransport).
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { gunzipSync } from "node:zlib";

const STUB = "export function cacheLife(x) { const s = globalThis.__nextCacheStub; s.calls.push('life:' + x); if (s.throwInCache) throw new Error('cacheLife outside a cached scope'); }\n" +
  "export function cacheTag(t) { globalThis.__nextCacheStub.calls.push('tag:' + t); }\n";
const HOOK = "export async function resolve(s, c, next) { if (s === 'next/cache') return { url: " +
  JSON.stringify("data:text/javascript," + encodeURIComponent(STUB)) + ", shortCircuit: true }; return next(s, c); }\n";
register("data:text/javascript," + encodeURIComponent(HOOK));
const stub: { calls: string[]; throwInCache: boolean } = { calls: [], throwInCache: false };
(globalThis as unknown as { __nextCacheStub: typeof stub }).__nextCacheStub = stub;

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbioportal";
process.env.CLICKHOUSE2_URL = "http://secondary.invalid";
process.env.CLICKHOUSE2_DB = "cbioportal_b";
process.env.ONCOKB_PIN = "v4.20";
process.env.GENOME_NEXUS_PIN = "2.2.3-vep116-clinvar20260208";
process.env.GENOME_NEXUS_GRCH38_PIN = "1.4.1-vepNA-clinvar20250106";
process.env.AGGREGATE_ONLY_INSTANCES = "b";
for (const k of ["LOOPBACK_PEER", "RESULT_CACHE", "FEDERATION_PEERS", "AGGREGATE_ONLY_STUDIES"]) delete process.env[k];

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const nc = await import("../lib/next-cache.ts");
const { withCustomData } = await import("../lib/custom-data.ts");
const { withIdSets } = await import("../lib/id-sets.ts");

/** what each instance holds: its cbioportal databases, each one's latest import, its studies */
let warehouse: Record<string, { dbs: Record<string, string>; studies?: string[] }>;
let sent: { conn: string; query: string }[] = [];
let failing: RegExp | null = null;
const json = (data: unknown[]) => JSON.stringify({ data, meta: [], rows: data.length });
setChTransport(async (st) => {
  const q = st.query;
  sent.push({ conn: st.conn.id, query: q });
  if (failing?.test(q)) throw new Error("ClickHouse error [" + st.conn.id + "]: down");
  const inst = warehouse[st.conn.id] ?? { dbs: {} };
  if (/FROM system\.databases/.test(q)) {
    // the database applies the statement's own LIKE
    const like = new RegExp("^" + /LIKE '([^']*)'/.exec(q)![1].replace(/%/g, ".*") + "$");
    return json(Object.keys(inst.dbs).filter((n) => like.test(n)).sort().map((name) => ({ name })));
  }
  const db = /FROM (\w+)\.cancer_study\n/.exec(q)?.[1];
  if (db && /max\(import_date\)/.test(q)) return json([{ m: inst.dbs[db] ?? "" }]);
  if (/FROM \w+\.cancer_study\n/.test(q)) return json((inst.studies ?? []).map((id) => ({ id, name: id })));
  if (/^SELECT count\(\) AS n FROM \(/.test(q)) return json([{ n: "42" }]);
  return json([]);
});
after(() => setChTransport(null));

/** forget the memoized data version (a changed setting does this: lib/settings.ts calls its listeners) */
const forgetVersion = () => (globalThis as unknown as { __cbioSettings: { listeners: Map<string, () => void> } }).__cbioSettings.listeners.get("data-version")!();

beforeEach(() => {
  warehouse = { a: { dbs: { cbioportal: "2026-10-01 00:00:00", cbioportal_x: "2026-11-01 00:00:00", other: "1999" }, studies: ["s_a"] },
    b: { dbs: { cbioportal_b: "2026-09-09 00:00:00" }, studies: ["s_b"] } };
  sent = []; failing = null; stub.calls = []; stub.throwInCache = false;
  delete process.env.RESULT_CACHE; delete process.env.LOOPBACK_PEER;
  forgetVersion();
});

const unpack = (s: string) => JSON.parse(gunzipSync(Buffer.from(s, "base64")).toString("utf8"));

test("pack: gzipped JSON as base64 text, typed arrays as plain arrays", () => {
  const v = { a: Int32Array.from([1, -2]), b: Float64Array.from([0.5]), c: Uint8Array.from([255]), s: "x", n: null };
  const packed = nc.pack(v);
  assert.match(packed, /^[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(unpack(packed), { a: [1, -2], b: [0.5], c: [255], s: "x", n: null });
});

test("throughCache: the cached answer when it reads, without running the direct one", async () => {
  let direct = 0;
  const r = await nc.throughCache(async () => nc.pack({ cells: Int32Array.from([3]) }), async () => { direct++; return { cells: [0] }; });
  assert.deepEqual(r, { cells: [3] });
  assert.equal(direct, 0);
});

test("throughCache: the direct answer when the cache throws or hands back something unreadable", async () => {
  assert.equal(await nc.throughCache(async () => { throw new Error("cache down"); }, async () => "direct"), "direct");
  assert.equal(await nc.throughCache(async () => "not gzip", async () => "direct"), "direct");
  assert.equal(await nc.throughCache(async () => Buffer.from("{oops").toString("base64"), async () => "direct"), "direct");
});

test("throughCache: an error the cached run threw reaches the reader as the direct run throws it", async () => {
  await assert.rejects(nc.throughCache(async () => { throw new Error("An error occurred in the Server Components render"); },
    async () => { throw new Error("no cohort “X”"); }), /no cohort “X”/);
});

test("throughCache: RESULT_CACHE=off answers directly without reading the cache", async () => {
  process.env.RESULT_CACHE = "off";
  let read = 0;
  assert.equal(await nc.throughCache(async () => { read++; return nc.pack("cached"); }, async () => "direct"), "direct");
  assert.equal(read, 0);
});

test("the data version: each instance's cbioportal databases' latest import, then the OncoKB and Genome Nexus pins", async () => {
  const v = await nc.dataVersion();
  assert.equal(v, "a:cbioportal@2026-10-01 00:00:00|a:cbioportal_x@2026-11-01 00:00:00|b:cbioportal_b@2026-09-09 00:00:00|oncokb@v4.20|" +
    "genome_nexus@2.2.3-vep116-clinvar20260208/1.4.1-vepNA-clinvar20250106");
});

test("the data version is asked at most once a minute", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const first = await nc.dataVersion();
    const asked = sent.length;
    warehouse.a.dbs.cbioportal = "2026-12-01 00:00:00";
    now += 59_000;
    assert.equal(await nc.dataVersion(), first, "within the minute: the same answer, nothing asked");
    assert.equal(sent.length, asked);
    now += 2_000;
    assert.match(await nc.dataVersion(), /a:cbioportal@2026-12-01/, "after it: asked again");
  } finally { Date.now = realNow; }
});

test("a failed data version lookup is not remembered", async () => {
  failing = /system\.databases/;
  await assert.rejects(nc.dataVersion(), /down/);
  failing = null;
  assert.match(await nc.dataVersion(), /^a:cbioportal@/);
});

test("a changed setting asks the databases again", async () => {
  await nc.dataVersion();
  warehouse.b.dbs.cbioportal_b = "2026-12-12 00:00:00";
  forgetVersion();
  assert.match(await nc.dataVersion(), /b:cbioportal_b@2026-12-12/);
});

test("the simulated peer's database is left out of the data version", async () => {
  process.env.LOOPBACK_PEER = "b";
  forgetVersion();
  const v = await nc.dataVersion();
  assert.ok(!v.includes("cbioportal_b"), v);
  assert.ok(!sent.some((s) => s.conn === "b"), "the peer's instance is not asked directly");
});

test("the cache version is the data version, plus the settings fingerprint when there is one", async () => {
  const s = (globalThis as unknown as { __cbioSettings: { fingerprint: string } }).__cbioSettings;
  const data = await nc.dataVersion();
  assert.equal(await nc.cacheVersion(), data);
  s.fingerprint = "abc";
  try { assert.equal(await nc.cacheVersion(), data + "|settings@abc"); } finally { s.fingerprint = ""; }
});

test("every cached result lives for days and carries the results tag", () => {
  nc.resultEntry();
  assert.deepEqual(stub.calls, ["life:days", "tag:" + nc.RESULT_TAG]);
  assert.equal(nc.RESULT_TAG, "results");
});

test("a cohort's count goes through the cache, as a count of its compiled SQL on its connection", async () => {
  assert.equal(await nc.cachedCount(PRIMARY, "SELECT 1 AS pid"), 42);
  assert.ok(stub.calls.includes("life:days"), "the cached entry ran");
  const counts = sent.filter((s) => s.query.startsWith("SELECT count() AS n FROM (SELECT 1 AS pid)"));
  assert.deepEqual(counts.map((s) => s.conn), ["a"]);
});

test("a count is still answered when the cache refuses to run, or the connection is unknown to it", async () => {
  stub.throwInCache = true;
  assert.equal(await nc.cachedCount(PRIMARY, "SELECT 1 AS pid"), 42);
  stub.throwInCache = false;
  sent = [];
  assert.equal(await nc.cachedCount({ ...PRIMARY, id: "zz" }, "SELECT 2 AS pid"), 42);
  assert.equal(sent.filter((s) => s.query.startsWith("SELECT count()")).length, 1, "the entry refused; the direct run counted");
});

test("a count whose query failed is not an answer: it throws", async () => {
  failing = /^SELECT count\(\)/;
  await assert.rejects(nc.cachedCount(PRIMARY, "SELECT 1 AS pid"), /down/);
});

const idSet = { id: "00000000-0000-4000-8000-000000000001", owner: "u", name: "n", level: "patient" as const, count: 1, perStudy: { s_a: ["P1"] } };
const customCtx = { datasets: [{ id: "d1", name: "d", level: "patient" as const, columns: [], rows: [] }], allowedConns: new Set(["a"]), allowedDbs: new Set(["cbioportal"]) };

test("over a stored id set or uploaded data, a count never touches the shared cache", async () => {
  assert.equal(await withIdSets([idSet as never], new Map([["s_a", "a"]]), () => nc.cachedCount(PRIMARY, "SELECT 1 AS pid")), 42);
  assert.equal(await withCustomData(customCtx as never, () => nc.cachedCount(PRIMARY, "SELECT 1 AS pid")), 42);
  assert.deepEqual(stub.calls, [], "no cached entry ran");
  assert.ok(!sent.some((s) => /system\.databases/.test(s.query)), "nor was a cache key built");
});

test("a refused analysis is thrown, from the direct run, and never answered from the cache", async () => {
  const doc = { dsl: "999.0", study: "s_a", cohorts: {}, views: [] };
  await assert.rejects(nc.cachedAnalysis(doc as never), /written for DSL 999\.0/);
  assert.ok(stub.calls.includes("tag:results"), "the cached entry was tried");
  stub.calls = [];
  await assert.rejects(withIdSets([idSet as never], new Map([["s_a", "a"]]), () => nc.cachedAnalysis(doc as never, { oncoprint: "spec" })), /written for DSL 999\.0/);
  assert.deepEqual(stub.calls, [], "over a stored set the cache is not tried");
});

test("a refused oncoprint contract is thrown, with or without its provenance", async () => {
  const spec = { study: "s_a", genes: ["TP53"], clinical: [{ attribute: "custom:nope/COL" }] };
  for (const provenance of [false, true]) {
    stub.calls = [];
    await assert.rejects(nc.cachedContract(spec as never, { provenance }), /nope/);
    assert.ok(stub.calls.includes("tag:results"));
  }
  stub.calls = [];
  await assert.rejects(withIdSets([idSet as never], new Map([["s_a", "a"]]), () => nc.cachedContract(spec as never)), /nope/);
  assert.deepEqual(stub.calls, []);
});

test("a risk model's fit is refused for an aggregate-only study, through the cache or past its size limit", async () => {
  const args = { study: "s_b", def: { all: [] }, compile: { oncokbPin: null, profiles: [], gaProfiles: [] }, view: { kind: "riskmodel" } };
  await assert.rejects(nc.cachedRiskFit({ ...args, patients: 10 } as never), /answers in aggregate only/);
  assert.ok(stub.calls.includes("tag:results"), "a small cohort's fit goes through the cache");
  stub.calls = [];
  await assert.rejects(nc.cachedRiskFit({ ...args, patients: 60_001 } as never), /answers in aggregate only/);
  assert.deepEqual(stub.calls, [], "a fit too large to keep is never put through the cache");
  await assert.rejects(withCustomData(customCtx as never, () => nc.cachedRiskFit({ ...args, patients: 10 } as never)), /answers in aggregate only/);
  assert.deepEqual(stub.calls, [], "nor one over uploaded data");
});
