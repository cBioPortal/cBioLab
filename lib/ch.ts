// Server-side ClickHouse HTTP client. Credentials never leave the server.
//
// Supports several instances for data-level federation. Every connection is
// declared by environment variables and referenced by id; SQL is always sent to
// an explicit connection, defaulting to the primary so the 40-odd existing call
// sites are unaffected.
//
//   primary : CLICKHOUSE_URL / _USER / _PASSWORD / _DB
//   peers   : CLICKHOUSE2_URL / _USER / _PASSWORD / _DB   (id "b")
//
// Note that the *database name* is per-connection, which is why SQL builders
// take a `db` argument rather than closing over a module constant.
import { loopbackConnId, servingAsLoopbackPeer } from "./loopback-peer.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChResult, ChRow } from "./types.ts";
import { customExternalsFor } from "./custom-data.ts";
import { idSetExternalsFor } from "./id-sets.ts";

export interface ChConn {
  id: string;
  url: string;
  user: string;
  password: string;
  /** database (schema) name on THIS instance — may differ between instances */
  db: string;
  label: string;
}

const clean = (s: string | undefined) => (s || "").replace(/[^A-Za-z0-9_]/g, "");

export const DB = clean(process.env.CLICKHOUSE_DB);
export const STUDY = process.env.STUDY_ID || "msk_chord_2024";
export const PORTAL = process.env.PORTAL_URL || "https://www.cbioportal.org";

export const PRIMARY: ChConn = {
  id: "a",
  url: process.env.CLICKHOUSE_URL || "",
  user: process.env.CLICKHOUSE_USER || "",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  db: DB,
  label: process.env.CLICKHOUSE_LABEL || "primary"
};

/** Secondary instance, present only when CLICKHOUSE2_* is configured. */
export function secondary(): ChConn | null {
  if (!process.env.CLICKHOUSE2_URL) return null;
  return {
    id: "b",
    url: process.env.CLICKHOUSE2_URL,
    user: process.env.CLICKHOUSE2_USER || "",
    password: process.env.CLICKHOUSE2_PASSWORD || "",
    db: clean(process.env.CLICKHOUSE2_DB),
    label: process.env.CLICKHOUSE2_LABEL || "secondary"
  };
}

/** All configured connections, primary first. */
export function connections(): ChConn[] {
  const b = secondary();
  return b ? [PRIMARY, b] : [PRIMARY];
}

export function connById(id: string): ChConn | null {
  return connections().find((c) => c.id === id) || null;
}

/**
 * Per-request context, carried implicitly so the 40-odd call sites keep their signatures.
 *
 * Two things live here, both properties of "the request being served" rather than of any one
 * query:
 *
 * - `signal` — the reader's connection. When they supersede a request (ticking another facet
 *   before the last answer arrives) every query it still owes is abandoned, and
 *   `cancel_http_readonly_queries_on_client_close` makes ClickHouse stop rather than finish
 *   work nobody will read. Measured: four facet clicks 250ms apart cost the final answer 2x
 *   without this, because the discarded passes still hold database capacity.
 * - `externals` — resolved cohorts, sent as ClickHouse external tables. The compiled cohort
 *   predicate is otherwise re-evaluated inside every facet query (~30 of them, measured at 2x
 *   the cost of the same query without it); resolving once and shipping the ids means the
 *   database evaluates the definition a single time per request. Keyed by table name, so the
 *   studies of a federated request register side by side without colliding.
 */
export interface ChExternal { name: string; structure: string; data: string }
/** The payload is encoded once per request, not once per query that carries it. */
interface ChExternalEnc { name: string; structure: string; blob: Blob }
interface ChCtx { signal?: AbortSignal; externals: Map<string, ChExternalEnc> }
const ctxStore = new AsyncLocalStorage<ChCtx>();

/**
 * Queries that failed under a cached computation, whether or not the caller caught them. The
 * engine turns many failures into a view's `error` so the other views still answer, and that is
 * right for the reader in front of it — but such a result must not be cached, or a dropped
 * connection is served to everyone for a day as "this view failed".
 */
const failedStore = new AsyncLocalStorage<{ n: number }>();
export class FailedQueriesError extends Error {
  readonly count: number;
  constructor(count: number) {
    super(count + " database quer" + (count === 1 ? "y" : "ies") + " failed while computing this answer; it is not cached");
    this.count = count;
  }
}
/** Count a failed request to another participant (a peer over MCP) as a failed query: its answer is not cached either. */
export function noteFailedQuery(): void {
  const f = failedStore.getStore();
  if (f) f.n++;
}
/** `fn`'s value, or a throw when any query under it failed — for the body of a cached function. */
export async function withoutFailedQueries<T>(fn: () => Promise<T>): Promise<T> {
  const s = { n: 0 };
  const v = await failedStore.run(s, fn);
  if (s.n) throw new FailedQueriesError(s.n);
  return v;
}

/** Run `fn` in a fresh context — the request boundary. */
export function withChContext<T>(ctx: { signal?: AbortSignal }, fn: () => Promise<T>): Promise<T> {
  return ctxStore.run({ signal: ctx.signal, externals: new Map() }, fn);
}
/** Run `fn` in the inherited context, or a fresh one when there is none (MCP, scripts, tests). */
export function ensureChContext<T>(fn: () => Promise<T>): Promise<T> {
  return ctxStore.getStore() ? fn() : withChContext({}, fn);
}
/** Publish a resolved cohort for the rest of this request. Returns false when there is no context. */
export function registerChExternal(ext: ChExternal): boolean {
  const s = ctxStore.getStore();
  if (!s) return false;
  s.externals.set(ext.name, { name: ext.name, structure: ext.structure, blob: new Blob([ext.data]) });
  return true;
}
export function chExternalRegistered(name: string): boolean {
  return !!ctxStore.getStore()?.externals.has(name);
}

/**
 * A cancelled query, as opposed to a failed one. The distinction matters to any caller that
 * catches an error and remembers the result: an abort says the READER left, never that the
 * data or the instance is unavailable, so it must not be folded into a cached answer.
 */
export function isAbortError(e: unknown): boolean {
  const n = (e as { name?: string } | undefined)?.name;
  // undici raises AbortError; Next.js raises ResponseAborted when the reader's response is
  // gone. Both mean the same thing here, and missing one of these names is precisely the
  // omission that let a cancelled query be cached as "this instance holds no studies".
  return n === "AbortError" || n === "TimeoutError" || n === "ResponseAborted";
}
const isAbort = isAbortError;
function abortError(): Error {
  const e = new Error("ClickHouse query abandoned: the request was superseded or the client disconnected");
  e.name = "AbortError";
  return e;
}

/**
 * Bounded concurrency for ClickHouse. A federated oncoprint fans out four queries per study;
 * at eleven studies that is 44 in flight, and ClickHouse Cloud has closed the connection
 * mid-response under that load. Queries queue instead, and a dropped socket is retried once.
 */
const MAX_INFLIGHT = Number(process.env.CLICKHOUSE_MAX_INFLIGHT || 8);
let inflight = 0;
const waiting: (() => void)[] = [];
async function acquire(): Promise<void> {
  if (inflight < MAX_INFLIGHT) { inflight++; return; }
  await new Promise<void>((res) => waiting.push(res));
  inflight++;
}
function release(): void { inflight--; const next = waiting.shift(); if (next) next(); }

const RETRYABLE = /socket|ECONNRESET|ETIMEDOUT|EPIPE|other side closed|fetch failed|terminated/i;

/** External tables this statement actually names — an unreferenced cohort is not uploaded. */
function externalsFor(query: string): ChExternalEnc[] {
  const s = ctxStore.getStore();
  if (!s || !s.externals.size) return [];
  const out: ChExternalEnc[] = [];
  for (const ext of s.externals.values()) {
    // identifier boundary, so `_cohort_brca` does not drag in `_cohort_brca_tcga`
    if (new RegExp("(^|[^A-Za-z0-9_])" + ext.name + "([^A-Za-z0-9_]|$)").test(query)) out.push(ext);
  }
  return out;
}

/**
 * The simulated peer's database (LOOPBACK_PEER, lib/loopback-peer.ts) is read only while answering
 * as that peer, over MCP — never directly by the app it serves. Refused before anything is sent:
 * a query on its connection, and a query naming its database on any other connection (the two may
 * share a server and a login).
 */
export function assertNotLoopbackDirect(sql: string, conn: ChConn): void {
  const peer = loopbackOnlyConn();
  if (!peer) return;
  const id = peer.id;
  const names = peer.db && new RegExp("(^|[^A-Za-z0-9_.])`?" + peer.db.replace(/[^A-Za-z0-9_]/g, "") + "`?\\.").test(sql);
  if (conn.id === id || names) {
    const e = new LoopbackDirectError("the " + peer.label + " database is reached only over MCP (LOOPBACK_PEER=" + id + "); this query went to it directly");
    // logged as well as thrown: a caller that treats a failed instance as an absent one must not hide it
    console.error("[boundary] " + e.message + "\n" + sql.slice(0, 300) + "\n" + e.stack);
    throw e;
  }
}

/** A query the boundary above refused. Never a sign that an instance is unreachable. */
export class LoopbackDirectError extends Error {}

/** The connection served to this app as a simulated peer, while it may not be read directly. */
export function loopbackOnlyConn(): ChConn | null {
  const id = loopbackConnId();
  return id && !servingAsLoopbackPeer() ? connById(id) : null;
}

/** The connections this code may query directly: all of them but the simulated peer's (above). */
export function directConnections(): ChConn[] {
  const peer = loopbackOnlyConn();
  return connections().filter((c) => c.id !== peer?.id);
}

async function post(sql: string, conn: ChConn, format: string): Promise<string> {
  assertNotLoopbackDirect(sql, conn);
  if (!conn.url || !conn.user || !conn.password || !conn.db)
    throw new Error("ClickHouse instance '" + conn.id + "' is missing configuration (url/password/db)");
  const ctx = ctxStore.getStore();
  const query = sql + "\nFORMAT " + format;
  // uploaded custom data and stored id sets ride along only with a statement that names them
  // (lib/custom-data.ts, lib/id-sets.ts)
  const externals = [...externalsFor(query),
    ...[...customExternalsFor(query, conn.id), ...idSetExternalsFor(query, conn.id)]
      .map((e) => ({ name: e.name, structure: e.structure, blob: new Blob([e.data]) }))];
  // Tell ClickHouse to stop a query whose client has gone away. Without it an abandoned
  // request keeps its share of the database until it finishes, which is most of what an
  // abandoned request costs.
  const url = conn.url.replace(/\/+$/, "") + "/?cancel_http_readonly_queries_on_client_close=1";
  const send = async (): Promise<string> => {
    const auth = "Basic " + Buffer.from(conn.user + ":" + conn.password).toString("base64");
    let init: RequestInit;
    if (externals.length) {
      // multipart carries the statement as a form field, so a long one is not bounded by
      // the URI limit, and each cohort rides along as a TSV table
      const fd = new FormData();
      fd.set("query", query);
      for (const ext of externals) {
        fd.set(ext.name + "_format", "TSV");
        fd.set(ext.name + "_structure", ext.structure);
        fd.set(ext.name, ext.blob, ext.name);
      }
      init = { method: "POST", headers: { Authorization: auth }, body: fd };
    } else {
      init = { method: "POST", headers: { Authorization: auth, "Content-Type": "text/plain" }, body: query };
    }
    const res = await fetch(url, { ...init, cache: "no-store", signal: ctx?.signal });
    const text = await res.text();
    // never echo the query (it can embed patient ids) or anything credential-shaped
    if (!res.ok) throw new Error("ClickHouse error [" + conn.id + "]: " + text.slice(0, 500));
    return text;
  };
  await acquire();
  try {
    // A query that reached the front of the queue after its reader left is never started.
    if (ctx?.signal?.aborted) throw abortError();
    try { return await send(); }
    catch (e) {
      // An abort is the intended outcome, not a flaky socket — retrying it would reinstate
      // exactly the wasted work the abort exists to stop.
      if (isAbort(e) || ctx?.signal?.aborted) throw e;
      const msg = String((e as Error)?.message || e) + " " + String((e as { cause?: { code?: string } })?.cause?.code || "");
      if (!RETRYABLE.test(msg)) throw e;
      return await send();   // one retry: a dropped connection, not a bad query
    }
  } catch (e) {
    noteFailedQuery();
    throw e;
  } finally { release(); }
}

/**
 * Columnar result: `FORMAT JSONCompact` gives rows as arrays, which is ~45% fewer bytes and
 * ~35% less time than the object form on a million-row fetch, and leaves the caller free to
 * read by index instead of allocating an object per row. Used by the oncoprint's hot queries.
 */
export interface ChRows { names: string[]; rows: unknown[][]; _ms: number }
export async function chQueryRows(sql: string, conn: ChConn = PRIMARY): Promise<ChRows> {
  const t0 = Date.now();
  const text = await post(sql, conn, "JSONCompact");
  const j = JSON.parse(text) as { meta: { name: string }[]; data: unknown[][] };
  return { names: j.meta.map((m) => m.name), rows: j.data, _ms: Date.now() - t0 };
}

export async function chQuery<R = ChRow>(sql: string, conn: ChConn = PRIMARY): Promise<ChResult<R>> {
  const t0 = Date.now();
  const j = JSON.parse(await post(sql, conn, "JSON")) as ChResult<R>;
  j._ms = Date.now() - t0;
  return j;
}
