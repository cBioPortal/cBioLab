// The multistate view's runner (lib/views/multistate/run.ts), driven with hand-made participants
// answering the id-free (prevalent, tp, te, dead, n) counts of multistateCountsSql: refusals, the
// clock check, the per-cohort illness–death summaries, and a Cox ratio per transition against the
// first cohort (lib/views/multistate/doc.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runMultistate } from "../lib/views/multistate/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import { Z_975 } from "../lib/stats.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, number | string>;
type Fake = Record<string, unknown> & { instance: { id: string; mode: string; label: string; conn: unknown } };
/** a participant answering each cohort's counts by cohort name, and the progression-values fallback */
const site = (byCohort: Record<string, Row[]>, values: Row[] | "fail" = []): Fake => ({
  instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
  viewAggregate: async (key: string, _def: unknown, sql: (c: string, s: string, d: string) => unknown) => {
    asked.push(String(sql("SELECT pid FROM cohort_pids", "s1", "db")));
    if (key !== "multistate:progression-values") return byCohort[key.replace(/^multistate:/, "")] ?? [];
    if (values === "fail") throw new Error("peer timed out");
    return values;
  },
});
/** the SQL each participant was handed, in order */
const asked: string[] = [];
const remotePeer = (): Fake => ({ instance: { id: "peer", mode: "aggregate-only", label: "peer", conn: PRIMARY } });

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, Fake>): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = (view: Record<string, unknown>, c: ViewRun) => runMultistate({ kind: "multistate", ...view } as never, c);
type MS = { cohorts: { cohort: string; n: number; prevalent: number; excluded: { noFollowup: number; prevalent: number }; notAssessed: number; afterEnd: number; seq0: number;
    rates: { key: string; events: number; personMonths: number; rate: number; lo: number | null; hi: number | null }[]; drawnTo: number;
    atHorizon: { months: number; p0: number | null; p1: number | null; p2: number | null; atRisk: number }[]; occupation: { t: number }[]; cumhaz: Record<string, { t: number; h: number }[]> }[];
  cox: { key: string; rows: { cohort: string; hr: number; lo: number; hi: number; p: number }[]; n: number; events: number; noFit?: string }[];
  origin: string; reference: string; cutoffMonths?: number; tMax: number; prevalent: string; excludedStudies?: { study: string; reason: string }[] };
const msOf = (r: ViewResult) => (r as unknown as { multistate: MS }).multistate;
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, a + " ≠ " + b);

const rec = (tp: number, te: number, dead: number, n: number, flags: Partial<Record<"prevalent" | "assessed" | "seq0" | "late" | "afterend", number>> = {}): Row =>
  ({ kind: "record", prevalent: 0, tp, te, dead, afterend: 0, assessed: 1, seq0: 1, late: 0, n, ...flags });
/** each path k times: progress at 1, die at 3 · die at 2 without progressing · censored at 4 · progress at 2, censored at 5 */
const toy = (k: number, flags: Parameters<typeof rec>[4] = {}): Row[] =>
  [rec(1, 3, 1, k, flags), rec(0, 2, 1, k, flags), rec(0, 4, 0, k, flags), rec(2, 5, 0, k, flags)];

describe("multistate: refusals before any data is read", () => {
  const one = () => ctx({ A: cohort({ s1: 40 }) }, { s1: site({ A: toy(10) }) });
  const err = async (view: Record<string, unknown>, c = one()) => (await run(view, c)).error!;
  test("more than 4 cohorts", async () => {
    const c = ctx(Object.fromEntries(["A", "B", "C", "D", "E"].map((n) => [n, cohort({ s1: 1 })])), { s1: site({}) });
    assert.match(await err({}, c), /at most 4 cohorts; this asks for 5/);
  });
  test("a progression with too many values, or a probability key without a floor", async () => {
    assert.match(await err({ progression: { values: Array.from({ length: 11 }, (_, i) => "v" + i) } }), /at most 10 values/);
    assert.match(await err({ progression: { probabilityKey: "P" } }), /needs minProbability/);
  });
  test("prevalent other than include or exclude", async () => assert.match(await err({ prevalent: "drop" }), /prevalent is "include"/));
  test("horizons: none, more than 6, or outside (0, 600]", async () => {
    for (const horizons of [[], [1, 2, 3, 4, 5, 6, 7], [0], [601]]) assert.match(await err({ horizons }), /horizons are 1 to 6 month values/);
  });
  test("cutoffMonths not in (0, 1200]", async () => {
    for (const cutoffMonths of [0, 1201, "soon"]) assert.match(await err({ cutoffMonths }), /cutoffMonths is a positive number of months/);
  });
  test("no participant serves the view's aggregates", async () =>
    assert.match(await err({}, ctx({ A: cohort({ s2: 9 }) }, { s2: remotePeer() })), /no participant can answer: s2 is a remote peer/));
});

describe("multistate: nothing to model", () => {
  test("timeline events past OS_MONTHS in more than 5% of a study: the clock check refuses it, by study", async () => {
    const r = await run({}, ctx({ A: cohort({ s1: 40 }) }, { s1: site({ A: toy(10, { late: 1 }) }) }));
    assert.match(r.error!, /^the timeline and OS_MONTHS do not share a clock in s1 \(40 patients of 40 have timeline events more than \d+ days after OS_MONTHS\)/);
  });
  test("no follow-up, and none left once prevalent patients are excluded", async () => {
    const r = await run({}, ctx({ A: cohort({ s1: 5 }) }, { s1: site({ A: [{ kind: "nofollowup", n: 5 }] }) }));
    assert.equal(r.error, "no patient of “A” has follow-up (OS_MONTHS > 0 and OS_STATUS)");
    const r2 = await run({ prevalent: "exclude" }, ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }) }, { s1: site({ A: [rec(0, 3, 1, 5, { prevalent: 1 })], B: [] }) }));
    assert.equal(r2.error, "no patient of these cohorts has follow-up (OS_MONTHS > 0 and OS_STATUS) without a progression by day 0");
  });
  test("no progression record: says what the key does take, or that no event carries it", async () => {
    const unassessed = toy(10, { assessed: 0 }).map((r) => ({ ...r, tp: 0 }));
    const r = await run({}, ctx({ A: cohort({ s1: 40 }) }, { s1: site({ A: unassessed }, [{ test: "No", patients: 1234 }, { test: "Unknown", patients: 3 }]) }));
    assert.equal(r.error, "no patient of “A” has a Diagnosis event with PROGRESSION in Y / Yes. PROGRESSION takes: No (1,234 patients), Unknown (3 patients)");
    const r2 = await run({ progression: { eventType: "Imaging", key: "PROG" } }, ctx({ A: cohort({ s1: 40 }) }, { s1: site({ A: unassessed }) }));
    assert.match(r2.error!, /no patient of “A” has a Imaging event with .*\. No Imaging event here carries PROG — set progression.eventType/);
  });
  test("the progression-values lookup failing still refuses, without the list", async () => {
    const unassessed = toy(10, { assessed: 0 }).map((r) => ({ ...r, tp: 0 }));
    const r = await run({}, ctx({ A: cohort({ s1: 40 }) }, { s1: site({ A: unassessed }, "fail") }));
    assert.match(r.error!, /\. No Diagnosis event here carries PROGRESSION/);
  });
  test("each participant is asked for the cohort's counts, never its ids", async () => {
    asked.length = 0;
    await run({}, ctx({ A: cohort({ s1: 40 }) }, { s1: site({ A: toy(10) }) }));
    assert.equal(asked.length, 1);
    assert.match(asked[0], /^WITH cohort AS \(SELECT pid FROM cohort_pids\)/);
    assert.match(asked[0], /count\(\) AS n\s+FROM cls GROUP BY kind/);
  });
});

describe("multistate: one cohort", () => {
  test("rates per 100 person-months, occupation at the horizons, drawn while 10 are followed", async () => {
    const r = await run({ horizons: [1, 3, 12] }, ctx({ A: cohort({ s1: 45 }) }, { s1: site({ A: [...toy(10), { kind: "nofollowup", n: 5 }] }) }));
    assert.equal(r.error, undefined);
    const ms = msOf(r), c = ms.cohorts[0];
    assert.equal(c.n, 40);
    assert.equal(c.excluded.noFollowup, 5);
    // state 0: 10×(1+2+4+2) = 90 person-months; state 1: 10×(2+3) = 50
    const rate = Object.fromEntries(c.rates.map((q) => [q.key, q]));
    assert.deepEqual([rate["01"].events, rate["02"].events, rate["12"].events], [20, 10, 10]);
    assert.deepEqual([rate["01"].personMonths, rate["12"].personMonths], [90, 50]);
    close(rate["01"].rate, 2000 / 90); close(rate["02"].rate, 1000 / 90); close(rate["12"].rate, 20);
    close(rate["12"].lo!, 20 * Math.exp(-Z_975 / Math.sqrt(10))); close(rate["12"].hi!, 20 * Math.exp(Z_975 / Math.sqrt(10)));
    assert.equal(c.drawnTo, 5, "the 10th-latest end of follow-up");
    assert.ok(c.occupation.every((q) => q.t <= 5));
    assert.deepEqual(c.atHorizon, [{ months: 1, p0: 0.75, p1: 0.25, p2: 0, atRisk: 40 }, { months: 3, p0: 0.25, p1: 0.25, p2: 0.5, atRisk: 30 },
      { months: 12, p0: null, p1: null, p2: null, atRisk: 0 }]);
    assert.equal(ms.origin, "first sequencing");
    assert.deepEqual(ms.cox, [], "no second cohort, no hazard ratio");
    assert.match(r.caveat!, /day 0 = first sequencing/);
    assert.match(r.caveat!, /Left out: 5 without follow-up/);
  });

  test("prevalent patients start progressed, or are left out; a cutoff censors administratively", async () => {
    const rows = [...toy(10), rec(0, 6, 1, 10, { prevalent: 1 })];
    const inc = msOf(await run({}, ctx({ A: cohort({ s1: 50 }) }, { s1: site({ A: rows }) })));
    assert.deepEqual([inc.cohorts[0].n, inc.cohorts[0].prevalent, inc.prevalent], [50, 10, "include"]);
    const r = await run({ prevalent: "exclude", cutoffMonths: 3.5 }, ctx({ A: cohort({ s1: 50 }) }, { s1: site({ A: rows }) }));
    const exc = msOf(r);
    assert.deepEqual([exc.cohorts[0].n, exc.cohorts[0].excluded.prevalent, exc.cutoffMonths], [40, 10, 3.5]);
    assert.equal(exc.cohorts[0].drawnTo, 3.5, "no follow-up past the cutoff");
    assert.match(r.caveat!, /10 patients with a progression on or before day 0 are left out/);
    assert.match(r.caveat!, /Administratively censored at 3.5 months/);
  });

  test("day 0 that is not sequencing, unassessed and after-end patients, and a peer left out are all said", async () => {
    const rows = [...toy(10, { seq0: 0 }), rec(0, 3, 1, 4, { seq0: 0, assessed: 0 }), rec(0, 4, 0, 3, { seq0: 0, afterend: 1 })];
    const r = await run({}, ctx({ A: cohort({ s1: 47, s2: 8 }) }, { s1: site({ A: rows }), s2: remotePeer() }));
    const ms = msOf(r), c = ms.cohorts[0];
    assert.deepEqual([c.notAssessed, c.afterEnd, c.seq0], [4, 3, 0]);
    assert.equal(ms.origin, "the timeline's day 0");
    assert.deepEqual(ms.excludedStudies, [{ study: "s2", reason: "a remote peer, which does not serve this view's aggregates yet" }]);
    assert.deepEqual(r.studies, ["s1", "s2"]);
    assert.match(r.caveat!, /early death is understated/);
    assert.match(r.caveat!, /4 patients in the model have no PROGRESSION record/);
    assert.match(r.caveat!, /3 with a progression only on or after their end of follow-up/);
    assert.match(r.caveat!, /Left out: s2 \(a remote peer/);
  });
});

describe("multistate: cohorts compared", () => {
  test("cohorts with the same paths have hazard ratio 1 on every transition, a baseline per study", async () => {
    const r = await run({}, ctx({ A: cohort({ s1: 20, s3: 20 }), B: cohort({ s1: 12, s3: 8 }) },
      { s1: site({ A: toy(5), B: toy(3) }), s3: site({ A: toy(5), B: toy(2) }) }));
    const ms = msOf(r);
    assert.equal(ms.reference, "A");
    assert.deepEqual(ms.cox.map((x) => x.key), ["01", "02", "12"]);
    for (const x of ms.cox) {
      assert.equal(x.noFit, undefined);
      assert.equal(x.rows[0].cohort, "B");
      close(x.rows[0].hr, 1, 1e-6);
      assert.ok(x.rows[0].lo < 1 && x.rows[0].hi > 1);
    }
    // 0→1 and 0→2: every patient at risk from day 0; 1→2: only the progressed, entering at their progression
    assert.deepEqual(ms.cox.map((x) => [x.n, x.events]), [[60, 30], [60, 15], [30, 15]]);
    assert.match(r.caveat!, /each cohort against A, a baseline hazard per study/);
  });

  test("cohorts each wholly in their own study cannot be told from the study's baseline: no ratio, and why", async () => {
    const ms = msOf(await run({}, ctx({ A: cohort({ s1: 40 }), B: cohort({ s3: 20 }) }, { s1: site({ A: toy(10) }), s3: site({ B: toy(5) }) })));
    for (const x of ms.cox) {
      assert.deepEqual(x.rows, []);
      assert.match(x.noFit!, /not identifiable/);
    }
  });

  test("a cohort with fewer than 5 events in a transition gets no ratio for it, and is named", async () => {
    const ms = msOf(await run({}, ctx({ A: cohort({ s1: 40 }), B: cohort({ s1: 8 }) }, { s1: site({ A: toy(10), B: toy(2) }) })));
    for (const x of ms.cox) {
      assert.deepEqual(x.rows, []);
      assert.equal(x.noFit, "B has fewer than 5 events");
    }
  });
});
