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
//   - an administrator (/admin): a changed federation setting or a cleared cache changes
//     `settingsFingerprint()` (lib/settings.ts), which `cacheVersion()` adds to every key, so every
//     process stops reading the old entries; a clear also expires them through RESULT_TAG
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
// it caches, built from `pack`, `throughCache`, `cacheVersion` and `resultEntry` here.
//
// Next-only: `next/cache` exists only under the Next runtime, so the stdio MCP server, the CLI
// and the tests use the uncached engine directly.
import { cacheLife, cacheTag } from "next/cache";
import { gzipSync, gunzipSync } from "node:zlib";
import { chQuery, directConnections, loopbackOnlyConn, connById, withoutFailedQueries, type ChConn } from "./ch.ts";
import { oncokbPin } from "./annotation.ts";
import { runAnalysis } from "./analysis.ts";
import { buildContract } from "./oncoprint.ts";
import { hasCustomData } from "./custom-data.ts";
import { hasIdSets } from "./id-sets.ts";
import { riskFitDirect, type RiskFit, type RiskFitArgs } from "./views/riskmodel/run.ts";
import type { AnalysisDoc, AnalysisResult, Contract } from "./types.ts";
import type { OncoprintSpec } from "./views/oncoprint/types.ts";
import { onSettingsChange, refreshSettings, settingsFingerprint } from "./settings.ts";

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
  // RESULT_CACHE=off answers every request directly, for measuring the uncached path
  if (process.env.RESULT_CACHE === "off") return direct();
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
    // not the simulated peer's database, which is read only over MCP: like a real peer's, its
    // reloads reach this cache when entries expire
    const peerDb = loopbackOnlyConn()?.db;
    for (const conn of directConnections()) {
      const dbs = await chQuery<{ name: string }>("SELECT name FROM system.databases WHERE name LIKE 'cbioportal%' ORDER BY name", conn);
      for (const { name } of dbs.data.filter((d) => d.name !== peerDb)) {
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
// a cleared cache or a changed setting asks the databases again
onSettingsChange("data-version", () => { versionMemo = null; });

/** Every cached result's tag, which clearing the cache from /admin expires. */
export const RESULT_TAG = "results";

/** The lifetime and tag of every cached result: called first in each `'use cache: remote'` body. */
export function resultEntry(): void {
  cacheLife("days");
  cacheTag(RESULT_TAG);
}

/**
 * What every cached result is keyed by besides its own arguments: the data (`dataVersion`) and the
 * administrator's settings and last cache clear (lib/settings.ts).
 */
export async function cacheVersion(): Promise<string> {
  await refreshSettings();
  const data = await dataVersion(), s = settingsFingerprint();
  return s ? data + "|settings@" + s : data;
}

/**
 * One cohort's size on one connection, by its compiled SQL — which already says everything that
 * decides it (definition, study, OncoKB pin, profiles). The page asks for a document's cohorts and
 * then for each view on its own, and each of those requests counts every cohort; this answers all
 * but the first. A count, never a membership, so nothing patient-level is stored.
 */
async function countEntry(connId: string, sql: string, _version: string): Promise<string> {
  "use cache: remote";
  resultEntry();
  const conn = connById(connId);
  if (!conn) throw new Error("no connection '" + connId + "'");
  return pack(await withoutFailedQueries(async () =>
    Number((await chQuery<{ n: string }>("SELECT count() AS n FROM (" + sql + ")", conn)).data[0].n)));
}
async function countDirect(conn: ChConn, sql: string): Promise<number> {
  return Number((await chQuery<{ n: string }>("SELECT count() AS n FROM (" + sql + ")", conn)).data[0].n);
}
export async function cachedCount(conn: ChConn, sql: string): Promise<number> {
  // a statement over uploaded data belongs to its uploader, never to the shared cache
  if (hasCustomData() || hasIdSets()) return countDirect(conn, sql);
  return throughCache(async () => countEntry(conn.id, sql, await cacheVersion()), () => countDirect(conn, sql));
}

/**
 * The cohort size past which a risk model's fit is not kept. A fit holds a few numbers per modelled
 * patient: packed, about 12 bytes each (measured on msk_chord_2024: 93 KB for 7,809 patients, 284 KB
 * for 24,950), so Runtime Cache's 2 MB item limit is near 170,000; validation and an anchor add an
 * array each, and this leaves room for both. Past it, the fit runs on every request.
 */
const RISK_FIT_CACHE_MAX_PATIENTS = 60_000;

/**
 * A risk model's fit, keyed by its arguments (`RiskFitArgs`: the study, the cohort and the whole view
 * but for the settings that only cut and draw its groups), which are all it reads — so a change to
 * the groups is answered from here and refits nothing, and any other change refits. It is
 * per-patient survival times and scores without identifiers, cached where the whole answers that
 * already hold patient ids are (docs/DATA-BOUNDARY.md), from the same patient-level resolver.
 */
async function riskFitEntry(args: RiskFitArgs, _version: string): Promise<string> {
  "use cache: remote";
  resultEntry();
  return pack(await withoutFailedQueries(() => riskFitDirect(args)));
}
export async function cachedRiskFit(a: RiskFitArgs & { patients: number }): Promise<RiskFit> {
  const { patients, ...args } = a;
  // a fit over uploaded data belongs to its uploader, never to the shared cache
  if (hasCustomData() || hasIdSets() || patients > RISK_FIT_CACHE_MAX_PATIENTS) return riskFitDirect(args);
  return throughCache(async () => riskFitEntry(args, await cacheVersion()), () => riskFitDirect(args));
}

/** What the routes run a document with: the cached count and fit. */
const ROUTE_OPTS = { count: cachedCount, riskFit: cachedRiskFit };

async function analysisEntry(doc: AnalysisDoc, oncoprint: "svg" | "spec", _version: string): Promise<string> {
  "use cache: remote";
  resultEntry();
  return pack(await withoutFailedQueries(() => runAnalysis(doc, { oncoprint, ...ROUTE_OPTS })));
}
export async function cachedAnalysis(doc: AnalysisDoc, opts: { oncoprint?: "svg" | "spec" } = {}): Promise<AnalysisResult> {
  const oncoprint = opts.oncoprint ?? "svg";
  // an answer that depends on uploaded data belongs to its uploader, never to the shared cache
  if (hasCustomData() || hasIdSets()) return runAnalysis(doc, { oncoprint });
  return throughCache(async () => analysisEntry(doc, oncoprint, await cacheVersion()), () => runAnalysis(doc, { oncoprint, ...ROUTE_OPTS }));
}

async function contractEntry(spec: OncoprintSpec, provenance: boolean, _version: string): Promise<string> {
  "use cache: remote";
  resultEntry();
  return pack(await withoutFailedQueries(() => buildContract(spec, provenance ? { log: [], provenance } : {})));
}
/**
 * An oncoprint's contract. With `provenance` it carries the queries that built it — those of the
 * run whose answer is cached, which are the queries behind the cells it holds.
 */
export async function cachedContract(spec: OncoprintSpec, opts: { provenance?: boolean } = {}): Promise<Contract> {
  const provenance = !!opts.provenance;
  const direct = () => buildContract(spec, provenance ? { log: [], provenance } : {});
  if (hasCustomData() || hasIdSets()) return direct();
  return throughCache(async () => contractEntry(spec, provenance, await cacheVersion()), direct);
}
