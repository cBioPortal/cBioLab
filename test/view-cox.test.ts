// The cox view's runner (lib/views/cox/run.ts), driven with hand-made participants: a multivariate
// Cox fit from per-patient rows inside each patient-level study; an aggregate-only participant
// cannot contribute and is named as excluded, never silently dropped (lib/views/cox/doc.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCox } from "../lib/views/cox/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Fake = Record<string, unknown> & { instance: { id: string; mode: string; label: string; conn: unknown } };
type CoxAnswer = { rows: { t: number; event: number; values: (number | string)[] }[]; kinds: string[]; notProfiled: number };
const patientLevel = (answer: CoxAnswer | ((def: unknown, endpoint: string, covs: unknown, cols: unknown) => CoxAnswer)): Fake =>
  ({ instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    coxRows: async (def: unknown, endpoint: string, covs: unknown, cols: unknown) => typeof answer === "function" ? answer(def, endpoint, covs, cols) : answer });
const aggregateOnly = (): Fake => ({ instance: { id: "agg", mode: "aggregate-only", label: "agg site", conn: PRIMARY } });

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
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: [], requiresPatientLevel, aggregateOnly: studies.filter((s) => resolvers[s].instance.mode !== "patient-level") }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const unwrap = (r: ViewResult | Untimed): ViewResult => (r instanceof Untimed ? r.result : r);
type Coef = { label: string; reference?: string; level?: string; beta: number; se: number; hr: number; ciLow: number; ciHigh: number; p: number };
type CoxOut = { coefficients: Coef[]; n: number; events: number; excludedRemote?: { study: string; patients: number }[];
  byCohort?: { cohort: string; coefficients: Coef[]; n: number; events: number; error?: string; excludedRemote?: unknown[] }[] };
const coxOf = (r: ViewResult) => (r as unknown as { cox: CoxOut }).cox;
const SMOKER = { source: "clinical", attribute: "SMOKER" };
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, a + " ≠ " + b);

// Four patients, no ties: t=1 Yes (event), t=2 No (event), t=3 Yes (event), t=4 No (censored).
// Partial likelihood with u = e^β: [u/(2u+2)]·[1/(u+2)]·[u/(u+1)] ∝ u²/((u+1)²(u+2)).
// Score 2 − 2u/(u+1) − u/(u+2) = 0 ⇔ u² − u − 4 = 0 ⇔ HR = u = (1+√17)/2.
const FOUR: CoxAnswer = { rows: [
  { t: 1, event: 1, values: ["Yes"] }, { t: 2, event: 1, values: ["No"] },
  { t: 3, event: 1, values: ["Yes"] }, { t: 4, event: 0, values: ["No"] }], kinds: ["cat"], notProfiled: 0 };
const HR_FOUR = (1 + Math.sqrt(17)) / 2;

describe("cox: refusals before any fit", () => {
  const one = () => ctx({ A: cohort({ s1: 4 }) }, { s1: patientLevel(FOUR) });
  const err = async (view: Record<string, unknown>) => {
    const r = await runCox({ kind: "cox", ...view } as never, one());
    assert.ok(r instanceof Untimed, "a refusal is untimed");
    return r.result.error!;
  };
  test("a malformed endpoint", async () => assert.match(await err({ endpoint: "1os", covariates: [SMOKER] }), /bad survival endpoint '1OS'/));
  test("monthsAttribute without statusAttribute, or a name that is not an attribute", async () => {
    assert.match(await err({ monthsAttribute: "PFS_M", covariates: [SMOKER] }), /must both be given.*got 'PFS_M'\/''/);
    assert.match(await err({ monthsAttribute: "a b", statusAttribute: "S", covariates: [SMOKER] }), /must both be given/);
  });
  test("no covariates, and more than 8", async () => {
    assert.match(await err({}), /at least one covariate/);
    assert.match(await err({ covariates: Array.from({ length: 9 }, () => SMOKER) }), /at most 8 covariates/);
  });
  test("a covariate that is not a valid axis", async () => {
    assert.match(await err({ covariates: [{ source: "clinical", attribute: "not a name!" }] }), /covariate 1 axis: 'not a name!' is not a clinical attribute name/);
  });
  test("a cutoff that is not a positive number of months up to 1200", async () => {
    for (const cutoffMonths of [0, -3, 1201, "soon"]) assert.match(await err({ covariates: [SMOKER], cutoffMonths }), /bad cutoffMonths/);
  });
});

describe("cox: nothing to fit", () => {
  test("an empty cohort, and all cohorts empty", async () => {
    const e1 = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 0 }) }, { s1: patientLevel(FOUR) })));
    assert.equal(e1.error, "nothing to fit: cohort “A” is empty.");
    const e2 = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 0 }) }, { s1: patientLevel(FOUR) })));
    assert.equal(e2.error, "nothing to fit: all cohorts are empty.");
  });

  test("only aggregate-only participants: named, since Cox needs patient-level covariates", async () => {
    const one = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s2: 5 }) }, { s2: aggregateOnly() })));
    assert.match(one.error!, /no patient-level participant could answer this — s2 is aggregate-only/);
    const two = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s2: 5, s3: 1 }) }, { s2: aggregateOnly(), s3: aggregateOnly() })));
    assert.match(two.error!, /s2, s3 are aggregate-only/);
  });

  test("no patient with the endpoint and every covariate: names the endpoint, or the override columns", async () => {
    const none: CoxAnswer = { rows: [], kinds: ["cat"], notProfiled: 0 };
    const r = unwrap(await runCox({ kind: "cox", endpoint: "pfs", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 3 }) }, { s1: patientLevel(none) })));
    assert.equal(r.error, "no patient had both a PFS measurement and every requested covariate defined");
    let asked: unknown;
    const r2 = unwrap(await runCox({ kind: "cox", monthsAttribute: "M_T", statusAttribute: "M_S", covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 3 }) }, { s1: patientLevel((_d, _e, _c, cols) => { asked = cols; return none; }) })));
    assert.equal(r2.error, "no patient had both a M_T/M_S measurement and every requested covariate defined");
    assert.deepEqual(asked, { months: "M_T", status: "M_S" }, "the override columns reach the participant");
  });

  test("a covariate with one observed level has nothing to compare against", async () => {
    const flat: CoxAnswer = { rows: FOUR.rows.map((r) => ({ ...r, values: ["Yes"] })), kinds: ["cat"], notProfiled: 0 };
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 4 }) }, { s1: patientLevel(flat) })));
    assert.match(r.error!, /only one observed level/);
  });

  test("more than 20 dummy terms is refused", async () => {
    const wide: CoxAnswer = { rows: Array.from({ length: 22 }, (_, i) => ({ t: i + 1, event: 1, values: ["L" + i] })), kinds: ["cat"], notProfiled: 0 };
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 22 }) }, { s1: patientLevel(wide) })));
    assert.match(r.error!, /expand to 21 terms \(capped at 20\)/);
  });

  test("collinear covariates cannot be fit, and say so", async () => {
    const twin: CoxAnswer = { rows: FOUR.rows.map((r, i) => ({ ...r, values: [i, i] })), kinds: ["num", "num"], notProfiled: 0 };
    const r = unwrap(await runCox({ kind: "cox", covariates: [{ source: "clinical", attribute: "AGE" }, { source: "clinical", attribute: "AGE2" }] } as never,
      ctx({ A: cohort({ s1: 4 }) }, { s1: patientLevel(twin) })));
    assert.match(r.error!, /not identifiable/);
  });
});

describe("cox: the fit", () => {
  test("one binary covariate: HR (1+√17)/2 against the reference level, with Wald interval", async () => {
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 4 }) }, { s1: patientLevel(FOUR) })));
    assert.equal(r.error, undefined);
    const cx = coxOf(r);
    assert.equal(cx.n, 4);
    assert.equal(cx.events, 3);
    assert.equal(cx.coefficients.length, 1);
    const c = cx.coefficients[0];
    // a 2–2 tie in frequency: the reference is the first level in order, "No"
    assert.equal(c.reference, "No");
    assert.equal(c.level, "Yes");
    assert.equal(c.label, "SMOKER: Yes");
    close(c.hr, HR_FOUR);
    close(c.beta, Math.log(HR_FOUR));
    close(c.ciLow, Math.exp(c.beta - 1.959964 * c.se), 1e-4);
    close(c.ciHigh, Math.exp(c.beta + 1.959964 * c.se), 1e-4);
    assert.match(r.caveat!, /^Cox proportional-hazards regression \(Efron ties\) on 4 patients, 3 events, 1 term\./);
    assert.ok(!/Pooled across studies/.test(r.caveat!), "one study: nothing to pool");
    assert.ok(r.method, "a method record is attached");
  });

  test("a numeric covariate coded 0/1 gives the same HR, as one column with no reference", async () => {
    const num: CoxAnswer = { rows: FOUR.rows.map((r) => ({ ...r, values: [r.values[0] === "Yes" ? 1 : 0] })), kinds: ["num"], notProfiled: 0 };
    const r = unwrap(await runCox({ kind: "cox", covariates: [{ source: "clinical", attribute: "SMOKES" }] } as never, ctx({ A: cohort({ s1: 4 }) }, { s1: patientLevel(num) })));
    const c = coxOf(r).coefficients[0];
    assert.equal(c.reference, undefined);
    assert.equal(c.label, "SMOKES");
    close(c.hr, HR_FOUR);
  });

  test("a cutoff censors later follow-up at it: HR √2 with times cut at 2.5 months", async () => {
    // t=3 (event) and t=4 become censored at 2.5: L ∝ [u/(2u+2)]·[1/(u+2)]; score 1 − u/(u+1) − u/(u+2) = 0 ⇔ u² = 2.
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER], cutoffMonths: 2.5 } as never, ctx({ A: cohort({ s1: 4 }) }, { s1: patientLevel(FOUR) })));
    assert.equal((r as { cutoffMonths?: number }).cutoffMonths, 2.5);
    assert.equal(coxOf(r).events, 2);
    close(coxOf(r).coefficients[0].hr, Math.SQRT2);
    assert.match(r.caveat!, /Administratively censored at 2\.5 months\./);
  });

  test("a negative time is dropped from the fit; missing and not-profiled patients are counted in the caveat", async () => {
    const withBad: CoxAnswer = { rows: [...FOUR.rows, { t: -1, event: 1, values: ["No"] }], kinds: ["cat"], notProfiled: 1 };
    // cohort of 8 patient-level patients: 4 fit, 1 not profiled → 3 lacked the endpoint or a covariate
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 8 }) }, { s1: patientLevel(withBad) })));
    assert.equal(coxOf(r).n, 4);
    close(coxOf(r).coefficients[0].hr, HR_FOUR);
    assert.match(r.caveat!, / 3 patients from patient-level participants lacked the endpoint or a covariate and were excluded\./);
    assert.match(r.caveat!, / 1 patient was not profiled for the gene of a covariate/);
  });

  test("the reference level is chosen among the patients fit, not one dropped for a bad time",
    { todo: "spec: a categorical defaults to its most frequently observed level among the fitted patients; code counts levels over rows before dropping negative times (lib/views/cox/run.ts:104 vs :118-119), so a dropped row can flip the reference" },
    async () => {
      // fitted: Yes 2, No 2 (tie → "No" first); the dropped t=-1 row would make "Yes" the most frequent
      const withBad: CoxAnswer = { rows: [...FOUR.rows, { t: -1, event: 1, values: ["Yes"] }], kinds: ["cat"], notProfiled: 0 };
      const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 5 }) }, { s1: patientLevel(withBad) })));
      assert.equal(coxOf(r).coefficients[0].reference, "No");
      close(coxOf(r).coefficients[0].hr, HR_FOUR);
    });

  test("exactly one missing patient is singular in the caveat", async () => {
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never, ctx({ A: cohort({ s1: 5 }) }, { s1: patientLevel(FOUR) })));
    assert.match(r.caveat!, / 1 patient from patient-level participants lacked/);
  });

  test("an aggregate-only study beside a patient-level one: named with its patients, and pooling across studies is disclosed", async () => {
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 4, s2: 5 }) }, { s1: patientLevel(FOUR), s2: aggregateOnly() })));
    assert.deepEqual(coxOf(r).excludedRemote, [{ study: "s2", patients: 5 }]);
    assert.match(r.caveat!, /s2 \(5 patients\) could not contribute: aggregate-only participants/);
    assert.match(r.caveat!, /Pooled across studies WITHOUT stratifying/);
    assert.match(r.caveat!, /NOT harmonized across studies/);
    assert.deepEqual(r.participation!.aggregateOnly, ["s2"]);
  });

  test("stratified by study: each study its own baseline hazard; two identical studies give the one-study HR", async () => {
    // the stratified partial likelihood is the product of the two strata's, each ∝ u²/((u+1)²(u+2)): same maximiser
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER], stratifyByStudy: true } as never,
      ctx({ A: cohort({ s1: 4, s3: 4 }) }, { s1: patientLevel(FOUR), s3: patientLevel(FOUR) })));
    assert.equal(coxOf(r).n, 8);
    close(coxOf(r).coefficients[0].hr, HR_FOUR);
    assert.match(r.caveat!, /Stratified by study: each study fits its own baseline hazard/);
    assert.ok(!/Pooled across studies WITHOUT/.test(r.caveat!));
  });
});

describe("cox: stratified by cohort", () => {
  test("each cohort its own fit; a cohort that cannot be fit is named and skipped, not blocking the rest", async () => {
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER], stratifyByCohort: true, cutoffMonths: 100 } as never,
      ctx({ A: cohort({ s1: 4, s2: 2 }), B: cohort({ s1: 0 }) }, { s1: patientLevel(FOUR), s2: aggregateOnly() })));
    assert.equal(r.error, undefined);
    const cx = coxOf(r);
    assert.deepEqual(cx.coefficients, [], "no pooled coefficients");
    assert.equal(cx.byCohort!.length, 2);
    const [a, b] = cx.byCohort!;
    assert.equal(a.cohort, "A");
    close(a.coefficients[0].hr, HR_FOUR);
    assert.deepEqual(a.excludedRemote, [{ study: "s2", patients: 2 }]);
    assert.equal(b.error, "nothing to fit: cohort “B” is empty.");
    assert.equal(b.n, 0);
    assert.equal(cx.n, 4);
    assert.equal(cx.events, 3);
    assert.match(r.caveat!, /^Stratified by cohort: 1 of 2 cohorts fit as its OWN separate Cox model/);
    assert.match(r.caveat!, /“B” could not be fit: nothing to fit/);
    assert.match(r.caveat!, /Administratively censored at 100 months\./);
  });

  test("no cohort can be fit: refused, naming each cohort's reason", async () => {
    const r = await runCox({ kind: "cox", covariates: [SMOKER], stratifyByCohort: true } as never,
      ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 0 }) }, { s1: patientLevel(FOUR) }));
    assert.ok(r instanceof Untimed);
    assert.match(r.result.error!, /^no cohort could be fit: A \(nothing to fit: cohort “A” is empty\.\); B \(/);
  });

  test("with one cohort it is a no-op: the pooled fit", async () => {
    const r = unwrap(await runCox({ kind: "cox", covariates: [SMOKER], stratifyByCohort: true } as never, ctx({ A: cohort({ s1: 4 }) }, { s1: patientLevel(FOUR) })));
    assert.equal(coxOf(r).byCohort, undefined);
    close(coxOf(r).coefficients[0].hr, HR_FOUR);
  });
});
