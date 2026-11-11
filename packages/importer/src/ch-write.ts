// The importer's statements and bulk inserts, against the LOCAL database `npm run local` starts, on
// @cbiolab/clickhouse, and only when the launcher has said this instance owns that database. Run
// from the app (local mode's import page), the connection is the app's own (lib/import-conn.ts),
// whose statements go through lib/ch.ts.
import { envConn, exec, insertRaw, query, send, sq, type Conn, type Row } from "@cbiolab/clickhouse";

export type WriteConn = Conn;
export { exec, insertRaw, query, sq, type Row };

/** The local database, as the environment names it: what the command-line import writes to. */
export function localConn(): WriteConn {
  return envConn();
}

/** Local mode is the only place the importer may write: the launcher sets CBIOLAB_LOCAL=1. */
export function importEnabled(): boolean {
  return process.env.CBIOLAB_LOCAL === "1";
}

export function assertLocal(): void {
  if (!importEnabled()) throw new Error("Importing is only available in local mode (npm run local)");
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

/**
 * Buffers rows for one table and sends them as JSONEachRow in batches, so a 500k-row MAF is a few
 * dozen requests instead of one per row or one enormous body. `statement`, when given, is an
 * INSERT … SELECT … FROM input(…) that reshapes the rows on the server.
 */
export class Inserter {
  private rows: string[] = [];
  private bytes = 0;
  count = 0;
  private readonly conn: WriteConn;
  private readonly table: string;
  private readonly statement: string | null;
  constructor(conn: WriteConn, table: string, statement: string | null = null) { this.conn = conn; this.table = table; this.statement = statement; }
  async add(row: Row | Record<string, unknown>): Promise<void> {
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
    if (this.statement) await send(this.conn, this.statement + " FORMAT JSONEachRow", body, { input_format_skip_unknown_fields: "0" });
    else await insertRaw(this.conn, this.table, "JSONEachRow", body);
  }
}

export async function insertAll(conn: WriteConn, table: string, rows: Iterable<Row>): Promise<number> {
  const ins = new Inserter(conn, table);
  for (const r of rows) await ins.add(r);
  await ins.flush();
  return ins.count;
}
