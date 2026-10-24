// The cox view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type CoxTrace, type MethodRecord, type MethodStep, fetchSteps, plural, codingStep, VERIFIED, GOLDEN_TEST, withResult, checks, RESULT_INIT, py, pyCategoricalDtypes, pyTerms } from "../../method.ts";
import { COX_MAX_ITERATIONS } from "../../stats.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

function pyFileName(base: string, scope?: string): string {
  return base + (scope ? "_" + scope.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") : "") + ".csv";
}

export function coxMethod(traces: CoxTrace[], o: CoxMethodOptions): MethodRecord {
  const steps: MethodStep[] = [];
  const keep = "Patients with a " + o.monthsColumn + " value and a value for every covariate are kept. " +
    "Event: " + o.statusColumn + " starting with “1” (e.g. “1:DECEASED”); any other value, including a missing one, is censored.";
  for (const t of traces) {
    steps.push(...fetchSteps(t, o.queryLabel, keep).map((s) => t.scope ? { ...s, scope: t.scope + " · " + s.scope } : s));
    const rows = t.perStudy.reduce((n, s) => n + s.rows, 0);
    if (o.cutoffMonths != null) {
      steps.push({ kind: "transform", title: "Censor at " + o.cutoffMonths + " months",
        detail: plural(t.censoredAtCutoff, "patient") + " followed past " + o.cutoffMonths + " months had their time set to " +
          o.cutoffMonths + " and their event to censored.",
        ...(t.scope ? { scope: t.scope } : {}), rowsIn: rows, rowsOut: rows });
    }
    if (t.droppedBadTime > 0) {
      steps.push({ kind: "transform", title: "Drop invalid times",
        detail: plural(t.droppedBadTime, "patient") + " with a negative or non-numeric time were dropped.",
        ...(t.scope ? { scope: t.scope } : {}), rowsIn: rows, rowsOut: rows - t.droppedBadTime });
    }
    steps.push(codingStep(t));
    steps.push({
      kind: "statistic",
      title: "Fit a Cox proportional-hazards model",
      detail: "Maximum partial likelihood with Efron's method for tied event times, by Newton–Raphson with step-halving.",
      ...(t.scope ? { scope: t.scope } : {}),
      params: [
        ["patients / events", t.fit.n.toLocaleString() + " / " + t.fit.events.toLocaleString()],
        ["terms", String(t.columns.length)],
        ["baseline hazard", o.stratifyByStudy ? "one per study (stratified by study)" : "one, shared by every patient"],
        ["standard errors", "from the observed information at the estimate"],
        ["95% interval", "exp(β ± 1.959964·SE), Wald"],
        ["p-value", "Wald χ² on 1 df, (β/SE)²"],
        ["fit", t.fit.iterations < COX_MAX_ITERATIONS ? "converged in " + plural(t.fit.iterations, "iteration")
          : "stopped at the " + COX_MAX_ITERATIONS + "-iteration limit without converging"],
        ["log partial likelihood", t.fit.loglik.toFixed(4)],
      ],
    });
  }
  return {
    steps,
    implementation: { functions: ["coxRegression"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Matches " + VERIFIED.cox.library + " " + VERIFIED.cox.version + " " + VERIFIED.cox.fn +
      " (" + VERIFIED.cox.ties + " ties) to a relative 1e-6 on coefficients, SEs, p-values and intervals (" + GOLDEN_TEST + ").",
    python: withResult(coxPython(traces, o)),
    // lifelines can stop ~1e-5 short of the optimum on a term with only a handful of patients
    check: Object.assign({}, ...traces.map((t) => checks("cox:" + (t.scope || "") + ":", t.coefficients, (c) => c.label,
      [["beta", "beta", { rel: 1e-4, abs: 1e-6 }], ["se", "se", { rel: 1e-4 }], ["p", "p", { rel: 1e-3, abs: 1e-12 }]]))),
  };
}

function coxPython(traces: CoxTrace[], o: CoxMethodOptions): string {
  const multiStudy = traces.some((t) => t.perStudy.length > 1);
  const lines = [
    "# Refit with lifelines (" + VERIFIED.cox.version + " is the version our fit is tested against).",
    "# Input: the rows the " + o.queryLabel + " query above returns — columns m (months), ev (0/1), c0, c1, …",
    multiStudy || o.stratifyByStudy
      ? "# It runs once per study: concatenate the results and add a \"study\" column."
      : "# Save them as CSV.",
    "import pandas as pd",
    "from lifelines import CoxPHFitter",
    "",
    RESULT_INIT,
    ...(traces.some((t) => t.scope) ? ["fits = {}  # one independent model per cohort", ""] : []),
  ];
  for (const t of traces) {
    if (t.scope) lines.push("# --- cohort " + py(t.scope) + ": its own model, own coding ---");
    lines.push("df = pd.read_csv(" + py(pyFileName("cox_rows", t.scope)) + pyCategoricalDtypes(t) + ")");
    if (o.cutoffMonths != null) {
      lines.push("df.loc[df[\"m\"] > " + o.cutoffMonths + ", \"ev\"] = 0  # censor at " + o.cutoffMonths + " months",
        "df[\"m\"] = df[\"m\"].clip(upper=" + o.cutoffMonths + ")");
    }
    lines.push("df = df[df[\"m\"] >= 0]",
      "X = pd.DataFrame({",
      "    \"m\": df[\"m\"], \"ev\": df[\"ev\"],",
      pyTerms(t, "    "),
      "})");
    if (o.stratifyByStudy) lines.push("X[\"study\"] = df[\"study\"]");
    lines.push("cph = CoxPHFitter()  # Efron ties and no penalty: the same model",
      "# a tighter tolerance than lifelines' default (1e-7), which can stop about 1e-6 short of the optimum",
      "cph.fit(X, duration_col=\"m\", event_col=\"ev\"" + (o.stratifyByStudy ? ", strata=[\"study\"]" : "") +
        ", fit_options={\"precision\": 1e-10})",
      "cph.print_summary()  # coef, se(coef), p and the exp(coef) 95% bounds are the forest plot's numbers",
      ...(t.scope ? ["fits[" + py(t.scope) + "] = cph"] : []),
      "for term, row in cph.summary.iterrows():",
      "    k = " + py("cox:" + (t.scope || "") + ":") + " + term",
      "    RESULT[k + \":beta\"], RESULT[k + \":se\"], RESULT[k + \":p\"] = row[\"coef\"], row[\"se(coef)\"], row[\"p\"]",
      "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export interface CoxMethodOptions {
  endpoint: string;
  monthsColumn: string;
  statusColumn: string;
  cutoffMonths?: number;
  stratifyByStudy: boolean;
  queryLabel: string;
}
