// A Redis store for `'use cache: remote'` (lib/next-cache.ts), for deployments that are not on
// Vercel. Without it the remote cache is each Node process's own memory: lost on restart and not
// shared between replicas. With `REDIS_URL` set, next.config.mjs registers this module as the
// `remote` cache handler, so every replica reads and writes one store and it survives restarts.
//
// It keeps the in-memory handler's semantics, so nothing above it changes:
//   - an entry is served until its `revalidate` time (a day under `cacheLife("days")`), then it is
//     a miss and regenerates; Redis drops it at that point too (PX)
//   - an entry whose `expire` is 0 is dynamic and is not stored
//   - a `get` for a key this process is still writing waits for the write
//   - tags expired by `revalidateTag`/`updateTag` are kept in one Redis hash, so an expiry on one
//     replica is seen by all
//
// Redis being down or slow is a miss, never a failed request: every command is bounded by
// `REDIS_CACHE_TIMEOUT_MS` and nothing is queued while disconnected, so the cached function runs
// directly, as `throughCache` already does when a cache cannot be read.
//
// Next imports this file itself (not through the bundler), so it reads only its own environment
// and node_modules.
import { createClient } from "redis";

/** The `use cache` handler interface (next/dist/server/lib/cache-handlers/types.d.ts). */
export interface CacheEntry {
  value: ReadableStream<Uint8Array>;
  tags: string[];
  stale: number;
  timestamp: number;
  expire: number;
  revalidate: number;
}
export interface CacheHandler {
  get(cacheKey: string, softTags: string[]): Promise<undefined | CacheEntry>;
  set(cacheKey: string, pendingEntry: Promise<CacheEntry>): Promise<void>;
  refreshTags(): Promise<void>;
  getExpiration(tags: string[]): Promise<number>;
  updateTags(tags: string[], durations?: { expire?: number }): Promise<void>;
}

/** The commands this handler uses, so a test can hand it an in-memory stand-in. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts: { PX: number }): Promise<unknown>;
  hmGet(key: string, fields: string[]): Promise<(string | null)[]>;
  hSet(key: string, values: Record<string, string>): Promise<unknown>;
}

interface Stored {
  tags: string[];
  stale: number;
  timestamp: number;
  expire: number;
  revalidate: number;
  /** the entry's bytes, base64 */
  value: string;
}

export interface RedisCacheOptions {
  /** prepended to every key, so several deployments can share one Redis */
  prefix?: string;
  /** the longest any one command may take before it counts as a miss */
  timeoutMs?: number;
  /** whether this is `next dev`, which keeps dynamic (`expire: 0`) entries */
  dev?: boolean;
  log?: (msg: string) => void;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("redis: no reply in " + ms + " ms")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (let c = await reader.read(); !c.done; c = await reader.read()) chunks.push(Buffer.from(c.value));
  return Buffer.concat(chunks);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

export function createRedisCacheHandler(redis: () => Promise<RedisLike>, opts: RedisCacheOptions = {}): CacheHandler {
  const prefix = opts.prefix ?? "cbiolab:";
  const timeoutMs = opts.timeoutMs ?? 2000;
  const tagsKey = prefix + "tags";
  const pendingSets = new Map<string, Promise<void>>();
  // one line per failure streak, not one per request while Redis is down
  let failing = false;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const failed = (what: string, err: unknown) => {
    if (!failing) log("redis cache: " + what + " failed, answering uncached until it recovers: " + (err instanceof Error ? err.message : String(err)));
    failing = true;
  };
  const ok = () => { if (failing) log("redis cache: recovered"); failing = false; };
  const run = async <T>(f: (r: RedisLike) => Promise<T>) => withTimeout(redis().then(f), timeoutMs);

  /** The latest time any of these tags was expired, 0 if never. */
  async function tagsExpiredAt(tags: string[]): Promise<number> {
    if (tags.length === 0) return 0;
    const at = await run((r) => r.hmGet(tagsKey, tags));
    return Math.max(0, ...at.map((t) => Number(t ?? 0)));
  }

  return {
    async get(cacheKey, softTags) {
      const pending = pendingSets.get(cacheKey);
      if (pending) await pending;
      let stored: Stored;
      try {
        const raw = await run((r) => r.get(prefix + cacheKey));
        ok();
        if (raw === null) return undefined;
        stored = JSON.parse(raw) as Stored;
        if (Date.now() > stored.timestamp + stored.revalidate * 1000) return undefined;
        if (await tagsExpiredAt([...stored.tags, ...softTags]) > stored.timestamp) return undefined;
      } catch (err) {
        failed("read", err);
        return undefined;
      }
      const { value, ...meta } = stored;
      return { ...meta, value: streamOf(Buffer.from(value, "base64")) };
    },

    async set(cacheKey, pendingEntry) {
      let done = () => {};
      pendingSets.set(cacheKey, new Promise<void>((resolve) => { done = resolve; }));
      try {
        const entry = await pendingEntry;
        // a dynamic entry is regenerated on every read in production, so storing it is wasted
        if (!opts.dev && entry.expire === 0) return;
        const [mine, theirs] = entry.value.tee();
        entry.value = theirs;
        const bytes = await readAll(mine);
        const ttlMs = Math.max(1, Math.floor(entry.revalidate * 1000));
        const stored: Stored = {
          tags: entry.tags, stale: entry.stale, timestamp: entry.timestamp,
          expire: entry.expire, revalidate: entry.revalidate, value: bytes.toString("base64"),
        };
        await run((r) => r.set(prefix + cacheKey, JSON.stringify(stored), { PX: ttlMs }));
        ok();
      } catch (err) {
        failed("write", err);
      } finally {
        done();
        pendingSets.delete(cacheKey);
      }
    },

    // tag expiries are read from Redis on every lookup, so there is no local copy to refresh
    async refreshTags() {},

    async getExpiration(tags) {
      try { return await tagsExpiredAt(tags); } catch (err) { failed("tag read", err); return 0; }
    },

    async updateTags(tags) {
      if (tags.length === 0) return;
      const now = String(Date.now());
      try { await run((r) => r.hSet(tagsKey, Object.fromEntries(tags.map((t) => [t, now])))); } catch (err) { failed("tag write", err); }
    },
  };
}

/** One client per process, connected on first use; a dropped connection reconnects in the background. */
function connectFromEnv(url: string): () => Promise<RedisLike> {
  let client: ReturnType<typeof createClient> | null = null;
  let connecting: Promise<unknown> | null = null;
  return async () => {
    if (!client) {
      client = createClient({
        url,
        // a command sent while disconnected fails at once instead of waiting for the reconnect
        disableOfflineQueue: true,
        socket: { connectTimeout: 2000, reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
      });
      client.on("error", () => {});
      connecting = client.connect();
      connecting.catch(() => {});
    }
    await connecting;
    return client as unknown as RedisLike;
  };
}

const url = process.env.REDIS_URL;
const handler: CacheHandler | undefined = url
  ? createRedisCacheHandler(connectFromEnv(url), {
    prefix: process.env.REDIS_CACHE_PREFIX,
    timeoutMs: process.env.REDIS_CACHE_TIMEOUT_MS ? Number(process.env.REDIS_CACHE_TIMEOUT_MS) : undefined,
    dev: !!process.env.__NEXT_DEV_SERVER,
  })
  : undefined;
export default handler;
