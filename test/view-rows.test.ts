// What the table views share (lib/views/rows.ts): who may hand over rows, how a page is taken across
// several databases in one order, a column's values, a patient's place in the list, and the words a
// table's caveat ends with. Driven with hand-made participants whose rows live in memory.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rowHolders, runRows, viewQuery, tableTail, listPosition, pagedTable, type Rows } from "../lib/views/rows.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { TableQuery } from "../lib/table-query.ts";

type Row = Record<string, unknown>;
const base = (label: string) => label.replace(/:(rows|counts|values|rank)$/, "");

/**
 * A patient-level participant in database `conn`, holding `rows` (each with its cohort and study) per
 * table label. A row marked `_out` counts in `all` but is not kept, as if the query's filter dropped it.
 * Every row source it is handed is built, so the view's own source code runs.
 */
function local(conn: string, rows: Record<string, Row[]>, label = conn) {
  const asked: { label: string; limit?: number; offset?: number }[] = [];
  const kept = (l: string) => (rows[base(l)] || []).filter((r) => !r._out);
  return {
    asked,
    instance: { id: conn, mode: "patient-level", label, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    rowsPage: async (l: string, source: (db: string) => unknown, _q: TableQuery, _d: string[], limit: number, offset: number) => {
      source(conn); asked.push({ label: l, limit, offset });
      return { rows: kept(l).slice(offset, offset + limit), total: kept(l).length };
    },
    rowsCounts: async (l: string, source: (db: string) => unknown) => {
      source(conn); asked.push({ label: l });
      const m = new Map<string, { cohort: string; study: string; n: number; all: number }>();
      for (const r of rows[base(l)] || []) {
        const k = r.cohort + "|" + r.study;
        const c = m.get(k) || { cohort: String(r.cohort), study: String(r.study), n: 0, all: 0 };
        c.all++; if (!r._out) c.n++;
        m.set(k, c);
      }
      return [...m.values()];
    },
    rowsValues: async (l: string, source: (db: string) => unknown, _q: TableQuery, _d: string[], column: string) => {
      source(conn); asked.push({ label: l });
      const m = new Map<string, number>();
      for (const r of kept(l)) m.set(String(r[column]), (m.get(String(r[column])) || 0) + 1);
      return [...m].map(([v, n]) => ({ v, n }));
    },
    rowsRank: async (l: string, source: (db: string) => unknown, _q: TableQuery, _d: string[], study: string, patient: string) => {
      source(conn); asked.push({ label: l });
      const i = kept(l).findIndex((r) => r.study === study && r.patient === patient);
      return i < 0 ? null : i;
    },
  };
}
const aggregate = (id = "agg") => ({ instance: { id, mode: "aggregate-only", label: id, conn: { id } } });

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
const pts = (cohort: string, study: string, ids: string[], extra: Row = {}) => ids.map((patient) => ({ cohort, study, patient, ...extra }));
const source = () => () => ({}) as never;

describe("rowHolders: who may hand over rows", () => {
  test("patient-level participants hold rows; every other study is named with a reason and its patients in these cohorts", () => {
    const c = ctx({ A: cohort({ s1: 2, agg: 3, p: 4 }), B: cohort({ agg: 5 }) },
      { s1: local("db1", {}), agg: aggregate(), p: { instance: { id: "peer", mode: "aggregate-only", label: "Peer", conn: { id: "peer" } } } });
    const { holders, excluded, viaPeer } = rowHolders(c);
    assert.deepEqual(holders, ["s1"]);
    assert.deepEqual(viaPeer, []);
    assert.deepEqual(excluded, [
      { study: "agg", reason: "aggregate-only: it does not disclose patients", patients: 8 },
      { study: "p", reason: "a remote peer, which does not disclose patients", patients: 4 },
    ]);
  });

  test("a peer holds a kind's rows only when its rules name that kind; otherwise it is named as not accepted for that kind", () => {
    const peer = (kinds: string[]) => ({ instance: { id: "peer", mode: "aggregate-only", label: "Peer", conn: { id: "peer" } },
      peerUrl: "http://peer.invalid", patientKinds: new Set(kinds), patientRows: async () => ({}) });
    const c = ctx({ A: cohort({ p1: 1, p2: 2 }) }, { p1: peer(["alterations"]), p2: peer(["timeline"]) });
    const r = rowHolders(c, "alterations");
    assert.deepEqual(r.holders, ["p1"]);
    assert.deepEqual(r.viaPeer, ["p1"]);
    assert.deepEqual(r.excluded, [{ study: "p2", reason: "a remote peer this instance does not accept patient alterations from", patients: 2 }]);
    assert.deepEqual(rowHolders(c).holders, [], "with no kind named, a peer never holds rows");
  });
});

describe("runRows: one order across databases", () => {
  // db1 holds cohort A's s1 patients a1..a3 (and one row a filter drops); db2 holds A's s2 patients b1, b2.
  const two = () => {
    const d1 = local("db1", { t: [...pts("A", "s1", ["a1", "a2", "a3"]), ...pts("A", "s1", ["x"], { _out: true })] });
    const d2 = local("db2", { t: pts("A", "s2", ["b1", "b2"]) });
    return { d1, d2, c: (extra: Partial<ViewRun> = {}) => ctx({ A: cohort({ s1: 4, s2: 2 }) }, { s1: d1, s2: d2 }, extra) };
  };

  test("the first page walks the databases in turn: db1's three rows, then db2's first; totals add up, the dropped row counts only in all", async () => {
    const { c } = two();
    const r = await runRows(c(), "t", ["s1", "s2"], {}, ["patient"], ["patient"], 4, source);
    assert.deepEqual(r.rows.map((x) => x.patient), ["a1", "a2", "a3", "b1"]);
    assert.equal(r.total, 5);
    assert.equal(r.all, 6);
    assert.equal(r.groups, 2);
    assert.equal(r.offset, 0);
    assert.equal(r.position, undefined, "no locate, no position");
    assert.deepEqual(r.lists, [{ cohort: "A", study: "s1", total: 3, all: 4 }, { cohort: "A", study: "s2", total: 2, all: 2 }]);
  });

  test("a page past the first database skips it without asking it for rows", async () => {
    const { c, d1, d2 } = two();
    const r = await runRows(c({ page: { offset: 3.7, limit: 10 } }), "t", ["s1", "s2"], {}, [], [], 4, source);
    assert.deepEqual(r.rows.map((x) => x.patient), ["b1", "b2"]);
    assert.equal(r.offset, 3, "the offset is floored");
    assert.equal(d1.asked.filter((a) => a.label === "t:rows").length, 0);
    assert.deepEqual(d2.asked.filter((a) => a.label === "t:rows").map((a) => a.offset), [0]);
  });

  test("a page whose limit is reached in the first database never asks the second", async () => {
    const { c, d2 } = two();
    const r = await runRows(c({ page: { offset: -5, limit: 0 } }), "t", ["s1", "s2"], {}, [], [], 4, source);
    assert.equal(r.offset, 0, "a negative offset is read as 0");
    assert.deepEqual(r.rows.map((x) => x.patient), ["a1"], "a limit below 1 is read as 1");
    assert.equal(d2.asked.filter((a) => a.label === "t:rows").length, 0);
  });

  test("a study not among the holders is not asked at all", async () => {
    const { c, d2 } = two();
    const r = await runRows(c(), "t", ["s1"], {}, [], [], 10, source);
    assert.equal(r.total, 3);
    assert.equal(r.groups, 1);
    assert.equal(d2.asked.length, 0);
  });

  test("two studies in one database form one group, sorted together", async () => {
    const d = local("db1", { t: [...pts("A", "s1", ["a1"]), ...pts("A", "s2", ["b1", "b2"])] });
    const r = await runRows(ctx({ A: cohort({ s1: 1, s2: 2 }) }, { s1: d, s2: d }), "t", ["s1", "s2"], {}, [], [], 10, source);
    assert.equal(r.groups, 1);
    assert.equal(r.total, 3);
    assert.equal(d.asked.filter((a) => a.label === "t:counts").length, 1, "one count query for the database");
  });

  test("a column's values, merged across databases, instead of rows", async () => {
    const d1 = local("db1", { t: [...pts("A", "s1", ["a1", "a2"], { CT: "Lung" }), ...pts("A", "s1", ["a3"], { CT: "Breast" })] });
    const d2 = local("db2", { t: pts("A", "s2", ["b1"], { CT: "Breast" }) });
    const r = await runRows(ctx({ A: cohort({ s1: 3, s2: 1 }) }, { s1: d1, s2: d2 }), "t", ["s1", "s2"], {}, [], [], 10, source, { column: "CT", numeric: false });
    assert.deepEqual(r.rows, []);
    assert.equal(r.groups, 2);
    assert.deepEqual(r.values, { column: "CT", numeric: false, values: [{ value: "Breast", n: 2 }, { value: "Lung", n: 2 }], truncated: false });
  });

  describe("locate: a patient's place in the order", () => {
    test("in the second database: its index counts every row before it, with the rows either side", async () => {
      const { c } = two();
      const r = await runRows(c(), "t", ["s1", "s2"], {}, [], ["patient"], 2, source, undefined, undefined, { study: "s2", patient: "b1" });
      assert.deepEqual(r.position && { index: r.position.index, prev: r.position.prev?.patient, next: r.position.next?.patient }, { index: 3, prev: "a3", next: "b2" });
    });

    test("first in the list: no previous; last: no next", async () => {
      const { c } = two();
      const first = await runRows(c(), "t", ["s1", "s2"], {}, [], [], 2, source, undefined, undefined, { study: "s1", patient: "a1" });
      assert.deepEqual({ index: first.position!.index, prev: first.position!.prev, next: first.position!.next?.patient }, { index: 0, prev: null, next: "a2" });
      const last = await runRows(c(), "t", ["s1", "s2"], {}, [], [], 2, source, undefined, undefined, { study: "s2", patient: "b2" });
      assert.deepEqual({ index: last.position!.index, prev: last.position!.prev?.patient, next: last.position!.next }, { index: 4, prev: "b1", next: null });
    });

    test("a patient the query leaves out is placed nowhere: null", async () => {
      const { c } = two();
      const r = await runRows(c(), "t", ["s1", "s2"], {}, [], [], 2, source, undefined, undefined, { study: "s1", patient: "x" });
      assert.equal(r.position, null);
    });
  });

  describe("a peer that pages its own rows", () => {
    test("every mode goes to the peer as one request carrying the definitions and the table's subject, scope and pin", async () => {
      const reqs: Record<string, unknown>[] = [];
      const answers: unknown[] = [];
      const peerRows = pts("A", "p", ["r1", "r2", "r3"]);
      const peer = {
        instance: { id: "peer", mode: "aggregate-only", label: "Peer", conn: { id: "peer" } }, peerUrl: "http://peer.invalid", patientKinds: new Set(["alterations"]),
        patientRows: async (req: Record<string, unknown>) => {
          reqs.push(req);
          switch (req.mode) {
            case "counts": return { counts: [{ cohort: "A", study: "p", n: 3, all: 3 }], oncokbPin: "v9" };
            case "page": return { rows: peerRows.slice(Number(req.offset), Number(req.offset) + Number(req.limit)) };
            case "rank": return { rank: 1 };
            default: return { values: [{ v: "x", n: 3 }] };
          }
        },
      };
      const c = ctx({ A: cohort({ p: 3 }) }, { p: peer });
      const remote = { of: (r: unknown) => (r === peer ? peer : null), table: "alterations" as const, subject: { patient: "r1" }, samples: "cohort" as const, oncokbPin: "v1",
        onAnswer: (a: unknown) => answers.push(a) };
      const r = await runRows(c, "alterations", ["p"], {}, [], [], 2, source, undefined, remote as never, { study: "p", patient: "r2" });
      assert.deepEqual(r.rows.map((x) => x.patient), ["r1", "r2"]);
      assert.equal(r.total, 3);
      assert.deepEqual(r.position && { index: r.position.index, prev: r.position.prev?.patient, next: r.position.next?.patient }, { index: 1, prev: "r1", next: "r3" });
      assert.ok(reqs.every((q) => q.table === "alterations" && q.samples === "cohort" && q.oncokbPin === "v1" && (q.subject as { patient: string }).patient === "r1"));
      assert.deepEqual((reqs[0].parts as { cohort: string; def: unknown }[]), [{ cohort: "A", def: { study: "p" } }], "definitions travel, not SQL");
      assert.equal(answers.length, reqs.length, "every answer is reported");
      const v = await runRows(c, "alterations", ["p"], {}, [], [], 2, source, { column: "gene", numeric: false }, { of: () => peer, table: "alterations" } as never);
      assert.deepEqual(v.values, { column: "gene", numeric: false, values: [{ value: "x", n: 3 }], truncated: false });
      assert.equal(reqs.at(-1)!.column, "gene");
      assert.equal("subject" in reqs.at(-1)!, false, "no subject, no pin, no scope when the view gives none");
    });

    test("a peer's empty answers read as no rows, no counts, no values and no rank", async () => {
      const peer = { instance: { id: "peer", mode: "aggregate-only", label: "Peer", conn: { id: "peer" } }, peerUrl: "u", patientKinds: new Set(["alterations"]), patientRows: async () => ({}) };
      const c = ctx({ A: cohort({ p: 3 }) }, { p: peer });
      const r = await runRows(c, "x", ["p"], {}, [], [], 2, source, undefined, { of: () => peer, table: "alterations" } as never, { study: "p", patient: "r" });
      assert.deepEqual([r.rows, r.total, r.all, r.position], [[], 0, 0, null]);
      const v = await runRows(c, "x", ["p"], {}, [], [], 2, source, { column: "c", numeric: true }, { of: () => peer, table: "alterations" } as never);
      assert.deepEqual(v.values, { column: "c", numeric: true, min: null, max: null, n: 0 });
    });
  });
});

describe("viewQuery: the query as the document gives it", () => {
  test("older spellings attributes and sort.attribute are read as columns and sort.column; empty parts are dropped", () => {
    assert.deepEqual(viewQuery({ attributes: ["AGE"], sort: { attribute: "AGE", desc: true }, search: "  ", filters: {} } as never),
      { columns: ["AGE"], sort: { column: "AGE", desc: true } });
    assert.deepEqual(viewQuery({ columns: ["X"], attributes: ["AGE"], sort: { column: "X" }, search: "kras" } as never),
      { columns: ["X"], search: "kras", sort: { column: "X" } }, "columns wins over attributes; no desc unless asked");
    assert.deepEqual(viewQuery({ sort: {} } as never), {}, "a sort without a column is no sort");
  });
});

describe("tableTail: the words a table's caveat ends with", () => {
  const cols = [{ id: "patient", name: "Patient ID" }, { id: "AGE", name: "Age" }];
  const rows = (o: Partial<Rows>): Rows => ({ rows: [], lists: [{ cohort: "A", study: "s1", total: 0, all: 0 }], total: 3, all: 3, offset: 0, groups: 1, ...o });

  test("no query, one list, one database: the count, the default order, nobody left out", () => {
    assert.equal(tableTail(rows({}), {}, cols, "patient", "by patient id", [], false),
      "3 patients. Sorted by patient id across the cohort; every page is a slice of that one order, and the download holds every row kept, with every column. ");
  });

  test("a filtered, sorted query over two databases and two cohorts, with a study left out", () => {
    const t = tableTail(rows({ total: 1, all: 4, groups: 2, lists: [{ cohort: "A", study: "s1", total: 1, all: 2 }, { cohort: "B", study: "s1", total: 0, all: 2 }] }),
      { search: "lung", sort: { column: "AGE", desc: true } }, cols, "sample", "by id", [{ study: "agg", reason: "aggregate-only", patients: 1 }], true);
    assert.match(t, /^Showing 1 of 4 samples: rows containing “lung” in a shown column\. /);
    assert.match(t, /Sorted by Age \(highest first\), missing values last, across every cohort and study together;/);
    assert.match(t, /These studies live in 2 separate databases/);
    assert.match(t, /A patient in two cohorts is listed under each\. /);
    assert.match(t, /Left out: agg \(aggregate-only; 1 patient in these cohorts\)\.$/);
  });

  test("an ascending sort says nothing of highest first", () => {
    assert.match(tableTail(rows({}), { sort: { column: "AGE" } }, cols, "patient", "x", [], false), /Sorted by Age, missing values last, across the cohort/);
  });
});

describe("listPosition: where the shown patient falls", () => {
  const never = async (): Promise<Rows> => { throw new Error("not asked"); };
  const r = (rows: Row[], o: Partial<Rows> = {}): Rows => ({ rows, lists: [], total: rows.length, all: rows.length, offset: 0, groups: 1, ...o });

  test("a named patient is placed by the list's own position, or nowhere", async () => {
    assert.equal(await listPosition(r([]), true, never), null);
    assert.deepEqual(await listPosition(r([], { position: { index: 2, prev: { study: "s", patient: "a" }, next: null } }), true, never),
      { index: 2, prev: { study: "s", id: "a" }, next: null });
  });

  test("no patient named: the list's first, its next the page's second row", async () => {
    assert.equal(await listPosition(r([]), false, never), null, "an empty list has no first patient");
    assert.deepEqual(await listPosition(r([{ study: "s", patient: "a" }, { study: "s", patient: "b" }]), false, never),
      { index: 0, prev: null, next: { study: "s", id: "b" } });
    assert.deepEqual(await listPosition(r([{ study: "s", patient: "a" }]), false, never), { index: 0, prev: null, next: null }, "a list of one has no next");
  });

  test("a page of one row from a longer list finds the next by locating the first", async () => {
    let located: unknown;
    const pos = await listPosition(r([{ study: "s", patient: "a" }], { total: 5 }), false, async (first) => {
      located = first;
      return r([], { position: { index: 0, prev: null, next: { study: "s", patient: "b" } } });
    });
    assert.deepEqual(located, { study: "s", patient: "a" });
    assert.deepEqual(pos, { index: 0, prev: null, next: { study: "s", id: "b" } });
  });
});

describe("pagedTable: a paged view's table in its result", () => {
  test("each paged kind's own table; the alterations view's patient list or a named table; nothing for other kinds", () => {
    const t = { total: 1 };
    assert.equal(pagedTable({ kind: "table", table: t } as unknown as ViewResult), t);
    assert.equal(pagedTable({ kind: "mutations", mutations: t } as unknown as ViewResult), t);
    assert.equal(pagedTable({ kind: "sv", sv: t } as unknown as ViewResult), t);
    assert.equal(pagedTable({ kind: "timeline", timeline: t } as unknown as ViewResult), t);
    const alt = { total: 2, tables: { cna: t } };
    assert.equal(pagedTable({ kind: "alterations", alterations: alt } as unknown as ViewResult), alt);
    assert.equal(pagedTable({ kind: "alterations", alterations: alt } as unknown as ViewResult, "cna"), t);
    assert.equal(pagedTable({ kind: "alterations" } as unknown as ViewResult, "cna"), undefined);
    assert.equal(pagedTable({ kind: "survival" } as unknown as ViewResult), undefined);
  });
});
