// A stand-in ClickHouse for the offline tools' tests: a connection whose requests never leave the
// process. Every statement is recorded; each INSERT's JSONEachRow rows are kept by table; a SELECT
// is answered by the first `answer` whose pattern it matches, and otherwise with no rows (the id
// allocator's `SELECT greatest(...)` gets 0, so ids start at 1). The client calls fetch, so this
// replaces fetch for the fake connection's URL only and passes every other request on.
import type { Conn } from "./index.ts";

type Rows = Record<string, unknown>[];

export interface FakeCh {
  conn: Conn;
  /** every statement sent, in order (an INSERT's text without its rows) */
  statements: string[];
  /** the rows inserted into `table`, in order, across every INSERT into it */
  rows(table: string): Rows;
  /** tables that received at least one row */
  tables(): string[];
  /** answer SELECTs matching `pattern` with `rows` (checked in the order added) */
  answer(pattern: RegExp, rows: Rows | ((sql: string) => Rows)): void;
  /** forget statements and rows (answers stay) */
  clear(): void;
  /** put fetch back */
  restore(): void;
}

const URL_BASE = "http://fake-clickhouse.test";

export function fakeCh(): FakeCh {
  const conn: Conn = { id: "fake", url: URL_BASE, user: "u", password: "p", db: "fake" };
  const statements: string[] = [];
  const inserted = new Map<string, Rows>();
  const answers: [RegExp, Rows | ((sql: string) => Rows)][] = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(URL_BASE)) return realFetch(input as never, init);
    const params = new URL(url).searchParams;
    const body = init?.body == null ? "" : typeof init.body === "string" ? init.body : await new Response(init.body as BodyInit).text();
    const sql = params.get("query") ?? body;
    statements.push(sql);
    const insert = /^\s*INSERT\s+INTO\s+([`"\w.]+)/i.exec(sql);
    if (insert && params.has("query")) {
      const table = insert[1].replace(/[`"]/g, "").replace(/^.*\./, "");
      const list = inserted.get(table) ?? [];
      for (const line of body.split("\n")) if (line.trim()) list.push(JSON.parse(line));
      inserted.set(table, list);
      return new Response("");
    }
    for (const [re, rows] of answers) if (re.test(sql)) return jsonRows(typeof rows === "function" ? rows(sql) : rows);
    if (/SELECT\s+greatest\(/i.test(sql)) return jsonRows([{ m: 0 }]);
    return new Response("");
  }) as typeof fetch;

  return {
    conn, statements,
    rows: (t) => inserted.get(t) ?? [],
    tables: () => [...inserted.keys()],
    answer: (re, rows) => { answers.push([re, rows]); },
    clear: () => { statements.length = 0; inserted.clear(); },
    restore: () => { globalThis.fetch = realFetch; },
  };
}

const jsonRows = (rows: Rows) => new Response(rows.map((r) => JSON.stringify(r)).join("\n"));
