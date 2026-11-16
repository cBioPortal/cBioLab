// The survival view's runner (lib/views/survival/run.ts), driven with hand-made participants that
// answer (months, event, n) counts. Expected numbers are computed by hand from the spec
// (lib/views/survival/doc.ts): Kaplan–Meier per cohort, a two-sided log-rank for 2 cohorts, the
// k-group generalisation for 3+, stratified by study across studies with the pooled test beside it,
// refused when an arm has fewer than 10 patients.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runSurvival } from "../lib/views/survival/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { SurvivalCount } from "../lib/federation.ts";
import { PRIMARY } from "../lib/ch.ts";
import { kindText } from "./support/kind-text.ts";
import { survivalKind } from "../lib/views/survival/kind.ts";

/** counts per cohort, per study, as each site answers them */
type Answers = Record<string, Record<string, SurvivalCount[]>>;

/** a study's counts per endpoint, where a test gives each endpoint its own; otherwise every endpoint reads `answers` */
let BY_ENDPOINT: Record<string, Answers> = {};
/** the _STATUS attributes' metadata every study's database returns */
let STATUS_META: { a: string; label: string; priority: number }[] = [];
/** patients each study's database finds in more than one of the cohorts; a study listed as "remote" cannot be asked */
let SHARED: Record<string, number | "remote"> = {};
const sharedAsked: { study: string; label: string; cohorts: string[]; sql: string }[] = [];
/** the partition query's answer per study and endpoint: rows of (mask over the cohorts asked, m, ev, n) */
type PartRow = { mask: number; m: number | null; ev: number; n: number };
let PARTS: Record<string, Record<string, PartRow[]>> = {};
const partsAsked: { study: string; cohorts: string[]; endpoint: string; sql: string }[] = [];

function site(study: string, answers: Answers, endpoints: string[] | "fail" = [], seen?: unknown[][]) {
  const aggregates = SHARED[study] === "remote" ? {} : {
    viewAggregate: async () => [],
    viewMeta: async (label: string, build: (st: string, db: string) => string) => {
      assert.equal(label, "survivalStatusMeta");
      assert.match(build(study, "db"), /LIKE '%\\\\_STATUS'/);
      return STATUS_META;
    },
    viewAggregateMany: async (label: string, defs: { name: string }[], build: (sqls: string[], st: string, db: string) => string) => {
      const sql = build(defs.map((d) => "SELECT pid, sid FROM " + d.name), study, "db");
      if (/ AS mask/.test(sql)) {
        const endpoint = /'([A-Z0-9_]+)_MONTHS'/.exec(sql)![1];
        partsAsked.push({ study, cohorts: defs.map((d) => d.name), endpoint, sql });
        return PARTS[study]?.[endpoint] ?? [];
      }
      sharedAsked.push({ study, label, cohorts: defs.map((d) => d.name), sql });
      return [{ n: SHARED[study] ?? 0 }];
    },
  };
  return {
    ...aggregates,
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY }, study,
    survivalCounts: async (def: { name: string }, endpoint: string, anchor: unknown, columns: unknown) => {
      seen?.push([def.name, study, endpoint, anchor, columns]);
      return (BY_ENDPOINT[endpoint] || answers)[def.name]?.[study] ?? [];
    },
    survivalEndpoints: async () => { if (endpoints === "fail") throw new Error("down"); return endpoints; },
  };
}

function ctx(counts: Record<string, Record<string, number>>, answers: Answers, endpoints: Record<string, string[] | "fail"> = {}, seen?: unknown[][]): ViewRun {
  const vNames = Object.keys(counts);
  const vStudies = [...new Set(vNames.flatMap((n) => Object.keys(counts[n])))];
  const cohorts: Record<string, EvaluatedCohort> = Object.fromEntries(vNames.map((n) => [n, {
    studies: Object.keys(counts[n]),
    perStudy: Object.fromEntries(Object.entries(counts[n]).map(([st, k]) => [st, { sql: "", count: k, samples: k, mode: "patient-level" }])),
    count: Object.values(counts[n]).reduce((a, b) => a + b, 0), samples: 0, text: "",
  }]));
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { name: n }])), views: [] } as never,
    cohorts, resolvers: Object.fromEntries(vStudies.map((st) => [st, site(st, answers, endpoints[st] ?? [], seen)])) as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const unwrap = (r: ViewResult | Untimed): ViewResult => (r instanceof Untimed ? r.result : r);
type Out = ViewResult & {
  curves: { cohort: string; n: number; events: number; median: number | null; missing?: number; unobserved?: number; points: { t: number; s: number }[] }[];
  logrank?: { chi2: number; p: number; df: number; strata: number }; logrankPooled?: { chi2: number; p: number };
  logrankK?: { chi2: number; p: number; df: number; strata: number; groups: number }; logrankKPooled?: { chi2: number; p: number };
  entryMonths?: { median: number; p90: number; max: number }; anchoredTo?: string; truncated?: boolean; cutoffMonths?: number; tickMonths?: number; display?: string;
  method: { steps: unknown[] };
};
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), a + " ≠ " + b);

// Ten events at month 1 against ten censored at month 2: one event time, n 20, d 10, 10 in A.
// O_A − E_A = 10 − 5 = 5; V = n_A·n_B·d·(n−d)/(n²(n−1)) = 10·10·10·10/(400·19) = 25/19; χ² = 25/(25/19) = 19.
const DIE = (n = 10): SurvivalCount[] => [{ months: 1, event: 1, n }];
const LIVE = (n = 10): SurvivalCount[] => [{ months: 2, event: 0, n }];
// χ²₁ survival: P(χ²₁ > x) = erfc(√(x/2)); for x = 19, ≈ 1.3101e-5
const P19 = 1.3101e-5;

describe("survival: refusals before anything is asked", () => {
  for (const [name, view, re] of [
    ["a malformed endpoint", { endpoint: "os months" }, /bad survival endpoint 'OS MONTHS'/],
    ["only one of monthsAttribute / statusAttribute", { monthsAttribute: "PFS_M" }, /must both be given as valid attribute names.*'PFS_M'\/''/],
    ["an attribute name that is not one", { monthsAttribute: "A B", statusAttribute: "S" }, /must both be given/],
    ["a cutoff of 0", { cutoffMonths: 0 }, /bad cutoffMonths '0'/],
    ["a cutoff past 1200 months", { cutoffMonths: 1201 }, /max 1200/],
    ["a non-numeric cutoff", { cutoffMonths: "soon" }, /bad cutoffMonths 'soon'/],
    ["a tick of -1", { tickMonths: -1 }, /bad tickMonths '-1'/],
    ["a tick past 600 months", { tickMonths: 601 }, /bad tickMonths/],
  ] as const) test(name + " is refused untimed", async () => {
    const r = await runSurvival({ kind: "survival", ...view } as never, ctx({ A: { s1: 10 } }, {}));
    assert.ok(r instanceof Untimed);
    assert.match(r.result.error!, re);
  });
});

describe("survival: an empty cohort is not a missing endpoint", () => {
  test("one empty cohort is named, and the endpoint is not blamed", async () => {
    const v = unwrap(await runSurvival({ kind: "survival" } as never, ctx({ A: { s1: 0 } }, {})));
    assert.match(v.error!, /nothing to plot: cohort “A” is empty\. The endpoint is not the problem/);
  });
  test("several empty cohorts: all cohorts are empty", async () => {
    const v = unwrap(await runSurvival({ kind: "survival" } as never, ctx({ A: { s1: 0 }, B: { s1: 0 } }, {})));
    assert.match(v.error!, /nothing to plot: all cohorts are empty/);
  });
});

describe("survival: a study with patients but no data for the endpoint is named", () => {
  test("one study, standard naming, other endpoints declared: suggests them", async () => {
    const v = unwrap(await runSurvival({ kind: "survival", endpoint: "pfs" } as never, ctx({ A: { s1: 5 } }, {}, { s1: ["OS", "DFS"] })));
    assert.equal(v.error, "s1 has no PFS data (no PFS_MONTHS/PFS_STATUS). It does declare OS, DFS — pick one of those as the endpoint.");
  });
  test("one study declaring no endpoint at all (or failing to say): no survival data", async () => {
    const v = unwrap(await runSurvival({ kind: "survival" } as never, ctx({ A: { s1: 5 } }, {}, { s1: "fail" })));
    assert.match(v.error!, /^s1 has no survival data: it declares no <X>_MONTHS\/<X>_STATUS pair/);
  });
  test("one study, explicit columns: names the columns, and points at the declared endpoints", async () => {
    const view = { kind: "survival", monthsAttribute: "PFS_MONTHS_FIRST_LINE_TX", statusAttribute: "PROGRESSION_STATUS" };
    const v = unwrap(await runSurvival(view as never, ctx({ A: { s1: 5 } }, {}, { s1: ["OS"] })));
    assert.match(v.error!, /^s1 has no data in PFS_MONTHS_FIRST_LINE_TX\/PROGRESSION_STATUS \(checked because monthsAttribute\/statusAttribute were given explicitly\)\. It does declare OS/);
    const none = unwrap(await runSurvival(view as never, ctx({ A: { s1: 5 } }, {}, { s1: [] })));
    assert.ok(!/It does declare/.test(none.error!));
  });
  test("every one of several studies silent: refused, each study's declared endpoints listed", async () => {
    const v = unwrap(await runSurvival({ kind: "survival" } as never, ctx({ A: { s1: 5, s2: 3 } }, {}, { s1: ["PFS"] })));
    assert.equal(v.error, "no participating study has data in OS_MONTHS/OS_STATUS. 2 of 2 studies have no OS data and contribute no patients here (s1: PFS; s2: none declared).");
  });
  test("one of two studies silent: drawn from the other, and the caveat names the silent one", async () => {
    const v = unwrap(await runSurvival({ kind: "survival" } as never,
      ctx({ A: { s1: 4, s2: 3 } }, { A: { s1: [{ months: 5, event: 1, n: 2 }, { months: 8, event: 0, n: 2 }] } }))) as Out;
    assert.equal(v.error, undefined);
    assert.match(v.caveat!, /1 of 2 study has no OS data and contributes no patients here \(s2: none declared\)\./);
    assert.equal(v.curves[0].n, 4);
    assert.equal(v.curves[0].missing, 3, "the 3 patients of s2 are counted as missing, not dropped");
    assert.match(v.caveat!, /baselines are NOT harmonized across studies/);
  });
});

describe("survival: Kaplan–Meier and the log-rank test", () => {
  test("two cohorts in one study: unstratified log-rank, χ² 19 by hand", async () => {
    const seen: unknown[][] = [];
    const v = unwrap(await runSurvival({ kind: "survival" } as never,
      ctx({ A: { s1: 12 }, B: { s1: 10 } }, { A: { s1: DIE() }, B: { s1: LIVE() } }, {}, seen))) as Out;
    assert.deepEqual(seen.map((s) => s.slice(0, 5)), [["A", "s1", "OS", null, undefined], ["B", "s1", "OS", null, undefined]]);
    const [a, b] = v.curves;
    assert.equal(a.n, 10); assert.equal(a.events, 10); assert.equal(a.median, 1); assert.equal(a.missing, 2);
    // all ten die at month 1: S = 0, so the log band is undefined and neither end is reached (R reports NA)
    assert.deepEqual((a as { medianCi?: unknown }).medianCi, { lo: null, hi: null });
    assert.equal(b.n, 10); assert.equal(b.events, 0); assert.equal(b.median, null); assert.equal(b.missing, 0);
    assert.equal(v.logrank!.df, 1);
    close(v.logrank!.chi2, 19);
    close(v.logrank!.p, P19, 1e-3);
    assert.equal(v.logrankPooled, undefined);
    assert.match(v.caveat!, /Log-rank on a single study, so no stratification applies\./);
    assert.match(v.caveat!, /OS from each study's own baseline \(left truncation applies\)/);
    assert.ok(!/NOT harmonized/.test(v.caveat!));
  });

  test("two cohorts across two studies: stratified by study (χ² 38), pooled beside it (χ² 39)", async () => {
    // per study as above: O−E 5, V 25/19 each → stratified χ² = (5+5)²/(50/19) = 38.
    // pooled: n 40, d 20, n_A 20: O−E 10, V = 20·20·20·20/(1600·39) = 100/39 → χ² = 39.
    const v = unwrap(await runSurvival({ kind: "survival" } as never,
      ctx({ A: { s1: 10, s2: 10 }, B: { s1: 10, s2: 10 } }, { A: { s1: DIE(), s2: DIE() }, B: { s1: LIVE(), s2: LIVE() } }))) as Out;
    close(v.logrank!.chi2, 38);
    assert.equal(v.logrank!.strata, 2);
    close(v.logrankPooled!.chi2, 39);
    assert.match(v.caveat!, /The log-rank test is STRATIFIED by study \(2 strata contributed events\)/);
  });

  test("three cohorts in one study: the k-group test, χ² 29 on 2 df by hand", async () => {
    // one event time, n 30, d 10, all in A: u = O−E over A, B = (20/3, −10/3); V = d(n−d)/(n−1) · [[2,−1],[−1,2]]/9.
    // uᵀV⁻¹u = (29/200)·3·(2·400/9 − 2·200/9 + 2·100/9) = (29/200)·200 = 29; p = e^(−29/2) on 2 df.
    const v = unwrap(await runSurvival({ kind: "survival" } as never,
      ctx({ A: { s1: 10 }, B: { s1: 10 }, C: { s1: 10 } }, { A: { s1: DIE() }, B: { s1: LIVE() }, C: { s1: LIVE() } }))) as Out;
    assert.equal(v.logrank, undefined);
    close(v.logrankK!.chi2, 29);
    assert.equal(v.logrankK!.df, 2);
    close(v.logrankK!.p, Math.exp(-14.5), 1e-6);
    assert.equal(v.logrankKPooled, undefined);
    assert.match(v.caveat!, / 3-group log-rank \(2 df\) on a single study — tests whether the groups differ at all/);
  });

  test("three cohorts across two studies: the k-group test stratified, pooled beside it", async () => {
    // stratified: u doubles to (40/3, −20/3), V doubles → χ² = 2·29 = 58.
    const v = unwrap(await runSurvival({ kind: "survival" } as never,
      ctx({ A: { s1: 10, s2: 10 }, B: { s1: 10, s2: 10 }, C: { s1: 10, s2: 10 } },
        { A: { s1: DIE(), s2: DIE() }, B: { s1: LIVE(), s2: LIVE() }, C: { s1: LIVE(), s2: LIVE() } }))) as Out;
    close(v.logrankK!.chi2, 58);
    assert.equal(v.logrankK!.strata, 2);
    // pooled: n 60, d 20 all in A: u = (40/3, −20/3), V = 20·40/59 · [[2,−1],[−1,2]]/9 → χ² = (59/800)·3·(800/3) = 59
    close(v.logrankKPooled!.chi2, 59);
    assert.match(v.caveat!, /The k-group log-rank test \(3 groups, 2 df\) is STRATIFIED by study \(2 strata contributed events\)/);
  });

  test("an arm of fewer than 10 patients: the test is refused by name, the curves still drawn", async () => {
    const v = unwrap(await runSurvival({ kind: "survival" } as never,
      ctx({ A: { s1: 9 }, B: { s1: 3 } }, { A: { s1: DIE(9) }, B: { s1: LIVE(3) } }))) as Out;
    assert.equal(v.logrank, undefined);
    assert.equal(v.curves.length, 2);
    assert.match(v.caveat!, /Log-rank not computed: A \(n=9\), B \(n=3\) have fewer than 10 patients/);
    const one = unwrap(await runSurvival({ kind: "survival" } as never,
      ctx({ A: { s1: 10 }, B: { s1: 3 } }, { A: { s1: DIE() }, B: { s1: LIVE(3) } }))) as Out;
    assert.match(one.caveat!, /Log-rank not computed: B \(n=3\) has fewer than 10 patients/);
  });

  test("one cohort: no test, said so", async () => {
    const v = unwrap(await runSurvival({ kind: "survival" } as never, ctx({ A: { s1: 10 } }, { A: { s1: DIE() } }))) as Out;
    assert.equal(v.logrank, undefined); assert.equal(v.logrankK, undefined);
    assert.match(v.caveat!, /Log-rank needs at least two cohorts\.$/);
  });
});

describe("survival: cohorts that share patients — the count, and the approximate test without partitions", () => {
  const run = async (counts: Record<string, Record<string, number>>, answers: Answers, shared: Record<string, number | "remote">, view: object = {}) => {
    SHARED = shared; sharedAsked.length = 0;
    try { return unwrap(await runSurvival({ kind: "survival", ...view } as never, ctx(counts, answers))) as Out; } finally { SHARED = {}; }
  };
  test("47 shared: the test is given, and the caveat says how many and that its p is approximate", async () => {
    const v = await run({ A: { s1: 10 }, B: { s1: 10 } }, { A: { s1: DIE() }, B: { s1: LIVE() } }, { s1: 47 });
    close(v.logrank!.chi2, 19);
    assert.equal((v as { sharedPatients?: number }).sharedPatients, 47);
    assert.equal((v as { partitioned?: boolean }).partitioned, undefined);
    assert.match(v.caveat!, /47 patients are in more than one cohort, so in more than one curve; the log-rank test assumes the groups share no one, so its p is approximate\./);
    assert.deepEqual(sharedAsked.map((a) => [a.study, a.label, a.cohorts]), [["s1", "survival", ["A", "B"]]]);
    assert.match(sharedAsked[0].sql, /GROUP BY pid HAVING count\(\) > 1/);
  });
  test("no shared patient: nothing said", async () => {
    const v = await run({ A: { s1: 10 }, B: { s1: 10 } }, { A: { s1: DIE() }, B: { s1: LIVE() } }, { s1: 0 });
    close(v.logrank!.chi2, 19);
    assert.ok(!/more than one cohort/.test(v.caveat!));
  });
  test("shared patients summed over studies; a study only one cohort reaches is not asked", async () => {
    const v = await run({ A: { s1: 10, s2: 10 }, B: { s1: 10 } }, { A: { s1: DIE(), s2: DIE() }, B: { s1: LIVE() } }, { s1: 2, s2: 5 });
    assert.deepEqual(sharedAsked.map((a) => a.study), ["s1"]);
    assert.match(v.caveat!, /2 patients are in more than one cohort/);
  });
  test("a participant that cannot be asked is named, and the test still given", async () => {
    const v = await run({ A: { s1: 10, s2: 10 }, B: { s1: 10, s2: 10 } }, { A: { s1: DIE(), s2: DIE() }, B: { s1: LIVE(), s2: LIVE() } }, { s1: 0, s2: "remote" });
    close(v.logrank!.chi2, 38);
    assert.match(v.caveat!, /Whether the cohorts share patients could not be checked at s2 \(a remote peer/);
  });
  test("one cohort: nothing to ask", async () => {
    await run({ A: { s1: 10 } }, { A: { s1: DIE() } }, { s1: 5 });
    assert.equal(sharedAsked.length, 0);
  });
});

// cBioPortal's Include mode (Survival.tsx analysisGroupsComputations): the patients are partitioned by
// the set of groups each is in, one curve per set present, named "Only " + the groups in their order,
// ordered by how many groups, then by the sum of their positions; logRankTest runs over every such
// group with any patients (a group whose expected count is 0 is dropped), at any size.
describe("survival: partitions — groups that share patients drawn as their overlaps (CMP-SV-4, CMP-MD-2)", () => {
  const run = async (counts: Record<string, Record<string, number>>, answers: Answers, shared: Record<string, number | "remote">,
    parts: Record<string, Record<string, PartRow[]>>, view: object = { partitions: true, testAnySize: true }) => {
    SHARED = shared; PARTS = parts; sharedAsked.length = 0; partsAsked.length = 0;
    try { return unwrap(await runSurvival({ kind: "survival", ...view } as never, ctx(counts, answers))); } finally { SHARED = {}; PARTS = {}; }
  };
  // A, B, C as the G2 groups: Only A ten deaths at 1, Only B ten censored at 2, Only C one patient
  // without OS, A∩C five censored at 2.
  const G2 = { s1: { OS: [{ mask: 1, m: 1, ev: 1, n: 10 }, { mask: 2, m: 2, ev: 0, n: 10 }, { mask: 4, m: null, ev: 0, n: 1 }, { mask: 5, m: 2, ev: 0, n: 5 }] } };
  const ABC = { A: { s1: 15 }, B: { s1: 10 }, C: { s1: 6 } };
  // the cohorts' own counts, which say the study has the endpoint at all
  const HAS_OS = { A: { s1: DIE() } };
  test("one curve per set of cohorts, named and ordered as the portal's; each patient counted once", async () => {
    const v = await run(ABC, HAS_OS, { s1: 5 }, G2) as Out;
    assert.deepEqual(v.curves.map((c) => [c.cohort, c.n, c.events, c.missing]),
      [["Only A", 10, 10, 0], ["Only B", 10, 0, 0], ["Only C", 0, 0, 1], ["Only A, C", 5, 0, 0]]);
    assert.deepEqual(partsAsked.map((a) => [a.study, a.cohorts, a.endpoint]), [["s1", ["A", "B", "C"], "OS"]]);
    assert.equal((v as { partitioned?: boolean }).partitioned, true);
    assert.equal((v as { sharedPatients?: number }).sharedPatients, 5);
    assert.match(v.caveat!, /Overlapping patients \(5\) are plotted as distinct groups/);
    assert.ok(!/approximate/.test(v.caveat!));
  });
  test("the test runs over the groups with patients, at any size: 3 groups, χ² 24 on 2 df", async () => {
    // one event time, N 25, d 10: died (10, 0, 0) of (10, 10, 5), so O − E = (6, −4, −2) and
    // V_ij = d(N−d)/(N−1) · (n_i/N)(δ_ij − n_j/N); on the first two groups, V = [[1.5, −1], [−1, 1.5]],
    // and (6, −4)·V⁻¹·(6, −4) = 24 (statsmodels survdiff on the same 25 patients: 24.0, p 6.144e-6)
    const v = await run(ABC, HAS_OS, { s1: 5 }, G2) as Out;
    assert.equal(v.logrank, undefined);
    assert.equal(v.logrankK!.groups, 3); assert.equal(v.logrankK!.df, 2);
    close(v.logrankK!.chi2, 24, 1e-4);
    close(v.logrankK!.p, Math.exp(-24 / 2), 1e-3);
  });
  test("without testAnySize the floor of 10 still refuses it", async () => {
    const v = await run(ABC, HAS_OS, { s1: 5 }, G2, { partitions: true }) as Out;
    assert.equal(v.logrankK, undefined);
    assert.match(v.caveat!, /Log-rank not computed: Only C \(n=0\), Only A, C \(n=5\) have fewer than 10 patients/);
  });
  test("the method record names the split and recounts from the partitions' rows", async () => {
    const v = await run(ABC, HAS_OS, { s1: 5 }, G2) as Out;
    const steps = v.method.steps as { title: string; detail?: string; params?: [string, string][] }[];
    const split = steps.find((st) => st.title === "Split the patients by the cohorts they are in")!;
    assert.match(split.detail!, /5 patients are in more than one of A, B, C/);
    assert.deepEqual(split.params, [["Only A", "10 patients"], ["Only B", "10 patients"], ["Only C", "1 patient"], ["Only A, C", "5 patients"]]);
    assert.ok(steps.some((st) => st.title === "3-group log-rank test"));
    const py = (v.method as { python?: string }).python!;
    assert.ok(py.includes('"\\"Only A, C\\",s1,2,0,5"'), "the partition's rows, its name quoted in the CSV");
  });
  test("no shared patient: the cohorts as they are, and the overlaps never asked for", async () => {
    const v = await run({ A: { s1: 10 }, B: { s1: 10 } }, { A: { s1: DIE() }, B: { s1: LIVE() } }, { s1: 0 }, {}) as Out;
    assert.deepEqual(v.curves.map((c) => c.cohort), ["A", "B"]);
    close(v.logrank!.chi2, 19);
    assert.equal(partsAsked.length, 0);
  });
  test("the order: fewer cohorts first, then by the sum of their positions (Only C before Only A, B; A, B before A, C before B, C)", async () => {
    const rows = [6, 5, 4, 3, 1].map((mask) => ({ mask, m: 1, ev: 1, n: 2 }));
    const v = await run(ABC, HAS_OS, { s1: 6 }, { s1: { OS: rows } }) as Out;
    assert.deepEqual(v.curves.map((c) => c.cohort), ["Only A", "Only C", "Only A, B", "Only A, C", "Only B, C"]);
  });
  test("one group with patients: no test, said so", async () => {
    const v = await run({ A: { s1: 10 }, B: { s1: 3 } }, HAS_OS, { s1: 3 }, { s1: { OS: [{ mask: 1, m: 1, ev: 1, n: 7 }, { mask: 3, m: null, ev: 0, n: 3 }] } }) as Out;
    assert.deepEqual(v.curves.map((c) => [c.cohort, c.n]), [["Only A", 7], ["Only A, B", 0]]);
    assert.equal(v.logrank, undefined); assert.equal(v.logrankK, undefined);
    assert.match(v.caveat!, /No log-rank test: fewer than two groups have patients with OS data\./);
  });
  test("a study only one cohort reaches adds to that cohort's Only group from its own counts; the test is stratified", async () => {
    const v = await run({ A: { s1: 10, s2: 10 }, B: { s1: 13 } }, { A: { s1: [], s2: DIE() } }, { s1: 3 },
      { s1: { OS: [{ mask: 1, m: 1, ev: 1, n: 7 }, { mask: 2, m: 2, ev: 0, n: 10 }, { mask: 3, m: 2, ev: 0, n: 3 }] } }) as Out;
    assert.deepEqual(v.curves.map((c) => [c.cohort, c.n]), [["Only A", 17], ["Only B", 10], ["Only A, B", 3]]);
    assert.deepEqual(partsAsked.map((a) => a.study), ["s1"]);
    assert.ok(v.logrankKPooled, "stratified by study, the pooled test beside it");
  });
  test("refused where the overlaps cannot be counted: a remote participant, an anchor, explicit columns", async () => {
    const remote = await run({ A: { s1: 10, s2: 10 }, B: { s1: 10, s2: 10 } }, { A: { s1: DIE(), s2: DIE() }, B: { s1: LIVE(), s2: LIVE() } }, { s1: 2, s2: "remote" }, {});
    assert.match(remote.error!, /the cohorts share 2 patients, and their overlaps \(partitions\) cannot be counted at s2/);
    const anchored = await run({ A: { s1: 10 }, B: { s1: 10 } }, HAS_OS, { s1: 2 }, {}, { partitions: true, anchor: { eventType: "Treatment" } });
    assert.match(anchored.error!, /drawn only for a study's own <X>_MONTHS\/<X>_STATUS endpoint/);
  });
});

describe("survival: testAnySize — the test at any group size, as the portal gives it (CMP-MD-10, CMP-STM-3)", () => {
  test("9 against 3: χ² 11 by hand, where the floor of 10 would refuse it", async () => {
    // one event time, N 12, d 9: O_A − E_A = 9 − 6.75 = 2.25; V = 9·9·3·3/(144·11) = 729/1584; χ² = 5.0625·1584/729 = 11
    const v = unwrap(await runSurvival({ kind: "survival", testAnySize: true } as never,
      ctx({ A: { s1: 9 }, B: { s1: 3 } }, { A: { s1: DIE(9) }, B: { s1: LIVE(3) } }))) as Out;
    close(v.logrank!.chi2, 11, 1e-4);
    assert.ok(!/Log-rank not computed/.test(v.caveat!));
  });
  test("a cohort with no patients is left out of the test; with one left there is none", async () => {
    const v = unwrap(await runSurvival({ kind: "survival", testAnySize: true } as never,
      ctx({ A: { s1: 10 }, B: { s1: 4 }, C: { s1: 3 } }, { A: { s1: DIE() }, B: { s1: LIVE(4) } }))) as Out;
    assert.equal(v.logrank!.df, 1);
    const one = unwrap(await runSurvival({ kind: "survival", testAnySize: true } as never,
      ctx({ A: { s1: 10 }, B: { s1: 4 } }, { A: { s1: DIE() } }))) as Out;
    assert.equal(one.logrank, undefined);
    assert.match(one.caveat!, /No log-rank test: fewer than two groups have patients with OS data\./);
  });
});

describe("survival: the survival-type table (types, CMP-SV-1, CMP-SV-5, CMP-STM-4)", () => {
  const counts = { A: { s1: 10 }, B: { s1: 10 } };
  const run = async (view: object, endpoints: string[], byEndpoint: Record<string, Answers>, meta: typeof STATUS_META = [], shared: Record<string, number> = {}) => {
    BY_ENDPOINT = byEndpoint; STATUS_META = meta; SHARED = shared;
    const seen: unknown[][] = [];
    try { return { v: unwrap(await runSurvival({ kind: "survival", types: true, ...view } as never, ctx(counts, byEndpoint.OS || {}, { s1: endpoints }, seen))) as Out & { types?: any[] }, seen }; }
    finally { BY_ENDPOINT = {}; STATUS_META = []; SHARED = {}; }
  };
  const FOUR = { OS: { A: { s1: DIE() }, B: { s1: LIVE() } }, PFS: { A: { s1: DIE() }, B: { s1: DIE() } },
    DFS: { A: { s1: DIE() }, B: { s1: LIVE(3) } }, RFS: { A: { s1: LIVE() }, B: { s1: DIE() } } };
  const META = [{ a: "OS_STATUS", label: "Overall Survival Status", priority: 0 }, { a: "PFS_STATUS", label: "Progression Free Status", priority: 0 },
    { a: "RFS_STATUS", label: "Relapse Free Status", priority: 100 }, { a: "OTHER_STATUS", label: "x", priority: 9 }];
  test("every declared endpoint: titles, the portal's order, patients, p by the curve's rules, BH q over those tested", async () => {
    const { v, seen } = await run({}, ["DFS", "OS", "PFS", "RFS"], FOUR, META);
    const t = v.types!;
    // OS 400, DFS 300, PFS 250, then RFS by its _STATUS priority (100)
    assert.deepEqual(t.map((x) => [x.endpoint, x.title, x.priority, x.patients]),
      [["OS", "Overall", 400, 20], ["DFS", "DFS", 300, 13], ["PFS", "Progression Free", 250, 20], ["RFS", "Relapse Free", 100, 20]]);
    // OS and RFS: χ² 19 by hand (10 events against 10 censored); PFS: identical groups, χ² 0, p 1; DFS: B has 3, under 10
    close(t[0].p, P19, 1e-3); close(t[3].p, P19, 1e-3); close(t[2].p, 1, 1e-9);
    assert.equal(t[1].p, undefined); assert.equal(t[1].why, "B has 3 (under 10)");
    // BH over 3 tested: sorted OS, RFS (tied), PFS → q(OS) = q(RFS) = P19·3/2, q(PFS) = 1
    close(t[0].q, t[0].p * 3 / 2, 1e-9); close(t[3].q, t[3].p * 3 / 2, 1e-9); close(t[2].q, 1, 1e-9);
    assert.equal(t[1].q, undefined);
    assert.deepEqual(t[0].groups, [{ cohort: "A", n: 10, events: 10, median: 1 }, { cohort: "B", n: 10, events: 0, median: null }]);
    // the drawn endpoint's rows are reused: OS asked once per cohort
    assert.equal(seen.filter((x) => x[2] === "OS").length, 2);
    assert.ok(seen.filter((x) => x[2] !== "OS").every((x) => x[3] === null && x[4] === undefined), "no anchor, no columns");
  });
  test("the drawn endpoint is listed even when the study does not declare it", async () => {
    const { v } = await run({ endpoint: "PFS" }, ["OS"], FOUR, META);
    assert.deepEqual(v.types!.map((x) => x.endpoint), ["OS", "PFS"]);
  });
  test("testAnySize: DFS's 3 patients in B are tested, as the portal tests them", async () => {
    const { v } = await run({ testAnySize: true }, ["DFS", "OS", "PFS", "RFS"], FOUR, META);
    const dfs = v.types!.find((x) => x.endpoint === "DFS")!;
    // one event time, N 13, d 10: O_A − E_A = 10 − 100/13; V = 10·3·10·3/(169·12); χ² = (30/13)²·169·12/900 = 12
    // P(χ²₁ > 12) = erfc(√6) ≈ 5.3200e-4
    close(dfs.p, 5.32e-4, 1e-3);
    assert.equal(dfs.why, undefined);
  });
  test("partitions: each endpoint's groups are the overlaps, asked per endpoint", async () => {
    PARTS = { s1: { OS: [{ mask: 1, m: 1, ev: 1, n: 7 }, { mask: 2, m: 2, ev: 0, n: 7 }, { mask: 3, m: 2, ev: 0, n: 3 }],
      PFS: [{ mask: 1, m: 1, ev: 1, n: 7 }, { mask: 2, m: 1, ev: 1, n: 7 }, { mask: 3, m: null, ev: 0, n: 3 }] } };
    partsAsked.length = 0;
    try {
      const { v } = await run({ partitions: true, testAnySize: true }, ["OS", "PFS"], FOUR, META, { s1: 3 });
      const [os, pfs] = v.types!;
      assert.deepEqual(os.groups.map((g: { cohort: string; n: number }) => [g.cohort, g.n]), [["Only A", 7], ["Only B", 7], ["Only A, B", 3]]);
      assert.deepEqual(pfs.groups.map((g: { cohort: string; n: number }) => [g.cohort, g.n]), [["Only A", 7], ["Only B", 7], ["Only A, B", 0]]);
      // PFS: both groups die at month 1, χ² 0, over the two with patients
      close(pfs.p, 1, 1e-9);
      assert.deepEqual(partsAsked.map((a) => a.endpoint).sort(), ["OS", "PFS"]);
      const step = (v.method.steps as { title: string }[]).find((st) => st.title.startsWith("The survival-type table"));
      assert.ok(step);
    } finally { PARTS = {}; }
  });
  test("not computed for an anchored clock or explicit columns, nor without types", async () => {
    BY_ENDPOINT = FOUR;
    try {
      for (const view of [{ types: true, anchor: { eventType: "Treatment" } }, { types: true, monthsAttribute: "M", statusAttribute: "S" }, {}]) {
        const v = unwrap(await runSurvival({ kind: "survival", ...view } as never, ctx(counts, FOUR.OS, { s1: ["OS", "PFS"] }))) as Out & { types?: unknown };
        assert.equal(v.types, undefined, JSON.stringify(view));
      }
    } finally { BY_ENDPOINT = {}; }
  });
});

describe("survival: options", () => {
  test("cutoffMonths censors everyone past it at it, and counts who was still observed beyond", async () => {
    // B's ten were censored at 2: past a 1.5-month cutoff they are censored at 1.5, and all 10 counted beyond it.
    const v = unwrap(await runSurvival({ kind: "survival", cutoffMonths: 1.5, tickMonths: 3 } as never,
      ctx({ A: { s1: 10 }, B: { s1: 10 } }, { A: { s1: DIE() }, B: { s1: LIVE() } }))) as Out;
    assert.equal(v.cutoffMonths, 1.5);
    assert.equal(v.tickMonths, 3);
    assert.ok(Math.max(...v.curves[1].points.map((p) => p.t)) <= 1.5);
    assert.match(v.caveat!, /^Administratively censored at 1\.5 months \(10 patients still under observation past this point\)\. /);
    // the test is unchanged: censoring after the only event time moves nothing
    close(v.logrank!.chi2, 19);
  });

  test("a cutoff nobody passes says nothing about patients beyond it; one patient is singular", async () => {
    const v = unwrap(await runSurvival({ kind: "survival", cutoffMonths: 100 } as never, ctx({ A: { s1: 10 } }, { A: { s1: DIE() } }))) as Out;
    assert.match(v.caveat!, /^Administratively censored at 100 months\. /);
    const one = unwrap(await runSurvival({ kind: "survival", cutoffMonths: 1.5 } as never,
      ctx({ A: { s1: 10 } }, { A: { s1: [...DIE(9), { months: 2, event: 0, n: 1 }] } }))) as Out;
    assert.match(one.caveat!, /\(1 patient still under observation past this point\)/);
  });

  test("display incidence draws 1 − S(t), says so, and keeps the median of the survival curve's data", async () => {
    // A: S drops 1 → 0 at month 1, so incidence rises 0 → 1
    const v = unwrap(await runSurvival({ kind: "survival", display: "incidence" } as never, ctx({ A: { s1: 10 } }, { A: { s1: DIE() } }))) as Out;
    assert.equal(v.display, "incidence");
    assert.deepEqual([v.curves[0].points[0].s, v.curves[0].points.at(-1)!.s], [0, 1]);
    assert.match(v.caveat!, /^Cumulative incidence \(1 - survival\) shown, not survival\. /);
  });

  test("explicit columns are passed to every site in place of <endpoint>_MONTHS/_STATUS", async () => {
    const seen: unknown[][] = [];
    const v = unwrap(await runSurvival({ kind: "survival", endpoint: "PFS", monthsAttribute: " PFS_M ", statusAttribute: "PFS_S" } as never,
      ctx({ A: { s1: 10 } }, { A: { s1: DIE() } }, {}, seen))) as Out;
    assert.equal(v.error, undefined);
    assert.deepEqual(seen[0][4], { months: "PFS_M", status: "PFS_S" });
  });

  test("an anchor: left truncation applied, entry distribution reported, the unobservable left out by count", async () => {
    // 11 observable patients entering at months 0..10 (each followed to entry + 5, an event),
    // plus 1 whose follow-up (3) ends before its entry (4): never at risk.
    // Entries sorted: 0,1,…,10 and 4 → 0,1,2,3,4,4,5,6,7,8,9,10 (12 values); index ⌊q·11⌋:
    // median → index 5 → 4; p90 → index 9 → 8; max → 10.
    const rows: SurvivalCount[] = [...Array.from({ length: 11 }, (_, e) => ({ months: e + 5, event: 1, n: 1, entry: e })), { months: 3, event: 0, n: 1, entry: 4 }];
    const seen: unknown[][] = [];
    const v = unwrap(await runSurvival({ kind: "survival", anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Chemo", occurrence: "LAST" } } as never,
      ctx({ A: { s1: 12 } }, { A: { s1: rows } }, {}, seen))) as Out;
    assert.deepEqual(seen[0][3], { eventType: "Treatment", key: "SUBTYPE", value: "Chemo", occurrence: "LAST" });
    assert.equal(v.anchoredTo, "Treatment [SUBTYPE=Chemo]");
    assert.equal(v.truncated, true);
    assert.deepEqual(v.entryMonths, { median: 4, p90: 8, max: 10 });
    assert.equal(v.curves[0].n, 11);
    assert.equal(v.curves[0].unobserved, 1);
    assert.match(v.caveat!, /1 patient whose follow-up ends at or before their entry was never at risk and is left out of the curves and the test\./);
    assert.match(v.caveat!, /OS re-anchored to last Treatment where SUBTYPE=Chemo\. LEFT TRUNCATION IS APPLIED/);
    assert.match(v.caveat!, /a median of 4 months after the anchor \(90th percentile 8, longest 10\)/);
  });

  test("rows standing for several patients: the entry quantiles and the count past a cutoff are read per patient", async () => {
    // Entries 0 ×3, 2 ×5, 7 ×2 (10 patients): sorted 0,0,0,2,2,2,2,2,7,7; index ⌊q·9⌋ → median 4 → 2,
    // p90 8 → 7, max 9 → 7. Past the 6-month cutoff: the rows at 9 (n 5) and 12 (n 2) → 7 patients.
    const rows: SurvivalCount[] = [{ months: 3, event: 1, n: 3, entry: 0 }, { months: 9, event: 0, n: 5, entry: 2 }, { months: 12, event: 1, n: 2, entry: 7 }];
    const v = unwrap(await runSurvival({ kind: "survival", cutoffMonths: 6, anchor: { eventType: "Diagnosis" } } as never,
      ctx({ A: { s1: 12 } }, { A: { s1: rows } }))) as Out;
    assert.deepEqual(v.entryMonths, { median: 2, p90: 7, max: 7 });
    assert.match(v.caveat!, /\(7 patients still under observation past this point\)/);
    assert.equal(v.curves[0].n, 8);
    assert.equal(v.curves[0].unobserved, 2);
    assert.equal(v.curves[0].missing, 2);
  });

  test("an anchor by event type alone defaults to the FIRST occurrence; without entries no distribution is given", async () => {
    const seen: unknown[][] = [];
    const v = unwrap(await runSurvival({ kind: "survival", anchor: { eventType: "Diagnosis" } } as never,
      ctx({ A: { s1: 10 } }, { A: { s1: [{ months: 3, event: 0, n: 1 }, { months: 2, event: 0, n: 1 }] } }, {}, seen))) as Out;
    assert.deepEqual(seen[0][3], { eventType: "Diagnosis", occurrence: "FIRST" });
    assert.equal(v.anchoredTo, "Diagnosis");
    assert.equal(v.entryMonths, undefined);
    assert.match(v.caveat!, /OS re-anchored to first Diagnosis\. LEFT TRUNCATION/);
    const two = unwrap(await runSurvival({ kind: "survival", anchor: { eventType: "Diagnosis" } } as never,
      ctx({ A: { s1: 2 } }, { A: { s1: [{ months: 1, event: 0, n: 1, entry: 2 }, { months: 1, event: 0, n: 1, entry: 3 }] } }))) as Out;
    assert.match(two.caveat!, /2 patients whose follow-up ends at or before their entry were never at risk and are left out/);
  });

  test("an anchor without an event type is no anchor", async () => {
    const seen: unknown[][] = [];
    const v = unwrap(await runSurvival({ kind: "survival", anchor: { key: "X" } } as never, ctx({ A: { s1: 10 } }, { A: { s1: DIE() } }, {}, seen))) as Out;
    assert.equal(seen[0][3], null);
    assert.equal(v.anchoredTo, undefined);
  });

  test("every result carries its method record", async () => {
    const v = unwrap(await runSurvival({ kind: "survival" } as never, ctx({ A: { s1: 10 }, B: { s1: 10 } }, { A: { s1: DIE() }, B: { s1: LIVE() } }))) as Out;
    assert.ok(v.method.steps.length > 0);
  });
});

test("a median never reached, patients missing OS or never followed, and a k-group test", () => {
  const [t] = kindText(survivalKind, { endpoint: "OS", caveat: "c", logrankK: { p: 0.04 },
    curves: [{ cohort: "A", median: null, n: 10, events: 3, missing: 2, unobserved: 1 }, { cohort: "B", median: 12.34, n: 5, events: 5 }] });
  assert.ok(t.includes("A: median not reached (n=10, 3 events, 2 missing OS, 1 with no follow-up after entry left out)"), t);
  assert.ok(t.includes("B: median 12.3 mo (n=5, 5 events)"), t);
  assert.ok(t.includes("k-group log-rank p=0.04"), t);
});
