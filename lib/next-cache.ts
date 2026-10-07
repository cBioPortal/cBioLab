// Shared result cache for the Next.js routes, on `'use cache: remote'`.
//
// On Vercel the remote handler is Runtime Cache: one store per region, shared by every function
// instance. Anywhere else (`next dev`, the tailnet server) it falls back to process memory.
//
// Invalidation, in the order it happens:
//   - a deploy: Next puts the build/deployment id in every key, so a new deploy cannot read
//     the previous one's entries
//   - a data import or a new OncoKB release: `dataVersion()` is an argument of every cached
//     function, so new data means new keys
//   - time: `cacheLife("days")` regenerates an entry a day after it was written
//
// Only a value the function returns is stored. A thrown error, a refused request or a query the
// reader abandoned is never cached, so every path that means "no answer" must throw. Each cached
// body runs under `withoutFailedQueries`, which throws when any query failed even if the code
// caught it — a view that degraded to an error for one reader is not kept for the next.
//
// Every read goes through `throughCache`, which answers directly when the cached call throws.
// That is how an error reaches the reader at all: a production build replaces the message of
// anything thrown inside a cached function with a generic one, so the direct run is what reports
// what was actually wrong. It also means a cache that cannot be read costs one uncached run
// rather than a failed request.
//
// Entries hold gzipped JSON as base64 text. Text, because Runtime Cache has returned typed arrays
// corrupted; gzipped, because it refuses items over 2 MB (a 450k-patient oncoprint contract is
// 22 MB as JSON, 2.5 MB this way, so that one is simply not kept).
//
// A cached function takes only serializable arguments and computes its answer itself, so each
// route keeps its own small one (`catalogEntry`, `studiesEntry`, `exploreEntry`) beside the code
// it caches, built from `pack`, `throughCache` and `dataVersion` here.
//
// Next-only: `next/cache` exists only under the Next runtime, so the stdio MCP server, the CLI
// and the tests use the uncached engine directly.
import { cacheLife } from "next/cache";
import { gzipSync, gunzipSync } from "node:zlib";
import { chQuery, connections, withoutFailedQueries } from "./ch.ts";
import { oncokbPin } from "./annotation.ts";
import { runAnalysis } from "./analysis.ts";
import { buildContract } from "./oncoprint.ts";
import { hasCustomData } from "./custom-data.ts";
import type { AnalysisDoc, AnalysisResult, Contract, OncoprintSpec } from "./types.ts";

type Json = unknown;

/** Typed arrays become plain arrays, which every consumer of the contract also accepts. */
export function pack(v: Json): string {
  const text = JSON.stringify(v, (_k, x) => ArrayBuffer.isView(x) && !(x instanceof DataView) ? Array.from(x as unknown as ArrayLike<number>) : x);
  return gzipSync(text, { level: 6 }).toString("base64");
}
function unpack<T>(s: string): T {
  return JSON.parse(gunzipSync(Buffer.from(s, "base64")).toString("utf8")) as T;
}

/** The cached answer, or the direct one when the cache throws or hands back something unreadable. */
export async function throughCache<T>(read: () => Promise<string>, direct: () => Promise<T>): Promise<T> {
  let packed: string;
  try { packed = await read(); } catch { return direct(); }
  try { return unpack<T>(packed); } catch { return direct(); }
}

let versionMemo: { at: number; value: Promise<string> } | null = null;
/**
 * What the data looks like right now: the latest study import in every cBioPortal database on
 * every instance, plus the OncoKB release. Asked at most once a minute per instance.
 */
export function dataVersion(): Promise<string> {
  if (versionMemo && Date.now() - versionMemo.at < 60_000) return versionMemo.value;
  const value = (async () => {
    const parts: string[] = [];
    for (const conn of connections()) {
      const dbs = await chQuery<{ name: string }>("SELECT name FROM system.databases WHERE name LIKE 'cbioportal%' ORDER BY name", conn);
      for (const { name } of dbs.data) {
        const r = await chQuery<{ m: string }>("SELECT toString(max(import_date)) AS m FROM " + name + ".cancer_study", conn);
        parts.push(conn.id + ":" + name + "@" + (r.data[0]?.m ?? ""));
      }
    }
    parts.push("oncokb@" + ((await oncokbPin()) ?? ""));
    return parts.join("|");
  })();
  versionMemo = { at: Date.now(), value };
  // a failed lookup must not stick for the next minute
  value.catch(() => { if (versionMemo?.value === value) versionMemo = null; });
  return value;
}

async function analysisEntry(doc: AnalysisDoc, oncoprint: "svg" | "spec", _version: string): Promise<string> {
  "use cache: remote";
  cacheLife("days");
  return pack(await withoutFailedQueries(() => runAnalysis(doc, { oncoprint })));
}
export async function cachedAnalysis(doc: AnalysisDoc, opts: { oncoprint?: "svg" | "spec" } = {}): Promise<AnalysisResult> {
  const oncoprint = opts.oncoprint ?? "svg";
  // an answer that depends on uploaded data belongs to its uploader, never to the shared cache
  if (hasCustomData()) return runAnalysis(doc, { oncoprint });
  return throughCache(async () => analysisEntry(doc, oncoprint, await dataVersion()), () => runAnalysis(doc, { oncoprint }));
}

async function contractEntry(spec: OncoprintSpec, _version: string): Promise<string> {
  "use cache: remote";
  cacheLife("days");
  return pack(await withoutFailedQueries(() => buildContract(spec)));
}
export async function cachedContract(spec: OncoprintSpec): Promise<Contract> {
  if (hasCustomData()) return buildContract(spec);
  return throughCache(async () => contractEntry(spec, await dataVersion()), () => buildContract(spec));
}
