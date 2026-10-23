// The logistic view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type FitTrace, type MethodRecord, type MethodStep, fetchSteps, codingStep, plural, py, VERIFIED, RESULT_INIT, pyCategoricalDtypes, pyComment, pyTerms, GOLDEN_TEST, withResult, checks } from "../../method.ts";
import type { AxisKind } from "../../plot.ts";
import { LOGISTIC_MAX_ITERATIONS } from "../../stats.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface LogisticTrace extends FitTrace {
  outcomeKind: AxisKind;
  outcomeEvent?: string;
  outcomeOther: string[];
  /** what the fit reported, per term — for the script check */
  coefficients: { label: string; beta: number; se: number; p: number }[];
}

export function logisticMethod(t: LogisticTrace, o: { outcomeLabel: string; queryLabel: string }): MethodRecord {
  const steps: MethodStep[] = fetchSteps(t, o.queryLabel,
    "Patients with a value for " + o.outcomeLabel + " and for every covariate are kept.");
  steps.push({
    kind: "transform",
    title: "Code the outcome",
    detail: t.outcomeKind === "num"
      ? o.outcomeLabel + " is numeric and already coded 0/1; it is used as is."
      : "1 if " + o.outcomeLabel + " = “" + t.outcomeEvent + "”, else 0" +
        (t.outcomeOther.length ? " — every other observed value (" + t.outcomeOther.join(", ") + ") counts as not the event." : "."),
  });
  steps.push(codingStep(t));
  steps.push({
    kind: "statistic",
    title: "Fit a logistic regression",
    detail: "Maximum likelihood for a binomial GLM with a logit link and an intercept, by Newton–Raphson with step-halving.",
    params: [
      ["patients / events", t.fit.n.toLocaleString() + " / " + t.fit.events.toLocaleString()],
      ["terms", t.columns.length + " plus an intercept (not drawn)"],
      ["standard errors", "from the Fisher information at the estimate"],
      ["95% interval", "exp(β ± 1.959964·SE), Wald"],
      ["p-value", "Wald χ² on 1 df, (β/SE)²"],
      ["fit", t.fit.iterations < LOGISTIC_MAX_ITERATIONS ? "converged in " + plural(t.fit.iterations, "iteration")
        : "stopped at the " + LOGISTIC_MAX_ITERATIONS + "-iteration limit without converging"],
      ["log likelihood", t.fit.loglik.toFixed(4)],
    ],
  });
  const y = t.outcomeKind === "num" ? "df[\"y\"].astype(int)" : "(df[\"y\"] == " + py(t.outcomeEvent!) + ").astype(int)";
  const python = [
    "# Refit with statsmodels (" + VERIFIED.logistic.version + " is the version our fit is tested against).",
    "# Input: the rows the " + o.queryLabel + " query above returns — columns y, c0, c1, …",
    t.perStudy.length > 1 ? "# It runs once per study: concatenate the results." : "# Save them as CSV.",
    "import numpy as np",
    "import pandas as pd",
    "import statsmodels.api as sm",
    "",
    RESULT_INIT,
    "df = pd.read_csv(\"logistic_rows.csv\"" + pyCategoricalDtypes(t, t.outcomeKind === "num" ? [] : ["y"]) + ")",
    "y = " + y + "  # the outcome: " + (t.outcomeKind === "num" ? "already 0/1" : "event = " + pyComment(t.outcomeEvent)),
    "X = pd.DataFrame({",
    pyTerms(t, "    "),
    "})",
    "fit = sm.Logit(y, sm.add_constant(X)).fit(method=\"newton\")",
    "print(fit.summary())  # coefficients, SEs and p-values",
    "print(np.exp(fit.conf_int()))  # the odds-ratio 95% intervals drawn in the forest plot",
    "for term in X.columns:",
    "    RESULT[\"logistic:\" + term + \":beta\"], RESULT[\"logistic:\" + term + \":se\"], RESULT[\"logistic:\" + term + \":p\"] = fit.params[term], fit.bse[term], fit.pvalues[term]",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["logisticRegression"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Matches " + VERIFIED.logistic.library + " " + VERIFIED.logistic.version + " " + VERIFIED.logistic.fn +
      " to a relative 1e-6 on coefficients, SEs, p-values and intervals (" + GOLDEN_TEST + ").",
    python: withResult(python),
    check: checks("logistic:", t.coefficients, (c) => c.label, [["beta", "beta"], ["se", "se"], ["p", "p", { rel: 1e-5, abs: 1e-14 }]]),
  };
}
