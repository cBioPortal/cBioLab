// runAnalysis (lib/analysis.ts) on what it refuses and reports before any view draws: a document
// with no cohorts or past its limits; a view that names no cohorts, an unknown one, or a split
// whose base does not exist; an unknown view kind reported under its own name; an author's note
// carried onto its view; a split's arms evaluated and an empty "Other" arm dropped; each cohort's
// size the sum over its studies, counted by the caller's counter when one is given. The warehouse is
// a stand-in (setChTransport).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "testdb";
process.env.STUDY_ID = "st1";
process.env.ONCOKB_PIN = "v1";
// st2 is held aggregate-only: never asked for a patient id
process.env.AGGREGATE_ONLY_STUDIES = "st2";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "CH_RUN_CACHE", "LOOPBACK_PEER", "STUDY_DENY"]) delete process.env[k];

const { setChTransport } = await import("../lib/ch.ts");
const { runAnalysis } = await import("../lib/analysis.ts");
const { DOC_VERSION } = await import("../lib/doc-version.ts");
type Row = Record<string, unknown>;

let answers: [RegExp, Row[] | ((q: string) => Row[])][] = [];
const BASE: [RegExp, Row[]][] = [
  [/SELECT cancer_study_identifier AS id, name FROM testdb\.cancer_study/, [{ id: "st1", name: "Study one" }, { id: "st2", name: "Study two" }]],
];
setChTransport(async ({ query }) => {
  const hit = answers.find(([re]) => re.test(query)) ?? BASE.find(([re]) => re.test(query));
  const data = hit ? (typeof hit[1] === "function" ? hit[1](query) : hit[1]) : [];
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));
beforeEach(() => { answers = []; });
const on = (re: RegExp, rows: Row[] | ((q: string) => Row[])) => { answers.push([re, rows]); };

/** every cohort resolves to these (pid, sid) rows in each study */
const members = (rows: [string, string][]) => on(/^SELECT DISTINCT pid, sid FROM/, rows.map(([pid, sid]) => ({ pid, sid })));
/** the aggregate-only study's cohorts are counted, never resolved: 4 patients, 5 samples */
const counted = () => on(/AS patients/, [{ patients: 4, samples: 5 }]);

const doc = (o: Record<string, unknown>) => ({ dsl: DOC_VERSION, study: "st1", cohorts: { A: { all: [] } }, views: [], ...o }) as never;

describe("documents refused outright", () => {
  test("no cohorts", async () => {
    await assert.rejects(runAnalysis(doc({ cohorts: {} })), /document has no cohorts/);
  });
  test("more than 16 cohorts, or 6 views, named with the limit", async () => {
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => ["C" + i, { all: [] }]));
    await assert.rejects(runAnalysis(doc({ cohorts: many })), /at most 16 cohorts/);
    const views = Array.from({ length: 7 }, () => ({ kind: "clinical", cohorts: ["A"] }));
    await assert.rejects(runAnalysis(doc({ views })), /at most 6 views/);
  });
  test("an unknown study", async () => {
    await assert.rejects(runAnalysis(doc({ study: "nowhere" })), /unknown study 'nowhere'/);
  });
});

describe("views refused before they draw", () => {
  test("each refusal says what is wrong and names what the document has; a note stays with its view", async () => {
    members([["P1", "S1"], ["P1", "S2"], ["P2", "S3"]]);
    counted();
    const r = await runAnalysis(doc({
      cohorts: { A: { all: [] }, B: { study: "st2", all: [] } },
      views: [
        { kind: "no-such-kind", note: "  why this view  " },
        { kind: "no-such-kind", cohorts: ["Z"] },
        { kind: "no-such-kind", cohorts: ["Y", "Z"] },
        { kind: "no-such-kind", splitBy: { cohort: "Z", gene: "TP53" } },
        { kind: "no-such-kind", cohorts: ["A"], note: "   " },
      ],
    }));
    const [none, one, two, split, unknown] = r.views;
    assert.match(none.error!, /this view names no cohorts — list the ones it draws in its `cohorts` \(this document has “A”, “B”\)/);
    assert.equal(none.annotationNote, "why this view");
    assert.match(one.error!, /this view names “Z”, which is not a cohort in this document/);
    assert.match(two.error!, /this view names “Y”, “Z”, which are not cohorts in this document/);
    assert.match(split.error!, /splitBy names cohort “Z”, which doesn't exist/);
    assert.deepEqual([unknown.kind, unknown.error], ["no-such-kind", "unknown view kind"]);
    assert.equal(unknown.annotationNote, undefined, "a blank note is not a note");

    assert.deepEqual(r.cohorts.A.studies, ["st1"]);
    assert.deepEqual([r.cohorts.A.count, r.cohorts.A.samples], [2, 3]);
    assert.match(r.cohorts.B.text, / — in st2$/, "a cohort outside the document's study says where it is");
    assert.deepEqual(r.involvedStudies.sort(), ["st1", "st2"]);
    assert.equal(r.oncokbPin, "v1");
  });

  test("a cohort over several studies is the sum of each study's count, and its SQL says overlap is not deduplicated", async () => {
    members([["P1", "S1"]]);
    counted();
    const r = await runAnalysis(doc({ cohorts: { A: { studies: ["st1", "st2"], all: [] } } }));
    assert.deepEqual([r.cohorts.A.count, r.cohorts.A.samples], [1 + 4, 1 + 5]);
    assert.match(r.cohorts.A.text, / — across 2 studies$/);
    assert.match(r.cohorts.A.sql, /^-- st1\n[\s\S]*the counts are ADDED; patient and sample overlap across studies is not deduplicated[\s\S]*-- st2\n/);
  });
});

describe("a view split by a gene or OQL", () => {
  test("its arms are evaluated as cohorts, and an empty Other arm is dropped", async () => {
    // every arm resolves to one sample, except the arm OQL's Other condition picks out
    on(/^SELECT DISTINCT pid, sid FROM/, (q) => /EXCEPT DISTINCT/.test(q) ? [] : [{ pid: "P1", sid: "S1" }]);
    const r = await runAnalysis(doc({ views: [{ kind: "no-such-kind", splitBy: { cohort: "A", oql: ["TP53: MUT", "KRAS: MUT"] } }] }));
    const v = r.views[0];
    assert.equal(v.error, "unknown view kind");
    assert.deepEqual(v.splitBy!.oql, ["TP53: MUT", "KRAS: MUT"]);
    assert.equal(v.splitBy!.cohort, "A");
    assert.ok(v.splitBy!.arms.length >= 2);
    assert.ok(v.splitBy!.arms.every((a) => a.count === 1 && /^-- st1\n/.test(a.sql)));
    assert.equal(v.splitBy!.arms.length, 2, "the Other arm, empty, is dropped");
    assert.equal(v.splitBy!.overlapCount, 1, "the one sample in both arms is disclosed, not left for the reader to find");
    assert.deepEqual(Object.keys(r.cohorts), ["A"], "arms are not document cohorts");
  });

  test("a gene split gives two arms, mutated and not", async () => {
    members([["P1", "S1"]]);
    const r = await runAnalysis(doc({ views: [{ kind: "no-such-kind", splitBy: { cohort: "A", gene: "TP53" } }] }));
    assert.equal(r.views[0].splitBy!.gene, "TP53");
    assert.equal(r.views[0].splitBy!.arms.length, 2);
  });

  test("a split that cannot be resolved is the view's error, not the run's", async () => {
    members([["P1", "S1"]]);
    const r = await runAnalysis(doc({ views: [{ kind: "no-such-kind", splitBy: { cohort: "A" } }] }));
    assert.ok(r.views[0].error);
  });
});

describe("counting", () => {
  test("an aggregate-only study's cohort is counted by the caller's counter, patients and samples", async () => {
    members([["P1", "S1"]]);
    const asked: string[] = [];
    const count = async (_conn: unknown, sql: string) => { asked.push(sql); return /^SELECT DISTINCT pid FROM/.test(sql) ? 7 : 9; };
    const r = await runAnalysis(doc({ cohorts: { A: { all: [] }, B: { study: "st2", all: [] } } }), { count });
    assert.deepEqual([r.cohorts.B.count, r.cohorts.B.samples], [7, 9]);
    assert.deepEqual([r.cohorts.A.count, r.cohorts.A.samples], [1, 1], "a patient-level study is resolved to its rows instead");
    assert.equal(asked.length, 2);
  });
});
