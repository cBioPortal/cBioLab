// The offline annotation sync: resolves the warehouse's distinct keys against one source's service
// and appends them to that source's version-pinned store. Idempotent and resumable — the keys still
// to annotate are the study's key space minus what the store already holds for this release,
// computed in ClickHouse — so re-running, or a key shared by several studies, never asks twice.
// Every run leaves a row in the shared `annotation.sync_run` (store.ts), which the app reads to say which studies a
// release covers (lib/annotation.ts).
import { exec, insertRows, query, sq, type Conn as WriteConn, type Row } from "@cbiolab/clickhouse";
import type { AnnotationSource, Release } from "./source.ts";
import { STORE_DDL, SYNC_RUN_TABLE } from "./store.ts";

/** Stops a run when this many batches in a row fail: a token or rate problem, not a data problem. */
export const MAX_CONSECUTIVE_FAILURES = 10;

export type Log = (msg: string) => void;

export interface SyncResult { total: number; alreadyStored: number; done: number; failed: number; aborted: boolean }

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** When held rows are written: at this many rows, or this long after the last write, whichever comes first. */
export interface InsertLimits { rows: number; seconds: number }
export function insertLimits(env: Record<string, string | undefined> = process.env): InsertLimits {
  return { rows: Number(env.ANNOTATION_INSERT_ROWS) || 20_000, seconds: Number(env.ANNOTATION_INSERT_SECONDS) || 300 };
}

/**
 * Holds a sync's rows and writes them in few, large INSERTs: every INSERT makes a part ClickHouse
 * later merges, so a row per service batch would leave tens of thousands of parts behind a full sync.
 * A run's sync_run row is held too and written after the rows it counts, so the log never reports a
 * study whose rows are not yet stored. A sync that stops loses only what it held, and the next run
 * asks for it again (the diff). The keys it holds are skipped by a later study of the same run, which
 * cannot see them in the store yet. `before` runs ahead of each write of rows (the release guard).
 */
export class HeldWriter {
  private rows: Row[] = [];
  private logs: Row[] = [];
  private keys = new Set<string>();
  private last: number;
  private conn: WriteConn;
  private table: string;
  private limits: InsertLimits;
  private clock: () => number;
  private before: () => Promise<void>;
  inserts = 0;
  constructor(conn: WriteConn, table: string, limits: InsertLimits = insertLimits(), clock: () => number = Date.now, before: () => Promise<void> = async () => {}) {
    this.conn = conn; this.table = table; this.limits = limits; this.clock = clock; this.before = before;
    this.last = clock();
  }
  holds(key: string): boolean { return this.keys.has(key); }
  async add(rows: Row[], keys: string[]): Promise<void> {
    this.rows.push(...rows);
    for (const k of keys) this.keys.add(k);
    if (this.rows.length >= this.limits.rows || this.clock() - this.last >= this.limits.seconds * 1000) await this.flush();
  }
  /** a sync_run row, written after every row held before it */
  log(row: Row): void { this.logs.push(row); }
  async flush(): Promise<void> {
    if (this.rows.length) { await this.before(); await insertRows(this.conn, this.table, this.rows); this.inserts++; }
    if (this.logs.length) { await insertRows(this.conn, SYNC_RUN_TABLE, this.logs); this.inserts++; }
    this.rows = []; this.logs = []; this.keys.clear(); this.last = this.clock();
  }
}

/**
 * A writer for `src`'s rows of `release` that, before each write, asks the service for its release again
 * and stops the sync when it has moved on: rows annotated after the change would be stored under a release
 * that did not make them. What it held is not written; the next run starts on the new release.
 */
export function releaseWriter(conn: WriteConn, src: AnnotationSource, release: Release): HeldWriter {
  return new HeldWriter(conn, src.table, insertLimits(), Date.now, async () => {
    const now = (await src.release()).version;
    if (now !== release.version) throw new Error(src.label + " moved from release " + release.version + " to " + now + " during the sync; nothing since the last write was stored. Re-run to sync the new release.");
  });
}

const keyOf = (src: AnnotationSource, r: Row) => src.keyColumns.map((c) => String(r[c])).join("\u0000");

/**
 * The key columns, as Strings, of what `src` stores for `version` (an Enum key compares with the warehouse's
 * String), among the keys of `within`, which may carry more columns than the key.
 */
function storedKeys(src: AnnotationSource, version: string, within: string): string {
  const cols = src.keyColumns;
  return "SELECT " + cols.map((c) => "toString(" + c + ") AS " + c).join(", ") + " FROM " + src.table +
    " WHERE " + src.versionColumn + " = " + sq(version) + " AND (" + cols.map((c) => "toString(" + c + ")").join(", ") + ") IN (SELECT " + cols.join(", ") + " FROM (" + within + "))";
}

/** The keys `space` holds that the store does not hold for `version`, with whatever else `space` says of each. */
function missingSql(src: AnnotationSource, version: string, space: string): string {
  const cols = src.keyColumns.join(", ");
  return "SELECT w.* FROM (" + space + ") w\nLEFT ANTI JOIN (" + storedKeys(src, version, space) + ") s USING (" + cols + ")";
}

async function countOf(conn: WriteConn, src: AnnotationSource, sql: string): Promise<number> {
  const [{ n }] = await query<{ n: number }>(conn, "SELECT uniqExact(" + src.keyColumns.join(", ") + ") AS n FROM (" + sql + ")");
  return Number(n);
}

/** The keys of `space` still to annotate for `version`, in key order, and how many keys `space` holds. */
export async function pendingKeys(conn: WriteConn, src: AnnotationSource, version: string, space: string): Promise<{ total: number; todo: Row[] }> {
  const total = await countOf(conn, src, space);
  const todo = await query<Row>(conn, missingSql(src, version, space) + "\nORDER BY " + src.keyColumns.join(", "));
  return { total, todo };
}


/** Creates the annotation database, sync_run and the source's table, where they are missing. */
export async function ensureStore(conn: WriteConn, src: AnnotationSource): Promise<void> {
  for (const st of [...STORE_DDL, ...src.ddl]) await exec(conn, st);
}

/**
 * Annotates one study's pending keys and records the run, through `out` (one is made, and written
 * out at the end, when none is given). A key `out` already holds counts as stored.
 */
export async function syncKeys(conn: WriteConn, src: AnnotationSource, release: Release, study: string, log: Log, out?: HeldWriter): Promise<SyncResult> {
  const own = !out;
  const w = out ?? releaseWriter(conn, src, release);
  try {
    return await syncInto(w, conn, src, release, study, log);
  } finally {
    if (own) await w.flush();
  }
}

async function syncInto(w: HeldWriter, conn: WriteConn, src: AnnotationSource, release: Release, study: string, log: Log): Promise<SyncResult> {
  const label = study;
  const startedAt = now();
  const pending = await pendingKeys(conn, src, release.version, src.keySpace(conn.db, study));
  const total = pending.total;
  const todo = pending.todo.filter((r) => !w.holds(keyOf(src, r)));
  const alreadyStored = total - todo.length;
  log(`[${label}] ${total.toLocaleString()} keys — already stored for ${src.label} ${release.version}: ${alreadyStored.toLocaleString()} — to annotate: ${todo.length.toLocaleString()}`);

  let done = 0, failed = 0, inARow = 0, aborted = false;
  for (let i = 0; i < todo.length; i += src.batchSize) {
    const batch = todo.slice(i, i + src.batchSize);
    let rows: Row[];
    try {
      rows = await src.annotate(batch);
    } catch (e) {
      failed += batch.length;
      inARow++;
      log(`[${label}] batch at ${i} failed: ${String((e as Error).message || e).slice(0, 200)}`);
      if (inARow >= MAX_CONSECUTIVE_FAILURES) { aborted = true; break; }
      if (i + src.batchSize < todo.length && src.batchDelayMs) await sleep(src.batchDelayMs);
      continue;
    }
    // a failed write is not a service hiccup: it stops the sync
    await w.add(rows.map((r) => ({ [src.versionColumn]: release.version, ...r, ...release.extra })), batch.map((r) => keyOf(src, r)));
    done += batch.length;
    inARow = 0;
    if (i + src.batchSize < todo.length && src.batchDelayMs) await sleep(src.batchDelayMs);
  }

  w.log({
    run_id: "run_" + Date.now().toString(36), started_at: startedAt, finished_at: now(),
    source: src.id, version: release.version, study,
    variants_total: total, already_stored: alreadyStored, annotated_new: done, failed,
    note: aborted ? `aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive batch failures — re-run to resume`
      : failed ? "partial — re-run to resume" : "complete"
  });
  log(`[${label}] ${done.toLocaleString()} annotated, ${failed.toLocaleString()} failed, pinned to ${src.label} ${release.version}`);
  return { total, alreadyStored, done, failed, aborted };
}

/** The studies the warehouse holds genomic events for, in id order. */
export async function warehouseStudies(conn: WriteConn): Promise<string[]> {
  const r = await query<{ s: string }>(conn, "SELECT DISTINCT cancer_study_identifier AS s FROM genomic_event_derived ORDER BY s");
  return r.map((x) => x.s);
}

/**
 * Syncs each of `studies` in turn, then records a portal-wide row saying how much of every study's
 * key space is stored. Stops at the first study whose run aborts; `missing` counts the keys still
 * unannotated, so the caller can exit non-zero.
 */
export async function syncStudies(conn: WriteConn, src: AnnotationSource, release: Release, studies: string[], log: Log):
    Promise<{ done: number; failed: number; aborted: boolean; missing: number; total: number }> {
  let done = 0, failed = 0, aborted = false;
  const w = releaseWriter(conn, src, release);
  try {
    for (const [i, study] of studies.entries()) {
      log(`--- study ${i + 1}/${studies.length}: ${study}`);
      const r = await syncKeys(conn, src, release, study, log, w);
      done += r.done; failed += r.failed;
      if (r.aborted) { aborted = true; log(`stopping at ${study}`); break; }
    }
  } finally {
    // the portal-wide count below reads the store, so everything held is written first
    await w.flush();
  }
  log(`${w.inserts.toLocaleString()} inserts`);
  const startedAt = now();
  const space = src.keySpace(conn.db, null);
  const total = await countOf(conn, src, space), missing = await countOf(conn, src, missingSql(src, release.version, space));
  await insertRows(conn, SYNC_RUN_TABLE, [{
    run_id: "run_" + Date.now().toString(36), started_at: startedAt, finished_at: now(),
    source: src.id, version: release.version, study: "__portal__",
    variants_total: total, already_stored: total - missing, annotated_new: done, failed,
    note: aborted ? "aborted — re-run to resume" : missing ? `incomplete: ${missing} keys still missing` : "complete"
  }]);
  log(`portal-wide: ${(total - missing).toLocaleString()} / ${total.toLocaleString()} keys stored for ${src.label} ${release.version}`);
  return { done, failed, aborted, missing, total };
}
