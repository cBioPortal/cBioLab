// A stand-in ClickHouse for the importer's tests: a connection whose requests never leave the
// process. Every statement is recorded; each INSERT's JSONEachRow rows are kept by table; a SELECT
// is answered by the first `answer` whose pattern it matches, and otherwise with no rows (the id
// allocator's `SELECT greatest(...)` gets 0, so ids start at 1). lib/importer/ writes through
// lib/ch.ts's `chWrite`, which calls fetch, so this replaces fetch for the fake connection's URL only.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChConn } from "../../lib/ch.ts";
import { GeneResolver, type Gene } from "../../lib/importer/genes.ts";
import { ImportContext, type Progress } from "../../lib/importer/context.ts";
import type { SchemaMode } from "../../lib/importer/lab-schema.ts";
import type { DataFile, DataKind, Meta } from "../../lib/importer/study.ts";

type Rows = Record<string, unknown>[];

export interface FakeCh {
  conn: ChConn;
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
  const conn: ChConn = { id: "fake", url: URL_BASE, user: "u", password: "p", db: "fake" } as ChConn;
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

/** A gene table for GeneResolver: [entrez, hugo, aliases?]; entity ids are the entrez ids. */
export function genes(list: [number, string, string[]?][]): GeneResolver {
  const gs: Gene[] = list.map(([entrez, hugo]) => ({ entrez, hugo, type: "protein-coding", entityId: entrez }));
  return GeneResolver.fromRows(gs, list.flatMap(([entrez, , aliases]) => (aliases ?? []).map((alias) => ({ entrez, alias }))));
}

/** An import context on the fake connection, with its ids loaded (they start at 1). */
export async function importContext(ch: FakeCh, opts: { genes?: GeneResolver; studyId?: string; mode?: SchemaMode; progress?: Progress } = {}): Promise<ImportContext> {
  const ctx = new ImportContext(ch.conn, opts.genes ?? genes([]), opts.studyId ?? "test_study", opts.progress ?? (() => {}), opts.mode ?? "legacy");
  await ctx.loadIds();
  return ctx;
}

/** A data file in a fresh temp folder, as readStudyFolder would describe it. */
export function dataFile(kind: DataKind, text: string, meta: Meta = {}, name = "data_" + kind + ".txt"): DataFile {
  const dir = mkdtempSync(join(tmpdir(), "importer-test-"));
  const file = join(dir, name);
  writeFileSync(file, text);
  return { kind, meta, metaFile: null, file };
}

/** A temp folder holding `files` (name → text), for readStudyFolder and importStudy. */
export function studyDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "importer-study-"));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    if (name.includes("/")) mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}
