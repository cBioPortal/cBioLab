// The logistic view's runner (lib/views/logistic/run.ts), driven with hand-made participants: a
// binary outcome regressed on covariates coded as cox's are, from per-patient rows inside each
// patient-level study; a categorical outcome needs outcomeEvent, a numeric one must be 0/1
// (lib/views/logistic/doc.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runLogistic } from "../lib/views/logistic/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Fake = Record<string, unknown> & { instance: { id: string; mode: string; label: string; conn: unknown } };
type LogAnswer = { rows: { y: number | string; values: (number | string)[] }[]; outcomeKind: string; kinds: string[]; notProfiled: number };
const patientLevel = (answer: LogAnswer, extra: Record<string, unknown> = {}): Fake =>
  ({ instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY }, logisticRows: async () => answer, ...extra });
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
type Coef = { label: string; reference?: string; level?: string; beta: number; se: number; or: number; ciLow: number; ciHigh: number; p: number };
type LogOut = { coefficients: Coef[]; n: number; events: number; outcomeOther?: string[]; excludedRemote?: { study: string; patients: number }[] };
const logOf = (r: ViewResult) => (r as unknown as { logistic: LogOut }).logistic;
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, a + " ≠ " + b);

const RESPONSE = { source: "clinical", attribute: "RESPONSE" };
const SMOKER = { source: "clinical", attribute: "SMOKER" };

// The 2×2 table: smokers 3 events of 4, non-smokers 1 of 4. Odds ratio (3/1)/(1/3) = 9, so β = ln 9,
// and its Wald SE is √(1/3 + 1/1 + 1/1 + 1/3) = √(8/3) — the closed form of a one-binary-covariate logistic fit.
const TABLE = [[1, "Yes"], [1, "Yes"], [1, "Yes"], [0, "Yes"], [1, "No"], [0, "No"], [0, "No"], [0, "No"]] as const;
const numeric01: LogAnswer = { rows: TABLE.map(([y, s]) => ({ y, values: [s] })), outcomeKind: "num", kinds: ["cat"], notProfiled: 0 };

describe("logistic: refusals before any fit", () => {
  const one = () => ctx({ A: cohort({ s1: 8 }) }, { s1: patientLevel(numeric01) });
  const err = async (view: Record<string, unknown>) => {
    const r = await runLogistic({ kind: "logistic", ...view } as never, one());
    assert.ok(r instanceof Untimed, "a refusal is untimed");
    return r.result.error!;
  };
  test("an outcome that is not an axis", async () => assert.match(await err({ outcome: { attribute: "X" }, covariates: [SMOKER] }), /outcome axis needs a source/));
  test("a categorical alteration outcome without outcomeEvent", async () =>
    assert.match(await err({ outcome: { source: "alteration", gene: "TP53" }, covariates: [SMOKER] }), /a categorical outcome needs outcomeEvent/));
  test("outcomeEvent on a numeric molecular or assay outcome", async () => {
    assert.match(await err({ outcome: { source: "molecular", profileType: "mrna", gene: "TP53" }, outcomeEvent: "high", covariates: [SMOKER] }), /is numeric \(a molecular axis\)/);
    assert.match(await err({ outcome: { source: "assay", profileType: "ga", entity: "SBS4" }, outcomeEvent: "high", covariates: [SMOKER] }), /is numeric \(a assay axis\)/);
  });
  test("no covariates, more than 8, or one that is not an axis", async () => {
    assert.match(await err({ outcome: RESPONSE }), /at least one covariate/);
    assert.match(await err({ outcome: RESPONSE, covariates: Array.from({ length: 9 }, () => SMOKER) }), /at most 8 covariates/);
    assert.match(await err({ outcome: RESPONSE, covariates: [{ source: "clinical", attribute: "bad name" }] }), /covariate 1 axis: 'bad name' is not a clinical attribute name/);
  });
  test("an assay entity the study's profile lacks is refused, offering what it has", async () => {
    const s1 = patientLevel(numeric01, { viewAggregate: async () => [],
      viewMeta: async (label: string) => label === "assay:entity" ? [] : [{ entity: "SBS1", total: 3 }, { entity: "SBS2", total: 3 }] });
    const r = await runLogistic({ kind: "logistic", outcome: { source: "assay", profileType: "ga", entity: "SBS4" }, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 8 }) }, { s1 }));
    assert.ok(r instanceof Untimed);
    assert.match(r.result.error!, /outcome axis: s1's ga has no entity 'SBS4'; it has SBS1, SBS2, …/);
  });
});

describe("logistic: nothing to fit", () => {
  test("empty cohorts", async () => {
    assert.equal(unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 0 }) }, { s1: patientLevel(numeric01) }))).error, "nothing to fit: cohort “A” is empty.");
    assert.equal(unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 0 }) }, { s1: patientLevel(numeric01) }))).error, "nothing to fit: all cohorts are empty.");
  });
  test("only aggregate-only participants", async () => {
    assert.match(unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s2: 3 }) }, { s2: aggregateOnly() }))).error!, /s2 is aggregate-only, and multivariate logistic regression needs patient-level covariates/);
    assert.match(unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s2: 3, s3: 2 }) }, { s2: aggregateOnly(), s3: aggregateOnly() }))).error!, /s2, s3 are aggregate-only/);
  });
  test("no patient with the outcome and every covariate", async () => {
    const r = unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 3 }) }, { s1: patientLevel({ rows: [], outcomeKind: "cat", kinds: ["cat"], notProfiled: 0 }) })));
    assert.equal(r.error, "no patient had both a value for RESPONSE and every requested covariate defined");
  });
});

describe("logistic: the outcome's coding", () => {
  const run = (answer: LogAnswer, view: Record<string, unknown> = {}) => runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER], ...view } as never,
    ctx({ A: cohort({ s1: answer.rows.length }) }, { s1: patientLevel(answer) })).then(unwrap);

  test("a numeric outcome refuses outcomeEvent", async () =>
    assert.match((await run(numeric01, { outcomeEvent: "1" })).error!, /RESPONSE is numeric here — outcomeEvent only applies/));
  test("a numeric outcome not coded 0/1 is refused, naming the value", async () => {
    const r = await run({ ...numeric01, rows: [...numeric01.rows, { y: 2, values: ["Yes"] }] });
    assert.match(r.error!, /must already be coded 0\/1 — RESPONSE has an observed value of 2/);
  });
  const cat: LogAnswer = { rows: TABLE.map(([y, s], i) => ({ y: y ? "CR" : i % 2 ? "SD" : "PD", values: [s] })), outcomeKind: "cat", kinds: ["cat"], notProfiled: 0 };
  test("a categorical outcome without outcomeEvent lists the observed values", async () =>
    assert.match((await run(cat)).error!, /needs outcomeEvent.*observed values: CR, PD, SD$/));
  test("an outcomeEvent never observed lists the observed values", async () =>
    assert.match((await run(cat, { outcomeEvent: "PR" })).error!, /outcomeEvent “PR” was never observed for RESPONSE here — observed values: CR, PD, SD/));

  test("a categorical outcome: the event is 1, every other value 0, and which were collapsed is disclosed", async () => {
    const r = await run(cat, { outcomeEvent: "CR" });
    assert.equal(r.error, undefined);
    const lg = logOf(r);
    assert.deepEqual(lg.outcomeOther, ["PD", "SD"]);
    assert.equal(lg.events, 4);
    close(lg.coefficients[0].or, 9);
    assert.match(r.caveat!, /^Logistic regression on 8 patients, 4 with RESPONSE = CR \(1 term\)\./);
    assert.match(r.caveat!, /Every other observed value of RESPONSE \(PD, SD\) was treated as “not event\.”/);
  });
});

describe("logistic: the fit", () => {
  test("one binary covariate: OR 9 = the 2×2 table's odds ratio, SE √(8/3), Wald interval", async () => {
    const r = unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 8 }) }, { s1: patientLevel(numeric01) })));
    assert.equal(r.error, undefined);
    const lg = logOf(r);
    assert.equal(lg.n, 8);
    assert.equal(lg.events, 4);
    const c = lg.coefficients[0];
    assert.equal(c.reference, "No", "a 4–4 tie: the first level in order");
    assert.equal(c.level, "Yes");
    close(c.beta, Math.log(9));
    close(c.or, 9);
    close(c.se, Math.sqrt(8 / 3));
    close(c.ciLow, Math.exp(Math.log(9) - 1.959964 * Math.sqrt(8 / 3)), 1e-4);
    close(c.ciHigh, Math.exp(Math.log(9) + 1.959964 * Math.sqrt(8 / 3)), 1e-4);
    assert.equal(lg.outcomeOther, undefined);
    assert.ok(!/ = /.test(r.caveat!.split(".")[0]), "a numeric outcome names no event level");
    assert.ok(r.method);
  });

  test("a declared reference flips the odds ratio to 1/9", async () => {
    const r = unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [{ ...SMOKER, reference: "Yes" }] } as never,
      ctx({ A: cohort({ s1: 8 }) }, { s1: patientLevel(numeric01) })));
    assert.equal(logOf(r).coefficients[0].reference, "Yes");
    close(logOf(r).coefficients[0].or, 1 / 9);
  });

  test("missing, not-profiled and aggregate-only patients are each disclosed", async () => {
    // 11 patient-level patients: 8 fit, 2 not profiled → 1 lacked the outcome or a covariate
    const r = unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 11, s2: 4 }) }, { s1: patientLevel({ ...numeric01, notProfiled: 2 }), s2: aggregateOnly() })));
    assert.deepEqual(logOf(r).excludedRemote, [{ study: "s2", patients: 4 }]);
    assert.match(r.caveat!, / 1 patient from patient-level participants lacked the outcome or a covariate and were excluded\./);
    assert.match(r.caveat!, / 2 patients were not profiled for the gene of the outcome or a covariate/);
    assert.match(r.caveat!, /NOT harmonized across studies/);
    assert.match(r.caveat!, /s2 \(4 patients\) could not contribute/);
  });

  test("several missing patients are plural", async () => {
    const r = unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 10 }) }, { s1: patientLevel(numeric01) })));
    assert.match(r.caveat!, / 2 patients from patient-level participants lacked/);
  });

  test("a covariate with one level, more than 20 terms, or collinear covariates: refused", async () => {
    const flat = { ...numeric01, rows: numeric01.rows.map((r) => ({ ...r, values: ["Yes"] })) };
    assert.match(unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 8 }) }, { s1: patientLevel(flat) }))).error!, /only one observed level/);
    const wide = { ...numeric01, rows: Array.from({ length: 22 }, (_, i) => ({ y: i % 2, values: ["L" + i] })) };
    assert.match(unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [SMOKER] } as never,
      ctx({ A: cohort({ s1: 22 }) }, { s1: patientLevel(wide) }))).error!, /expand to 21 terms \(capped at 20\)/);
    const twin = { ...numeric01, kinds: ["num", "num"], rows: numeric01.rows.map((r, i) => ({ ...r, values: [i, i] })) };
    assert.match(unwrap(await runLogistic({ kind: "logistic", outcome: RESPONSE, covariates: [{ source: "clinical", attribute: "A" }, { source: "clinical", attribute: "B" }] } as never,
      ctx({ A: cohort({ s1: 8 }) }, { s1: patientLevel(twin) }))).error!, /not identifiable/);
  });
});
