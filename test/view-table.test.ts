// The clinical data table view (lib/views/table/run.ts), driven with hand-made participants whose
// attributes and rows live in memory: what it refuses, which columns it holds, and the rows,
// position and caveat it returns.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runTable } from "../lib/views/table/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { TableQuery } from "../lib/table-query.ts";
import type { TableView, TableResult } from "../lib/views/table/types.ts";

type Row = Record<string, unknown>;
type Meta = { id: string; name?: string; patient: 0 | 1; datatype: "STRING" | "NUMBER" };
const base = (label: string) => label.replace(/:(rows|counts|values|rank)$/, "");

/**
 * A patient-level participant in database `conn` with clinical attributes `meta` and `rows` (each
 * with its cohort, study, patient, sample and attribute map `m`). A row marked `_out` counts in `all`
 * but is not kept, as if the query's filter dropped it. Every SQL builder it is handed is called.
 */
function local(conn: string, meta: Meta[], rows: Row[], opts: { fail?: string } = {}) {
  const asked: string[] = [];
  const kept = () => rows.filter((r) => !r._out);
  return {
    asked,
    instance: { id: conn, mode: "patient-level", label: conn, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    viewMeta: async (l: string, build: (study: string, db: string) => unknown) => { build("s", conn); asked.push(l); return meta; },
    rowsPage: async (l: string, source: (db: string) => unknown, _q: TableQuery, _d: string[], limit: number, offset: number) => {
      source(conn); asked.push(base(l) + ":rows");
      if (opts.fail) throw new Error(opts.fail);
      return { rows: kept().slice(offset, offset + limit), total: kept().length };
    },
    rowsCounts: async (l: string, source: (db: string) => unknown) => {
      source(conn); asked.push(l);
      const m = new Map<string, { cohort: string; study: string; n: number; all: number }>();
      for (const r of rows) {
        const k = r.cohort + "|" + r.study;
        const c = m.get(k) || { cohort: String(r.cohort), study: String(r.study), n: 0, all: 0 };
        c.all++; if (!r._out) c.n++;
        m.set(k, c);
      }
      return [...m.values()];
    },
    rowsValues: async (l: string, source: (db: string) => unknown, _q: TableQuery, _d: string[], column: string) => {
      source(conn); asked.push(l);
      const xs = kept().map((r) => Number((r.m as Row)[column]));
      return [{ n: xs.length, lo: Math.min(...xs), hi: Math.max(...xs) }];
    },
    rowsRank: async (l: string, source: (db: string) => unknown, _q: TableQuery, _d: string[], study: string, patient: string) => {
      source(conn); asked.push(l);
      const i = kept().findIndex((r) => r.study === study && r.patient === patient);
      return i < 0 ? null : i;
    },
  };
}
const aggregate = () => ({ instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: { id: "agg" } } });

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "", count: n, samples: n, mode: "" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>, extra: Partial<ViewRun> = {}): ViewRun {
  const vNames = Object.keys(cohorts);
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies: [...new Set(vNames.flatMap((n) => cohorts[n].studies))],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }), ...extra,
  };
}
const run = (view: Partial<TableView>, c: ViewRun) => runTable({ kind: "table", ...view } as TableView, c);
const tableOf = (v: ViewResult) => (v as ViewResult & { table: TableResult }).table;

// One study: patient attribute AGE (numeric), sample attribute ST (text). P1 has two samples, P2 one.
const META: Meta[] = [{ id: "AGE", name: "Age", patient: 1, datatype: "NUMBER" }, { id: "ST", patient: 0, datatype: "STRING" }];
const SAMPLE_ROWS: Row[] = [
  { cohort: "A", study: "s1", patient: "P1", sample: "S1a", m: { AGE: "61", ST: "Primary" } },
  { cohort: "A", study: "s1", patient: "P1", sample: "S1b", m: { AGE: "61", ST: "Metastasis" } },
  { cohort: "A", study: "s1", patient: "P2", sample: "S2", m: { AGE: "47" } },
];
const PATIENT_ROWS: Row[] = [
  { cohort: "A", study: "s1", patient: "P1", samples: 2, m: { AGE: "61" } },
  { cohort: "A", study: "s1", patient: "P2", samples: 1, m: { AGE: "47" } },
  { cohort: "A", study: "s1", patient: "P3", samples: 1, m: {} },
];
const one = (rows = SAMPLE_ROWS, extra: Partial<ViewRun> = {}) => ctx({ A: cohort({ s1: 2 }) }, { s1: local("db1", META, rows) }, extra);

describe("table: what it refuses", () => {
  test("more than 6 cohorts", async () => {
    const cs = Object.fromEntries(Array.from({ length: 7 }, (_, i) => ["C" + i, cohort({ s1: 1 })]));
    assert.match((await run({}, ctx(cs, { s1: local("db1", META, []) }))).error!, /at most 6 cohorts/);
  });

  test("a page size outside 1 to 1000", async () => {
    for (const rows of [0, 1001, Number.NaN]) assert.match((await run({ rows }, one())).error!, /rows \(the page size\) is 1 to 1000/);
  });

  test("a column id that is not an attribute name, naming the id columns of its unit", async () => {
    assert.match((await run({ columns: ["no spaces allowed"] }, one())).error!, /column ids: patient, sample and clinical attribute ids/);
    assert.match((await run({ unit: "patient", columns: [42 as never] }, one())).error!, /column ids: patient, samples and clinical attribute ids/);
  });

  test("no study that may disclose rows: each named with its reason", async () => {
    const v = await run({}, ctx({ A: cohort({ agg: 3 }) }, { agg: aggregate() }));
    assert.equal(v.error, "no study here may disclose patients' rows (agg: aggregate-only: it does not disclose patients)");
  });

  test("a named patient needs a per-patient list, a {study, id}, a study the cohorts span, and one that may disclose it", async () => {
    const two = ctx({ A: cohort({ s1: 2, agg: 1 }) }, { s1: local("db1", META, SAMPLE_ROWS), agg: aggregate() });
    assert.match((await run({ patient: { study: "s1", id: "P1" } }, two)).error!, /needs unit "patient"/);
    assert.equal((await run({ unit: "patient", patient: { study: "s1" } as never }, two)).error, "patient is {study, id}");
    assert.match((await run({ unit: "patient", patient: { study: "s9", id: "P1" } }, two)).error!, /named in s9, which none of this view's cohorts span \(s1, agg\)/);
    assert.equal((await run({ unit: "patient", patient: { study: "agg", id: "P1" } }, two)).error,
      "agg is aggregate-only: it does not disclose patients, so its patients cannot be listed");
  });

  test("an unknown column, filter or sort column is refused by the query check", async () => {
    assert.match((await run({ sort: { column: "NOPE" } }, one())).error!, /sort\.column NOPE is not a column/);
    assert.match((await run({ columns: ["NOPE"] }, one())).error!, /unknown column NOPE/);
  });

  test("a sample attribute in a per-patient table is named as such", async () => {
    assert.equal((await run({ unit: "patient", columns: ["patient", "ST"] }, one(PATIENT_ROWS))).error,
      "ST is a sample attribute; a per-patient table holds patient attributes only");
    assert.equal((await run({ unit: "patient", sort: { column: "ST" } }, one(PATIENT_ROWS))).error,
      "ST is a sample attribute; a per-patient table holds patient attributes only");
  });

  test("a failing row query is refused with its message, not thrown", async () => {
    const v = await run({}, ctx({ A: cohort({ s1: 2 }) }, { s1: local("db1", META, SAMPLE_ROWS, { fail: "too many rows" }) }));
    assert.equal(v.error, "too many rows");
  });
});

describe("table: rows per sample (the default)", () => {
  test("every sample with its patient's attributes, values aligned to the columns, blank where none was recorded", async () => {
    const v = await run({}, one());
    assert.equal(v.error, undefined);
    const t = tableOf(v);
    assert.equal(t.unit, "sample");
    assert.deepEqual(t.columns.map((c) => c.id), ["patient", "sample", "AGE", "ST"]);
    assert.deepEqual(t.columns.map((c) => c.numeric), [false, false, true, false], "NUMBER attributes are numeric");
    assert.equal(t.columns[3].name, "ST", "an attribute without a name is named by its id");
    assert.deepEqual(t.defaults, ["patient", "sample", "AGE", "ST"], "every column is shown by default");
    assert.deepEqual(t.rows.map((r) => r.values), [["P1", "S1a", "61", "Primary"], ["P1", "S1b", "61", "Metastasis"], ["P2", "S2", "47", ""]]);
    assert.deepEqual([t.total, t.all, t.offset, t.pageSize], [3, 3, 0, 25]);
    assert.equal(t.position, undefined);
    assert.ok(v.method, "a full answer carries its method record");
    assert.match(v.caveat!, /^One row per sample of each cohort's patients, carrying its patient's attributes too, with 2 attributes as each study recorded them — vocabularies are not harmonized across studies\. 3 samples\. Sorted by patient and sample id across the cohort;/);
    assert.equal(v.studies, undefined, "one study: no study list");
    assert.equal(v.participation!.requiresPatientLevel, true);
  });

  test("an attribute two databases both record is one column; two studies list both and name the databases", async () => {
    const d1 = local("db1", META, SAMPLE_ROWS);
    const d2 = local("db2", [{ id: "AGE", name: "Age (other)", patient: 1, datatype: "NUMBER" }, { id: "GRADE", patient: 1, datatype: "STRING" }],
      [{ cohort: "A", study: "s2", patient: "Q1", sample: "T1", m: { GRADE: "2" } }]);
    const v = await run({ rows: 2 }, ctx({ A: cohort({ s1: 2, s2: 1 }) }, { s1: d1, s2: d2 }));
    const t = tableOf(v);
    assert.deepEqual(t.columns.map((c) => c.id), ["patient", "sample", "AGE", "ST", "GRADE"]);
    assert.equal(t.columns[2].name, "Age", "the first study's description wins");
    assert.deepEqual(t.rows.map((r) => r.sample), ["S1a", "S1b"], "a page of 2 from the first database");
    assert.equal(t.total, 4);
    assert.equal(t.instances, 2);
    assert.deepEqual(v.studies, ["s1", "s2"]);
    assert.match(v.caveat!, /These studies live in 2 separate databases/);
  });

  test("an aggregate-only study is named as left out, with its patients", async () => {
    const v = await run({}, ctx({ A: cohort({ s1: 2, agg: 5 }) }, { s1: local("db1", META, SAMPLE_ROWS), agg: aggregate() }));
    assert.deepEqual(tableOf(v).excluded, [{ study: "agg", reason: "aggregate-only: it does not disclose patients", patients: 5 }]);
    assert.match(v.caveat!, /Left out: agg \(aggregate-only: it does not disclose patients; 5 patients in these cohorts\)\.$/);
  });

  test("a sorted, filtered query is described in the caveat by the column's name", async () => {
    const rows = [...SAMPLE_ROWS, { cohort: "A", study: "s1", patient: "P9", sample: "S9", m: {}, _out: true }];
    const v = await run({ sort: { column: "AGE", desc: true }, filters: { ST: { op: "contains", value: "Pri" } } } as never, one(rows));
    assert.match(v.caveat!, /Showing 3 of 4 samples: rows ST contains “Pri”\. Sorted by Age \(highest first\), missing values last,/);
  });

  test("a page asked for returns the table alone: no method, no caveat", async () => {
    const v = await run({}, one(SAMPLE_ROWS, { page: { offset: 1, limit: 1 } }));
    assert.deepEqual(tableOf(v).rows.map((r) => r.sample), ["S1b"]);
    assert.equal(v.method, undefined);
    assert.equal(v.caveat, undefined);
  });

  test("a numeric column's values: its range and count, read as numeric because the study declares it NUMBER", async () => {
    const v = await run({}, one(SAMPLE_ROWS, { values: "AGE" }));
    assert.deepEqual(tableOf(v).values, { column: "AGE", numeric: true, min: 47, max: 61, n: 3 });
    assert.equal(v.method, undefined);
  });
});

describe("table: rows per patient", () => {
  test("patient attributes only, with the samples count as a column", async () => {
    const t = tableOf(await run({ unit: "patient" }, one(PATIENT_ROWS)));
    assert.deepEqual(t.columns.map((c) => c.id), ["patient", "samples", "AGE"]);
    assert.deepEqual(t.rows.map((r) => r.values), [["P1", "2", "61"], ["P2", "1", "47"], ["P3", "1", ""]]);
  });

  test("a named patient is placed in the list's order with the patients either side", async () => {
    const t = tableOf(await run({ unit: "patient", patient: { study: "s1", id: "P2" } }, one(PATIENT_ROWS)));
    assert.deepEqual(t.position, { index: 1, prev: { study: "s1", id: "P1" }, next: { study: "s1", id: "P3" } });
  });

  test("a named patient the list leaves out has position null", async () => {
    const t = tableOf(await run({ unit: "patient", patient: { study: "s1", id: "P7" } }, one(PATIENT_ROWS)));
    assert.equal(t.position, null);
  });

  test("a page request with a named patient does not locate it", async () => {
    const t = tableOf(await run({ unit: "patient", patient: { study: "s1", id: "P2" } }, one(PATIENT_ROWS, { page: { offset: 0, limit: 5 } })));
    assert.equal(t.position, undefined);
  });
});

describe("table: more attributes than a table carries", () => {
  test("past 200, the ones the query names come first and the caveat says how many of how many", async () => {
    const meta: Meta[] = Array.from({ length: 205 }, (_, i) => ({ id: "A" + String(i).padStart(3, "0"), patient: 1, datatype: "STRING" }));
    const v = await run({ sort: { column: "A204" } }, ctx({ A: cohort({ s1: 1 }) }, { s1: local("db1", meta, [{ cohort: "A", study: "s1", patient: "P1", sample: "S1", m: {} }]) }));
    const t = tableOf(v);
    assert.equal(t.columns.length, 2 + 200);
    assert.equal(t.columns[2].id, "A204", "the sort column is held though it is past the cap");
    assert.ok(!t.columns.some((c) => c.id === "A199"), "the rest are cut at the cap");
    assert.match(v.caveat!, /with 200 attributes as each study recorded them \(of 205; name others in columns\)/);
  });
});
