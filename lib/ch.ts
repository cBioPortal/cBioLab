// Server-side ClickHouse HTTP client. Credentials never leave the server.
import type { ChResult, ChRow } from "./types.ts";
const URL_ = process.env.CLICKHOUSE_URL;
const USER = process.env.CLICKHOUSE_USER;
const PASS = process.env.CLICKHOUSE_PASSWORD;

export const DB = (process.env.CLICKHOUSE_DB || "").replace(/[^A-Za-z0-9_]/g, "");
export const STUDY = process.env.STUDY_ID || "msk_chord_2024";
export const PORTAL = process.env.PORTAL_URL || "https://www.cbioportal.org";

export async function chQuery<R = ChRow>(sql: string): Promise<ChResult<R>> {
  if (!URL_ || !USER || !PASS || !DB) throw new Error("Server is missing CLICKHOUSE_* env configuration");
  const t0 = Date.now();
  const res = await fetch(URL_.replace(/\/+$/, "") + "/", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(USER + ":" + PASS).toString("base64"),
      "Content-Type": "text/plain"
    },
    body: sql + "\nFORMAT JSON",
    cache: "no-store"
  });
  const text = await res.text();
  if (!res.ok) throw new Error("ClickHouse error: " + text.slice(0, 500));
  const j = JSON.parse(text) as ChResult<R>;
  j._ms = Date.now() - t0;
  return j;
}
