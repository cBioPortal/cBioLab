// The RMST view's runner (lib/views/rmst/run.ts), driven with hand-made participants: its refusals,
// the default τ (the largest time every cohort still has 10 at risk), a τ past follow-up, landmarks,
// the treatment anchor and its clock check, and what it says it left out. The restricted mean itself
// is checked against hand computation in test/rmst.test.ts; here the inputs are uncensored, so the
// RMST to τ is simply the mean of min(t, τ).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runRmst } from "../lib/views/rmst/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { RmstView } from "../lib/views/rmst/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
type SurvCount = { months: number; event: number; n: number; entry?: number };

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + " vs " + b);
/** one event per listed time */
const events = (times: number[]): SurvCount[] => times.map((t) => ({ months: t, event: 1, n: 1 }));
const range = (from: number, to: number, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

interface Site {
  /** survivalCounts per cohort name (the def passed is { name }) */
  counts?: Record<string, SurvCount[]>;
  /** viewAggregate answers by label prefix */
  agg?: (label: string) => Row[];
  endpoints?: () => Promise<string[]>;
  remote?: boolean;
}
function resolver(s: Site, seen: { columns?: unknown; endpoint?: unknown }[] = []) {
  const r: Record<string, unknown> = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    survivalCounts: async (def: { name: string }, endpoint: string, _a: unknown, columns: unknown) => {
      seen.push({ endpoint, columns });
      return s.counts?.[def.name] ?? [];
    },
    survivalEndpoints: s.endpoints ?? (async () => ["OS"]),
  };
  if (!s.remote) r.viewAggregate = async (label: string, _def: unknown, build: (c: string, st: string, db: string) => unknown) => {
    build("SELECT 1", "s1", "db");
    return s.agg ? s.agg(label) : [];
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
const run = (view: Partial<RmstView>, c: ViewRun) => runRmst({ kind: "rmst", ...view } as RmstView, c);
type Rmst = NonNullable<Extract<ViewResult, { kind: "rmst" }>["rmst"]>;
const rmstOf = (r: ViewResult): Rmst => { assert.equal(r.error, undefined, String(r.error)); return (r as unknown as { rmst: Rmst }).rmst; };

// A: one death at each of months 1..12; B: one at each of 2, 4, …, 24 — 12 patients each, all events.
// At risk at time t is the number with t_i ≥ t: A has ≥ 10 at risk up to t = 3, B up to t = 6, so the
// default τ is min(3, 6) = 3. RMST(A, 3) = (1 + 2 + 3·10)/12 = 33/12; RMST(B, 3) = (2 + 3·11)/12 = 35/12.
const A = events(range(1, 12)), B = events(range(2, 24, 2));
const twoCohorts = (extra: Site = {}) => ctx({ A: cohort({ s1: 14 }), B: cohort({ s1: 12 }) }, { s1: resolver({ counts: { A, B }, ...extra }) });

describe("rmst: refusals", () => {
  const one = () => twoCohorts();
  const cases: [string, Partial<RmstView>, RegExp][] = [
    ["a malformed endpoint", { endpoint: "1OS" }, /bad endpoint '1OS'/],
    ["monthsAttribute without statusAttribute", { monthsAttribute: "PFS_M" }, /monthsAttribute and statusAttribute go together/],
    ["an attribute that is not a name", { monthsAttribute: "a b", statusAttribute: "S" }, /“a b” is not an attribute name/],
    ["an anchor without an event type", { anchor: {} as never }, /needs anchor: \{eventType/],
    ["an anchor with another endpoint", { anchor: { eventType: "Treatment" }, endpoint: "PFS" }, /an anchor measures overall survival/],
    ["an anchor with endpoint columns", { anchor: { eventType: "Treatment" }, monthsAttribute: "M", statusAttribute: "S" }, /an anchor measures overall survival/],
    ["decreasing landmarks", { landmarkMonths: [6, 0] }, /landmarkMonths is 1 to 4 increasing month values/],
    ["five landmarks", { landmarkMonths: [0, 1, 2, 3, 4] }, /landmarkMonths is 1 to 4/],
    ["a landmark past 120 months", { landmarkMonths: [121] }, /landmarkMonths is 1 to 4/],
    ["an empty landmark list", { landmarkMonths: [] }, /landmarkMonths is 1 to 4/],
    ["τ of zero", { tau: 0 }, /tau is a positive number of months \(at most 600\)/],
    ["τ past 600 months", { tau: 601 }, /tau is a positive number/],
  ];
  for (const [what, view, re] of cases) test(what + " is refused", async () => {
    const r = await run(view, one());
    assert.match(r.error!, re);
  });

  test("more than 6 cohorts is refused, naming cohorts", async () => {
    const cs = Object.fromEntries(range(1, 7).map((i) => ["C" + i, cohort({ s1: 1 })]));
    const r = await run({}, ctx(cs, { s1: resolver({}) }));
    assert.match(r.error!, /at most 6 cohorts/);
  });

  test("no participant that can answer: refused, naming the remote peer", async () => {
    const r = await run({}, ctx({ A: cohort({ p: 3 }) }, { p: resolver({ remote: true }) }));
    assert.match(r.error!, /no participant can answer: p is a remote peer/);
  });

  test("empty cohorts: nothing to estimate", async () => {
    const r = await run({}, ctx({ A: cohort({ s1: 0 }) }, { s1: resolver({}) }));
    assert.match(r.error!, /nothing to estimate: the cohorts are empty/);
  });

  test("patients but no follow-up on the endpoint: refused, listing what each site declares", async () => {
    const r = await run({ endpoint: "pfs" }, ctx({ A: cohort({ s1: 5, s2: 4 }) }, {
      s1: resolver({ endpoints: async () => ["OS", "DFS"] }),
      s2: resolver({ endpoints: async () => { throw new Error("down"); } }),
    }));
    assert.match(r.error!, /no patient of these cohorts has PFS_MONTHS\/PFS_STATUS\. Endpoints declared: s1: OS, DFS; s2: none declared/);
  });

  test("…and with endpoint columns, names those columns", async () => {
    const r = await run({ monthsAttribute: "M", statusAttribute: "S" }, ctx({ A: cohort({ s1: 5 }) }, { s1: resolver({}) }));
    assert.match(r.error!, /no patient of these cohorts has M\/S\. /);
  });
});

describe("rmst: estimates", () => {
  test("default τ is the largest time every cohort keeps 10 at risk; B is compared with A", async () => {
    const r = await run({}, twoCohorts());
    const m = rmstOf(r);
    assert.equal(m.endpointLabel, "OS");
    assert.equal(m.panels.length, 1);
    const p = m.panels[0];
    assert.equal(p.landmark, 0);
    assert.equal(p.tau, 3);
    assert.equal(p.tauSet, false);
    close(p.curves[0].rmst, 33 / 12);
    close(p.curves[1].rmst, 35 / 12);
    assert.deepEqual(p.curves.map((c) => c.atRiskTau), [10, 11]);
    assert.equal(p.comparisons.length, 1);
    const cmp = p.comparisons[0];
    assert.deepEqual([cmp.cohort, cmp.vs], ["B", "A"]);
    close(cmp.diff, 2 / 12);
    close(cmp.ratio, 35 / 33);
    const seD = Math.sqrt(p.curves[0].se ** 2 + p.curves[1].se ** 2);
    close(cmp.diffHi - cmp.diff, 1.959963984540054 * seD);
    // A's cohort holds 14 patients, 12 with follow-up
    assert.deepEqual(m.cohorts.map((c) => [c.cohort, c.cohortPatients, c.n, c.noFollowup, c.noAnchor]), [["A", 14, 12, 2, 0], ["B", 12, 12, 0, 0]]);
    assert.match(r.caveat!, /τ by default the largest time at which every cohort still has 10 patients at risk \(3 months\)/);
    assert.match(r.caveat!, /mean months lived within the first τ/);
    assert.match(r.caveat!, /Left out: 2 without follow-up\./);
    assert.doesNotMatch(r.caveat!, /landmark keeps/);
    assert.equal(r.studies, undefined);
  });

  test("a set τ: RMST(A, 5) = (1+2+3+4+5·8)/12, and the caveat says τ was set", async () => {
    const r = await run({ tau: 5 }, twoCohorts());
    const p = rmstOf(r).panels[0];
    assert.equal(p.tauSet, true);
    close(p.curves[0].rmst, 50 / 12);
    close(p.curves[1].rmst, (2 + 4 + 5 * 10) / 12);
    assert.match(r.caveat!, /τ = 5 months, as set/);
  });

  test("a τ past a cohort's last follow-up is refused, naming the cohort and how far it is followed", async () => {
    const r = await run({ tau: 20 }, twoCohorts());
    assert.match(r.error!, /tau = 20 months is past the last follow-up of A \(12 months\)/);
  });

  test("a non-OS endpoint is event-free time, and endpoint columns label the view", async () => {
    const seen: { columns?: unknown; endpoint?: unknown }[] = [];
    const r = await run({ monthsAttribute: "PFS_M", statusAttribute: "PFS_S" },
      ctx({ A: cohort({ s1: 12 }) }, { s1: resolver({ counts: { A } }, seen) }));
    assert.equal(rmstOf(r).endpointLabel, "PFS_M/PFS_S");
    assert.deepEqual(seen[0].columns, { months: "PFS_M", status: "PFS_S" });
    const pfs = await run({ endpoint: "PFS" }, ctx({ A: cohort({ s1: 12 }) }, { s1: resolver({ counts: { A } }) }));
    assert.match(pfs.caveat!, /mean months free of the event within the first τ/);
  });

  test("landmarks: from month 4, A keeps the 8 still followed with their clock restarted", async () => {
    // A past 4: deaths at 5..12 → 1..8 on the new clock; RMST to τ = 2 is (1 + 2·7)/8.
    // B past 4: 6, 8, …, 24 → 2, 4, …, 20 (10 patients); RMST to 2 is 2.
    const r = await run({ tau: 2, landmarkMonths: [0, 4] }, twoCohorts());
    const m = rmstOf(r);
    assert.deepEqual(m.panels.map((p) => p.landmark), [0, 4]);
    const p4 = m.panels[1];
    assert.deepEqual(p4.curves.map((c) => [c.n, c.beforeLandmark]), [[8, 4], [10, 2]]);
    close(p4.curves[0].rmst, 15 / 8);
    close(p4.curves[1].rmst, 2);
    assert.match(r.caveat!, /A landmark keeps only the patients alive and still followed at it/);
  });

  test("landmarks with the default τ: a cohort left with fewer than 10 at risk is named", async () => {
    const r = await run({ landmarkMonths: [0, 4] }, twoCohorts());
    assert.match(r.error!, /every cohort needs at least 10 patients at risk after the 4-month landmark to set tau; A has fewer/);
  });

  test("the default τ with no cohort keeping 10 at risk names them all", async () => {
    const r = await run({}, ctx({ A: cohort({ s1: 3 }), B: cohort({ s1: 3 }) }, { s1: resolver({ counts: { A: events([1, 2, 3]), B: events([1, 2]) } }) }));
    assert.match(r.error!, /every cohort needs at least 10 patients at risk to set tau; A, B have fewer/);
  });

  test("two studies are pooled into one cohort and named; a remote peer is left out by name", async () => {
    const r = await run({ tau: 3 }, ctx({ A: cohort({ s1: 6, s2: 6, p: 5 }) }, {
      s1: resolver({ counts: { A: events(range(1, 6)) } }),
      s2: resolver({ counts: { A: events(range(7, 12)) } }),
      p: resolver({ remote: true }),
    }));
    const m = rmstOf(r);
    assert.equal(m.panels[0].curves[0].n, 12);
    close(m.panels[0].curves[0].rmst, 33 / 12);
    // the cohort's 17 patients include the peer's 5, whose follow-up is not known here
    assert.equal(m.cohorts[0].cohortPatients, 12);
    assert.deepEqual(r.studies, ["s1", "s2", "p"]);
    assert.deepEqual(m.excludedStudies!.map((e) => e.study), ["p"]);
    assert.match(r.caveat!, /\(3 studies here, whose day 0 need not match\)/);
    assert.match(r.caveat!, /Left out: p \(a remote peer/);
  });
});

describe("rmst: from a treatment anchor", () => {
  const anchor = { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" };
  const record = (t: number, extra: Row = {}): Row => ({ kind: "record", entry: 0, t, ev: 1, n: 1, late: 0, ...extra });

  test("OS from the first matching treatment: patients without it, and without follow-up after it, are counted apart", async () => {
    // 15 in the cohort; 14 anchored (12 followed, 2 not), so 1 lacks the anchor.
    const rows = [...range(1, 12).map((t) => record(t)), { kind: "no_followup", n: 2, late: 0 }];
    const r = await run({ anchor, tau: 3 }, ctx({ A: cohort({ s1: 15 }) }, { s1: resolver({ agg: () => rows }) }));
    const m = rmstOf(r);
    assert.equal(m.endpointLabel, "OS from first Treatment [SUBTYPE=Immuno]");
    assert.equal(m.anchoredTo, "first Treatment [SUBTYPE=Immuno]");
    assert.deepEqual([m.cohorts[0].n, m.cohorts[0].noFollowup, m.cohorts[0].noAnchor], [12, 2, 1]);
    close(m.panels[0].curves[0].rmst, 33 / 12);
    assert.match(r.caveat!, /The clock starts at each patient's first Treatment \[SUBTYPE=Immuno\] record/);
    assert.match(r.caveat!, /checked: 0 of 14 anchored patients/);
    assert.match(r.caveat!, /Left out: 1 without the anchor, 2 without follow-up/);
  });

  test("an anchor before day 0 enters the risk set late (left truncation)", async () => {
    const rows = [...range(1, 11).map((t) => record(t)), record(12, { entry: 2 })];
    const r = await run({ anchor: { eventType: "Treatment", occurrence: "LAST" }, tau: 3 }, ctx({ A: cohort({ s1: 12 }) }, { s1: resolver({ agg: () => rows }) }));
    const m = rmstOf(r);
    assert.equal(m.endpointLabel, "OS from last Treatment");
    // the patient entering at 2 is at risk only after 2 (entry < t): 11 at risk at t=1 (not 12), 10 at t=2.
    // S(1) = 10/11, S(2) = 10/11·9/10 = 9/11; area to 3 = 1 + 10/11 + 9/11
    close(m.panels[0].curves[0].rmst, 1 + 10 / 11 + 9 / 11);
  });

  test("a study whose timeline runs past OS_MONTHS for more than 5% of anchored patients is refused", async () => {
    const rows = [record(1, { late: 1 }), ...range(2, 10).map((t) => record(t))];
    const r = await run({ anchor, tau: 1 }, ctx({ A: cohort({ s1: 10 }) }, { s1: resolver({ agg: () => rows }) }));
    assert.match(r.error!, /do not share a clock in s1 \(1 anchored patient of 10 have timeline events more than 31 days after OS_MONTHS\)/);
  });

  test("no cohort patient has the anchor: refused, listing the values its key takes", async () => {
    const r = await run({ anchor }, ctx({ A: cohort({ s1: 8 }) }, { s1: resolver({
      agg: (label) => label === "rmst:anchor-values" ? [{ test: "Chemo", patients: 5 }, { test: "Targeted", patients: 2 }] : [],
    }) }));
    assert.match(r.error!, /no patient of “A” has a Treatment event with SUBTYPE = Immuno\. SUBTYPE takes: Chemo \(5 patients\), Targeted \(2 patients\)/);
  });

  test("…and without a key, no values are asked for", async () => {
    const asked: string[] = [];
    const r = await run({ anchor: { eventType: "Surgery" } }, ctx({ A: cohort({ s1: 8 }), B: cohort({ s1: 2 }) }, { s1: resolver({ agg: (l) => { asked.push(l); return []; } }) }));
    assert.match(r.error!, /no patient of these cohorts has a Surgery event$/);
    assert.ok(!asked.includes("rmst:anchor-values"));
  });

  test("anchored patients with no follow-up after the anchor: refused, saying so", async () => {
    const r = await run({ anchor }, ctx({ A: cohort({ s1: 4 }) }, { s1: resolver({ agg: () => [{ kind: "no_followup", n: 4, late: 0 }] }) }));
    assert.match(r.error!, /no patient of these cohorts has OS_MONTHS\/OS_STATUS follow-up after the anchor/);
  });
});
