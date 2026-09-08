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
import type { ChResult, ChRow } from "./types.ts";

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

async function post(sql: string, conn: ChConn, format: string): Promise<string> {
  if (!conn.url || !conn.user || !conn.password || !conn.db)
    throw new Error("ClickHouse instance '" + conn.id + "' is missing configuration (url/password/db)");
  const send = async (): Promise<string> => {
    const res = await fetch(conn.url.replace(/\/+$/, "") + "/", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(conn.user + ":" + conn.password).toString("base64"),
        "Content-Type": "text/plain"
      },
      body: sql + "\nFORMAT " + format,
      cache: "no-store"
    });
    const text = await res.text();
    // never echo the query (it can embed patient ids) or anything credential-shaped
    if (!res.ok) throw new Error("ClickHouse error [" + conn.id + "]: " + text.slice(0, 500));
    return text;
  };
  await acquire();
  try {
    try { return await send(); }
    catch (e) {
      const msg = String((e as Error)?.message || e) + " " + String((e as { cause?: { code?: string } })?.cause?.code || "");
      if (!RETRYABLE.test(msg)) throw e;
      return await send();   // one retry: a dropped connection, not a bad query
    }
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
