// The treatment-endpoints view's runner (lib/views/txendpoints/run.ts), driven with hand-made
// participants: its refusals, the per-cohort Kaplan–Meier curves from (entry, t, event, n) counts,
// who it says it left out, the clock check, the log-rank test and when it is withheld, and the
// caption for each endpoint (lib/views/txendpoints/doc.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runTxendpoints } from "../lib/views/txendpoints/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { TxendpointsView, TxendpointsResult } from "../lib/views/txendpoints/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
/** a txEndpointCountsSql row: `kind` is "ok" for a patient at risk, else nofollowup / nostop */
const row = (t: number, ev: number, n = 1, o: { entry?: number; late?: number; kind?: string } = {}): Row =>
  ({ kind: o.kind ?? "ok", n, late: o.late ?? 0, entry: o.entry ?? 0, t, ev });
const events = (times: number[]) => times.map((t) => row(t, 1));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

interface Site {
  /** rows per cohort name, for the txendpoints:<endpoint>:<cohort> query */
  rows?: Record<string, Row[]>;
  /** the anchor-values query (labTestsSql) */
  anchorValues?: Row[] | "throw";
  remote?: boolean;
}
function resolver(s: Site, labels: string[] = []) {
  const r: Record<string, unknown> = { instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY } };
  if (!s.remote) r.viewAggregate = async (label: string, _def: unknown, build: (c: string, st: string, db: string) => { sql?: unknown } | string) => {
    labels.push(label);
    assert.ok(build("SELECT 1 AS patient_id", "s1", "db"), "the query builds");
    if (label === "txendpoints:anchor-values") {
      if (s.anchorValues === "throw") throw new Error("no such table");
      return s.anchorValues ?? [];
    }
    const cohort = label.split(":").slice(2).join(":");
    return s.rows?.[cohort] ?? [];
  };
  return r;
}
const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { name: n }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const ANCHOR = { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" };
const run = (view: Partial<TxendpointsView>, c: ViewRun) => runTxendpoints({ kind: "txendpoints", anchor: ANCHOR, ...view } as TxendpointsView, c);
const txOf = (r: ViewResult): TxendpointsResult => { assert.equal(r.error, undefined, String(r.error)); return (r as unknown as { txendpoints: TxendpointsResult }).txendpoints; };

// A: an event at each of months 1..12; B: one at each of 13..24 — every B patient outlives every A patient
const A = events(range(1, 12)), B = events(range(13, 24));
const two = (extra: Site = {}, labels?: string[]) =>
  ctx({ A: cohort({ s1: 20 }), B: cohort({ s1: 12 }) }, { s1: resolver({ rows: { A, B }, ...extra }, labels) });

describe("txendpoints: refusals before any query", () => {
  const cases: [string, Partial<TxendpointsView>, RegExp][] = [
    ["an unknown endpoint", { endpoint: "os" as never }, /endpoint is ttnt .* got 'os'/],
    ["no anchor", { anchor: undefined }, /a treatment-endpoints view needs anchor: \{eventType/],
    ["an anchor key without a value", { anchor: { eventType: "Treatment", key: "SUBTYPE" } }, /anchor's key and value go together/],
    ["a lineGap of 0 days", { lineGap: 0 }, /lineGap is a whole number of days, 1 to 3650/],
    ["a fractional lineGap", { lineGap: 1.5 }, /lineGap is a whole number/],
    ["an unknown lineClasses word", { lineClasses: "some" as never }, /lineClasses is "systemic" \(default\), "all", or a list/],
    ["an empty lineClasses list", { lineClasses: [] }, /lineClasses is/],
    ["a blank class in lineClasses", { lineClasses: ["Chemo", " "] }, /lineClasses is/],
    ["rwpfs with eleven progression values", { endpoint: "rwpfs", progression: { values: range(1, 11).map(String) } }, /at most 10 values/],
    ["rwpfs with a probability key and no floor", { endpoint: "rwpfs", progression: { probabilityKey: "P" } }, /needs minProbability/],
    ["ongoingDays past a year", { ongoingDays: 366 }, /ongoingDays is a whole number of days, 0 to 365/],
    ["a cutoff of 0 months", { cutoffMonths: 0 }, /cutoffMonths is a positive number of months/],
    ["a cutoff past 1200 months", { cutoffMonths: 1201 }, /cutoffMonths is a positive number/],
  ];
  for (const [what, view, re] of cases) test(what, async () => {
    const labels: string[] = [];
    const r = await run(view, two({}, labels));
    assert.match(r.error!, re);
    assert.deepEqual(labels, [], "nothing is queried");
  });

  test("more than six cohorts", async () => {
    const cs = Object.fromEntries(range(1, 7).map((i) => ["C" + i, cohort({ s1: 5 })]));
    const r = await run({}, ctx(cs, { s1: resolver({}) }));
    assert.match(r.error!, /at most 6 cohorts/);
  });

  test("progression rules are not checked unless the endpoint is rwpfs", async () => {
    const r = await run({ progression: { values: range(1, 11).map(String) } }, two());
    assert.equal(r.error, undefined);
  });

  test("no participant can answer: each is named with why", async () => {
    const r = await run({}, ctx({ A: cohort({ peer1: 5 }) }, { peer1: resolver({ remote: true }) }));
    assert.match(r.error!, /no participant can answer: peer1 is a remote peer/);
  });
});

describe("txendpoints: curves and the log-rank test", () => {
  test("one Kaplan–Meier curve per cohort, with the median, the patients left out and a 2-group log-rank", async () => {
    const labels: string[] = [];
    const c = two({ rows: { A: [...A, row(0, 0, 3, { kind: "nofollowup" })], B } }, labels);
    const r = await run({}, c);
    const tx = txOf(r);
    assert.equal(tx.endpoint, "ttnt");
    assert.equal(tx.endpointLabel, "time to next treatment");
    assert.equal(tx.anchoredTo, "first Treatment [SUBTYPE=Immuno]");
    assert.equal(tx.lineGap, 90, "the default line gap");
    assert.equal(tx.lineClasses, "systemic");
    assert.deepEqual(labels, ["txendpoints:ttnt:A", "txendpoints:ttnt:B"]);
    const [a, b] = tx.curves;
    assert.equal(a.cohort, "A");
    assert.equal(a.n, 12); assert.equal(a.events, 12);
    assert.equal(a.median, 6, "half of A has had the event by month 6");
    assert.equal(b.median, 18);
    // A: 20 patients, 15 anchored (12 at risk + 3 without follow-up), so 5 had no anchor
    assert.deepEqual([a.cohortPatients, a.anchored], [20, 15]);
    assert.deepEqual(a.excluded, { noAnchor: 5, noFollowup: 3, noStop: 0 });
    assert.deepEqual(b.excluded, { noAnchor: 0, noFollowup: 0, noStop: 0 });
    assert.ok(tx.logrank, "two cohorts of at least ten are tested");
    assert.equal(tx.logrank!.groups, 2); assert.equal(tx.logrank!.df, 1); assert.equal(tx.logrank!.strata, 1);
    assert.ok(tx.logrank!.p < 0.001, "completely separated curves differ");
    assert.equal(tx.noTest, undefined);
    assert.equal(r.studies, undefined, "one study names none");
    assert.match(r.caveat!, /^Time to next treatment: from the start of the first Treatment \[SUBTYPE=Immuno\] record/);
    assert.match(r.caveat!, /systemic-therapy records; a record more than 90 days after/);
    assert.match(r.caveat!, /Left out: 5 cohort patients with no Treatment \[SUBTYPE=Immuno\] record, 3 with no follow-up after it\./);
    assert.match(r.caveat!, /2-group log-rank \(1 df\)\. /);
    assert.match(r.caveat!, /0 of 27 anchored patients have a timeline event more than 31 days past it/);
    assert.match(r.caveat!, /not randomised/);
  });

  test("a row counting several patients stands for that many records", async () => {
    const r = await run({}, two({ rows: { A: [row(5, 1, 6), row(9, 0, 6)], B } }));
    const a = txOf(r).curves[0];
    assert.equal(a.n, 12); assert.equal(a.events, 6);
    assert.equal(a.median, 5);
  });

  test("one cohort: a curve, and no test because a log-rank needs two", async () => {
    const r = await run({}, ctx({ A: cohort({ s1: 12 }) }, { s1: resolver({ rows: { A } }) }));
    const tx = txOf(r);
    assert.equal(tx.curves.length, 1);
    assert.equal(tx.logrank, null);
    assert.equal(tx.noTest, "a log-rank test needs at least two cohorts");
    assert.match(r.caveat!, /A log-rank test needs at least two cohorts\. /);
  });

  test("a cohort under ten patients withholds the test and says which, and how many", async () => {
    const one = await run({}, two({ rows: { A, B: events([13, 14, 15]) } }));
    assert.equal(txOf(one).noTest, "log-rank refused: B (n=3) has fewer than 10 patients");
    const both = await run({}, two({ rows: { A: events([1, 2]), B: events([13, 14, 15]) } }));
    assert.equal(txOf(both).noTest, "log-rank refused: A (n=2), B (n=3) have fewer than 10 patients");
    assert.equal(txOf(both).logrank, null);
  });

  test("an anchor before day 0 enters the risk set at day 0; one whose endpoint also came before day 0 is never at risk, and counted", async () => {
    const r = await run({}, two({ rows: { A: [...A, row(3, 1, 1, { entry: 2 }), row(1, 1, 2, { entry: 4 })], B } }));
    const a = txOf(r).curves[0];
    assert.equal(a.anchored, 15);
    assert.equal(a.n, 13, "the late entrant whose event follows its entry is at risk");
    assert.equal(a.unobserved, 2);
    assert.match(r.caveat!, /and 2 anchored before day 0 whose endpoint also came before it, so were never at risk/);
  });

  test("a cutoff censors administratively, and says so", async () => {
    const r = await run({ cutoffMonths: 6 }, two());
    const tx = txOf(r);
    assert.equal(tx.cutoffMonths, 6);
    assert.equal(tx.curves[0].events, 6, "A's events after month 6 are censored");
    assert.equal(tx.curves[1].events, 0, "every B event comes after month 6");
    assert.match(r.caveat!, /Administratively censored at 6 months\./);
  });

  test("two studies: pooled curves, a log-rank stratified by study, and the studies named", async () => {
    const c = ctx({ A: cohort({ s1: 6, s2: 6 }), B: cohort({ s1: 6, s2: 6 }) }, {
      s1: resolver({ rows: { A: events(range(1, 6)), B: events(range(13, 18)) } }),
      s2: resolver({ rows: { A: events(range(7, 12)), B: events(range(19, 24)) } }),
    });
    const r = await run({}, c);
    const tx = txOf(r);
    assert.deepEqual(tx.curves.map((x) => x.n), [12, 12]);
    assert.equal(tx.curves[0].median, 6);
    assert.equal(tx.logrank!.strata, 2);
    assert.deepEqual(r.studies, ["s1", "s2"]);
    assert.match(r.caveat!, /stratified by study \(2 strata\)/);
    assert.match(r.caveat!, /Records are pooled across 2 studies/);
  });

  test("a peer that cannot answer is left out and named, while the local study answers", async () => {
    const c = ctx({ A: cohort({ s1: 12, peer1: 4 }), B: cohort({ s1: 12 }) }, { s1: resolver({ rows: { A, B } }), peer1: resolver({ remote: true }) });
    const r = await run({}, c);
    const tx = txOf(r);
    assert.deepEqual(tx.excludedStudies, [{ study: "peer1", reason: "a remote peer, which does not serve this view's aggregates yet" }]);
    assert.equal(tx.curves[0].cohortPatients, 12, "the peer's patients are not counted as un-anchored");
    assert.match(r.caveat!, /Left out: peer1 \(a remote peer/);
  });
});

describe("txendpoints: the endpoints' own settings and captions", () => {
  test("tot: ongoingDays defaults to 30, patients without a stop date are left out and counted", async () => {
    const r = await run({ endpoint: "tot" }, two({ rows: { A: [...A, row(0, 0, 4, { kind: "nostop" })], B } }));
    const tx = txOf(r);
    assert.equal(tx.endpointLabel, "time on treatment");
    assert.equal(tx.ongoingDays, 30);
    assert.equal(tx.curves[0].excluded.noStop, 4);
    assert.equal(tx.progression, undefined);
    assert.match(r.caveat!, /^Time on treatment: .*within 30 days of their last follow-up .* 4 anchored patients have an anchored record without a stop date/);
  });

  test("rwpfs: the progression event, its default and a probability floor, in the result and the caption", async () => {
    const r = await run({ endpoint: "rwpfs" }, two());
    const tx = txOf(r);
    assert.equal(tx.endpointLabel, "real-world progression-free survival");
    assert.deepEqual(tx.progression, { eventType: "Diagnosis", key: "PROGRESSION", values: ["Y", "Yes"] });
    assert.equal(tx.ongoingDays, undefined);
    assert.match(r.caveat!, /to the first Diagnosis event after it with PROGRESSION in Y \/ Yes, or death/);
    const p = await run({ endpoint: "rwpfs", progression: { probabilityKey: "NLP_P", minProbability: 0.8 } }, two());
    assert.match(p.caveat!, /PROGRESSION in Y \/ Yes and NLP_P ≥ 0\.8/);
  });

  test("lineClasses \"all\", a class list, a line gap and the last occurrence are echoed", async () => {
    const all = await run({ lineClasses: "all", lineGap: 30 }, two());
    assert.equal(txOf(all).lineClasses, "all");
    assert.match(all.caveat!, /every treatment record; a record more than 30 days/);
    const listed = await run({ lineClasses: ["Chemo", "Immuno"], anchor: { eventType: "Treatment", occurrence: "LAST" } }, two());
    assert.equal(txOf(listed).lineClasses, "Chemo, Immuno");
    assert.equal(txOf(listed).anchoredTo, "last Treatment");
    assert.match(listed.caveat!, /records of class Chemo, Immuno/);
  });
});

describe("txendpoints: nothing to draw", () => {
  test("a study whose timeline runs past OS_MONTHS for over 5% of anchored patients is refused, with the count", async () => {
    const r = await run({}, two({ rows: { A: [row(1, 1, 10), row(2, 1, 2, { late: 1 })], B } }));
    assert.match(r.error!, /the timeline and OS_MONTHS do not share a clock in s1 \(2 anchored patients of 24 have timeline events more than 31 days after OS_MONTHS\)/);
  });

  test("a late share at the tolerance passes, and the caption counts it", async () => {
    const r = await run({}, two({ rows: { A: [row(1, 1, 11), row(2, 1, 1, { late: 1 })], B: [...B, ...events(range(1, 8))] } }));
    assert.equal(r.error, undefined);
    assert.match(r.caveat!, /1 of 32 anchored patients has a timeline event/);
  });

  test("no patient has the anchor: the refusal lists the values the anchor's key takes", async () => {
    const labels: string[] = [];
    const r = await run({}, two({ rows: {}, anchorValues: [{ test: "Chemo", patients: 1200 }, { test: "Targeted", patients: 30 }] }, labels));
    assert.equal(r.error, "no patient of these cohorts has a Treatment event with SUBTYPE = Immuno. SUBTYPE takes: Chemo (1,200 patients), Targeted (30 patients)");
    assert.ok(labels.includes("txendpoints:anchor-values"));
  });

  test("no anchor and no key: nothing more is asked; a failing values query still refuses plainly", async () => {
    const labels: string[] = [];
    const one = ctx({ A: cohort({ s1: 5 }) }, { s1: resolver({}, labels) });
    const r = await run({ anchor: { eventType: "Treatment" } }, one);
    assert.equal(r.error, "no patient of “A” has a Treatment event");
    assert.ok(!labels.includes("txendpoints:anchor-values"));
    const t = await run({}, ctx({ A: cohort({ s1: 5 }) }, { s1: resolver({ anchorValues: "throw" }) }));
    assert.equal(t.error, "no patient of “A” has a Treatment event with SUBTYPE = Immuno");
  });

  test("anchored patients but none at risk: each cohort's reasons, with stop dates on tot", async () => {
    const rows = { A: [row(0, 0, 3, { kind: "nofollowup" })], B: [row(0, 0, 2, { kind: "nostop" })] };
    const r = await run({}, two({ rows }));
    assert.equal(r.error, "no anchored patient could enter the risk set: A — 3 without follow-up after the anchor; B — 0 without follow-up after the anchor");
    const t = await run({ endpoint: "tot" }, two({ rows }));
    assert.match(t.error!, /A — 3 without follow-up after the anchor, 0 without a stop date; B — 0 without follow-up after the anchor, 2 without a stop date/);
  });
});
