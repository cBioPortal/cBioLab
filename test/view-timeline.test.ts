// The timeline view's runner (lib/views/timeline/run.ts), driven with hand-made participants: one
// patient's clinical timeline, with the cohort's patients listed to choose from (a table view).
// From the spec (lib/views/timeline/doc.ts): the view reads ONE cohort; the drawn patient is the
// named one (which must be one of the cohort's) or the list's first; the result gives its
// `position` — index from 0 and prev / next as {study, id}, null when the query leaves it out; only
// a patient-level participant (or a peer allowed timelines) contributes, any other study is named.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runTimeline } from "../lib/views/timeline/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, PatientTimeline, TimelineResult } from "../lib/types.ts";
import type { TableQuery, RowSource } from "../lib/table-query.ts";
import type { PeerRowsRequest } from "../lib/federation.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = { patient: string; samples: number; events: number; first: number | null; last: number | null; types: string };
const row = (patient: string, events = 0, first: number | null = null, last: number | null = null, samples = 1, types = ""): Row =>
  ({ patient, samples, events, first, last, types });

const timelineOf = (study: string, patient: string): PatientTimeline => ({
  study, patient, source: { label: "local" },
  events: [{ type: "Treatment", start: 10, end: 40, attrs: [["TREATMENT_TYPE", "Chemo"]] }, { type: "Diagnosis", start: 0, end: null, attrs: [] }],
  samples: [{ id: patient + "-T01", type: "Primary" }],
});

/** the member query the view asks when a named patient is not placed by the list's query */
const memberOf = (q: TableQuery): string | null => {
  const f = q.filters?.patient as { op?: string; value?: unknown } | undefined;
  return f && f.op === "equals" ? String(f.value) : null;
};

/** A local patient-level participant holding `rows` per cohort (already in the list's order). */
function local(study: string, rows: Record<string, Row[]>, o: { connId?: string; noTimeline?: boolean; fail?: string; timelineFail?: string; log?: string[] } = {}) {
  const forParts = (source: (db: string) => RowSource, q: TableQuery) => {
    const src = source("db");                       // the row source the database would be sent
    assert.match(src.with, /WITH /);
    const m = memberOf(q);
    const keep = (r: Row) => (m == null ? !(q.search && !r.patient.includes(q.search)) : r.patient === m);
    const parts = [...src.with.matchAll(/SELECT '([^']*)' AS cohort, '([^']*)' AS study/g)].map((x) => ({ cohort: x[1], study: x[2] }));
    return parts.map((p) => ({ ...p, all: rows[p.cohort] || [], kept: (rows[p.cohort] || []).filter(keep), source: /'(this portal[^']*)' AS source/.exec(src.with)![1] }));
  };
  const flat = (source: (db: string) => RowSource, q: TableQuery) =>
    forParts(source, q).flatMap((p) => p.kept.map((r) => ({ ...r, cohort: p.cohort, study: p.study, source: p.source })));
  return {
    instance: { id: "local", mode: "patient-level", label: "Local " + study, conn: { ...PRIMARY, id: o.connId ?? "db1" } }, study,
    cohortSql: () => "SELECT 1",
    rowsCounts: async (label: string, source: (db: string) => RowSource, q: TableQuery) => {
      o.log?.push(label);
      if (o.fail) throw new Error(o.fail);
      return forParts(source, q).map((p) => ({ cohort: p.cohort, study: p.study, n: p.kept.length, all: p.all.length }));
    },
    rowsPage: async (label: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], limit: number, offset: number) => {
      o.log?.push(label + " " + offset + "+" + limit);
      const all = flat(source, q);
      return { rows: all.slice(offset, offset + limit), total: all.length };
    },
    rowsRank: async (label: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], st: string, patient: string) => {
      o.log?.push(label);
      const i = flat(source, q).findIndex((r) => r.study === st && r.patient === patient);
      return i < 0 ? null : i;
    },
    rowsValues: async (_l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], column: string) =>
      flat(source, q).map((r) => ({ value: (r as Record<string, unknown>)[column], n: 1 })),
    ...(o.noTimeline ? {} : { patientTimeline: async (id: string) => { if (o.timelineFail) throw new Error(o.timelineFail); return timelineOf(study, id); } }),
  };
}

const aggregateOnly = (study: string) => ({ instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: PRIMARY }, study });

/** A federation peer whose rules allow timelines: it pages its own rows. */
function peer(study: string, rows: Row[], reqs: PeerRowsRequest[] = []) {
  return {
    instance: { id: "peer", mode: "aggregate-only", label: "Peer Hospital", conn: PRIMARY }, study,
    peerUrl: "http://peer.invalid", patientKinds: new Set(["timeline"]),
    patientRows: async (req: PeerRowsRequest) => {
      reqs.push(req);
      const m = memberOf(req.query);
      const kept = rows.filter((r) => m == null || r.patient === m);
      const cohort = req.parts[0].cohort;
      if (req.mode === "counts") return { counts: req.parts.map((p) => ({ cohort: p.cohort, study, n: kept.length, all: rows.length })) };
      if (req.mode === "page") return { rows: kept.slice(req.offset!, req.offset! + req.limit!).map((r) => ({ ...r, cohort, study, source: "Peer Hospital" })) };
      if (req.mode === "rank") { const i = kept.findIndex((r) => r.patient === req.patient); return { rank: i < 0 ? null : i }; }
      return { values: [] };
    },
    patientTimeline: async (id: string) => ({ ...timelineOf(study, id), source: { label: "Peer Hospital", remote: true } }),
  };
}

function ctx(counts: Record<string, Record<string, number>>, resolvers: Record<string, unknown>, extra: Partial<ViewRun> = {}): ViewRun {
  const vNames = Object.keys(counts);
  const vStudies = [...new Set(vNames.flatMap((n) => Object.keys(counts[n])))];
  const cohorts: Record<string, EvaluatedCohort> = Object.fromEntries(vNames.map((n) => [n, {
    studies: Object.keys(counts[n]),
    perStudy: Object.fromEntries(Object.entries(counts[n]).map(([st, k]) => [st, { sql: "", count: k, samples: k, mode: "" }])),
    count: Object.values(counts[n]).reduce((a, b) => a + b, 0), samples: 0, text: "",
  }]));
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: vStudies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }), ...extra,
  };
}
type Out = { error?: string; caveat?: string; svg?: string; studies?: string[]; timeline: TimelineResult; method?: { steps: { title: string }[] }; participation: ViewParticipation };
const run = async (view: Record<string, unknown>, c: ViewRun) => (await runTimeline({ kind: "timeline", ...view } as never, c)) as unknown as Out;
const col = (t: TimelineResult, id: string) => t.columns.findIndex((c) => c.id === id);

// The cohort's list in its order: patients with a timeline first, then by id.
const THREE = [row("P2", 3, -5, 120, 2, "Diagnosis, Treatment"), row("P1", 1, 7, 7), row("P3")];

describe("timeline: refusals", () => {
  for (const [name, view, counts, re] of [
    ["two cohorts", {}, { A: { s1: 3 }, B: { s1: 3 } }, /steps through one cohort's patients; this one draws 2/],
    ["rows 0", { rows: 0 }, null, /rows \(the page size of the patient list\) is 1 to 1000/],
    ["rows past 1000", { rows: 1001 }, null, /is 1 to 1000/],
    ["a patient id that is not one", { patient: { study: "s1", id: "P 1" } }, null, /patient is \{study, id\}/],
    ["a patient that is not an object", { patient: "P1" }, null, /patient is \{study, id\}/],
    ["collapsed that is not a list", { collapsed: "treatment" }, null, /collapsed is a list of track ids/],
    ["collapsed holding a non-string", { collapsed: [3] }, null, /collapsed is a list of track ids/],
    ["a sort on no column", { sort: { column: "age" } }, null, /sort\.column age is not a column/],
  ] as const) test(name + " is refused", async () => {
    const v = await run(view, ctx(counts ?? { A: { s1: 3 } }, { s1: local("s1", { A: THREE }) }));
    assert.match(v.error!, re);
  });

  test("no study may disclose a timeline: refused, naming each and why", async () => {
    const v = await run({}, ctx({ A: { s1: 3 } }, { s1: aggregateOnly("s1") }));
    assert.equal(v.error, "no study here may disclose a patient's timeline (s1: aggregate-only: it does not disclose patients)");
  });

  test("a patient named in a study none of the cohorts span", async () => {
    const v = await run({ patient: { study: "s9", id: "P1" } }, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }) }));
    assert.equal(v.error, "patient P1 is named in s9, which none of this view's cohorts span (s1)");
  });

  test("a patient named in a study that does not disclose patients", async () => {
    const v = await run({ patient: { study: "s2", id: "P1" } }, ctx({ A: { s1: 3, s2: 4 } }, { s1: local("s1", { A: THREE }), s2: aggregateOnly("s2") }));
    assert.equal(v.error, "s2 is aggregate-only: it does not disclose patients, so its patients' timelines cannot be shown");
  });

  test("a failing participant refuses the view with its message", async () => {
    const v = await run({}, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }, { fail: "database gone" }) }));
    assert.equal(v.error, "database gone");
  });
});

describe("timeline: the list and the drawn patient", () => {
  test("with no patient named the list's first is drawn, at index 0, its next the page's second row", async () => {
    const v = await run({ collapsed: ["treatment.Chemo"] }, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }) }));
    assert.equal(v.error, undefined);
    const t = v.timeline;
    assert.deepEqual(t.rows.map((r) => r.patient), ["P2", "P1", "P3"]);
    assert.equal(t.total, 3); assert.equal(t.all, 3); assert.equal(t.pageSize, 25);
    // span is last − first in days: 120 − (−5) = 125; 7 − 7 = 0; a patient with no events has none
    assert.deepEqual(t.rows.map((r) => r.values[col(t, "span")]), [125, 0, null]);
    assert.deepEqual(t.rows.map((r) => r.values[col(t, "events")]), [3, 1, 0]);
    assert.equal(t.rows[0].values[col(t, "source")], "this portal (Local s1)");
    assert.equal(t.patient!.patient, "P2");
    assert.deepEqual(t.position, { index: 0, prev: null, next: { study: "s1", id: "P1" } });
    assert.ok(v.svg!.startsWith("<svg"));
    assert.ok(v.method!.steps.some((s) => s.title === "Read P2's timeline"));
    assert.equal(v.participation.requiresPatientLevel, true, "the list and the timeline both name patients");
    assert.match(v.caveat!, /^The list is one row per patient of each cohort/);
    assert.match(v.caveat!, /3 patients\. Sorted with patients who have a timeline first, then by patient id across the cohort/);
    assert.equal(v.studies, undefined);
  });

  test("a page of one row still finds the next patient, by locating the first in the whole order", async () => {
    const log: string[] = [];
    const v = await run({ rows: 1 }, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }, { log }) }));
    assert.deepEqual(v.timeline.rows.map((r) => r.patient), ["P2"]);
    assert.deepEqual(v.timeline.position, { index: 0, prev: null, next: { study: "s1", id: "P1" } });
    assert.ok(log.includes("timeline:rank"));
  });

  test("a list of one: no next patient", async () => {
    const v = await run({}, ctx({ A: { s1: 1 } }, { s1: local("s1", { A: [row("P1", 2, 0, 3)] }) }));
    assert.deepEqual(v.timeline.position, { index: 0, prev: null, next: null });
  });

  test("an empty list draws no patient, and says so", async () => {
    const v = await run({}, ctx({ A: { s1: 0 } }, { s1: local("s1", { A: [] }) }));
    assert.equal(v.timeline.patient, null);
    assert.equal(v.timeline.position, null);
    assert.equal(v.svg, undefined);
    assert.match(v.caveat!, /^No patient to draw: the list is empty\. /);
  });

  test("a named patient in the list: drawn, placed by its rank, with prev and next", async () => {
    const v = await run({ patient: { study: "s1", id: "P1" }, expandGaps: true }, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }) }));
    assert.equal(v.timeline.patient!.patient, "P1");
    assert.deepEqual(v.timeline.position, { index: 1, prev: { study: "s1", id: "P2" }, next: { study: "s1", id: "P3" } });
  });

  test("a named patient the list's query leaves out is checked as a member, drawn, and placed nowhere", async () => {
    const log: string[] = [];
    const v = await run({ patient: { study: "s1", id: "P3" }, search: "P1" }, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }, { log }) }));
    assert.equal(v.error, undefined);
    assert.ok(log.includes("timeline:member"));
    assert.equal(v.timeline.patient!.patient, "P3");
    assert.equal(v.timeline.position, null);
    assert.match(v.caveat!, /Showing 1 of 3 patients/);
  });

  test("a named patient who is not one of the cohort's is refused", async () => {
    const v = await run({ patient: { study: "s1", id: "P9" } }, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }) }));
    assert.equal(v.error, "P9 is not a patient of this cohort in s1");
  });

  test("a holder that cannot read a patient's timeline is refused by name; a failing read refuses with its message", async () => {
    const no = await run({}, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }, { noTimeline: true }) }));
    assert.equal(no.error, "s1 cannot disclose a patient's timeline");
    const fail = await run({}, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }, { timelineFail: "no events table" }) }));
    assert.equal(fail.error, "no events table");
  });

  test("a sorted list says how it is sorted, and the method names the order", async () => {
    const v = await run({ sort: { column: "events", desc: true } }, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }) }));
    assert.match(v.caveat!, /Sorted by Events \(highest first\), missing values last,/);
    assert.deepEqual(v.timeline.query.sort, { column: "events", desc: true });
  });
});

describe("timeline: pages, values, and several participants", () => {
  test("a page request returns the list alone, at its offset, with no patient", async () => {
    const v = await run({}, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }) }, { page: { offset: 1, limit: 5 } }));
    assert.deepEqual(v.timeline.rows.map((r) => r.patient), ["P1", "P3"]);
    assert.equal(v.timeline.offset, 1);
    assert.equal(v.timeline.patient, null);
    assert.equal(v.caveat, undefined);
  });

  test("a values request returns the column's values instead of rows", async () => {
    const v = await run({}, ctx({ A: { s1: 3 } }, { s1: local("s1", { A: THREE }) }, { values: "events" }));
    assert.equal(v.timeline.rows.length, 0);
    assert.ok(v.timeline.values, "the column's values");
    assert.equal(v.timeline.patient, null);
  });

  test("two studies in two databases: listed in turn, named, an aggregate-only one left out with its patients", async () => {
    const v = await run({}, ctx({ A: { s1: 2, s2: 1, s3: 4 } }, {
      s1: local("s1", { A: [row("P1", 2, 0, 1), row("P2")] }), s2: local("s2", { A: [row("Q1", 1, 5, 5)] }, { connId: "db2" }), s3: aggregateOnly("s3"),
    }));
    assert.deepEqual(v.timeline.rows.map((r) => r.study + ":" + r.patient), ["s1:P1", "s1:P2", "s2:Q1"]);
    assert.equal(v.timeline.instances, 2);
    assert.deepEqual(v.timeline.excluded, [{ study: "s3", reason: "aggregate-only: it does not disclose patients", patients: 4 }]);
    assert.deepEqual(v.studies, ["s1", "s2", "s3"]);
    assert.match(v.caveat!, /These studies live in 2 separate databases/);
    assert.match(v.caveat!, /Left out: s3 \(aggregate-only: it does not disclose patients; 4 patients in these cohorts\)\./);
  });

  test("a peer allowed timelines pages its own rows and draws its patient, named as reached via federation", async () => {
    const reqs: PeerRowsRequest[] = [];
    const v = await run({}, ctx({ A: { p1: 2 } }, { p1: peer("p1", [row("R1", 4, 0, 9), row("R2")], reqs) }));
    assert.equal(v.error, undefined);
    assert.deepEqual(v.timeline.rows.map((r) => r.patient), ["R1", "R2"]);
    assert.equal(v.timeline.patient!.source.remote, true);
    assert.deepEqual([...new Set(reqs.map((r) => r.table))], ["timeline"]);
    assert.ok(reqs.every((r) => !JSON.stringify(r).includes("SELECT")), "a peer is sent definitions, not SQL");
    assert.match(v.caveat!, /Patients of p1 come from Peer Hospital via federation/);
  });

  test("a peer's named patient outside the query is checked as a member by the peer", async () => {
    const reqs: PeerRowsRequest[] = [];
    const ok = await run({ patient: { study: "p1", id: "R2" }, search: "R1" }, ctx({ A: { p1: 2 } }, { p1: peer("p1", [row("R1", 4, 0, 9), row("R2")], reqs) }));
    assert.equal(ok.error, undefined);
    assert.equal(ok.timeline.patient!.patient, "R2");
    const no = await run({ patient: { study: "p1", id: "R7" } }, ctx({ A: { p1: 2 } }, { p1: peer("p1", [row("R1")]) }));
    assert.equal(no.error, "R7 is not a patient of this cohort in p1");
  });
});
