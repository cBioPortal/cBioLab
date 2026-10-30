// The importer's statements and bulk inserts, against the LOCAL database `npm run local` starts.
// Every one goes through lib/ch.ts's `chWrite` (the one way to ClickHouse, with its checks) on the
// primary connection, and only when the launcher has said this instance owns that database.
import { chWrite, PRIMARY, type ChConn } from "../ch.ts";

export type WriteConn = ChConn;

export function localConn(): WriteConn {
  return PRIMARY;
}

/** Local mode is the only place the importer may write: the launcher sets CBIOLAB_LOCAL=1. */
export function importEnabled(): boolean {
  return process.env.CBIOLAB_LOCAL === "1";
}

export function assertLocal(): void {
  if (!importEnabled()) throw new Error("Importing is only available in local mode (npm run local)");
}

/** Runs one statement. */
export async function exec(conn: WriteConn, sql: string, settings: Record<string, string> = {}): Promise<void> {
  await chWrite(sql, conn, undefined, settings);
}

/** Sends `body` (rows in `format`) to `INSERT INTO table`. */
export async function insertRaw(conn: WriteConn, table: string, format: string, body: BodyInit): Promise<void> {
  await chWrite("INSERT INTO " + table + " FORMAT " + format, conn, body,
    { input_format_skip_unknown_fields: "0", date_time_input_format: "best_effort" });
}

/** Rows of a SELECT as objects. */
export async function query<R = Record<string, unknown>>(conn: WriteConn, sql: string): Promise<R[]> {
  const text = await chWrite(sql + "\nFORMAT JSONEachRow", conn, undefined, { output_format_json_quote_64bit_integers: "0" });
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as R);
}

/** A file's statements, split on `;` at line ends; `--` comment lines dropped. */
export function splitStatements(script: string): string[] {
  return script.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n")
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
}

/** A file's statements, run in order. */
export async function execScript(conn: WriteConn, script: string, settings: Record<string, string> = {}): Promise<void> {
  const statements = splitStatements(script);
  for (const st of statements) await exec(conn, st, settings);
}

export type Row = Record<string, string | number | boolean | null | undefined>;

/**
 * Buffers rows for one table and sends them as JSONEachRow in batches, so a 500k-row MAF is a few
 * dozen requests instead of one per row or one enormous body.
 */
export class Inserter {
  private rows: string[] = [];
  private bytes = 0;
  count = 0;
  private readonly conn: WriteConn;
  private readonly table: string;
  constructor(conn: WriteConn, table: string) { this.conn = conn; this.table = table; }
  async add(row: Row): Promise<void> {
    const line = JSON.stringify(row);
    this.rows.push(line);
    this.bytes += line.length;
    this.count++;
    if (this.bytes > 8_000_000) await this.flush();
  }
  async flush(): Promise<void> {
    if (!this.rows.length) return;
    const body = this.rows.join("\n");
    this.rows = [];
    this.bytes = 0;
    await insertRaw(this.conn, this.table, "JSONEachRow", body);
  }
}

export async function insertAll(conn: WriteConn, table: string, rows: Iterable<Row>): Promise<number> {
  const ins = new Inserter(conn, table);
  for (const r of rows) await ins.add(r);
  await ins.flush();
  return ins.count;
}

export const sq = (s: string): string => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
