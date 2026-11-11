// Reviewed changes to a study in the lab_ tables (lab-schema.ts), all within one database.
//
// A review starts by copying the live study X, on the server, to a study of its own, X__review:
// the same rows with the study id (and the profile and case-list ids that begin with it)
// rewritten. Changes are then made to the copy while readers of X see X unchanged, and reviewers
// look at X__review as at any other study. Approving copies the review back under X into a side
// table, merged, and swaps it in partition by partition (REPLACE PARTITION, which links files
// rather than copying them), so readers see the old X until a table's swap and the reviewed one
// after; the X it replaced is kept in `<table>_previous`, so the approval can be undone.
// Rejecting drops the copy.
//
// The review records the latest version X held when the copy was made. An approval refuses when X
// has changed since (an update applied to the live study during the review would otherwise be
// dropped), listing what changed, unless forced.
//
// Each swap is atomic for its table, not across tables: for the moment between the first and the
// last, a query reading two tables can see the new rows of one beside the old rows of the other.
import { randomUUID } from "node:crypto";
import { exec, query, sq, type WriteConn } from "./ch-write.ts";
import { LAB_TABLES, columnsOf, compactStudy } from "./lab-schema.ts";

export const reviewId = (studyId: string) => studyId + "__review";
export const isReviewId = (id: string) => id.endsWith("__review");
const REVIEW_SUFFIX = " (review)";

const REVIEW_DDL = `CREATE TABLE IF NOT EXISTS lab_review (study_id String, review_id String, base_version UInt64, created DateTime64(3),
  state String, approved_version UInt64, seconds Float64, version UInt64, is_deleted UInt8)
  ENGINE = ReplacingMergeTree(version, is_deleted) PARTITION BY study_id ORDER BY (study_id, review_id)`;

export interface Review { studyId: string; reviewId: string; baseVersion: number; created: string; state: "open" | "approved" | "rejected" | "undone"; approvedVersion: number }

/**
 * Expressions that read a row of study `from` as a row of study `to`, at `version`: the study id,
 * and the ids built on it (`<study>_mutations`, `<study>_all`), rewritten; a review copy's name
 * marked, and unmarked when it is copied back.
 */
export function copyColumns(table: string, from: string, to: string, version: number): string[] {
  const prefixed = (c: string) => `if(startsWith(${c}, ${sq(from + "_")}), concat(${sq(to + "_")}, substring(${c}, ${from.length + 2})), ${c}) AS ${c}`;
  const name = isReviewId(to) ? `concat(name, ${sq(REVIEW_SUFFIX)}) AS name`
    : `if(endsWith(name, ${sq(REVIEW_SUFFIX)}), substring(name, 1, length(name) - ${REVIEW_SUFFIX.length}), name) AS name`;
  return [...columnsOf(table).map((c) => c === "study_id" ? `${sq(to)} AS study_id`
    : c === "profile_id" || c === "list_id" ? prefixed(c)
      : table === "lab_study" && c === "name" ? name : c), `${version} AS version`, "0 AS is_deleted"];
}

const tables = () => Object.keys(LAB_TABLES);

/**
 * A study's current rows of a table, as a subquery: the expressions that rename its columns are
 * applied outside it, since a SELECT alias would otherwise stand for the column in the WHERE.
 */
const current = (table: string, studyId: string) => `(SELECT * FROM ${table} FINAL WHERE study_id = ${sq(studyId)} AND is_deleted = 0)`;

async function hasPartition(conn: WriteConn, table: string, studyId: string): Promise<boolean> {
  const r = await query<{ n: number }>(conn, `SELECT count() AS n FROM system.parts WHERE active AND database = currentDatabase() AND table = ${sq(table)} AND partition = ${sq(studyId)}`);
  return Number(r[0]?.n) > 0;
}

/** Makes `target`'s partition of a study what `source` holds of it (nothing, when it holds none). */
async function swapPartition(conn: WriteConn, target: string, source: string, studyId: string): Promise<void> {
  if (await hasPartition(conn, source, studyId)) await exec(conn, `ALTER TABLE ${target} REPLACE PARTITION ${sq(studyId)} FROM ${source}`);
  else await exec(conn, `ALTER TABLE ${target} DROP PARTITION ${sq(studyId)}`);
}

/** The latest version of any row of a study, deletion markers included: it grows with every change. */
export async function latestVersion(conn: WriteConn, studyId: string): Promise<number> {
  const r = await query<{ v: number }>(conn, `SELECT max(v) AS v FROM (${tables().map((t) => `SELECT max(version) AS v FROM ${t} WHERE study_id = ${sq(studyId)}`).join(" UNION ALL ")})`);
  return Number(r[0]?.v ?? 0);
}

export async function studyExists(conn: WriteConn, studyId: string): Promise<boolean> {
  const r = await query<{ n: number }>(conn, `SELECT count() AS n FROM lab_study FINAL WHERE study_id = ${sq(studyId)}`);
  return Number(r[0]?.n) > 0;
}

/** Copies a study's current rows under another id, on the server, then merges the copy's partitions. */
export async function copyStudy(conn: WriteConn, from: string, to: string): Promise<void> {
  const version = Date.now();
  for (const t of tables())
    await exec(conn, `INSERT INTO ${t} (${columnsOf(t).join(", ")}, version, is_deleted)
      SELECT ${copyColumns(t, from, to, version).join(", ")} FROM ${current(t, from)}`);
  await compactStudy(conn, to);
}

/** The study's latest review record, if it has one. */
export async function latestReview(conn: WriteConn, studyId: string): Promise<Review | null> {
  await exec(conn, REVIEW_DDL);
  const r = await query<{ s: string; r: string; b: number; c: string; st: Review["state"]; a: number }>(conn,
    `SELECT study_id AS s, review_id AS r, base_version AS b, toString(created) AS c, state AS st, approved_version AS a
     FROM lab_review FINAL WHERE study_id = ${sq(studyId)} ORDER BY created DESC LIMIT 1`);
  return r[0] ? { studyId: r[0].s, reviewId: r[0].r, baseVersion: Number(r[0].b), created: r[0].c, state: r[0].st, approvedVersion: Number(r[0].a) } : null;
}

async function record(conn: WriteConn, rv: Review, seconds: number): Promise<void> {
  await exec(conn, `INSERT INTO lab_review VALUES (${sq(rv.studyId)}, ${sq(rv.reviewId)}, ${rv.baseVersion}, ${sq(rv.created)}, ${sq(rv.state)},
    ${rv.approvedVersion}, ${seconds}, ${Date.now()}, 0)`);
}

/** Starts a review of a study: copies it to `<study>__review`. */
export async function startReview(conn: WriteConn, studyId: string): Promise<Review> {
  if (isReviewId(studyId)) throw new Error(studyId + " is itself a review copy");
  if (!(await studyExists(conn, studyId))) throw new Error("No study " + studyId + " in the lab_ tables");
  const open = await latestReview(conn, studyId);
  if (open?.state === "open") throw new Error(studyId + " already has a review open (" + open.reviewId + "); approve or reject it first");
  const id = reviewId(studyId);
  if (await studyExists(conn, id)) throw new Error("A study " + id + " already exists; remove it first");
  const t0 = Date.now();
  const base = await latestVersion(conn, studyId);
  await copyStudy(conn, studyId, id);
  const rv: Review = { studyId, reviewId: id, baseVersion: base, created: new Date().toISOString().replace("T", " ").replace("Z", ""), state: "open", approvedVersion: 0 };
  await record(conn, rv, (Date.now() - t0) / 1000);
  return rv;
}

export interface TableDiff { table: string; added: number; removed: number; changed: number }
export interface ReviewDiff {
  tables: TableDiff[];
  samplesAdded: string[]; samplesRemoved: string[]; samplesAddedCount: number; samplesRemovedCount: number;
  attributesAdded: string[]; profilesAdded: string[];
}

/**
 * What approving would change in the live study: per table, the rows the review adds, removes and
 * changes (by the table's key), and the samples, attributes and profiles it adds or removes.
 */
export async function diffReview(conn: WriteConn, studyId: string): Promise<ReviewDiff> {
  const id = reviewId(studyId);
  const out: TableDiff[] = [];
  for (const t of tables()) {
    const cols = columnsOf(t).filter((c) => c !== "study_id");
    const key = LAB_TABLES[t].order.replace(/^study_id,?\s*/, "") || "1";
    const side = (study: string, exprs: string[]) =>
      `SELECT sipHash64(tuple(${key})) AS k, sipHash64(tuple(${cols.join(", ")})) AS h FROM (SELECT ${exprs.join(", ")} FROM ${current(t, study)})`;
    // the review's rows read as the live study's, so equal rows hash equal
    const review = side(id, copyColumns(t, id, studyId, 0).slice(0, -2));
    const live = side(studyId, columnsOf(t));
    const n = await query<{ n: number }>(conn, `SELECT greatest((SELECT count() FROM ${t} WHERE study_id = ${sq(id)}), (SELECT count() FROM ${t} WHERE study_id = ${sq(studyId)})) AS n`);
    const slices = Math.max(1, Math.ceil(Number(n[0]?.n ?? 0) / 2_000_000));
    const d: TableDiff = { table: t, added: 0, removed: 0, changed: 0 };
    for (let i = 0; i < slices; i++) {
      const slice = slices === 1 ? "1" : `k % ${slices} = ${i}`;
      const r = await query<{ a: number; r: number; c: number }>(conn, `SELECT countIf(lk = 0) AS a, countIf(rk = 0) AS r, countIf(rk != 0 AND lk != 0 AND rh != lh) AS c
        FROM (SELECT k AS rk, h AS rh FROM (${review}) WHERE ${slice}) AS x FULL OUTER JOIN (SELECT k AS lk, h AS lh FROM (${live}) WHERE ${slice}) AS y ON x.rk = y.lk`);
      d.added += Number(r[0]?.a ?? 0); d.removed += Number(r[0]?.r ?? 0); d.changed += Number(r[0]?.c ?? 0);
    }
    if (d.added || d.removed || d.changed) out.push(d);
  }
  const only = async (sql: string) => (await query<{ x: string }>(conn, sql + " ORDER BY x LIMIT 50")).map((r) => r.x);
  const count = async (sql: string) => Number((await query<{ n: number }>(conn, `SELECT count() AS n FROM (${sql})`))[0]?.n ?? 0);
  const samples = (a: string, b: string) => `SELECT sample_id AS x FROM lab_sample FINAL WHERE study_id = ${sq(a)} AND sample_id NOT IN (SELECT sample_id FROM lab_sample FINAL WHERE study_id = ${sq(b)})`;
  const back = (c: string) => `if(startsWith(${c}, ${sq(id + "_")}), concat(${sq(studyId + "_")}, substring(${c}, ${id.length + 2})), ${c})`;
  return {
    tables: out,
    samplesAdded: await only(samples(id, studyId)), samplesAddedCount: await count(samples(id, studyId)),
    samplesRemoved: await only(samples(studyId, id)), samplesRemovedCount: await count(samples(studyId, id)),
    attributesAdded: await only(`SELECT attr_id AS x FROM lab_clinical_attribute FINAL WHERE study_id = ${sq(id)}
      AND attr_id NOT IN (SELECT attr_id FROM lab_clinical_attribute FINAL WHERE study_id = ${sq(studyId)})`),
    profilesAdded: await only(`SELECT ${back("profile_id")} AS x FROM lab_profile FINAL WHERE study_id = ${sq(id)}
      AND ${back("profile_id")} NOT IN (SELECT profile_id FROM lab_profile FINAL WHERE study_id = ${sq(studyId)})`)
  };
}

export interface Changes { table: string; rows: number; samples: string[] }

/** Rows of a study written after `version`, per table, with some of the samples they belong to. */
export async function changedSince(conn: WriteConn, studyId: string, version: number): Promise<Changes[]> {
  const out: Changes[] = [];
  for (const t of tables()) {
    const hasSample = columnsOf(t).includes("sample_id");
    const r = await query<{ n: number; s: string[] }>(conn, `SELECT count() AS n, ${hasSample ? "groupUniqArray(10)(sample_id)" : "[]"} AS s
      FROM ${t} WHERE study_id = ${sq(studyId)} AND version > ${version}`);
    if (Number(r[0]?.n)) out.push({ table: t, rows: Number(r[0].n), samples: (r[0].s ?? []).filter(Boolean) });
  }
  return out;
}

export type ApproveResult = { approved: true; seconds: number } | { approved: false; changes: Changes[] };

/**
 * Approves a study's open review: the reviewed rows replace the live study's, table by table, and
 * the review copy is dropped. Refuses, listing the changes, when the live study changed after the
 * review began, unless `force`.
 */
export async function approveReview(conn: WriteConn, studyId: string, force = false): Promise<ApproveResult> {
  const rv = await latestReview(conn, studyId);
  if (rv?.state !== "open") throw new Error(studyId + " has no open review");
  if (!force && (await latestVersion(conn, studyId)) > rv.baseVersion) return { approved: false, changes: await changedSince(conn, studyId, rv.baseVersion) };
  const t0 = Date.now();
  const version = Date.now();
  const tag = randomUUID().replace(/-/g, "").slice(0, 12);
  const side = (t: string) => `${t}_approve_${tag}`;
  try {
    // built first, then swapped one after another, so the tables change as close together as they can
    for (const t of tables()) {
      await exec(conn, `CREATE TABLE ${side(t)} AS ${t}`);
      await exec(conn, `INSERT INTO ${side(t)} (${columnsOf(t).join(", ")}, version, is_deleted)
        SELECT ${copyColumns(t, rv.reviewId, studyId, version).join(", ")} FROM ${current(t, rv.reviewId)}`);
      if (await hasPartition(conn, side(t), studyId)) await exec(conn, `OPTIMIZE TABLE ${side(t)} PARTITION ${sq(studyId)} FINAL`);
      await exec(conn, `CREATE TABLE IF NOT EXISTS ${t}_previous AS ${t}`);
      await swapPartition(conn, `${t}_previous`, t, studyId);
    }
    for (const t of tables()) await swapPartition(conn, t, side(t), studyId);
  } finally {
    for (const t of tables()) await exec(conn, `DROP TABLE IF EXISTS ${side(t)}`);
  }
  for (const t of tables()) await exec(conn, `ALTER TABLE ${t} DROP PARTITION ${sq(rv.reviewId)}`);
  const seconds = (Date.now() - t0) / 1000;
  await record(conn, { ...rv, state: "approved", approvedVersion: version }, seconds);
  return { approved: true, seconds };
}

/** Drops a study's open review copy. */
export async function rejectReview(conn: WriteConn, studyId: string): Promise<void> {
  const rv = await latestReview(conn, studyId);
  if (rv?.state !== "open") throw new Error(studyId + " has no open review");
  for (const t of tables()) await exec(conn, `ALTER TABLE ${t} DROP PARTITION ${sq(rv.reviewId)}`);
  await record(conn, { ...rv, state: "rejected" }, 0);
}

export type UndoResult = { undone: true } | { undone: false; changes: Changes[] };

/**
 * Puts back the study as it was before its last approval. Refuses, listing the changes, when the
 * study changed after the approval (undoing would drop them), unless `force`.
 */
export async function undoApproval(conn: WriteConn, studyId: string, force = false): Promise<UndoResult> {
  const rv = await latestReview(conn, studyId);
  if (rv?.state !== "approved") throw new Error(studyId + "'s last review was not approved; there is nothing to undo");
  // the approved rows carry the approval's version; anything later was written since
  if (!force && (await latestVersion(conn, studyId)) > rv.approvedVersion) return { undone: false, changes: await changedSince(conn, studyId, rv.approvedVersion) };
  for (const t of tables()) await swapPartition(conn, t, `${t}_previous`, studyId);
  await record(conn, { ...rv, state: "undone" }, 0);
  return { undone: true };
}
