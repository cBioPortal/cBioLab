// Incidence from a recorded time and a competing-risks status (lib/views/incidence/run.ts with
// monthsAttribute/statusAttribute, lib/federation-views.ts incidenceColumnsCountsSql): codes 0/1/2
// are censored / the event / a competing event, any other code is refused, and the view refuses to
// mix the columns with a timeline event or an anchor.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runIncidence } from "../lib/views/incidence/run.ts";
import { incidenceColumnsCountsSql } from "../lib/federation-views.ts";
import type { ViewRun } from "../lib/views/run.ts";

const M = "custom:bm/ICPFS_TIME", S = "custom:bm/ICPFS_EVENTCR";

/** one study, one or two cohorts, whose resolver answers every incidence query with `rows` */
function ctx(rows: Record<string, unknown>[], names = ["A"]) {
  const asked: string[] = [];
  const resolver = {
    viewAggregate: async (_label: string, _def: unknown, build: (c: string, s: string, d: string) => string) => {
      asked.push(String(build("SELECT 1", "s1", "db")));
      return rows;
    }
  };
  const c = {
    doc: { study: "s1", cohorts: Object.fromEntries(names.map((n) => [n, { study: "s1", all: [] }])), views: [] },
    cohorts: Object.fromEntries(names.map((n) => [n, { studies: ["s1"], perStudy: { s1: { count: 12 } }, count: 12 }])),
    resolvers: { s1: resolver }, vNames: names, vStudies: ["s1"], participationFor: () => ({}), pin: null,
    studyProfiles: async () => ({ profiles: [], gaProfiles: [] })
  } as unknown as ViewRun;
  return { c, asked };
}

const ROWS = [
  { kind: "record", entry: 0, t: 2, cause: 1, late: 0, n: 3 },
  { kind: "record", entry: 0, t: 4, cause: 2, late: 0, n: 2 },
  { kind: "record", entry: 0, t: 6, cause: 0, late: 0, n: 2 },
  { kind: "record", entry: 0, t: 8, cause: 1, late: 0, n: 3 }
];

test("the query reads both columns per patient and refuses a code other than 0, 1, 2", () => {
  const sql = String(incidenceColumnsCountsSql("SELECT 1", "s1", "db", M, S));
  assert.match(sql, /type = 'sample' AND attribute_name IN \('custom:bm\/ICPFS_TIME', 'custom:bm\/ICPFS_EVENTCR'\)/);
  assert.match(sql, /throwIf\(months IS NOT NULL AND ifNull\(code, -1\) NOT IN \(0, 1, 2\), 'custom:bm\/ICPFS_EVENTCR holds a status code other than 0, 1, 2/);
  assert.match(sql, /SELECT 'record' AS kind, 0 AS entry, round\(months, 4\) AS t, toInt8\(code\) AS cause, 0 AS late, count\(\) AS n/);
  // a study's own columns are read at patient level only
  assert.doesNotMatch(String(incidenceColumnsCountsSql("SELECT 1", "s1", "db", "PFS_MONTHS", "PFS_STATUS")), /type = 'sample'/);
});

test("cumulative incidence from the columns: counts, label, the columns in the result and its method", async () => {
  const { c, asked } = ctx(ROWS);
  const r = await runIncidence({ kind: "incidence", cohorts: ["A"], monthsAttribute: M, statusAttribute: S, horizons: [5, 10] }, c) as any;
  assert.equal(r.error, undefined);
  assert.match(asked[0], /ICPFS_EVENTCR/);
  const cv = r.incidence.curves[0];
  assert.deepEqual([cv.n, cv.events, cv.competing, cv.censored], [10, 6, 2, 2]);
  assert.equal(cv.excluded.noFollowup, 2, "the 2 of 12 patients without both values are counted, not dropped");
  assert.equal(r.incidence.eventLabel, "ICPFS_EVENTCR", "the column, without its dataset");
  assert.deepEqual(r.incidence.columns, { months: M, status: S });
  // F1 at 5 months: 3 events of 10 at t=2 → 0.3
  assert.equal(r.incidence.horizons[0].cells[0].f1, 0.3);
  const text = JSON.stringify(r.method);
  assert.match(text, /a competing event \(cause 2\)/);
  assert.match(text, /competing events first/);
  assert.doesNotMatch(text, /from OS_STATUS/);
  assert.match(r.caveat, /status code 0 is censored, 1 the event and 2 a competing event/);
});

test("a label names the event; two cohorts get Gray's test", async () => {
  const { c } = ctx(ROWS, ["A", "B"]);
  const r = await runIncidence({ kind: "incidence", cohorts: ["A", "B"], monthsAttribute: M, statusAttribute: S, label: "intracranial progression" }, c) as any;
  assert.equal(r.incidence.eventLabel, "intracranial progression");
  assert.ok(r.incidence.gray);
});

test("refused: half a pair, columns with an event or an anchor, and no one to put at risk", async () => {
  const run = async (v: Record<string, unknown>, rows = ROWS) => (await runIncidence({ kind: "incidence", cohorts: ["A"], ...v } as any, ctx(rows).c) as any).error;
  assert.match(await run({ monthsAttribute: M }), /must both be given/);
  assert.match(await run({ monthsAttribute: M, statusAttribute: S, event: { eventType: "Diagnosis" } }), /either event .* not both/);
  assert.match(await run({ monthsAttribute: M, statusAttribute: S, anchor: { eventType: "Diagnosis" } }), /anchor applies to a timeline event/);
  assert.match(await run({ monthsAttribute: M, statusAttribute: S }, []), /no patient could enter the risk set: A — 12 without both custom:bm\/ICPFS_TIME and custom:bm\/ICPFS_EVENTCR/);
  assert.match(await run({}), /needs event: \{eventType, attrs\?\}.*or monthsAttribute\/statusAttribute/);
});
