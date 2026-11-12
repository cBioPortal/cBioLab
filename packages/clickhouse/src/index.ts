// The ClickHouse client the offline tools share (@cbiolab/importer, @cbiolab/annotation-sync): one
// HTTP request per statement, nothing else. The app never uses it to reach a database of its own —
// its one way to ClickHouse is lib/ch.ts — so when the app hands one of these tools a connection
// (local mode's import page), the connection carries `send`, and every statement goes through that.

export interface Conn {
  /** short name for messages */
  id: string;
  url: string;
  user: string;
  password: string;
  /** the database statements run in; tables elsewhere are named with their database */
  db: string;
  label?: string;
  /** sends one statement instead of this client's own request: how the app keeps its queries on lib/ch.ts */
  send?: (sql: string, body: BodyInit | undefined, settings: Record<string, string>) => Promise<string>;
}

export type Row = Record<string, string | number | boolean | null | undefined>;

const clean = (s: string | undefined) => (s || "").replace(/[^A-Za-z0-9_]/g, "");

/** A string as a ClickHouse literal. */
export const sq = (s: string): string => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

/** A JSON-format error body's own message, so a refusal raised in SQL (throwIf) reads as itself. */
function exception(body: string): string {
  const m = /"exception":\s*("(?:[^"\\]|\\.)*")/.exec(body);
  if (!m) return body;
  let msg: string;
  try { msg = String(JSON.parse(m[1])); } catch { return body; }
  // 395 is throwIf's code: the message is ours, without the server's account of where it ran
  const own = /^Code: 395\. DB::Exception: ([\s\S]*?): while executing/.exec(msg);
  return own ? own[1] : msg;
}

/** Runs one statement; `body`, when given, is the statement's data (an INSERT's rows), and the statement goes in the URL. */
export async function send(conn: Conn, sql: string, body?: BodyInit, settings: Record<string, string> = {}): Promise<string> {
  if (conn.send) return conn.send(sql, body, settings);
  if (!conn.url || !conn.user || !conn.password || !conn.db)
    throw new Error("ClickHouse instance '" + conn.id + "' is missing configuration (url/password/db)");
  const params = new URLSearchParams({ database: conn.db, ...settings });
  if (body !== undefined) params.set("query", sql);
  const res = await fetch(conn.url.replace(/\/+$/, "") + "/?" + params.toString(), {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(conn.user + ":" + conn.password).toString("base64") },
    body: body === undefined ? sql : body,
    cache: "no-store"
  });
  const text = await res.text();
  if (!res.ok) throw new Error("ClickHouse error [" + conn.id + "]: " + exception(text).slice(0, 800));
  return text;
}

/**
 * Runs one statement and returns once its effect is in place: OPTIMIZE, ALTER and DELETE wait for
 * their merge or mutation on every replica (ClickHouse Cloud defaults to returning before them).
 */
const WAIT = { alter_sync: "2", mutations_sync: "2", lightweight_deletes_sync: "2" };

export async function exec(conn: Conn, sql: string, settings: Record<string, string> = {}): Promise<void> {
  await send(conn, sql, undefined, { ...WAIT, ...settings });
}

/** Sends `body` (rows in `format`) to `INSERT INTO table`. */
export async function insertRaw(conn: Conn, table: string, format: string, body: BodyInit): Promise<void> {
  await send(conn, "INSERT INTO " + table + " FORMAT " + format, body,
    { input_format_skip_unknown_fields: "0", date_time_input_format: "best_effort" });
}

/** Rows as JSONEachRow into `table`; nothing is sent for none. */
export async function insertRows(conn: Conn, table: string, rows: Row[]): Promise<void> {
  if (rows.length) await insertRaw(conn, table, "JSONEachRow", rows.map((r) => JSON.stringify(r)).join("\n"));
}

/** Rows of a SELECT as objects. */
export async function query<R = Record<string, unknown>>(conn: Conn, sql: string): Promise<R[]> {
  const text = await send(conn, sql + "\nFORMAT JSONEachRow", undefined, { output_format_json_quote_64bit_integers: "0" });
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as R);
}

/** The connection the environment names: CLICKHOUSE_URL, _USER, _PASSWORD and _DB. */
export function envConn(env: Record<string, string | undefined> = process.env): Conn {
  return { id: "a", url: env.CLICKHOUSE_URL || "", user: env.CLICKHOUSE_USER || "", password: env.CLICKHOUSE_PASSWORD || "",
    db: clean(env.CLICKHOUSE_DB), label: env.CLICKHOUSE_LABEL || "primary" };
}

/**
 * A writer on the warehouse for an offline job that may INSERT where the app may not:
 * `<PREFIX>_WRITER_USER` (default `<prefix>_writer`) and `<PREFIX>_WRITER_PASSWORD`, on
 * CLICKHOUSE_URL and CLICKHOUSE_DB. Refuses, naming what is unset.
 */
export function writerConn(prefix: string, label: string, env: Record<string, string | undefined> = process.env): Conn {
  const p = prefix.toUpperCase();
  const missing = ["CLICKHOUSE_URL", "CLICKHOUSE_DB", p + "_WRITER_PASSWORD"].filter((k) => !env[k]);
  if (missing.length) throw new Error("a " + label + " needs " + missing.join(", "));
  return { id: prefix + "-writer", url: env.CLICKHOUSE_URL!, user: env[p + "_WRITER_USER"] || prefix + "_writer",
    password: env[p + "_WRITER_PASSWORD"]!, db: clean(env.CLICKHOUSE_DB), label };
}
