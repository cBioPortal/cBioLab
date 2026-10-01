// coxRegression and logisticRegression checked against lifelines and statsmodels.
//
// test/fixtures/golden/regression.json holds seeded synthetic datasets and the fits those
// libraries produce on them (regenerate with `uv run python/golden/regression.py`; the library
// versions are pinned in that script and recorded in the fixture). Agreement is asserted to a
// relative 1e-6 on every reported number: tight enough that a different tie method, a wrong
// interval quantile or a missed stratum fails, loose enough for two Newton-Raphson
// implementations stopping at slightly different points.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coxRegression, logisticRegression, type CoxRow, type LogisticRow } from "../lib/stats.ts";

const golden = JSON.parse(readFileSync("test/fixtures/golden/regression.json", "utf8"));
const TOL = 1e-6;

function close(actual: number, expected: number, what: string): void {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);
  assert.ok(err <= TOL, what + ": got " + actual + ", reference " + expected + " (relative error " + err.toExponential(2) + ")");
}

function closeAll(fit: Record<string, any>, expected: Record<string, any>, terms: string[], keys: string[]): void {
  for (const k of keys) {
    assert.equal(fit[k].length, terms.length, k + " has one entry per term");
    terms.forEach((term, i) => close(fit[k][i], expected[k][i], k + "[" + term + "]"));
  }
  close(fit.loglik, expected.loglik, "log-likelihood");
  assert.equal(fit.n, expected.n);
  assert.equal(fit.events, expected.events);
}

describe("coxRegression matches lifelines CoxPHFitter (Efron ties) — lifelines " + golden.libraries.lifelines, () => {
  for (const c of golden.cox) {
    test(c.name + " — " + c.about, () => {
      const fit = coxRegression(c.rows as CoxRow[]);
      closeAll(fit, c.expected, c.terms, ["beta", "se", "p", "ciLow", "ciHigh"]);
    });
  }
});

describe("logisticRegression matches statsmodels Logit — statsmodels " + golden.libraries.statsmodels, () => {
  for (const c of golden.logistic) {
    test(c.name + " — " + c.about, () => {
      const fit = logisticRegression(c.rows as LogisticRow[]);
      close(fit.intercept, c.expected.intercept, "intercept");
      closeAll(fit, c.expected, c.terms, ["beta", "se", "p", "ciLow", "ciHigh"]);
    });
  }
});
