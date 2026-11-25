// lib/views/rows.ts runRows: when the page may be asked for beside the counts, and the column
// summaries the counts carry. Driven with stand-in participants whose answers are held by the test.
//   P1  one database, no locate: the page is asked for without waiting for the counts
//   P2  one database: the rows are as before — offset below the total, the page's rows; at or past
//       it, none, whatever the page returned
//   P3  two databases, or a locate: the page is asked for only after every count
//   P4  a failing page or count rejects runRows with its error, leaving no unhandled rejection
//   P5  summarize: Rows.summaries is the merge over every part when every count carried `sums`;
//       absent when one did not, in values mode, and with no summarize; the counts are asked with
//       the summary columns among their reads and with the summarize argument
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runRows } from "../lib/views/rows.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation } from "../lib/types.ts";
import type { TableQuery } from "../lib/table-query.ts";

type Row = Record<string, unknown>;
type Ask = { column: string; numeric: boolean };
type Summary =
  | { column: string; numeric: true; min: number | null; max: number | null }
  | { column: string; numeric: false; values: string[]; truncated: boolean };
type Counts = { cohort: string; study: string; n: number; all: number; sums?: Summary[] };
// runRows' trailing summarize argument, called through a loose signature so a build without it still loads
const runRowsAny = runRows as unknown as (...a: unknown[]) => Promise<Awaited<ReturnType<typeof runRows>> & { summaries?: Summary[] }>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LONG = 1500;

type Log = { events: string[]; countsAsked: { conn: string; reads: unknown; summarize: unknown }[]; pageAsked: { conn: string; offset: number; limit: number }[] };
const newLog = (): Log => ({ events: [], countsAsked: [], pageAsked: [] });

/**
 * A patient-level participant in database `conn`. `counts` is what its count answers (after
 * `countsWait`, which may wait on the test); `page` the rows its page answers whatever is asked.
 */
function standIn(conn: string, log: Log, opts: {
  counts: Counts[]; page?: Row[]; countsWait?: () => Promise<unknown>; pageFails?: Error; countsFails?: Error; countsFailAfter?: number;
}) {
  return {
    instance: { id: conn, mode: "patient-level", label: conn, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    rowsPage: async (_l: string, source: (db: string, m: boolean) => unknown, _q: TableQuery, _d: string[], limit: number, offset: number) => {
      source(conn, false);
      log.events.push("page:" + conn);
      log.pageAsked.push({ conn, offset, limit });
      if (opts.pageFails) throw opts.pageFails;
      // the page holds the rows from the asked offset on; the limit is honoured
      const rows = opts.page ?? [];
      return { rows: rows.slice(0, limit), total: rows.length };
    },
    rowsCounts: async (_l: string, source: (db: string, m: boolean) => unknown, _q: TableQuery, _d: string[], summarize?: unknown) => {
      const src = source(conn, false) as { reads?: unknown };
      log.events.push("counts-asked:" + conn);
      log.countsAsked.push({ conn, reads: src?.reads, summarize });
      if (opts.countsWait) await opts.countsWait();
      if (opts.countsFails) { await sleep(opts.countsFailAfter ?? 0); throw opts.countsFails; }
      log.events.push("counts-done:" + conn);
      const ask = (summarize as Ask[] | undefined) || [];
      return opts.counts.map((c) => ask.length || !c.sums ? c : { ...c, sums: undefined });
    },
    rowsValues: async (_l: string, source: (db: string, m: boolean) => unknown) => { source(conn, false); log.events.push("values:" + conn); return [{ v: "x", n: 1 }]; },
    rowsRank: async (_l: string, source: (db: string, m: boolean) => unknown) => { source(conn, false); log.events.push("rank:" + conn); return 0; },
  };
}

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
/** the row source factory: what each statement's source was built to read */
const source = (log: Log) => (_parts: unknown, reads: unknown) => {
  log.events.push("source:" + JSON.stringify(reads));
  return () => ({ reads }) as never;
};
const pts = (cohort: string, study: string, ids: string[]) => ids.map((patient) => ({ cohort, study, patient }));

/** a deferred the test resolves: `fired` tells whether it was resolved before a timeout */
function signal() {
  let fire!: () => void;
  const p = new Promise<void>((r) => { fire = r; });
  let fired = false;
  return { fire: () => { fired = true; fire(); }, wait: () => Promise.race([p, sleep(LONG)]), get fired() { return fired; } };
}

// ---- P1 / P2: one database -----------------------------------------------------------------------

describe("one database, no locate", () => {
  test("P1 the page is asked for before the counts answer", async () => {
    const log = newLog();
    const pageCalled = signal();
    let pageBeforeCounts = false;
    const r = standIn("db1", log, {
      counts: [{ cohort: "A", study: "s1", n: 3, all: 3 }, { cohort: "A", study: "s2", n: 2, all: 2 }],
      page: pts("A", "s1", ["a1", "a2", "a3"]),
      countsWait: async () => { await pageCalled.wait(); pageBeforeCounts = pageCalled.fired; },
    });
    const orig = r.rowsPage;
    r.rowsPage = async (...a: Parameters<typeof orig>) => { pageCalled.fire(); return orig(...a); };
    const t0 = Date.now();
    const res = await runRows(ctx({ A: cohort({ s1: 3, s2: 2 }) }, { s1: r, s2: r }), "t", ["s1", "s2"], {}, [], [], 10, source(log));
    assert.ok(pageBeforeCounts, "rowsPage was called while rowsCounts was still waiting: " + log.events.join(", "));
    assert.ok(Date.now() - t0 < LONG, "no wait for the timeout");
    assert.equal(res.total, 5);
    assert.deepEqual(res.rows.map((x) => x.patient), ["a1", "a2", "a3"]);
  });

  test("P2 an offset below the total gives the page's rows", async () => {
    const log = newLog();
    const r = standIn("db1", log, { counts: [{ cohort: "A", study: "s1", n: 5, all: 6 }], page: pts("A", "s1", ["a3", "a4", "a5"]) });
    const res = await runRows(ctx({ A: cohort({ s1: 6 }) }, { s1: r }, { page: { offset: 2, limit: 10 } }), "t", ["s1"], {}, [], [], 10, source(log));
    assert.deepEqual(res.rows.map((x) => x.patient), ["a3", "a4", "a5"]);
    assert.equal(res.total, 5);
    assert.equal(res.all, 6);
    assert.equal(res.offset, 2);
    assert.deepEqual(log.pageAsked.map((p) => p.offset), [2]);
  });

  for (const offset of [5, 9]) {
    test("P2 an offset " + (offset === 5 ? "at" : "past") + " the total gives no rows, even when the page returned some", async () => {
      const log = newLog();
      const r = standIn("db1", log, { counts: [{ cohort: "A", study: "s1", n: 5, all: 5 }], page: pts("A", "s1", ["ghost"]) });
      const res = await runRows(ctx({ A: cohort({ s1: 5 }) }, { s1: r }, { page: { offset, limit: 10 } }), "t", ["s1"], {}, [], [], 10, source(log));
      assert.deepEqual(res.rows, []);
      assert.equal(res.total, 5);
    });
  }

  test("P2 the first page of an empty list: no rows", async () => {
    const log = newLog();
    const r = standIn("db1", log, { counts: [], page: pts("A", "s1", ["ghost"]) });
    const res = await runRows(ctx({ A: cohort({ s1: 5 }) }, { s1: r }), "t", ["s1"], {}, [], [], 10, source(log));
    assert.deepEqual(res.rows, []);
    assert.equal(res.total, 0);
  });
});

// ---- P3: two databases, or a locate ---------------------------------------------------------------

describe("the walk needs each group's total", () => {
  test("P3 two databases: no page is asked until every count has answered", async () => {
    const log = newLog();
    const d1 = standIn("db1", log, { counts: [{ cohort: "A", study: "s1", n: 2, all: 2 }], page: pts("A", "s1", ["a1", "a2"]), countsWait: () => sleep(30) });
    const d2 = standIn("db2", log, { counts: [{ cohort: "A", study: "s2", n: 2, all: 2 }], page: pts("A", "s2", ["b1", "b2"]), countsWait: () => sleep(60) });
    const res = await runRows(ctx({ A: cohort({ s1: 2, s2: 2 }) }, { s1: d1, s2: d2 }), "t", ["s1", "s2"], {}, [], [], 3, source(log));
    const firstPage = log.events.findIndex((e) => e.startsWith("page:"));
    assert.ok(firstPage >= 0, log.events.join(", "));
    const lastCount = Math.max(log.events.lastIndexOf("counts-done:db1"), log.events.lastIndexOf("counts-done:db2"));
    assert.ok(lastCount >= 0 && lastCount < firstPage, "every count answered before a page: " + log.events.join(", "));
    assert.deepEqual(res.rows.map((x) => x.patient), ["a1", "a2", "b1"]);
  });

  test("P3 one database with a locate: no page is asked until the count has answered", async () => {
    const log = newLog();
    const d1 = standIn("db1", log, { counts: [{ cohort: "A", study: "s1", n: 3, all: 3 }], page: pts("A", "s1", ["a1", "a2", "a3"]), countsWait: () => sleep(40) });
    await runRowsAny(ctx({ A: cohort({ s1: 3 }) }, { s1: d1 }), "t", ["s1"], {}, [], [], 10, source(log), undefined, undefined, { study: "s1", patient: "a2" });
    const firstPage = log.events.findIndex((e) => e.startsWith("page:"));
    const done = log.events.indexOf("counts-done:db1");
    assert.ok(done >= 0 && (firstPage < 0 || done < firstPage), log.events.join(", "));
  });
});

// ---- P4: failures --------------------------------------------------------------------------------

describe("failures", () => {
  async function noUnhandled(fn: () => Promise<void>) {
    const seen: unknown[] = [];
    const on = (e: unknown) => { seen.push(e); };
    process.on("unhandledRejection", on);
    try {
      await fn();
      await sleep(120);
    } finally {
      process.off("unhandledRejection", on);
    }
    assert.deepEqual(seen.map(String), [], "no unhandled rejection");
  }
  const one = (log: Log, o: Parameters<typeof standIn>[2]) => {
    const r = standIn("db1", log, o);
    return () => runRows(ctx({ A: cohort({ s1: 2 }) }, { s1: r }), "t", ["s1"], {}, [], [], 10, source(log));
  };

  test("P4 a failing page rejects with its error (one database)", () => noUnhandled(async () => {
    const boom = new Error("page went wrong");
    await assert.rejects(one(newLog(), { counts: [{ cohort: "A", study: "s1", n: 2, all: 2 }], pageFails: boom, countsWait: () => sleep(30) })(), (e) => e === boom);
  }));

  test("P4 a failing count rejects with its error (one database)", () => noUnhandled(async () => {
    const boom = new Error("counts went wrong");
    await assert.rejects(one(newLog(), { counts: [], page: pts("A", "s1", ["a1"]), countsFails: boom, countsFailAfter: 20 })(), (e) => e === boom);
  }));

  test("P4 page and count both failing: rejects, and the second failure is not left unhandled", () => noUnhandled(async () => {
    const page = new Error("page went wrong"), counts = new Error("counts went wrong");
    await assert.rejects(one(newLog(), { counts: [], pageFails: page, countsFails: counts, countsFailAfter: 30 })(), (e) => e === page || e === counts);
  }));

  test("P4 a failing count in one of two databases rejects with its error", () => noUnhandled(async () => {
    const log = newLog();
    const boom = new Error("db2 counts went wrong");
    const d1 = standIn("db1", log, { counts: [{ cohort: "A", study: "s1", n: 1, all: 1 }], page: pts("A", "s1", ["a1"]) });
    const d2 = standIn("db2", log, { counts: [], countsFails: boom, countsFailAfter: 10 });
    await assert.rejects(runRows(ctx({ A: cohort({ s1: 1, s2: 1 }) }, { s1: d1, s2: d2 }), "t", ["s1", "s2"], {}, [], [], 10, source(log)), (e) => e === boom);
  }));
});

// ---- P5: summaries -------------------------------------------------------------------------------

describe("P5 summarize", () => {
  const ASK: Ask[] = [{ column: "vaf", numeric: true }, { column: "cancerType", numeric: false }];
  const sums = (min: number | null, max: number | null, values: string[], truncated = false): Summary[] =>
    [{ column: "vaf", numeric: true, min, max }, { column: "cancerType", numeric: false, values, truncated }];
  const setup = (log: Log, db2Sums: boolean) => {
    const d1 = standIn("db1", log, { counts: [
      { cohort: "A", study: "s1", n: 1, all: 4, sums: sums(0.2, 0.4, ["Colon"]) },
      { cohort: "B", study: "s1", n: 0, all: 2, sums: sums(null, null, [""]) },
    ], page: pts("A", "s1", ["a1"]) });
    const d2 = standIn("db2", log, { counts: [{ cohort: "A", study: "s2", n: 1, all: 3, ...(db2Sums ? { sums: sums(0.1, 0.3, ["Rectal", "Colon"]) } : {}) }], page: pts("A", "s2", ["b1"]) });
    return ctx({ A: cohort({ s1: 4, s2: 3 }), B: cohort({ s1: 2 }) }, { s1: d1, s2: d2 });
  };
  const norm = (s: Summary[] | undefined) => s?.map((x) => x.numeric ? x : { ...x, values: [...x.values].sort() });

  test("every count carried sums: Rows.summaries is their merge over every part (the filters' n aside)", async () => {
    const log = newLog();
    const res = await runRowsAny(setup(log, true), "t", ["s1", "s2"], { search: "x" }, [], [], 10, source(log), undefined, undefined, undefined, ASK);
    assert.deepEqual(norm(res.summaries), norm(sums(0.1, 0.4, ["", "Colon", "Rectal"])));
    assert.equal(res.total, 2);
  });

  test("the counts are asked with the summarize argument and the summary columns among their reads", async () => {
    const log = newLog();
    await runRowsAny(setup(log, true), "t", ["s1", "s2"], {}, [], [], 10, source(log), undefined, undefined, undefined, ASK);
    assert.equal(log.countsAsked.length, 2, "one count per database");
    for (const c of log.countsAsked) {
      assert.deepEqual(c.summarize, ASK, c.conn);
      assert.ok(c.reads === "all" || (Array.isArray(c.reads) && ASK.every((a) => (c.reads as string[]).includes(a.column))),
        c.conn + " reads " + JSON.stringify(c.reads));
    }
  });

  test("a count without sums (an older or stand-in backend): no summaries", async () => {
    const log = newLog();
    const res = await runRowsAny(setup(log, false), "t", ["s1", "s2"], {}, [], [], 10, source(log), undefined, undefined, undefined, ASK);
    assert.equal(res.summaries, undefined);
    assert.equal(res.total, 2, "the rows themselves are unaffected");
  });

  test("no summarize asked: no summaries, and the counts are not asked to summarise", async () => {
    const log = newLog();
    const res = await runRows(setup(log, true), "t", ["s1", "s2"], {}, [], [], 10, source(log));
    assert.equal(res.summaries, undefined);
    for (const c of log.countsAsked) assert.ok(c.summarize == null || (Array.isArray(c.summarize) && !c.summarize.length), JSON.stringify(c.summarize));
    const empty = await runRowsAny(setup(newLog(), true), "t", ["s1", "s2"], {}, [], [], 10, source(newLog()), undefined, undefined, undefined, []);
    assert.equal(empty.summaries, undefined, "an empty summarize is none");
  });

  test("values mode: no summaries", async () => {
    const log = newLog();
    const res = await runRowsAny(setup(log, true), "t", ["s1", "s2"], {}, [], [], 10, source(log), { column: "cancerType", numeric: false }, undefined, undefined, ASK);
    assert.equal(res.summaries, undefined);
    assert.ok(res.values, "the values are returned");
  });
});
