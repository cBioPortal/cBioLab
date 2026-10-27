// The Redis `'use cache: remote'` handler (lib/redis-cache-handler.ts), against an in-memory
// stand-in for Redis: what it stores, when an entry stops being served, and that Redis failing
// is a miss rather than a failed request.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRedisCacheHandler, type CacheEntry, type RedisLike } from "../lib/redis-cache-handler.ts";

function fakeRedis() {
  const kv = new Map<string, { v: string; until: number }>();
  const hashes = new Map<string, Map<string, string>>();
  const r: RedisLike & { kv: typeof kv } = {
    kv,
    async get(k) { const e = kv.get(k); return e && e.until > Date.now() ? e.v : null; },
    async set(k, v, { PX }) { kv.set(k, { v, until: Date.now() + PX }); return "OK"; },
    async hmGet(k, fields) { const h = hashes.get(k); return fields.map((f) => h?.get(f) ?? null); },
    async hSet(k, values) { const h = hashes.get(k) ?? new Map(); hashes.set(k, h); for (const [f, v] of Object.entries(values)) h.set(f, v); return 1; },
  };
  return r;
}

function entry(text: string, over: Partial<CacheEntry> = {}): CacheEntry {
  return {
    value: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }),
    tags: [], stale: 300, timestamp: Date.now(), expire: 604800, revalidate: 86400, ...over,
  };
}
async function text(e: CacheEntry | undefined) {
  assert.ok(e, "expected a hit");
  return new Response(e.value).text();
}

describe("redis cache handler", () => {
  test("a stored entry comes back with its bytes and lifetimes", async () => {
    const r = fakeRedis();
    const h = createRedisCacheHandler(async () => r, { prefix: "t:" });
    await h.set("k", Promise.resolve(entry("hello")));
    assert.deepEqual([...r.kv.keys()], ["t:k"]);
    assert.ok(r.kv.get("t:k")!.until - Date.now() <= 86400_000, "Redis drops it at revalidate");
    const got = await h.get("k", []);
    assert.equal(got?.revalidate, 86400);
    assert.equal(await text(got), "hello");
    assert.equal(await h.get("other", []), undefined);
  });

  test("the caller's stream still reads after the handler consumed its copy", async () => {
    const h = createRedisCacheHandler(async () => fakeRedis());
    const e = entry("both");
    await h.set("k", Promise.resolve(e));
    assert.equal(await new Response(e.value).text(), "both");
  });

  test("an entry past its revalidate time is a miss", async () => {
    const r = fakeRedis();
    const h = createRedisCacheHandler(async () => r);
    await h.set("k", Promise.resolve(entry("old", { timestamp: Date.now() - 2000, revalidate: 1 })));
    assert.equal(await h.get("k", []), undefined);
  });

  test("a dynamic entry (expire 0) is not stored outside dev", async () => {
    const r = fakeRedis();
    await createRedisCacheHandler(async () => r).set("k", Promise.resolve(entry("x", { expire: 0 })));
    assert.equal(r.kv.size, 0);
    await createRedisCacheHandler(async () => r, { dev: true }).set("k", Promise.resolve(entry("x", { expire: 0 })));
    assert.equal(r.kv.size, 1);
  });

  test("a get during a set waits for it", async () => {
    const r = fakeRedis();
    const h = createRedisCacheHandler(async () => r);
    let resolve!: (e: CacheEntry) => void;
    const writing = h.set("k", new Promise((r) => { resolve = r; }));
    const reading = h.get("k", []);
    resolve(entry("late"));
    await writing;
    assert.equal(await text(await reading), "late");
  });

  test("an expired tag, its own or a soft one, makes the entry a miss on every handler", async () => {
    const r = fakeRedis();
    const a = createRedisCacheHandler(async () => r);
    const b = createRedisCacheHandler(async () => r);
    await a.set("k", Promise.resolve(entry("tagged", { tags: ["t1"], timestamp: Date.now() - 10 })));
    assert.equal(await b.getExpiration(["t1"]), 0);
    await a.updateTags(["t1"]);
    assert.ok(await b.getExpiration(["t1"]) > 0);
    assert.equal(await b.get("k", []), undefined);

    await a.set("s", Promise.resolve(entry("soft", { timestamp: Date.now() - 10 })));
    await a.updateTags(["soft1"]);
    assert.equal(await b.get("s", ["soft1"]), undefined);
  });

  test("Redis failing or hanging is a miss, logged once per streak", async () => {
    const logs: string[] = [];
    let mode: "down" | "hang" | "up" = "down";
    const r = fakeRedis();
    const h = createRedisCacheHandler(async () => {
      if (mode === "down") throw new Error("ECONNREFUSED");
      if (mode === "hang") return new Promise<RedisLike>(() => {});
      return r;
    }, { timeoutMs: 50, log: (m) => logs.push(m) });
    assert.equal(await h.get("k", []), undefined);
    await h.set("k", Promise.resolve(entry("x")));
    mode = "hang";
    assert.equal(await h.get("k", []), undefined);
    assert.equal(await h.getExpiration(["t"]), 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /ECONNREFUSED/);
    mode = "up";
    await h.set("k", Promise.resolve(entry("back")));
    assert.equal(await text(await h.get("k", [])), "back");
    assert.deepEqual(logs.slice(1), ["redis cache: recovered"]);
  });
});
