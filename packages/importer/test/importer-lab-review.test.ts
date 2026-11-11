// Reviewed changes to a study (lib/importer/lab-review.ts; docs/LOCAL.md "Live updates and
// reviews"): a review copies study X to X__review; approving copies it back into side tables and
// swaps them in partition by partition, keeping the old X in <table>_previous so the approval can
// be undone; approving or undoing refuses, listing the changes, when X changed since; rejecting
// drops the copy. ClickHouse is test/support/fake-ch.ts, answering as a database in a given state.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCh, type FakeCh } from "./support.ts";
import { LAB_TABLES } from "../src/lab-schema.ts";
import {
  approveReview, changedSince, copyColumns, diffReview, latestReview, latestVersion, rejectReview, startReview, studyExists, undoApproval, type Review,
} from "../src/lab-review.ts";

let ch: FakeCh | null = null;
afterEach(() => { ch?.restore(); ch = null; });

const TABLES = Object.keys(LAB_TABLES);

interface State {
  studies: string[];
  review: Review | null;
  /** latest row version per study */
  version: Record<string, number>;
  /** tables with a partition for a study, as "table|study" */
  partitions: Set<string>;
  /** rows written after a version, per table */
  changed: Record<string, { n: number; s: string[] }>;
}

function database(over: Partial<State> = {}): { c: FakeCh; state: State } {
  const state: State = { studies: ["st"], review: null, version: { st: 100 }, partitions: new Set(), changed: {}, ...over };
  const c = fakeCh();
  ch = c;
  c.answer(/FROM lab_study FINAL WHERE study_id = '([^']+)'$/m, (sql) => [{ n: state.studies.includes(/study_id = '([^']+)'/.exec(sql)![1]) ? 1 : 0 }]);
  c.answer(/FROM lab_review FINAL/, () => state.review ? [{ s: state.review.studyId, r: state.review.reviewId, b: state.review.baseVersion, c: state.review.created, st: state.review.state, a: state.review.approvedVersion }] : []);
  c.answer(/SELECT max\(v\) AS v FROM/, (sql) => [{ v: state.version[/study_id = '([^']+)'/.exec(sql)![1]] ?? 0 }]);
  c.answer(/FROM system\.parts WHERE active/, (sql) => {
    const [, table, study] = /table = '([^']+)' AND partition = '([^']+)'/.exec(sql)!;
    // an approval's side tables carry a random tag: "<table>_approve_" stands for them
    return [{ n: state.partitions.has(table.replace(/_approve_\w+$/, "_approve_") + "|" + study) ? 3 : 0 }];
  });
  c.answer(/AS s\s+FROM (\w+) WHERE study_id = '[^']+' AND version > /, (sql) => {
    const t = /FROM (\w+) WHERE study_id/.exec(sql)![1];
    return [{ n: state.changed[t]?.n ?? 0, s: state.changed[t]?.s ?? [] }];
  });
  return { c, state };
}

/** the review records written, as [state, base version, approved version] */
const records = (c: FakeCh) => c.statements.filter((s) => s.startsWith("INSERT INTO lab_review VALUES")).map((s) => {
  const parts = s.replace(/^INSERT INTO lab_review VALUES \(/, "").split(/,\s*/);
  return [parts[4].replace(/'/g, ""), Number(parts[2]), Number(parts[5])];
});

const OPEN: Review = { studyId: "st", reviewId: "st__review", baseVersion: 100, created: "2026-01-01 00:00:00", state: "open", approvedVersion: 0 };

test("a review copy's rows are the study's with the study id, the ids built on it and the study's name marked; copied back, unmarked", () => {
  const study = copyColumns("lab_study", "st", "st__review", 5);
  assert.ok(study.includes("concat(name, ' (review)') AS name"));
  assert.deepEqual(study.slice(-2), ["5 AS version", "0 AS is_deleted"]);
  const back = copyColumns("lab_study", "st__review", "st", 6);
  assert.ok(back.includes("if(endsWith(name, ' (review)'), substring(name, 1, length(name) - 9), name) AS name"));
  const list = copyColumns("lab_case_list", "st__review", "st", 6);
  assert.ok(list.includes("if(startsWith(list_id, 'st__review_'), concat('st_', substring(list_id, 12)), list_id) AS list_id"));
  // a name column outside lab_study is data, left alone
  assert.ok(copyColumns("lab_case_list", "st", "st__review", 1).includes("name"));
});

test("the latest version is the largest of any lab_ table's, deletion markers included", async () => {
  const { c } = database({ version: { st: 42 } });
  assert.equal(await latestVersion(c.conn, "st"), 42);
  const sql = c.statements.at(-1)!;
  for (const t of TABLES) assert.ok(sql.includes(`FROM ${t} WHERE study_id = 'st'`), t);
  assert.doesNotMatch(sql, /FINAL|is_deleted/);
  assert.equal(await studyExists(c.conn, "st"), true);
  assert.equal(await studyExists(c.conn, "other"), false);
});

test("a study's latest review is read back, or null when it never had one", async () => {
  const { c, state } = database();
  assert.equal(await latestReview(c.conn, "st"), null);
  assert.match(c.statements[0], /^CREATE TABLE IF NOT EXISTS lab_review /);
  state.review = OPEN;
  assert.deepEqual(await latestReview(c.conn, "st"), OPEN);
});

test("starting a review copies every lab_ table to <study>__review, merges it, and records the base version", async () => {
  const { c } = database({ version: { st: 777 } });
  const rv = await startReview(c.conn, "st");
  assert.deepEqual([rv.studyId, rv.reviewId, rv.state, rv.baseVersion, rv.approvedVersion], ["st", "st__review", "open", 777, 0]);
  assert.match(rv.created, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/);
  for (const t of TABLES) {
    const copy = c.statements.find((s) => s.startsWith(`INSERT INTO ${t} (`))!;
    assert.match(copy, /'st__review' AS study_id/, t);
    assert.ok(copy.includes(`FROM (SELECT * FROM ${t} FINAL WHERE study_id = 'st' AND is_deleted = 0)`), t + " copies only the live rows");
  }
  assert.ok(c.statements.some((s) => /FROM system\.parts/.test(s) && /partition = 'st__review'/.test(s)), "the copy's partitions are merged");
  assert.deepEqual(records(c), [["open", 777, 0]]);
});

test("a review is refused for a review copy, an unknown study, a study with one open, or when the copy's id is taken", async () => {
  await assert.rejects(startReview(database().c.conn, "st__review"), /st__review is itself a review copy/);
  ch!.restore();
  await assert.rejects(startReview(database({ studies: [] }).c.conn, "st"), /No study st in the lab_ tables/);
  ch!.restore();
  await assert.rejects(startReview(database({ review: OPEN }).c.conn, "st"), /st already has a review open \(st__review\); approve or reject it first/);
  ch!.restore();
  const { c } = database({ studies: ["st", "st__review"], review: { ...OPEN, state: "rejected" } });
  await assert.rejects(startReview(c.conn, "st"), /A study st__review already exists; remove it first/);
  assert.ok(!c.statements.some((s) => s.startsWith("INSERT")), "nothing is written by a refused review");
});

test("approval refuses while the live study has changed since the review began, listing the changes; force goes ahead", async () => {
  const { c } = database({ review: OPEN, version: { st: 150 }, changed: { lab_sample: { n: 2, s: ["S9", ""] }, lab_study: { n: 1, s: [] } } });
  const r = await approveReview(c.conn, "st");
  assert.deepEqual(r, { approved: false, changes: [{ table: "lab_study", rows: 1, samples: [] }, { table: "lab_sample", rows: 2, samples: ["S9"] }] });
  assert.ok(c.statements.some((s) => /FROM lab_sample WHERE study_id = 'st' AND version > 100/.test(s)), "changes are those after the review's base version");
  assert.ok(!c.statements.some((s) => /REPLACE PARTITION|DROP PARTITION/.test(s)));
  const forced = await approveReview(c.conn, "st", true);
  assert.equal(forced.approved, true);
});

test("approving builds side tables from the review, keeps the live study in <table>_previous, swaps partitions in, and drops the copy", async () => {
  // the review has no segments: its side table for them holds no partition
  const partitions = new Set(TABLES.flatMap((t) => [`${t}|st`, ...(t === "lab_segment" ? [] : [`${t}_approve_|st`])]));
  const { c } = database({ review: OPEN, partitions });
  const r = await approveReview(c.conn, "st");
  assert.equal(r.approved, true);
  const st = c.statements;
  const side = /CREATE TABLE (lab_sample_approve_\w+) AS lab_sample/.exec(st.join("\n"))![1];
  const at = (re: RegExp) => st.findIndex((s) => re.test(s));
  // every side table is filled and every previous copy made before the first swap into a live table
  const firstSwap = at(/^ALTER TABLE lab_\w+ REPLACE PARTITION 'st' FROM lab_\w+_approve_/);
  assert.ok(firstSwap > at(new RegExp("^INSERT INTO " + side)));
  assert.ok(st.slice(0, firstSwap).filter((s) => / REPLACE PARTITION 'st' FROM lab_\w+$/.test(s) && /_previous REPLACE/.test(s)).length === TABLES.length);
  const fill = st.find((s) => s.startsWith("INSERT INTO " + side))!;
  assert.match(fill, /'st' AS study_id/);
  assert.ok(fill.includes("FROM (SELECT * FROM lab_sample FINAL WHERE study_id = 'st__review' AND is_deleted = 0)"));
  assert.ok(st.includes(`OPTIMIZE TABLE ${side} PARTITION 'st' FINAL`));
  // a side table the review left empty empties the live table's partition
  assert.ok(st.includes("ALTER TABLE lab_segment DROP PARTITION 'st'"));
  for (const t of TABLES) {
    assert.ok(st.some((s) => new RegExp(`^DROP TABLE IF EXISTS ${t}_approve_`).test(s)), t + " side table dropped");
    assert.ok(st.includes(`ALTER TABLE ${t} DROP PARTITION 'st__review'`), t + " review copy dropped");
  }
  const [rec] = records(c);
  assert.equal(rec[0], "approved");
  assert.ok(Number(rec[2]) > 0, "the approval's version is recorded, for undo");
});

test("a failed approval still drops its side tables", async () => {
  const { c } = database({ review: OPEN });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.startsWith("CREATE TABLE IF NOT EXISTS lab_patient_previous")) return new Response("Code: 1. boom", { status: 500 });
    return realFetch(input as never, init);
  }) as typeof fetch;
  try {
    await assert.rejects(approveReview(c.conn, "st"), /boom/);
  } finally { globalThis.fetch = realFetch; }
  for (const t of TABLES) assert.ok(c.statements.some((s) => new RegExp(`^DROP TABLE IF EXISTS ${t}_approve_`).test(s)), t);
  assert.ok(!c.statements.some((s) => /DROP PARTITION 'st__review'/.test(s)), "the review copy is kept");
  assert.deepEqual(records(c), []);
});

test("approve and reject need an open review", async () => {
  const { c, state } = database();
  await assert.rejects(approveReview(c.conn, "st"), /st has no open review/);
  await assert.rejects(rejectReview(c.conn, "st"), /st has no open review/);
  state.review = { ...OPEN, state: "approved" };
  await assert.rejects(rejectReview(c.conn, "st"), /st has no open review/);
});

test("rejecting drops the review copy's partitions and records it, leaving the live study alone", async () => {
  const { c } = database({ review: OPEN });
  await rejectReview(c.conn, "st");
  assert.deepEqual(c.statements.filter((s) => /^ALTER TABLE/.test(s)), TABLES.map((t) => `ALTER TABLE ${t} DROP PARTITION 'st__review'`));
  assert.deepEqual(records(c), [["rejected", 100, 0]]);
});

test("undo puts back each table's previous partition, unless the study changed after the approval", async () => {
  const approved: Review = { ...OPEN, state: "approved", approvedVersion: 500 };
  const { c, state } = database({ review: approved, version: { st: 600 }, changed: { lab_mutation: { n: 4, s: ["S1"] } }, partitions: new Set(["lab_sample_previous|st"]) });
  const refused = await undoApproval(c.conn, "st");
  assert.deepEqual(refused, { undone: false, changes: [{ table: "lab_mutation", rows: 4, samples: ["S1"] }] });
  assert.ok(c.statements.some((s) => /version > 500/.test(s)), "changes are those after the approval");
  state.version.st = 500;
  assert.deepEqual(await undoApproval(c.conn, "st"), { undone: true });
  assert.ok(c.statements.includes("ALTER TABLE lab_sample REPLACE PARTITION 'st' FROM lab_sample_previous"));
  assert.ok(c.statements.includes("ALTER TABLE lab_mutation DROP PARTITION 'st'"), "a table with no previous partition had none before the approval");
  assert.deepEqual(records(c).at(-1), ["undone", 100, 500]);
});

test("undo needs the last review to be approved", async () => {
  const { c } = database({ review: { ...OPEN, state: "undone" } });
  await assert.rejects(undoApproval(c.conn, "st"), /st's last review was not approved; there is nothing to undo/);
});

test("the review diff lists tables with added, removed or changed rows, and the samples, attributes and profiles it adds", async () => {
  const { c } = database();
  c.answer(/SELECT greatest\(\(SELECT count\(\) FROM (\w+) WHERE/, (sql) => [{ n: /FROM lab_profile_value WHERE/.test(sql) ? 5_000_000 : 10 }]);
  c.answer(/countIf\(lk = 0\) AS a/, (sql) => {
    if (/FROM lab_sample FINAL/.test(sql)) return [{ a: 2, r: 1, c: 0 }];
    if (/FROM lab_profile_value FINAL/.test(sql)) return [{ a: 1, r: 0, c: 1 }];
    return [{ a: 0, r: 0, c: 0 }];
  });
  c.answer(/SELECT count\(\) AS n FROM \(SELECT sample_id AS x FROM lab_sample FINAL WHERE study_id = 'st__review'/, [{ n: 2 }]);
  c.answer(/SELECT count\(\) AS n FROM \(SELECT sample_id AS x FROM lab_sample FINAL WHERE study_id = 'st'/, [{ n: 1 }]);
  c.answer(/^SELECT sample_id AS x FROM lab_sample FINAL WHERE study_id = 'st__review'/, [{ x: "N1" }, { x: "N2" }]);
  c.answer(/^SELECT sample_id AS x FROM lab_sample FINAL WHERE study_id = 'st'/, [{ x: "OLD" }]);
  c.answer(/^SELECT attr_id AS x FROM lab_clinical_attribute/, [{ x: "NEW_ATTR" }]);
  c.answer(/AS x FROM lab_profile FINAL WHERE study_id = 'st__review'/, [{ x: "st_demo_expression" }]);
  const d = await diffReview(c.conn, "st");
  // lab_profile_value has 5M rows: compared in 3 slices, each slice's counts added
  assert.deepEqual(d.tables, [{ table: "lab_sample", added: 2, removed: 1, changed: 0 }, { table: "lab_profile_value", added: 3, removed: 0, changed: 3 }]);
  assert.equal(c.statements.filter((s) => /countIf\(lk = 0\)/.test(s) && /% 3 = /.test(s)).length, 3);
  assert.deepEqual([d.samplesAdded, d.samplesAddedCount, d.samplesRemoved, d.samplesRemovedCount], [["N1", "N2"], 2, ["OLD"], 1]);
  assert.deepEqual(d.attributesAdded, ["NEW_ATTR"]);
  assert.deepEqual(d.profilesAdded, ["st_demo_expression"]);
  // the review's rows are read as the live study's, so an unchanged row hashes equal
  const sampleDiff = c.statements.find((s) => /countIf\(lk = 0\)/.test(s) && /FROM lab_sample FINAL WHERE study_id = 'st__review'/.test(s))!;
  assert.match(sampleDiff, /'st' AS study_id/);
});

test("changedSince lists only tables with later rows, and their non-empty sample ids", async () => {
  const { c } = database({ changed: { lab_clinical: { n: 3, s: ["S1", "", "S2"] }, lab_clinical_attribute: { n: 1, s: [] } } });
  assert.deepEqual(await changedSince(c.conn, "st", 9), [
    { table: "lab_clinical", rows: 3, samples: ["S1", "S2"] }, { table: "lab_clinical_attribute", rows: 1, samples: [] },
  ]);
  assert.ok(c.statements.some((s) => /^SELECT count\(\) AS n, \[\] AS s\s+FROM lab_clinical_attribute /.test(s)), "a table without samples asks for none");
});
