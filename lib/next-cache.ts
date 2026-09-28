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
// reader abandoned is never cached, so every path that means "no answer" must throw.
//
// Entries hold gzipped JSON: Runtime Cache refuses items over 2 MB, and a 450k-patient oncoprint
// contract is 22 MB as JSON but 1.9 MB gzipped.
//
// A cached function takes only serializable arguments and computes its answer itself, so each
// route keeps its own small one (`catalogEntry`, `studiesEntry`, `exploreEntry`) beside the code
// it caches, built from `pack`, `unpack` and `dataVersion` here.
//
// Next-only: `next/cache` exists only under the Next runtime, so the stdio MCP server, the CLI
// and the tests use the uncached engine directly.
import { cacheLife } from "next/cache";
import { gzipSync, gunzipSync } from "node:zlib";
import { chQuery, connections } from "./ch.ts";
import { oncokbPin } from "./annotation.ts";
import { runAnalysis } from "./analysis.ts";
import { buildContract } from "./oncoprint.ts";
import type { AnalysisDoc, AnalysisResult, Contract, OncoprintSpec } from "./types.ts";

type Json = unknown;

/** Typed arrays become plain arrays, which every consumer of the contract also accepts. */
export function pack(v: Json): Uint8Array {
  const text = JSON.stringify(v, (_k, x) => ArrayBuffer.isView(x) && !(x instanceof DataView) ? Array.from(x as unknown as ArrayLike<number>) : x);
  return new Uint8Array(gzipSync(text, { level: 6 }));
}
export function unpack<T>(b: Uint8Array): T {
  return JSON.parse(gunzipSync(b).toString("utf8")) as T;
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

async function analysisEntry(doc: AnalysisDoc, oncoprint: "svg" | "spec", _version: string): Promise<Uint8Array> {
  "use cache: remote";
  cacheLife("days");
  return pack(await runAnalysis(doc, { oncoprint }));
}
export async function cachedAnalysis(doc: AnalysisDoc, opts: { oncoprint?: "svg" | "spec" } = {}): Promise<AnalysisResult> {
  return unpack<AnalysisResult>(await analysisEntry(doc, opts.oncoprint ?? "svg", await dataVersion()));
}

async function contractEntry(spec: OncoprintSpec, _version: string): Promise<Uint8Array> {
  "use cache: remote";
  cacheLife("days");
  return pack(await buildContract(spec));
}
export async function cachedContract(spec: OncoprintSpec): Promise<Contract> {
  return unpack<Contract>(await contractEntry(spec, await dataVersion()));
}
