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

export async function chQuery<R = ChRow>(sql: string, conn: ChConn = PRIMARY): Promise<ChResult<R>> {
  if (!conn.url || !conn.user || !conn.password || !conn.db)
    throw new Error("ClickHouse instance '" + conn.id + "' is missing configuration (url/user/password/db)");
  const t0 = Date.now();
  const res = await fetch(conn.url.replace(/\/+$/, "") + "/", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(conn.user + ":" + conn.password).toString("base64"),
      "Content-Type": "text/plain"
    },
    body: sql + "\nFORMAT JSON",
    cache: "no-store"
  });
  const text = await res.text();
  // never echo the query (it can embed patient ids) or anything credential-shaped
  if (!res.ok) throw new Error("ClickHouse error [" + conn.id + "]: " + text.slice(0, 500));
  const j = JSON.parse(text) as ChResult<R>;
  j._ms = Date.now() - t0;
  return j;
}
