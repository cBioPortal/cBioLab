// The method record (lib/method.ts): what it says was done must be what the fit was given —
// the counts, the reference levels and why, the conditional steps, and a Python script that
// codes each term the way the fit did.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { coxMethod, logisticMethod, type CoxTrace, type LogisticTrace } from "../lib/method.ts";
import type { CoxCovariate } from "../lib/types.ts";

const tp53: CoxCovariate = { source: "alteration", gene: "TP53", by: "mutated" };
const gender: CoxCovariate = { source: "clinical", attribute: "GENDER" };
const age: CoxCovariate = { source: "clinical", attribute: "AGE" };

function coxTrace(over: Partial<CoxTrace> = {}): CoxTrace {
  return {
    perStudy: [{ study: "s1", cohortPatients: 10, rows: 8 }],
    covariates: [tp53, gender, age],
    kinds: ["cat", "cat", "num"],
    columns: [
      { axisIndex: 0, label: "TP53 mutation status: Mutated", reference: "Not mutated", level: "Mutated" },
      { axisIndex: 1, label: "GENDER: Male", reference: "Female", level: "Male" },
      { axisIndex: 2, label: "AGE" },
    ],
    x: [[1, 0, 60], [1, 1, 61], [0, 1, 62], [0, 0, 63], [1, 0, 64], [0, 0, 65], [0, 1, 66], [0, 0, 67]],
    fit: { n: 8, events: 5, iterations: 5, loglik: -9.87654 },
    censoredAtCutoff: 0, droppedBadTime: 0,
    ...over,
  };
}
const coxOpts = { endpoint: "OS", monthsColumn: "OS_MONTHS", statusColumn: "OS_STATUS", stratifyByStudy: false, queryLabel: "coxRows:OS" };
const step = (m: ReturnType<typeof coxMethod>, title: RegExp) => m.steps.find((s) => title.test(s.title));
const param = (s: { params?: [string, string][] } | undefined, k: string) => s?.params?.find(([key]) => key === k)?.[1];

describe("coxMethod", () => {
  test("the fetch step counts cohort patients in and rows out, and says how events are read", () => {
    const fetch = step(coxMethod([coxTrace()], coxOpts), /^Fetch/)!;
    assert.equal(fetch.scope, "s1");
    assert.equal(fetch.rowsIn, 10);
    assert.equal(fetch.rowsOut, 8);
    assert.match(fetch.detail, /2 cohort patients had no row/);
    assert.match(fetch.detail, /OS_STATUS starting with “1”/);
    assert.match(fetch.detail, /missing one, is censored/);
  });

  test("each coded term carries its 0/1 count and the reason for its reference level", () => {
    const coding = step(coxMethod([coxTrace()], coxOpts), /^Code the covariates/)!;
    assert.match(param(coding, "TP53 mutation status: Mutated")!, /3 of 8 patients · reference “Not mutated”: the fixed default for a mutated-vs-not axis/);
    assert.match(param(coding, "GENDER: Male")!, /3 of 8 patients · reference “Female”: the most frequent level/);
    assert.match(param(coding, "AGE")!, /^numeric/);
  });

  test("a declared reference is named as declared; one never observed says what it fell back to", () => {
    const declared = coxTrace({ covariates: [tp53, { ...gender, reference: "Female" }, age] });
    assert.match(param(step(coxMethod([declared], coxOpts), /^Code/), "GENDER: Male")!, /declared in the view/);
    const missing = coxTrace({ covariates: [tp53, { ...gender, reference: "Other" }, age] });
    assert.match(param(step(coxMethod([missing], coxOpts), /^Code/), "GENDER: Male")!, /declared “Other” was never observed, so the most frequent level/);
  });

  test("the censoring and invalid-time steps appear only when they did something to the data", () => {
    const plain = coxMethod([coxTrace()], coxOpts);
    assert.equal(step(plain, /^Censor/), undefined);
    assert.equal(step(plain, /^Drop/), undefined);
    const cut = coxMethod([coxTrace({ censoredAtCutoff: 3, droppedBadTime: 1 })], { ...coxOpts, cutoffMonths: 60 });
    assert.match(step(cut, /^Censor at 60 months/)!.detail, /^3 patients followed past 60 months/);
    assert.equal(step(cut, /^Drop/)!.rowsOut, 7);
    assert.match(cut.python, /df\.loc\[df\["m"\] > 60, "ev"\] = 0/);
  });

  test("the statistic step reports the fit as it went, including a fit that did not converge", () => {
    const ok = step(coxMethod([coxTrace()], coxOpts), /^Fit/);
    assert.equal(param(ok, "patients / events"), "8 / 5");
    assert.equal(param(ok, "fit"), "converged in 5 iterations");
    assert.equal(param(ok, "log partial likelihood"), "-9.8765");
    const stuck = step(coxMethod([coxTrace({ fit: { n: 8, events: 5, iterations: 25, loglik: -9 } })], coxOpts), /^Fit/);
    assert.match(param(stuck, "fit")!, /without converging/);
    assert.match(param(step(coxMethod([coxTrace()], { ...coxOpts, stratifyByStudy: true }), /^Fit/), "baseline hazard")!, /one per study/);
  });

  test("the Python script codes every term exactly as the fit did", () => {
    const m = coxMethod([coxTrace()], coxOpts);
    assert.match(m.python, /dtype=\{"c0": str, "c1": str\}/);
    assert.match(m.python, /"TP53 mutation status: Mutated": \(df\["c0"\] == "Mutated"\)\.astype\(float\),  # reference: Not mutated/);
    assert.match(m.python, /"GENDER: Male": \(df\["c1"\] == "Male"\)\.astype\(float\)/);
    assert.match(m.python, /"AGE": df\["c2"\]\.astype\(float\)/);
    assert.doesNotMatch(m.python, /strata=/);
    assert.match(coxMethod([coxTrace()], { ...coxOpts, stratifyByStudy: true }).python, /strata=\["study"\]/);
  });

  test("per-cohort fits get one scoped block each, saved under the cohort's name", () => {
    const m = coxMethod([coxTrace({ scope: "MSI-high" }), coxTrace({ scope: "MSS" })], coxOpts);
    assert.deepEqual(m.steps.filter((s) => s.kind === "statistic").map((s) => s.scope), ["MSI-high", "MSS"]);
    assert.equal(m.steps.find((s) => s.kind === "fetch")!.scope, "MSI-high · s1");
    assert.match(m.python, /cox_rows_MSI_high\.csv/);
    assert.match(m.python, /fits\["MSS"\] = cph/);
  });

  test("it names the code that ran and what it is verified against", () => {
    const m = coxMethod([coxTrace()], coxOpts);
    assert.deepEqual(m.implementation.functions, ["coxRegression"]);
    assert.equal(m.implementation.file, "lib/stats.ts");
    assert.match(m.verification!, /lifelines 0\.30\.3 CoxPHFitter \(Efron ties\)/);
  });
});

describe("logisticMethod", () => {
  const trace = (over: Partial<LogisticTrace> = {}): LogisticTrace => ({
    perStudy: [{ study: "s1", cohortPatients: 5, rows: 5 }],
    covariates: [tp53], kinds: ["cat"],
    columns: [{ axisIndex: 0, label: "TP53 mutation status: Mutated", reference: "Not mutated", level: "Mutated" }],
    x: [[1], [0], [1], [0], [0]],
    fit: { n: 5, events: 2, iterations: 6, loglik: -3.2 },
    outcomeKind: "cat", outcomeEvent: "Yes", outcomeOther: ["No", "Unknown"],
    ...over,
  });

  test("a categorical outcome says which value is the event and which values were folded into not-event", () => {
    const m = logisticMethod(trace(), { outcomeLabel: "RESPONSE", queryLabel: "logisticRows" });
    const outcome = m.steps.find((s) => s.title === "Code the outcome")!;
    assert.match(outcome.detail, /1 if RESPONSE = “Yes”, else 0 — every other observed value \(No, Unknown\) counts as not the event/);
    assert.match(m.python, /y = \(df\["y"\] == "Yes"\)\.astype\(int\)/);
    assert.match(m.python, /dtype=\{"y": str, "c0": str\}/);
    assert.match(m.python, /sm\.Logit\(y, sm\.add_constant\(X\)\)/);
  });

  test("a numeric outcome is used as is", () => {
    const m = logisticMethod(trace({ outcomeKind: "num", outcomeEvent: undefined, outcomeOther: [] }), { outcomeLabel: "FLAG", queryLabel: "logisticRows" });
    assert.match(m.steps.find((s) => s.title === "Code the outcome")!.detail, /already coded 0\/1/);
    assert.match(m.python, /y = df\["y"\]\.astype\(int\)/);
    assert.match(m.python, /dtype=\{"c0": str\}/);
  });
});
