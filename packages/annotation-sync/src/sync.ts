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

/** The key columns, as Strings, of what `src` stores for `version` (an Enum key compares with the warehouse's String). */
function storedKeys(src: AnnotationSource, version: string, within: string): string {
  const cols = src.keyColumns;
  return "SELECT " + cols.map((c) => "toString(" + c + ") AS " + c).join(", ") + " FROM " + src.table +
    " WHERE " + src.versionColumn + " = " + sq(version) + " AND (" + cols.map((c) => "toString(" + c + ")").join(", ") + ") IN (" + within + ")";
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

/** Annotates one study's pending keys and records the run. */
export async function syncKeys(conn: WriteConn, src: AnnotationSource, release: Release, study: string, log: Log): Promise<SyncResult> {
  const label = study;
  const startedAt = now();
  const { total, todo } = await pendingKeys(conn, src, release.version, src.keySpace(conn.db, study));
  const alreadyStored = total - todo.length;
  log(`[${label}] ${total.toLocaleString()} keys — already stored for ${src.label} ${release.version}: ${alreadyStored.toLocaleString()} — to annotate: ${todo.length.toLocaleString()}`);

  let done = 0, failed = 0, inARow = 0, aborted = false;
  for (let i = 0; i < todo.length; i += src.batchSize) {
    const batch = todo.slice(i, i + src.batchSize);
    try {
      const rows = await src.annotate(batch);
      await insertRows(conn, src.table, rows.map((r) => ({ [src.versionColumn]: release.version, ...r, ...release.extra })));
      done += batch.length;
      inARow = 0;
    } catch (e) {
      failed += batch.length;
      inARow++;
      log(`[${label}] batch at ${i} failed: ${String((e as Error).message || e).slice(0, 200)}`);
      if (inARow >= MAX_CONSECUTIVE_FAILURES) { aborted = true; break; }
    }
    if (i + src.batchSize < todo.length && src.batchDelayMs) await sleep(src.batchDelayMs);
  }

  await insertRows(conn, SYNC_RUN_TABLE, [{
    run_id: "run_" + Date.now().toString(36), started_at: startedAt, finished_at: now(),
    source: src.id, version: release.version, study,
    variants_total: total, already_stored: alreadyStored, annotated_new: done, failed,
    note: aborted ? `aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive batch failures — re-run to resume`
      : failed ? "partial — re-run to resume" : "complete"
  }]);
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
  for (const [i, study] of studies.entries()) {
    log(`--- study ${i + 1}/${studies.length}: ${study}`);
    const r = await syncKeys(conn, src, release, study, log);
    done += r.done; failed += r.failed;
    if (r.aborted) { aborted = true; log(`stopping at ${study}`); break; }
  }
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
