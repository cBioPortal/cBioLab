// The method record: what a view computed between its SQL and its numbers, built from the
// values the computation itself used, on every run.
//
// A view's queries say what was fetched; this says what was then done to the rows — which were
// dropped and why, how each covariate was coded and against which reference level, which model
// was fitted with which settings, and how the fit went — plus a Python script that refits the
// same model with a standard library. Each builder below takes the same variables the fit was
// given, so the record cannot describe a different computation from the one that ran.
//
// Browser-safe: no I/O, so the analysis page can import its types.

import type { CoxCovariate, CompositionCell } from "./types.ts";
import type { CompositionSource } from "./composition.ts";
import type { AxisKind } from "./plot.ts";
import { OQL_UNALTERED } from "./plot-oql.ts";
import { BUILD_COMMIT } from "./build-info.ts";
import { COX_MAX_ITERATIONS, LOGISTIC_MAX_ITERATIONS } from "./stats.ts";
import { SYSTEMIC_LINE_CLASSES, CLASS_KEYS } from "./treatment-lines.ts";

export interface MethodStep {
  kind: "fetch" | "transform" | "statistic";
  title: string;
  detail: string;
  /** the study a fetch ran against, or the cohort a per-cohort fit belongs to */
  scope?: string;
  rowsIn?: number;
  rowsOut?: number;
  /** ordered name/value pairs: a fit's settings, or one line per model term */
  params?: [string, string][];
}

export interface MethodRecord {
  steps: MethodStep[];
  implementation: { functions: string[]; file: string; commit: string | null };
  /** the reference implementation this one is tested against, and the test that does it */
  verification?: string;
  /** a script that recomputes the view's numbers from what its queries returned; absent when the
   *  queries' own counts are the numbers, with nothing computed from them */
  python?: string;
  /** the script exists but was left out of this response (the page's requests): POST the view's
   *  one-view document to /api/analysis/method for it */
  pythonDeferred?: true;
  /** the view's own numbers that the script must reproduce, by the name the script reports them
   *  under — scripts/check-method-scripts.ts runs every gallery example's script and compares */
  check?: Record<string, CheckValue>;
}

/** One number a script must reproduce: within `abs` of it (default 1e-300, so a p-value below that
 *  counts as zero), or within `rel` of it (default 1e-6), whichever is looser. */
export interface CheckValue { v: number | null; rel?: number; abs?: number }

/** The line a script's last output starts with, followed by its RESULT as JSON. */
export const RESULT_MARKER = "METHOD_RESULT ";

const RESULT_INIT = "RESULT = {}  # the numbers the automated check compares with the view's (printed at the end)";

/** The end of every script: RESULT as one machine-readable line, NaN and infinities as null. */
function withResult(python: string): string {
  return python.trimEnd() + "\n\n" + [
    "# for the check that this script reproduces the view (scripts/check-method-scripts.ts)",
    "import json as _json, math as _math",
    "def _num(x):",
    "    try:",
    "        x = float(x)",
    "    except (TypeError, ValueError):",
    "        return None",
    "    return None if _math.isnan(x) or _math.isinf(x) else x",
    "print(" + JSON.stringify(RESULT_MARKER) + " + _json.dumps({k: _num(v) for k, v in RESULT.items()}))",
  ].join("\n") + "\n";
}

/** check entries for a list of named results, each field with its own tolerance */
function checks(prefix: string, rows: Record<string, unknown>[], keyOf: (r: any) => string,
  fields: [string, string, { rel?: number; abs?: number }?][]): Record<string, CheckValue> {
  const out: Record<string, CheckValue> = {};
  for (const r of rows) for (const [field, name, tol] of fields) {
    const v = (r as any)[field];
    if (v === undefined) continue;
    out[prefix + keyOf(r) + ":" + name] = { v: v == null || !Number.isFinite(Number(v)) ? null : Number(v), ...(tol || {}) };
  }
  return out;
}

/**
 * The library releases test/regression-golden.test.ts compares our fits against. That test
 * asserts these equal the versions recorded in its fixture, so this claim cannot drift from
 * what was actually checked.
 */
export const VERIFIED = {
  cox: { library: "lifelines", version: "0.30.3", fn: "CoxPHFitter", ties: "Efron" },
  logistic: { library: "statsmodels", version: "0.15.0", fn: "Logit" },
  km: { library: "lifelines", version: "0.30.3", fn: "KaplanMeierFitter" },
  logrank: { library: "statsmodels", version: "0.15.0", fn: "survdiff" },
  fisher: { library: "scipy", version: "1.18.1", fn: "fisher_exact" },
  chi2: { library: "scipy", version: "1.18.1", fn: "chi2_contingency" },
  bh: { library: "statsmodels", version: "0.15.0", fn: "multipletests(method=\"fdr_bh\")" },
  cmh: { library: "statsmodels", version: "0.15.0", fn: "StratifiedTable" },
  welch: { library: "scipy", version: "1.18.1", fn: "ttest_ind(equal_var=False)" },
  anova: { library: "statsmodels", version: "0.15.0", fn: "anova_generic(use_var=\"unequal\")" },
  ranks: { library: "scipy", version: "1.18.1", fn: "mannwhitneyu / kruskal" },
  pearson: { library: "scipy", version: "1.18.1", fn: "pearsonr" },
  meta: { library: "statsmodels", version: "0.15.0", fn: "combine_effects (fixed effect)" },
  gsea: { library: "gseapy", version: "1.3.1", fn: "prerank" },
  cif: { library: "statsmodels", version: "0.15.0", fn: "CumIncidenceRight" },
  mcnemar: { library: "statsmodels", version: "0.15.0", fn: "mcnemar(exact=True)" },
} as const;
const GOLDEN_TEST = "test/regression-golden.test.ts";

/** One dummy-coded or numeric model term, as buildCoxColumns produced it. */
export interface MethodColumn { axisIndex: number; label: string; reference?: string; level?: string }

/** What one fit was given and what came back — everything the record is built from. */
export interface FitTrace {
  /** the cohort this fit belongs to, when each cohort is fitted separately */
  scope?: string;
  /** per study: patients in the cohort there, and rows its query returned */
  perStudy: { study: string; cohortPatients: number; rows: number }[];
  covariates: CoxCovariate[];
  kinds: AxisKind[];
  columns: MethodColumn[];
  /** the design matrix exactly as fitted, for per-term counts */
  x: number[][];
  fit: { n: number; events: number; iterations: number; loglik: number };
}

export interface CoxTrace extends FitTrace {
  censoredAtCutoff: number;
  droppedBadTime: number;
  /** what the fit reported, per term — for the script check */
  coefficients: { label: string; beta: number; se: number; p: number }[];
}

export interface LogisticTrace extends FitTrace {
  outcomeKind: AxisKind;
  outcomeEvent?: string;
  outcomeOther: string[];
  /** what the fit reported, per term — for the script check */
  coefficients: { label: string; beta: number; se: number; p: number }[];
}

const plural = (n: number, one: string, many = one + "s") => n.toLocaleString() + " " + (n === 1 ? one : many);
const py = (s: string) => JSON.stringify(s);
/** Text for a `#` comment: a line break in a cohort name or a value would end the comment and run the rest. */
const pyComment = (s: unknown) => String(s).replace(/[\r\n]+/g, " ");

/** Why a categorical covariate's reference level is the one it is — mirrors buildCoxColumns. */
function referenceReason(cov: CoxCovariate, reference: string): string {
  if (cov.reference && cov.reference === reference) return "declared in the view";
  const absentLevel = cov.source !== "alteration" ? undefined
    : "oql" in cov ? OQL_UNALTERED : (cov.by === "mutated" || cov.by === undefined) ? "Not mutated" : undefined;
  const fallback = absentLevel && reference === absentLevel
    ? (absentLevel === OQL_UNALTERED ? "the fixed default for an OQL axis" : "the fixed default for a mutated-vs-not axis")
    : "the most frequent level";
  return cov.reference ? "declared “" + cov.reference + "” was never observed, so " + fallback : fallback;
}

function fetchSteps(t: FitTrace, query: string, keep: string): MethodStep[] {
  return t.perStudy.map((s) => ({
    kind: "fetch" as const,
    title: "Fetch one row per patient",
    detail: "The " + query + " query above. " + keep + " " +
      (s.cohortPatients > s.rows ? plural(s.cohortPatients - s.rows, "cohort patient") + " had no row." : "Every cohort patient had a row."),
    scope: s.study,
    rowsIn: s.cohortPatients,
    rowsOut: s.rows,
  }));
}

function codingStep(t: FitTrace): MethodStep {
  const params: [string, string][] = t.columns.map((col, i) => {
    const source = "c" + col.axisIndex;
    if (t.kinds[col.axisIndex] === "num") return [col.label, "numeric, as fetched (" + source + ")"];
    const ones = t.x.reduce((n, row) => n + (row[i] === 1 ? 1 : 0), 0);
    return [col.label, "1 if " + source + " = “" + col.level + "”, else 0 · " + ones.toLocaleString() + " of " +
      t.x.length.toLocaleString() + " patients · reference “" + col.reference + "”: " + referenceReason(t.covariates[col.axisIndex], col.reference!)];
  });
  return {
    kind: "transform",
    title: "Code the covariates",
    detail: "Each numeric covariate is one term. Each categorical covariate becomes one 0/1 term per level, measured against a reference level that gets no term.",
    ...(t.scope ? { scope: t.scope } : {}),
    params,
  };
}

/** pandas columns for the design matrix, one line per term */
function pyTerms(t: FitTrace, indent: string): string {
  return t.columns.map((col) => {
    const c = py("c" + col.axisIndex);
    return indent + py(col.label) + ": " + (t.kinds[col.axisIndex] === "num"
      ? "df[" + c + "].astype(float),"
      : "(df[" + c + "] == " + py(col.level!) + ").astype(float),  # reference: " + pyComment(col.reference));
  }).join("\n");
}

function pyCategoricalDtypes(t: FitTrace, extra: string[] = []): string {
  const cols = [...extra, ...t.kinds.map((k, i) => k === "num" ? null : "c" + i).filter((c): c is string => !!c)];
  return cols.length ? ", dtype={" + cols.map((c) => py(c) + ": str").join(", ") + "}" : "";
}

function pyFileName(base: string, scope?: string): string {
  return base + (scope ? "_" + scope.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") : "") + ".csv";
}

export interface CoxMethodOptions {
  endpoint: string;
  monthsColumn: string;
  statusColumn: string;
  cutoffMonths?: number;
  stratifyByStudy: boolean;
  queryLabel: string;
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

// ---- aggregate inputs, embedded in a script ---------------------------------------------------
// The aggregate views' inputs are counts with no identifiers in them, so a script can carry them
// and run as is. Past this many rows it names the query instead of inlining a table that size.

export const INLINE_ROWS_MAX = 20000;

function csvField(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
}

/** `name = pd.read_csv(...)`: inline when small enough, else from a file the reader exports. */
function pyTable(name: string, what: string, columns: string[], rows: (string | number | null | undefined)[][], file: string): string[] {
  if (rows.length > INLINE_ROWS_MAX) {
    return ["# " + pyComment(what) + " — " + rows.length.toLocaleString() + " rows, too many to include here: export them as " + pyComment(file),
      "# with columns " + pyComment(columns.join(", ")) + ".",
      name + " = pd.read_csv(" + py(file) + ")"];
  }
  // each CSV line is its own string literal, so no value in the data can end the string
  return ["# " + pyComment(what) + ".",
    name + " = pd.read_csv(io.StringIO(\"\\n\".join([",
    "    " + py(columns.map(csvField).join(",")) + ",",
    ...rows.map((r) => "    " + py(r.map(csvField).join(",")) + ","),
    "])))"];
}

// ---- survival: Kaplan-Meier and log-rank -------------------------------------------------------

export interface SurvivalTrace {
  endpoint: string;
  monthsColumn: string;
  statusColumn: string;
  queryLabel: string;
  /** the timeline event survival was re-anchored to, which brings delayed entry with it */
  anchor?: string;
  cutoffMonths?: number;
  beyondCutoff: number;
  display: "survival" | "incidence";
  cohorts: {
    name: string;
    perStudy: { study: string; cohortPatients: number; patients: number; rows: number }[];
    n: number; events: number; median: number | null;
    /** follow-up ending at or before entry: never at risk, left out */
    unobserved?: number;
  }[];
  /** every (months, event, n[, entry]) row each study returned, per cohort */
  counts: { cohort: string; study: string; months: number; event: number; n: number; entry?: number }[];
  test:
    | { kind: "none"; reason: string }
    | { kind: "logrank" | "logrankK"; stratified: boolean; strata: number; chi2: number; df: number; p: number;
        pooled?: { chi2: number; p: number } };
}

const pFmt = (p: number) => p === 0 ? "<1e-300" : p < 1e-4 ? p.toExponential(2) : p.toPrecision(3);

export function survivalMethod(t: SurvivalTrace): MethodRecord {
  const steps: MethodStep[] = [];
  for (const c of t.cohorts) for (const s of c.perStudy) {
    steps.push({
      kind: "fetch", title: "Count patients by time and status",
      detail: "The " + t.queryLabel + " query above: patients grouped by identical " + t.monthsColumn + ", event" +
        (t.anchor ? " and entry time" : "") + ", returned as counts — no patient identifier leaves the database. Event: " +
        t.statusColumn + " starting with “1”; any other value is censored. " +
        (s.cohortPatients > s.patients ? plural(s.cohortPatients - s.patients, "cohort patient") + " had no " + t.monthsColumn + " value." : "Every cohort patient had a value."),
      scope: c.name + " · " + s.study, rowsIn: s.cohortPatients, rowsOut: s.patients,
      params: [["count rows", s.rows.toLocaleString()]],
    });
  }
  if (t.cutoffMonths != null) {
    steps.push({ kind: "transform", title: "Censor at " + t.cutoffMonths + " months",
      detail: plural(t.beyondCutoff, "patient") + " followed past " + t.cutoffMonths + " months had their time set to " +
        t.cutoffMonths + " and their event to censored." });
  }
  steps.push({
    kind: "statistic", title: "Estimate survival by Kaplan–Meier",
    detail: "The product-limit estimator, one curve per cohort, pooled over its studies" +
      (t.anchor ? ", with delayed entry: re-anchored to " + t.anchor + ", a patient is at risk only from the time the study could first observe them" : "") +
      (t.cohorts.some((c) => c.unobserved) ? ". A patient whose follow-up ends at or before their entry was never at risk and is left out: " +
        t.cohorts.filter((c) => c.unobserved).map((c) => c.name + " " + c.unobserved!.toLocaleString("en-US")).join(", ") : "") +
      ". The median is the first time the curve is at or below 0.5" +
      (t.display === "incidence" ? ". The figure shows cumulative incidence, 1 − S(t)" : "") + ".",
    params: t.cohorts.map((c) => [c.name, c.n.toLocaleString() + " patients, " + c.events.toLocaleString() + " events, median " +
      (c.median == null ? "not reached" : c.median.toFixed(1) + " months")] as [string, string]),
  });
  if (t.test.kind === "none") {
    steps.push({ kind: "statistic", title: "No log-rank test", detail: t.test.reason });
  } else {
    const k = t.cohorts.length, x = t.test;
    steps.push({
      kind: "statistic",
      title: (k === 2 ? "Two-group" : k + "-group") + " log-rank test" + (x.stratified ? ", stratified by study" : ""),
      detail: "At each event time, every cohort's observed events against its share of the risk set, with the hypergeometric variance" +
        (k > 2 ? " and covariance; χ² on " + x.df + " df from the deviation vector" : "; χ² on 1 df") +
        (x.stratified ? ". Each study is its own stratum — compared only against itself — and the strata are summed, so a difference in case mix between studies cannot pass for a difference between cohorts" : "") + ".",
      params: [
        ["χ² / df / p", x.chi2.toFixed(4) + " / " + x.df + " / " + pFmt(x.p)],
        ...(x.stratified ? [["strata with events", String(x.strata)] as [string, string]] : []),
        ...(x.pooled ? [["pooled, for contrast", "χ² " + x.pooled.chi2.toFixed(4) + ", p " + pFmt(x.pooled.p)] as [string, string]] : []),
      ],
    });
  }
  const hasEntry = t.counts.some((r) => r.entry != null);
  const cols = ["cohort", "study", "months", "event", "n", ...(hasEntry ? ["entry"] : [])];
  const python = [
    "# Refit with lifelines (Kaplan-Meier) and statsmodels (log-rank): lifelines " + VERIFIED.km.version +
      " and statsmodels " + VERIFIED.logrank.version + " are the versions our code is tested against.",
    "import io",
    "import pandas as pd",
    "from lifelines import KaplanMeierFitter",
    "from scipy.stats import chi2 as chi2_dist",
    "from statsmodels.duration.survfunc import survdiff",
    "",
    RESULT_INIT,
    ...pyTable("counts", "What the " + t.queryLabel + " query returned for each cohort and study: n patients per (months, event" +
      (hasEntry ? ", entry" : "") + ")", cols, t.counts.map((r) => [r.cohort, r.study, r.months, r.event, r.n, ...(hasEntry ? [r.entry] : [])]),
      "survival_counts.csv"),
    "# one row per patient again: a count row stands for n patients with exactly those values",
    "df = counts.loc[counts.index.repeat(counts[\"n\"])].reset_index(drop=True)",
    ...(t.cutoffMonths != null ? [
      "df.loc[df[\"months\"] > " + t.cutoffMonths + ", \"event\"] = 0  # censor at " + t.cutoffMonths + " months",
      "df[\"months\"] = df[\"months\"].clip(upper=" + t.cutoffMonths + ")"] : []),
    "df = df[df[\"months\"] >= 0]",
    ...(hasEntry ? ["df = df[df[\"months\"] > df[\"entry\"]]  # follow-up ending at or before entry was never at risk"] : []),
    "",
    "for cohort, g in df.groupby(\"cohort\", sort=False):",
    "    km = KaplanMeierFitter().fit(g[\"months\"], g[\"event\"]" + (hasEntry ? ", entry=g[\"entry\"]" : "") + ", label=cohort)",
    "    print(f\"{cohort}: n={len(g)}, events={g['event'].sum()}, median={km.median_survival_time_}\")",
    "    RESULT[f\"km:{cohort}:n\"], RESULT[f\"km:{cohort}:events\"], RESULT[f\"km:{cohort}:median\"] = len(g), g[\"event\"].sum(), km.median_survival_time_",
    ...(t.test.kind === "none" ? [] : [
      "",
      "# p from the chi-squared tail directly: survdiff's own p rounds to 0 below about 1e-16",
      ...(t.test.stratified ? [
        "chi2, p = survdiff(df[\"months\"], df[\"event\"], df[\"cohort\"], strata=df[\"study\"]" + (hasEntry ? ", entry=df[\"entry\"]" : "") + ")",
        "print(f\"log-rank, stratified by study: chi2={chi2:.4f}, p={chi2_dist.sf(chi2, " + t.test.df + "):.4g}\")",
        "RESULT[\"logrank:chi2\"], RESULT[\"logrank:p\"] = chi2, chi2_dist.sf(chi2, " + t.test.df + ")",
        "chi2, p = survdiff(df[\"months\"], df[\"event\"], df[\"cohort\"]" + (hasEntry ? ", entry=df[\"entry\"]" : "") + ")",
        "print(f\"log-rank, pooled: chi2={chi2:.4f}, p={chi2_dist.sf(chi2, " + t.test.df + "):.4g}\")",
        "RESULT[\"logrank:pooled:chi2\"], RESULT[\"logrank:pooled:p\"] = chi2, chi2_dist.sf(chi2, " + t.test.df + ")",
      ] : [
        "chi2, p = survdiff(df[\"months\"], df[\"event\"], df[\"cohort\"]" + (hasEntry ? ", entry=df[\"entry\"]" : "") + ")",
        "print(f\"log-rank: chi2={chi2:.4f}, p={chi2_dist.sf(chi2, " + t.test.df + "):.4g}\")",
        "RESULT[\"logrank:chi2\"], RESULT[\"logrank:p\"] = chi2, chi2_dist.sf(chi2, " + t.test.df + ")",
      ]),
    ]),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["kaplanMeier", ...(t.test.kind === "logrank" ? ["logRank"] : t.test.kind === "logrankK" ? ["logRankK"] : [])],
      file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Kaplan–Meier matches " + VERIFIED.km.library + " " + VERIFIED.km.version + " " + VERIFIED.km.fn +
      " (curves are reported to 4 decimals); the log-rank matches " + VERIFIED.logrank.library + " " + VERIFIED.logrank.version + " " +
      VERIFIED.logrank.fn + " to a relative 1e-6, pooled, stratified, with delayed entry and for k groups (test/survival-golden.test.ts).",
    python: withResult(python),
    check: {
      ...checks("km:", t.cohorts, (c) => c.name, [["n", "n", { abs: 0 }], ["events", "events", { abs: 0 }], ["median", "median", { abs: 1e-9 }]]),
      ...(t.test.kind === "none" ? {} : {
        "logrank:chi2": { v: t.test.chi2, abs: 5e-5 }, "logrank:p": { v: t.test.p, rel: 1e-5, abs: 1e-300 },
        ...(t.test.pooled ? { "logrank:pooled:chi2": { v: t.test.pooled.chi2, abs: 5e-5 }, "logrank:pooled:p": { v: t.test.pooled.p, rel: 1e-5, abs: 1e-300 } } : {}),
      }),
    },
  };
}

// ---- compare: per-gene alteration frequency, Fisher / chi-squared, Benjamini-Hochberg ---------

/** What "altered" and "driver" mean in every gene count, stated once for the views that use them. */
const ALTERED_MEANING = "altered: any mutation or structural variant, or a copy-number change of ±2 (amplification or deep deletion)";
const driverMeaning = (pin: string | null) => pin
  ? "driver: an alteration OncoKB calls oncogenic, from the OncoKB release pinned for this run (" + pin + ")"
  : "driver: no OncoKB release is pinned, so no alteration is counted as a driver";

export interface CompareTrace {
  oncokbPin: string | null;
  cohorts: string[];
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  /** the combined ("any") row each study returned per gene */
  counts: { cohort: string; study: string; gene: string; profiled: number; altered: number; driver: number }[];
  genes: string[];
  /** what the view reported per gene — for the script check */
  results: { gene: string; pAny?: number; pDriver?: number; qAny?: number; qDriver?: number }[];
}

export function compareMethod(t: CompareTrace): MethodRecord {
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count profiled and altered patients per gene",
    detail: "The geneCounts query above. Per gene: patients with a sample on a gene panel that covers the gene (profiled — the denominator, so a gene a panel omits is not counted as wild-type), " +
      ALTERED_MEANING + ", and " + driverMeaning(t.oncokbPin) + ". Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
    params: [["genes", String(t.genes.length)]],
  }));
  const multiStudy = t.cohorts.some((c) => t.perSite.filter((s) => s.cohort === c).length > 1);
  if (multiStudy) {
    steps.push({ kind: "transform", title: "Sum each cohort's counts across its studies",
      detail: "Profiled, altered and driver counts are added study by study, so the denominator stays panel-aware. The test that follows is on the pooled counts, not stratified by study." });
  }
  const k = t.cohorts.length;
  if (k === 2) {
    steps.push({ kind: "statistic", title: "Fisher's exact test per gene",
      detail: "Two-sided, on the 2×2 table of altered vs not altered (profiled − altered) in each cohort — once for any alteration and once for drivers only.",
      params: [["genes tested", String(t.genes.length)]] });
  } else if (k > 2) {
    steps.push({ kind: "statistic", title: "Pearson χ² test per gene",
      detail: "On the 2×" + k + " table of altered vs not altered, one column per cohort, with no continuity correction; an all-zero row or column is dropped first. Once for any alteration and once for drivers only.",
      params: [["genes tested", String(t.genes.length)], ["df", String(k - 1)]] });
  }
  if (k >= 2) {
    steps.push({ kind: "statistic", title: "Benjamini–Hochberg across genes",
      detail: "q-values over the " + t.genes.length + " genes tested here, separately for the any-alteration and driver-only families." });
  } else {
    steps.push({ kind: "statistic", title: "No test", detail: "One cohort: frequencies only, nothing to compare against." });
  }
  const python = [
    "# Recompute with scipy and statsmodels: scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version +
      " are the versions our code is tested against.",
    "import io",
    "import pandas as pd",
    k > 2 ? "from scipy.stats import chi2_contingency" : "from scipy.stats import fisher_exact",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("counts", "What the geneCounts query returned for each cohort and study: patients profiled for, altered in, and with a driver in each gene",
      ["cohort", "study", "gene", "profiled", "altered", "driver"],
      t.counts.map((r) => [r.cohort, r.study, r.gene, r.profiled, r.altered, r.driver]), "gene_counts.csv"),
    "cohorts = " + JSON.stringify(t.cohorts),
    "per_cohort = counts.groupby([\"gene\", \"cohort\"])[[\"profiled\", \"altered\", \"driver\"]].sum()",
    "for (gene, cohort), r in per_cohort.iterrows():",
    "    for f in (\"profiled\", \"altered\", \"driver\"):",
    "        RESULT[f\"compare:{gene}:{cohort}:{f}\"] = r[f]",
    "",
    ...(k < 2 ? ["print(per_cohort)"] : [
      "def test(gene, col):",
      "    t = per_cohort.loc[gene].reindex(cohorts).fillna(0)",
      ...(k === 2 ? [
        "    (a, pa), (b, pb) = [(r[col], r[\"profiled\"]) for _, r in t.iterrows()]",
        "    return fisher_exact([[a, pa - a], [b, pb - b]], alternative=\"two-sided\").pvalue",
      ] : [
        "    table = pd.DataFrame({\"yes\": t[col], \"no\": t[\"profiled\"] - t[col]})",
        "    table = table.loc[table.sum(axis=1) > 0, table.sum(axis=0) > 0]  # drop an all-zero row or column",
        "    if min(table.shape) < 2:",
        "        return 1.0",
        "    return chi2_contingency(table.to_numpy(), correction=False).pvalue",
      ]),
      "",
      "genes = " + JSON.stringify(t.genes),
      "result = pd.DataFrame({\"gene\": genes,",
      "                       \"p_any\": [test(g, \"altered\") for g in genes],",
      "                       \"p_driver\": [test(g, \"driver\") for g in genes]})",
      "result[\"q_any\"] = multipletests(result[\"p_any\"], method=\"fdr_bh\")[1]",
      "result[\"q_driver\"] = multipletests(result[\"p_driver\"], method=\"fdr_bh\")[1]",
      "print(result.sort_values(\"p_any\").to_string(index=False))",
      "for r in result.itertuples():",
      "    for f in (\"p_any\", \"p_driver\", \"q_any\", \"q_driver\"):",
      "        RESULT[f\"compare:{r.gene}:{f}\"] = getattr(r, f)",
    ]),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: k === 2 ? ["fisherExact", "benjaminiHochberg"] : k > 2 ? ["chiSquareTest", "benjaminiHochberg"] : [],
      file: "lib/stats.ts", commit: BUILD_COMMIT },
    ...(k >= 2 ? { verification: (k === 2 ? "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact"
      : "The χ² test matches scipy " + VERIFIED.chi2.version + " chi2_contingency(correction=False)") +
      " and Benjamini–Hochberg matches statsmodels " + VERIFIED.bh.version + " " + VERIFIED.bh.fn + ", to a relative 1e-6 (test/tables-golden.test.ts)." } : {}),
    python: withResult(python),
    check: {
      ...checks("compare:", t.results, (r) => r.gene, [["pAny", "p_any"], ["pDriver", "p_driver"], ["qAny", "q_any"], ["qDriver", "q_driver"]]),
      // the summed counts behind every cell, exact
      ...checks("compare:", [...t.counts.reduce((m, r) => {
        const k = r.gene + ":" + r.cohort, cur = m.get(k) || { key: k, profiled: 0, altered: 0, driver: 0 };
        cur.profiled += r.profiled; cur.altered += r.altered; cur.driver += r.driver; return m.set(k, cur);
      }, new Map<string, { key: string; profiled: number; altered: number; driver: number }>()).values()], (r) => r.key,
        [["profiled", "profiled", { abs: 0 }], ["altered", "altered", { abs: 0 }], ["driver", "driver", { abs: 0 }]]),
    },
  };
}

// ---- cooccurrence: per-pair 2x2, Fisher or CMH stratified by study, Benjamini-Hochberg --------

export interface CooccurrenceTrace {
  cohort: string;
  cohortPatients: { study: string; patients: number }[];
  /** the four counts each study returned per pair */
  counts: { study: string; a: string; b: string; both: number; onlyA: number; onlyB: number; neither: number }[];
  pairs: number;
  assessable: number;
  /** what the view reported per assessable pair — for the script check */
  results: { a: string; b: string; p: number; q: number; pStratified?: number }[];
}

export function cooccurrenceMethod(t: CooccurrenceTrace): MethodRecord {
  const stratified = t.cohortPatients.length > 1;
  const steps: MethodStep[] = t.cohortPatients.map((s) => ({
    kind: "fetch" as const, title: "Count each gene pair's 2×2 table",
    detail: "The pairCounts query above. Of the patients with a sample on a mutation panel covering both genes: how many are altered in both, only the first, only the second, or neither (" +
      ALTERED_MEANING + "). Four counts per pair, nothing else.",
    scope: t.cohort + " · " + s.study, rowsIn: s.patients,
    params: [["pairs", String(t.pairs)]],
  }));
  if (t.assessable < t.pairs) {
    steps.push({ kind: "transform", title: "Set aside pairs no panel covers",
      detail: plural(t.pairs - t.assessable, "pair") + " had no patient profiled for both genes — no denominator, so no test; they are omitted rather than reported as p = 1.",
      rowsIn: t.pairs, rowsOut: t.assessable });
  }
  steps.push({ kind: "statistic", title: "Log₂ odds ratio per pair",
    detail: "log₂((both · neither) / (only first · only second)) on the counts summed across studies, with 0.5 added to every cell when any cell is 0." +
      (stratified ? " The direction reported (co-occurrence vs mutual exclusivity) follows the Mantel–Haenszel odds ratio below." : "") });
  steps.push(stratified
    ? { kind: "statistic", title: "Cochran–Mantel–Haenszel test, stratified by study",
        detail: "Each study's 2×2 is a stratum (one with an empty margin says nothing and is dropped); the test of a common odds ratio of 1, with the 0.5 continuity correction applied when |Σa − ΣE[a]| ≥ 0.5 (as R's mantelhaen.test), on 1 df. This p is the one corrected and ranked; the two-sided Fisher p on the pooled counts is reported alongside." }
    : { kind: "statistic", title: "Fisher's exact test per pair", detail: "Two-sided, on the pair's 2×2 table." });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across pairs",
    detail: "q-values over the " + t.assessable + " assessable pairs, from the " + (stratified ? "stratified" : "Fisher") + " p-values." });
  const python = [
    "# Recompute with scipy and statsmodels: scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version +
      " are the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import fisher_exact",
    ...(stratified ? ["from scipy.stats import chi2 as chi2_dist", "from statsmodels.stats.contingency_tables import StratifiedTable"] : []),
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("counts", "What the pairCounts query returned for each study, cohort " + JSON.stringify(t.cohort),
      ["study", "a", "b", "both", "only_a", "only_b", "neither"],
      t.counts.map((r) => [r.study, r.a, r.b, r.both, r.onlyA, r.onlyB, r.neither]), "pair_counts.csv"),
    "",
    "def log2_or(a, b, c, d):",
    "    if 0 in (a, b, c, d):",
    "        a, b, c, d = a + 0.5, b + 0.5, c + 0.5, d + 0.5",
    "    return np.log2(a * d / (b * c))",
    "",
    "rows = []",
    "for (a, b), g in counts.groupby([\"a\", \"b\"], sort=False):",
    "    s = g[[\"both\", \"only_a\", \"only_b\", \"neither\"]].sum()",
    "    if s.sum() == 0:",
    "        continue  # no patient profiled for both genes: not assessable",
    "    row = {\"a\": a, \"b\": b, \"log2_or\": log2_or(*s),",
    "           \"p_fisher\": fisher_exact([[s.both, s.only_a], [s.only_b, s.neither]], alternative=\"two-sided\").pvalue}",
    ...(stratified ? [
      "    strata = [np.array([[r.both, r.only_a], [r.only_b, r.neither]], dtype=float) for r in g.itertuples()",
      "              if min(r.both + r.only_a, r.only_b + r.neither, r.both + r.only_b, r.only_a + r.neither) > 0]",
      "    if strata:",
      "        st = StratifiedTable(strata)",
      "        expected = sum(t[0].sum() * t[:, 0].sum() / t.sum() for t in strata)",
      "        delta = abs(sum(t[0, 0] for t in strata) - expected)",
      "        stat = st.test_null_odds(correction=bool(delta >= 0.5)).statistic  # R's continuity-correction rule",
      "        row[\"p_cmh\"] = chi2_dist.sf(stat, 1)  # from the tail directly: test_null_odds' own p is 0 below about 1e-16",
      "        row[\"or_mh\"] = st.oddsratio_pooled",
      "    else:",
      "        row[\"p_cmh\"] = 1.0",
    ] : []),
    "    rows.append(row)",
    "",
    "result = pd.DataFrame(rows)",
    "p = result[\"" + (stratified ? "p_cmh" : "p_fisher") + "\"]",
    "result[\"q\"] = multipletests(p, method=\"fdr_bh\")[1]",
    "print(result.sort_values(\"" + (stratified ? "p_cmh" : "p_fisher") + "\").to_string(index=False))",
    "for r in result.itertuples():",
    "    RESULT[f\"cooccurrence:{r.a}/{r.b}:p\"], RESULT[f\"cooccurrence:{r.a}/{r.b}:q\"] = r.p_fisher, r.q",
    ...(stratified ? ["    RESULT[f\"cooccurrence:{r.a}/{r.b}:p_cmh\"] = r.p_cmh"] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["fisherExact", ...(stratified ? ["cochranMantelHaenszel"] : []), "log2OddsRatio", "benjaminiHochberg"],
      file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact" +
      (stratified ? ", the CMH test and Mantel–Haenszel odds ratio statsmodels " + VERIFIED.cmh.version + " " + VERIFIED.cmh.fn : "") +
      " and Benjamini–Hochberg statsmodels " + VERIFIED.bh.version + " " + VERIFIED.bh.fn + ", to a relative 1e-6 (test/tables-golden.test.ts).",
    python: withResult(python),
    check: checks("cooccurrence:", t.results, (r) => r.a + "/" + r.b, [["p", "p"], ["q", "q"], ["pStratified", "p_cmh"]]),
  };
}

// ---- clinical: chi-squared, Welch t / ANOVA from moments, rank tests from histograms, BH -------

export interface ClinicalTrace {
  cohorts: string[];
  singleStudy: boolean;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  attributes: {
    attribute: string; per: "patient" | "sample"; kind: "cat" | "num"; skipped?: string;
    test?: string; statistic?: number; df?: number; df2?: number; p?: number; q?: number;
    rankStatistic?: number; rankP?: number; distinct?: number; minExpected?: number; histogramTruncated?: boolean;
  }[];
  categorical: { cohort: string; study: string; attribute: string; value: string; n: number }[];
  numeric: { cohort: string; study: string; attribute: string; n: number; sum: number; sumsq: number }[];
  /** single-study only: each numeric attribute's complete (value, count) distribution per cohort */
  histograms: { cohort: string; attribute: string; value: number; n: number }[];
  /** the medians and quartiles the view reported — for the script check */
  medians: { attribute: string; cohort: string; median: number | null; q1: number | null; q3: number | null }[];
}

export function clinicalMethod(t: ClinicalTrace): MethodRecord {
  const k = t.cohorts.length;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Describe each attribute",
    detail: "The attributeStats query above. A categorical attribute comes back as a count per value; a numeric one as n, Σx and Σx² (from which the mean and variance are exact, and which add across studies)" +
      (t.singleStudy ? ", plus its complete value distribution as (value, count) pairs for the median, IQR and rank tests" : "") +
      ". Patients for a patient-level attribute, samples for a sample-level one. No individual value leaves the database" +
      (t.singleStudy ? " except as a count of how many share it" : "") + ".",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  if (!t.singleStudy) {
    steps.push({ kind: "transform", title: "Add each cohort's counts and moments across its studies",
      detail: "Value counts, n, Σx and Σx² add exactly. Vocabularies are not harmonized: the same value spelled differently in two studies stays two values. Medians and rank tests need each study's full distribution in one place, so they are not computed for a view that spans studies." });
  }
  const skipped = t.attributes.filter((a) => a.skipped);
  if (skipped.length) {
    steps.push({ kind: "transform", title: "Set aside attributes that cannot be tested",
      detail: "Each is named with its reason rather than dropped.",
      params: skipped.map((a) => [a.attribute, a.skipped!] as [string, string]) });
  }
  const fmtP = (p?: number) => p == null ? "—" : pFmt(p);
  const cat = t.attributes.filter((a) => !a.skipped && a.kind === "cat");
  const num = t.attributes.filter((a) => !a.skipped && a.kind === "num");
  if (cat.length) {
    steps.push({ kind: "statistic", title: "Pearson χ² for each categorical attribute",
      detail: "On the cohort × value table over the full vocabulary, with no continuity correction; an all-zero row or column is dropped first. The smallest expected count is reported because the χ² approximation is poor below about 5.",
      params: cat.map((a) => [a.attribute, a.distinct + " values · χ² " + a.statistic + " on " + a.df + " df · p " + fmtP(a.p) +
        " · smallest expected " + a.minExpected] as [string, string]) });
  }
  if (num.length) {
    steps.push({ kind: "statistic", title: k === 2 ? "Welch's t-test for each numeric attribute" : "Welch's ANOVA for each numeric attribute",
      detail: (k === 2
        ? "Unequal-variance t from each cohort's n, mean and variance, with Welch–Satterthwaite degrees of freedom; two-sided."
        : "The unequal-variance F test from each cohort's n, mean and variance; a cohort with fewer than 2 values or no variance is left out.") +
        " Mean and variance are from the summed moments: variance = (Σx² − (Σx)²/n) / (n − 1).",
      params: num.map((a) => [a.attribute, (k === 2 ? "t " + a.statistic + " on " + a.df + " df" : "F " + a.statistic + " on " + a.df + " and " + a.df2 + " df") +
        " · p " + fmtP(a.p)] as [string, string]) });
    if (t.singleStudy) {
      steps.push({ kind: "statistic", title: k === 2 ? "Mann–Whitney U alongside" : "Kruskal–Wallis alongside",
        detail: "From each cohort's complete value distribution: ranks averaged within tied values, the variance tie-corrected" +
          (k === 2 ? ", the normal approximation with a 0.5 continuity correction; two-sided" : "; H on " + (k - 1) + " df") +
          ". Medians and quartiles from the same distribution, interpolating linearly between ranks. A check against skew and outliers — not part of the q-value correction.",
        params: num.map((a) => [a.attribute, a.histogramTruncated ? "not computed: too many distinct values to send the distribution whole"
          : a.rankStatistic == null ? "—" : (k === 2 ? "U " : "H ") + a.rankStatistic + " · p " + fmtP(a.rankP)] as [string, string]) });
    }
  }
  const tested = t.attributes.filter((a) => a.p != null);
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across attributes",
    detail: "q-values over the " + tested.length + " tested attributes, from the χ² and Welch p-values together." });

  const hasCat = t.categorical.length > 0, hasNum = t.numeric.length > 0, hasHist = t.histograms.length > 0;
  const python = [
    "# Recompute with scipy and statsmodels: scipy " + VERIFIED.welch.version + " and statsmodels " + VERIFIED.anova.version +
      " are the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    ...((names) => names.length ? ["from scipy.stats import " + names.join(", ")] : [])(
      [hasCat ? "chi2_contingency" : "", hasHist ? (k === 2 ? "mannwhitneyu" : "kruskal") : "", hasNum && k === 2 ? "ttest_ind_from_stats" : ""].filter(Boolean)),
    ...(hasNum && k > 2 ? ["from statsmodels.stats.oneway import anova_generic"] : []),
    "from statsmodels.stats.multitest import multipletests",
    "",
    "cohorts = " + JSON.stringify(t.cohorts),
    RESULT_INIT,
    "p_values = {}",
    ...(hasCat ? [
      "",
      ...pyTable("categorical", "Categorical attributes: what the attributeStats query returned per cohort and study, a count per value",
        ["cohort", "study", "attribute", "value", "n"], t.categorical.map((r) => [r.cohort, r.study, r.attribute, r.value, r.n]), "categorical_counts.csv"),
      "categorical[\"value\"] = categorical[\"value\"].astype(str)",
      "for attr, g in categorical.groupby(\"attribute\", sort=False):",
      "    table = g.pivot_table(index=\"cohort\", columns=\"value\", values=\"n\", aggfunc=\"sum\", fill_value=0).reindex(cohorts, fill_value=0)",
      "    table = table.loc[table.sum(axis=1) > 0, table.sum(axis=0) > 0]  # drop an all-zero row or column",
      "    p = chi2_contingency(table.to_numpy(), correction=False).pvalue if min(table.shape) >= 2 else 1.0",
      "    p_values[attr] = p",
      "    print(f\"{attr}: chi-squared p={p:.4g}\")",
    ] : []),
    ...(hasNum ? [
      "",
      ...pyTable("numeric", "Numeric attributes: n, sum and sum of squares per cohort and study", ["cohort", "study", "attribute", "n", "sum", "sumsq"],
        t.numeric.map((r) => [r.cohort, r.study, r.attribute, r.n, r.sum, r.sumsq]), "numeric_moments.csv"),
      "m = numeric.groupby([\"attribute\", \"cohort\"])[[\"n\", \"sum\", \"sumsq\"]].sum()",
      "m[\"mean\"] = m[\"sum\"] / m[\"n\"]",
      "m[\"var\"] = ((m[\"sumsq\"] - m[\"sum\"] ** 2 / m[\"n\"]) / (m[\"n\"] - 1)).clip(lower=0)  # rounding can put a constant attribute's just below 0",
      "for attr in numeric[\"attribute\"].unique():",
      "    g = m.loc[attr].reindex(cohorts)",
      ...(k === 2 ? [
        "    a, b = g.iloc[0], g.iloc[1]",
        "    p = ttest_ind_from_stats(a[\"mean\"], np.sqrt(a[\"var\"]), a[\"n\"], b[\"mean\"], np.sqrt(b[\"var\"]), b[\"n\"], equal_var=False).pvalue",
        "    print(f\"{attr}: Welch t p={p:.4g}\")",
      ] : [
        "    g = g[(g[\"n\"] >= 2) & (g[\"var\"] > 0)]  # a cohort with under 2 values or no variance says nothing",
        "    p = anova_generic(g[\"mean\"].to_numpy(), g[\"var\"].to_numpy(), g[\"n\"].to_numpy(), use_var=\"unequal\", welch_correction=True).pvalue",
        "    print(f\"{attr}: Welch ANOVA p={p:.4g}\")",
      ]),
      "    p_values[attr] = p",
    ] : []),
    ...(hasHist ? [
      "",
      ...pyTable("histograms", "Numeric attributes, single study: each cohort's complete value distribution", ["cohort", "attribute", "value", "n"],
        t.histograms.map((r) => [r.cohort, r.attribute, r.value, r.n]), "value_histograms.csv"),
      "for attr, g in histograms.groupby(\"attribute\", sort=False):",
      "    values = [np.repeat(h[\"value\"].to_numpy(), h[\"n\"].to_numpy()) for _, h in g.groupby(\"cohort\", sort=False)]",
      "    if len(values) < len(cohorts):",
      "        continue  # a cohort's distribution was too large to send whole: no rank test, as in the view",
      "    for c, v in zip(g[\"cohort\"].unique(), values):",
      "        print(f\"{attr} {c}: median={np.percentile(v, 50):.3f}, IQR={np.percentile(v, 25):.3f}-{np.percentile(v, 75):.3f}\")",
      "        for name, q in ((\"median\", 50), (\"q1\", 25), (\"q3\", 75)):",
      "            RESULT[f\"clinical:{attr}:{c}:{name}\"] = np.percentile(v, q)",
      k === 2
        ? "    RESULT[f\"clinical:{attr}:rank_p\"] = mannwhitneyu(*values, alternative='two-sided', use_continuity=True, method='asymptotic').pvalue"
        : "    RESULT[f\"clinical:{attr}:rank_p\"] = kruskal(*values).pvalue",
      "    print(f\"{attr}: " + (k === 2 ? "Mann-Whitney" : "Kruskal-Wallis") + " p={RESULT[f'clinical:{attr}:rank_p']:.4g}\")",
    ] : []),
    "",
    "q = multipletests(list(p_values.values()), method=\"fdr_bh\")[1]",
    "print(pd.DataFrame({\"attribute\": list(p_values), \"p\": list(p_values.values()), \"q\": q}).sort_values(\"p\").to_string(index=False))",
    "for (attr, p), qv in zip(p_values.items(), q):",
    "    RESULT[f\"clinical:{attr}:p\"], RESULT[f\"clinical:{attr}:q\"] = p, qv",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: [...(cat.length ? ["chiSquareTest"] : []), ...(num.length ? [k === 2 ? "welchT" : "welchAnovaTest"] : []),
      ...(num.length && t.singleStudy ? [k === 2 ? "mannWhitneyU" : "kruskalWallis", "quantilesFromHistogram"] : []), "benjaminiHochberg"],
      file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "χ² matches scipy " + VERIFIED.chi2.version + " chi2_contingency; Welch's t scipy ttest_ind(equal_var=False) and Welch's ANOVA statsmodels " +
      VERIFIED.anova.version + " anova_generic from the same moments; Mann–Whitney, Kruskal–Wallis and quantiles scipy/numpy on the expanded distribution; " +
      "Benjamini–Hochberg statsmodels multipletests — all to a relative 1e-6 (test/tables-golden.test.ts, test/moments-golden.test.ts).",
    python: withResult(python),
    check: {
      ...checks("clinical:", t.attributes.filter((a) => !a.skipped), (a) => a.attribute, [["p", "p"], ["q", "q"], ["rankP", "rank_p"]]),
      // medians and quartiles are reported to 3 decimals
      ...checks("clinical:", t.medians, (m) => m.attribute + ":" + m.cohort,
        [["median", "median", { abs: 5e-4 + 1e-9 }], ["q1", "q1", { abs: 5e-4 + 1e-9 }], ["q3", "q3", { abs: 5e-4 + 1e-9 }]]),
    },
  };
}

// ---- coexpression: Pearson from six sums, Fisher-z meta-analysis across studies, BH -----------

export interface CoexpressionTrace {
  cohort: string;
  profileType: string;
  cohortPatients: { study: string; patients: number }[];
  sums: { study: string; a: string; b: string; n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number }[];
  pairs: number;
  tested: number;
  /** what the view reported per pair — for the script check */
  results: { a: string; b: string; r: number | null; p: number; q: number; pMeta?: number }[];
}

export function coexpressionMethod(t: CoexpressionTrace): MethodRecord {
  const multi = t.cohortPatients.length > 1;
  const steps: MethodStep[] = t.cohortPatients.map((s) => ({
    kind: "fetch" as const, title: "Sum each gene pair's values",
    detail: "The pairMoments query above, on “" + t.profileType + "”. Per pair, over the patients with a value for both genes (a patient with several samples contributes their average): n, Σx, Σy, Σxy, Σx² and Σy² — six sums, no individual value.",
    scope: t.cohort + " · " + s.study, rowsIn: s.patients, params: [["pairs", String(t.pairs)]],
  }));
  if (multi) steps.push({ kind: "transform", title: "Add the six sums across studies",
    detail: "Every one is a sum, so the pooled totals — and the correlation of all patients taken together — are exact." });
  steps.push({ kind: "statistic", title: "Pearson correlation per pair" + (multi ? ", pooled" : ""),
    detail: "r = (nΣxy − ΣxΣy) / √((nΣx² − (Σx)²)(nΣy² − (Σy)²)); t = r√((n − 2)/(1 − r²)), two-sided p on n − 2 df. Undefined for n < 3 or a constant series." });
  if (multi) steps.push({ kind: "statistic", title: "Fisher-z meta-analysis across studies",
    detail: "Each study's own r → z = atanh(r), weighted by n − 3 (fixed effect); a study with n < 4 or |r| = 1 is left out. Pooled z / SE against the normal, two-sided. This asks whether the genes move together within a study, which differing study means can hide in the pooled r; it is the p that is corrected and ranked." });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across pairs",
    detail: "q-values over the " + t.tested + " pairs with a defined correlation, from the " + (multi ? "meta-analysis" : "Pearson") + " p-values." });
  const python = [
    "# Recompute with scipy and statsmodels: scipy " + VERIFIED.pearson.version + " and statsmodels " + VERIFIED.meta.version +
      " are the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import t as t_dist",
    ...(multi ? ["from statsmodels.stats.meta_analysis import combine_effects"] : []),
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("sums", "What the pairMoments query returned for each study, cohort " + JSON.stringify(t.cohort) + ", profile " + t.profileType,
      ["study", "a", "b", "n", "sx", "sy", "sxy", "sxx", "syy"], t.sums.map((r) => [r.study, r.a, r.b, r.n, r.sx, r.sy, r.sxy, r.sxx, r.syy]), "pair_sums.csv"),
    "",
    "def pearson(s):",
    "    # the same r and p scipy.stats.pearsonr gives on the values these sums came from",
    "    vx, vy = s.n * s.sxx - s.sx ** 2, s.n * s.syy - s.sy ** 2",
    "    if s.n < 3 or vx <= 0 or vy <= 0:",
    "        return None, 1.0",
    "    r = float(np.clip((s.n * s.sxy - s.sx * s.sy) / np.sqrt(vx * vy), -1, 1))",
    "    if abs(r) == 1:",
    "        return r, 0.0",
    "    t = r * np.sqrt((s.n - 2) / (1 - r * r))",
    "    return r, 2 * t_dist.sf(abs(t), s.n - 2)",
    "",
    "rows = []",
    "for (a, b), g in sums.groupby([\"a\", \"b\"], sort=False):",
    "    r, p = pearson(g[[\"n\", \"sx\", \"sy\", \"sxy\", \"sxx\", \"syy\"]].sum())",
    "    row = {\"a\": a, \"b\": b, \"r\": r, \"p\": p}",
    ...(multi ? [
      "    if len(g) > 1:  # in more than one study: meta-analyse the per-study correlations",
      "        per = [(pearson(s)[0], s.n) for s in g.itertuples()]",
      "        per = [(r_, n) for r_, n in per if r_ is not None and n >= 4 and abs(r_) < 1]",
      "        if per:",
      "            z = np.arctanh([r_ for r_, _ in per]); var = np.array([1 / (n - 3) for _, n in per])",
      "            res = combine_effects(z, var, method_re=\"chi2\")",
      "            zf, se = res.mean_effect_fe, res.sd_eff_w_fe",
      "            row.update(r_meta=np.tanh(zf), p_meta=2 * t_dist.sf(abs(zf / se), np.inf))  # normal tail",
      "        else:",
      "            row.update(r_meta=None, p_meta=1.0)  # no study had a usable correlation",
    ] : []),
    "    rows.append(row)",
    "",
    "result = pd.DataFrame(rows)",
    "tested = result[result[\"r\"].notna()]",
    "p = " + (multi ? "tested[\"p_meta\"].fillna(tested[\"p\"])" : "tested[\"p\"]"),
    "result.loc[tested.index, \"q\"] = multipletests(p, method=\"fdr_bh\")[1]",
    "print(result.reindex(result[\"r\"].abs().sort_values(ascending=False).index).to_string(index=False))",
    "for r in result.itertuples():",
    "    for f in (\"r\", \"p\", \"q\"" + (multi ? ", \"p_meta\"" : "") + "):",
    "        RESULT[f\"coexpression:{r.a}/{r.b}:{f}\"] = getattr(r, f)",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["pearsonFromMoments", ...(multi ? ["fisherZMeta"] : []), "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Pearson's r and p from the six sums match scipy " + VERIFIED.pearson.version + " pearsonr on the underlying values" +
      (multi ? ", and the Fisher-z meta-analysis statsmodels " + VERIFIED.meta.version + " " + VERIFIED.meta.fn : "") +
      ", to a relative 1e-6 (test/moments-golden.test.ts).",
    python: withResult(python),
    // r is reported to 4 decimals
    check: checks("coexpression:", t.results.filter((x) => x.r != null), (x) => x.a + "/" + x.b,
      [["r", "r", { abs: 5e-5 + 1e-12 }], ["p", "p"], ["q", "q"], ["pMeta", "p_meta"]]),
  };
}

// ---- diffexpr: Welch t per gene from moments, BH, preranked GSEA with a seeded null ------------

/** python/golden/gsea_null.py verbatim — the Python port of our seeded GSEA null; test/gsea-golden.test.ts
 *  holds the two to the same text and proves the port gives our p-values exactly. */
export const GSEA_NULL_PY = "import math\n\n\ndef seed_of(s):\n    \"\"\"FNV-1a over the name's UTF-16 code units: the seed each set's null is drawn from.\"\"\"\n    h = 0x811C9DC5\n    for unit in memoryview(s.encode(\"utf-16-le\")).cast(\"H\"):\n        h = ((h ^ unit) * 0x01000193) & 0xFFFFFFFF\n    return h\n\n\ndef mulberry32(seed):\n    a = seed & 0xFFFFFFFF\n\n    def rnd():\n        nonlocal a\n        a = (a + 0x6D2B79F5) & 0xFFFFFFFF\n        t = a\n        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF\n        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF\n        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296\n\n    return rnd\n\n\ndef enrichment_score(positions, weights, n):\n    \"\"\"Weighted (p = 1) running-sum ES from the members' 0-based ranks, ascending.\"\"\"\n    k = len(positions)\n    if not k or k >= n:\n        return 0.0\n    nr = sum(weights)\n    unweighted = not nr > 0\n    if unweighted:\n        nr = k\n    miss = 1 / (n - k)\n    cum, best = 0.0, 0.0\n    for i, (pos, w) in enumerate(zip(positions, weights)):\n        before = cum / nr - (pos - i) * miss\n        if abs(before) > abs(best):\n            best = before\n        cum += 1 if unweighted else w\n        after = cum / nr - (pos + 1 - (i + 1)) * miss\n        if abs(after) > abs(best):\n            best = after\n    return best\n\n\ndef preranked_gsea(ranked, sets, permutations=1000, min_size=10):\n    \"\"\"ranked: [(gene, score)] best first; sets: {name: [genes]}. Returns {name: (size, es, nes, p)}.\n    The null for each set is `permutations` random sets of the same size drawn from the same ranking\n    (Floyd's sampling), from a generator seeded by the set's name, so p is the same on every run.\"\"\"\n    n = len(ranked)\n    rank_of = {}\n    for i, (g, _) in enumerate(ranked):\n        rank_of.setdefault(g, i)\n    abs_w = [abs(s) for _, s in ranked]\n    out = {}\n    for name, genes in sets.items():\n        pos = sorted({rank_of[g] for g in set(genes) if g in rank_of})\n        k = len(pos)\n        if k < min_size or k >= n:\n            continue\n        es = enrichment_score(pos, [abs_w[i] for i in pos], n)\n        rnd = mulberry32(seed_of(name))\n        null_pos, null_neg = [], []\n        for _ in range(permutations):\n            chosen = set()\n            for j in range(n - k, n):\n                t = math.floor(rnd() * (j + 1))\n                chosen.add(j if t in chosen else t)\n            pick = sorted(chosen)\n            e = enrichment_score(pick, [abs_w[i] for i in pick], n)\n            (null_pos if e >= 0 else null_neg).append(e)\n        mean = lambda xs: sum(xs) / len(xs) if xs else 0.0\n        if es >= 0:\n            nes = es / mean(null_pos) if mean(null_pos) > 0 else 0.0\n            same, beyond = null_pos, sum(1 for e in null_pos if e >= es)\n        else:\n            nes = -es / mean(null_neg) if mean(null_neg) < 0 else 0.0\n            same, beyond = null_neg, sum(1 for e in null_neg if e <= es)\n        out[name] = (k, es, nes, (beyond + 1) / (len(same) + 1))\n    return out\n";

export interface DiffexprTrace {
  profileType: string;
  log2: boolean;
  groups: [string, string];
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  /** per cohort, summed over its studies: each gene's n, Σv and Σv² */
  moments: { cohort: string; gene: string; n: number; sx: number; sxx: number }[];
  minN: number;
  tested: number;
  skipped: number;
  gsea?: { sets: { name: string; genes: string[] }[]; tested: number; skipped: string[]; permutations: number; minSize: number };
  /** what the view reported — genes drawn as points, and each set tested — for the script check */
  results: { genes: { gene: string; p: number; q: number }[]; sets: { name: string; es: number; nes: number; p: number }[] };
}

export function diffexprMethod(t: DiffexprTrace): MethodRecord {
  const [A, B] = t.groups;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Sum every gene's values",
    detail: "The diffexpr:moments query above, on “" + t.profileType + "”" + (t.log2 ? " as log2(v + 1) (a negative stored value has no log and is left out, not clamped)" : " as stored") +
      ". Per gene, over the cohort's patients with a value (a patient with several samples contributes their average): n, Σv and Σv². Every gene in the profile, no individual value.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's sums across its studies",
    detail: "The totals add exactly; there is no batch correction between studies." });
  steps.push({ kind: "transform", title: "Leave out genes that cannot be tested",
    detail: "A gene with fewer than " + t.minN + " patients with a value in either cohort, or with no variance (Var A + Var B ≤ 1e-9 · (1 + mean A² + mean B²) — judged to a tolerance, since a constant gene's variance from the sums is rounding noise).",
    rowsIn: t.tested + t.skipped, rowsOut: t.tested });
  steps.push({ kind: "statistic", title: "Welch's t-test per gene",
    detail: "Mean A − mean B (" + A + " minus " + B + ") with each cohort's variance (Σv² − (Σv)²/n)/(n − 1); unequal-variance t, Welch–Satterthwaite df, two-sided. With thousands of patients a tiny difference is significant: read the effect too.",
    params: [["genes tested", t.tested.toLocaleString()]] });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across genes", detail: "q-values over all " + t.tested.toLocaleString() + " genes tested." });
  if (t.gsea) steps.push({ kind: "statistic", title: "Preranked gene-set enrichment (GSEA)",
    detail: "Genes ranked by the unrounded t, " + A + " over " + B + " first. Enrichment score as in Subramanian et al. 2005 with weight 1 (each member's step is |t| / Σ|t| of the members). Significance from " +
      t.gsea.permutations + " random sets of the same size drawn from the same ranking, from a generator seeded by the set's name — so a shared link gives the same p — with p = (b + 1)/(m + 1) over the m null scores of the same sign and NES = ES / mean of those. Gene-set permutation ignores correlation between genes, so it is anti-conservative next to phenotype permutation. A set with fewer than " +
      t.gsea.minSize + " ranked members is not tested. q is Benjamini–Hochberg across the sets tested.",
    params: [["sets tested", String(t.gsea.tested)], ...(t.gsea.skipped.length ? [["too small to test", t.gsea.skipped.join(", ")] as [string, string]] : [])] });
  const python = [
    "# Recompute with scipy and statsmodels; the enrichment uses the port of our seeded null below,",
    "# which reproduces our permutation p-values exactly (test/gsea-golden.test.ts). Its enrichment scores match gseapy " + VERIFIED.gsea.version + " prerank.",
    "import io",
    "import json",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import ttest_ind_from_stats",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("moments", "Each gene's n, sum and sum of squares per cohort (" + (t.log2 ? "log2(v + 1)" : "as stored") + "), from the diffexpr:moments queries, summed over each cohort's studies",
      ["cohort", "gene", "n", "sx", "sxx"], t.moments.map((r) => [r.cohort, r.gene, r.n, r.sx, r.sxx]), "diffexpr_moments.csv"),
    "",
    "a = moments[moments[\"cohort\"] == " + py(A) + "].set_index(\"gene\")",
    "b = moments[moments[\"cohort\"] == " + py(B) + "].set_index(\"gene\")",
    "g = a.join(b, lsuffix=\"_a\", rsuffix=\"_b\", how=\"inner\")",
    "g[\"mean_a\"], g[\"mean_b\"] = g[\"sx_a\"] / g[\"n_a\"], g[\"sx_b\"] / g[\"n_b\"]",
    "g[\"var_a\"] = ((g[\"sxx_a\"] - g[\"sx_a\"] ** 2 / g[\"n_a\"]) / (g[\"n_a\"] - 1)).clip(lower=0)  # a constant gene's is rounding noise, sometimes below 0",
    "g[\"var_b\"] = ((g[\"sxx_b\"] - g[\"sx_b\"] ** 2 / g[\"n_b\"]) / (g[\"n_b\"] - 1)).clip(lower=0)",
    "keep = (g[\"n_a\"] >= " + t.minN + ") & (g[\"n_b\"] >= " + t.minN + ") & (g[\"var_a\"] + g[\"var_b\"] > 1e-9 * (1 + g[\"mean_a\"] ** 2 + g[\"mean_b\"] ** 2))",
    "g = g[keep].copy()",
    "g[\"t\"], g[\"p\"] = ttest_ind_from_stats(g[\"mean_a\"], np.sqrt(g[\"var_a\"]), g[\"n_a\"], g[\"mean_b\"], np.sqrt(g[\"var_b\"]), g[\"n_b\"], equal_var=False)",
    "g[\"effect\"] = g[\"mean_a\"] - g[\"mean_b\"]",
    "g[\"q\"] = multipletests(g[\"p\"], method=\"fdr_bh\")[1]",
    "print(len(g), \"genes tested\")",
    "print(g.sort_values(\"p\")[[\"effect\", \"t\", \"p\", \"q\"]].head(20))",
    "RESULT[\"diffexpr:tested\"] = len(g)",
    "for gene, r in g.iterrows():",
    "    RESULT[f\"diffexpr:{gene}:p\"], RESULT[f\"diffexpr:{gene}:q\"] = r[\"p\"], r[\"q\"]",
    ...(t.gsea ? [
      "",
      "# ---- the port of our seeded GSEA null (python/golden/gsea_null.py) ----",
      ...GSEA_NULL_PY.trimEnd().split("\n"),
      "# ----",
      "",
      "sets = json.loads(" + py(JSON.stringify(Object.fromEntries(t.gsea.sets.map((x) => [x.name, x.genes])))) + ")",
      "ranked = list(g.sort_values(\"t\", ascending=False, kind=\"stable\")[\"t\"].items())",
      "res = preranked_gsea(ranked, sets, permutations=" + t.gsea.permutations + ", min_size=" + t.gsea.minSize + ")",
      "out = pd.DataFrame([(k, *v) for k, v in res.items()], columns=[\"set\", \"size\", \"es\", \"nes\", \"p\"])",
      "out[\"q\"] = multipletests(out[\"p\"], method=\"fdr_bh\")[1]",
      "print(out.sort_values([\"q\", \"nes\"], key=lambda c: c if c.name == \"q\" else -c.abs()).to_string(index=False))",
      "for r in out.itertuples():",
      "    RESULT[f\"gsea:{r.set}:es\"], RESULT[f\"gsea:{r.set}:nes\"], RESULT[f\"gsea:{r.set}:p\"] = r.es, r.nes, r.p",
    ] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["welchT", "benjaminiHochberg", ...(t.gsea ? ["preRankedGsea"] : [])], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Welch's t from moments matches scipy " + VERIFIED.welch.version + " ttest_ind(equal_var=False) and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/moments-golden.test.ts, test/tables-golden.test.ts)" +
      (t.gsea ? "; enrichment scores match gseapy " + VERIFIED.gsea.version + " prerank, and NES and p match the script's port of our seeded null exactly (test/gsea-golden.test.ts)" : "") + ".",
    python: withResult(python),
    check: {
      "diffexpr:tested": { v: t.tested, abs: 0 },
      ...checks("diffexpr:", t.results.genes, (g) => g.gene, [["p", "p", { rel: 1e-6, abs: 1e-300 }], ["q", "q", { rel: 1e-6, abs: 1e-300 }]]),
      // ES and NES are reported to 4 and 3 decimals; the permutation p is a ratio of counts
      ...checks("gsea:", t.results.sets, (x) => x.name, [["es", "es", { abs: 5e-5 + 1e-12 }], ["nes", "nes", { abs: 5e-4 + 1e-12 }], ["p", "p", { abs: 0 }]]),
    },
  };
}

// ---- incidence: Aalen-Johansen with death competing, Gray-type permutation test ----------------

/** python/golden/gray_null.py verbatim — the Python port of our seeded Gray permutation test;
 *  test/incidence-golden.test.ts holds the two to the same text and the port to our exact p. */
export const GRAY_NULL_PY = "import math\n\n\ndef mulberry32(seed):\n    a = seed & 0xFFFFFFFF\n\n    def rnd():\n        nonlocal a\n        a = (a + 0x6D2B79F5) & 0xFFFFFFFF\n        t = a\n        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF\n        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF\n        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296\n\n    return rnd\n\n\ndef gray_statistic(t, cause, entry, group, K, order, entry_order):\n    \"\"\"Sum over groups of (observed - expected)^2 / expected cause-1 events, expected from the pooled\n    subdistribution hazard with each group's risk set Y_k (1 - F1_k) / S_k (Gray 1988, weight 1).\n    order / entry_order: the records' indices sorted by exit and by entry time.\"\"\"\n    n = len(t)\n    Y, S, F = [0.0] * K, [1.0] * K, [0.0] * K\n    z, E = [0.0] * K, [0.0] * K\n    i = ei = 0\n    while i < n:\n        tj = t[order[i]]\n        while ei < n and entry[entry_order[ei]] < tj:\n            Y[group[entry_order[ei]]] += 1\n            ei += 1\n        d1, d2, cc = [0.0] * K, [0.0] * K, [0.0] * K\n        while i < n and t[order[i]] == tj:\n            r = order[i]\n            i += 1\n            if cause[r] == 1:\n                d1[group[r]] += 1\n            elif cause[r] == 2:\n                d2[group[r]] += 1\n            else:\n                cc[group[r]] += 1\n        R = [Y[k] * (1 - F[k]) / S[k] if Y[k] > 0 and S[k] > 0 else 0.0 for k in range(K)]\n        D1, Rtot = 0.0, 0.0\n        for k in range(K):\n            D1 += d1[k]\n            Rtot += R[k]\n        if D1 > 0 and Rtot > 0:\n            for k in range(K):\n                e = R[k] * D1 / Rtot\n                z[k] += d1[k] - e\n                E[k] += e\n        for k in range(K):\n            if Y[k] > 0:\n                F[k] += S[k] * d1[k] / Y[k]\n                S[k] *= 1 - (d1[k] + d2[k]) / Y[k]\n            Y[k] -= d1[k] + d2[k] + cc[k]\n    stat = 0.0\n    for k in range(K):\n        if E[k] > 0:\n            stat += z[k] * z[k] / E[k]\n    return stat\n\n\ndef gray_permutation_test(groups, permutations=2000, seed=1):\n    \"\"\"groups: per cohort, a list of (t, cause, entry or None). Returns (statistic, p): p = (b + 1)/(m + 1)\n    over `permutations` seeded shuffles of the cohort labels across the pooled records.\"\"\"\n    K = len(groups)\n    rows = [(r[0], r[1], -math.inf if r[2] is None else r[2], k) for k, g in enumerate(groups) for r in g]\n    t = [r[0] for r in rows]\n    cause = [r[1] for r in rows]\n    entry = [r[2] for r in rows]\n    labels = [r[3] for r in rows]\n    order = sorted(range(len(t)), key=lambda i: t[i])\n    entry_order = sorted(range(len(t)), key=lambda i: entry[i])\n    observed = gray_statistic(t, cause, entry, labels, K, order, entry_order)\n    rnd = mulberry32(seed)\n    perm = list(labels)\n    n = len(perm)\n    beyond = 0\n    for _ in range(permutations):\n        for i in range(n - 1, 0, -1):\n            j = math.floor(rnd() * (i + 1))\n            perm[i], perm[j] = perm[j], perm[i]\n        if gray_statistic(t, cause, entry, perm, K, order, entry_order) >= observed - 1e-12:\n            beyond += 1\n    return observed, (beyond + 1) / (permutations + 1)\n";

export interface IncidenceTrace {
  eventLabel: string;
  anchor?: string;
  horizons: number[];
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  cohorts: { name: string; n: number; events: number; competing: number; censored: number; late: number;
    excluded: { prior: number; unobserved: number; noFollowup: number; noAnchor: number } }[];
  /** every (entry, t, cause) count the queries returned for patients who enter the risk set */
  counts: { cohort: string; study: string; entry: number; t: number; cause: number; n: number }[];
  gray?: { statistic: number; p: number; permutations: number };
  /** the view's estimate and interval at each horizon — for the script check */
  horizonResults: { cohort: string; months: number; f1: number; lo: number; hi: number }[];
}

export function incidenceMethod(t: IncidenceTrace): MethodRecord {
  const hasEntry = t.counts.some((r) => r.entry > 0);
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Classify and count each patient's outcome",
    detail: "The incidence query above. Per patient, months from " + (t.anchor ? "the " + t.anchor : "the study's day 0") +
      " (days ÷ 30.4375, rounded to 4 decimals) to the first " + t.eventLabel + " after it (cause 1), death without it (cause 2, from OS_STATUS), or last follow-up (censored, OS_MONTHS)" +
      (t.anchor ? ", and the delay from the anchor to day 0 as a delayed entry when the anchor comes first" : "") +
      "; then counted by (entry, months, cause). Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  steps.push({ kind: "transform", title: "Set aside patients who cannot enter the risk set",
    detail: "Named and counted rather than treated as event-free. A patient whose first event was recorded after their last follow-up is kept, as censored or dead at follow-up.",
    params: t.cohorts.map((c) => [c.name, c.excluded.prior + " already had it " + (t.anchor ? "at or before the anchor" : "by day 0") +
      (c.excluded.unobserved ? " · " + c.excluded.unobserved + " had it before observation began" : "") +
      " · " + c.excluded.noFollowup + " without follow-up" + (t.anchor ? " · " + c.excluded.noAnchor + " with no anchor event" : "") +
      (c.late ? " · " + c.late + " recorded late, kept" : "")] as [string, string]) });
  steps.push({ kind: "statistic", title: "Estimate cumulative incidence by Aalen–Johansen",
    detail: "Death is a competing risk: at each time F1 rises by S(t−)·d1/R, with S the all-cause Kaplan–Meier survival and R those at risk" +
      (hasEntry ? " (entered strictly before t: delayed entry honoured)" : "") +
      ". Standard error by the delta method (Aalen 1978); 95% interval F1 ± 1.959964·SE, clamped to [0, 1]. At each horizon the curve's value there, beside 1 − Kaplan–Meier of the event alone, which counts the dead as still at risk and overstates incidence.",
    params: [["horizons (months)", t.horizons.join(", ")],
      ...t.cohorts.map((c) => [c.name, c.n.toLocaleString() + " at risk · " + c.events + " events · " + c.competing + " deaths first · " + c.censored + " censored"] as [string, string])] });
  if (t.gray) steps.push({ kind: "statistic", title: "Gray-type test by permutation",
    detail: "Per cohort, observed cause-1 events minus those expected from the pooled subdistribution hazard, the subdistribution risk set being Y·(1 − F1)/S (Gray 1988, weight 1), summed as Σ (O − E)²/E over cohorts. This is not Gray's variance-standardised χ², so its p does not come from a χ² table: the cohort labels are shuffled across the pooled records " +
      t.gray.permutations.toLocaleString() + " times by a generator seeded with 1, and p = (b + 1)/(m + 1). Exact under the null that every cohort's records, entry times included, come from one distribution.",
    params: [["statistic / p", t.gray.statistic.toFixed(4) + " / " + pFmt(t.gray.p)]] });
  const python = [
    "# Recompute: cumulative incidence with statsmodels" + (hasEntry ? " (or, with delayed entry, the short function below — statsmodels takes no entry times and lifelines jitters tied ones)" : "") +
      "; the Gray-type test with the port of our seeded permutation test below, which reproduces our p exactly (test/incidence-golden.test.ts).",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    ...(hasEntry ? [] : ["from statsmodels.duration.survfunc import CumIncidenceRight"]),
    "",
    ...pyTable("counts", "What the incidence queries returned for the patients who enter the risk set: n per (entry, months, cause); cause 1 the event, 2 death first, 0 censored",
      ["cohort", "study", "entry", "t", "cause", "n"], t.counts.map((r) => [r.cohort, r.study, r.entry, r.t, r.cause, r.n]), "incidence_counts.csv"),
    "df = counts.loc[counts.index.repeat(counts[\"n\"])].reset_index(drop=True)  # one row per patient",
    "horizons = " + JSON.stringify(t.horizons),
    RESULT_INIT,
    "",
    ...(hasEntry ? [
      "def aalen_johansen(t, cause, entry):",
      "    \"\"\"F1, F2 and the delta-method SE of F1 at each time anyone leaves; at risk = entered strictly before t, not yet left.\"\"\"",
      "    t, cause, entry = map(np.asarray, (t, cause, entry))",
      "    times = np.unique(t)",
      "    S, F1, F2, hist, out = 1.0, 0.0, 0.0, [], []",
      "    for x in times:",
      "        R = np.sum((entry < x) & (t >= x))",
      "        d1, d2 = np.sum((t == x) & (cause == 1)), np.sum((t == x) & (cause == 2))",
      "        if R <= 0:",
      "            continue",
      "        Sprev, d = S, d1 + d2",
      "        F1 += Sprev * d1 / R; F2 += Sprev * d2 / R; S *= 1 - d / R",
      "        hist.append((F1, Sprev, d, d1, R))",
      "        if d > 0:",
      "            v = sum(((F1 - hF1) ** 2 * hd / (hR * (hR - hd)) if hR - hd > 0 else 0) + hS ** 2 * hd1 * (hR - hd1) / hR ** 3 - 2 * (F1 - hF1) * hS * hd1 / hR ** 2",
      "                    for hF1, hS, hd, hd1, hR in hist if hd > 0)",
      "            out.append((x, F1, F2, np.sqrt(max(v, 0))))",
      "    return pd.DataFrame(out, columns=[\"t\", \"f1\", \"f2\", \"se1\"])",
      "",
    ] : []),
    "for cohort, g in df.groupby(\"cohort\", sort=False):",
    ...(hasEntry ? [
      "    cif = aalen_johansen(g[\"t\"], g[\"cause\"], np.where(g[\"entry\"] > 0, g[\"entry\"], -np.inf))",
    ] : [
      "    c = CumIncidenceRight(g[\"t\"].to_numpy(), g[\"cause\"].to_numpy())",
      "    cif = pd.DataFrame({\"t\": c.times, \"f1\": c.cinc[0], \"se1\": c.cinc_se[0]})",
    ]),
    "    for h in horizons:",
    "        at = cif[cif[\"t\"] <= h].tail(1)",
    "        f1, se = (float(at[\"f1\"].iloc[0]), float(at[\"se1\"].iloc[0])) if len(at) else (0.0, 0.0)",
    "        lo, hi = max(0, f1 - 1.959963984540054 * se), min(1, f1 + 1.959963984540054 * se)  # 95%: the exact normal quantile",
    "        print(f\"{cohort} at {h} months: {f1:.4f} (95% CI {lo:.4f}-{hi:.4f})\")",
    "        RESULT[f\"incidence:{cohort}:{h}:f1\"], RESULT[f\"incidence:{cohort}:{h}:lo\"], RESULT[f\"incidence:{cohort}:{h}:hi\"] = f1, lo, hi",
    ...(t.gray ? [
      "",
      "# ---- the port of our seeded Gray-type permutation test (python/golden/gray_null.py) ----",
      ...GRAY_NULL_PY.trimEnd().split("\n"),
      "# ----",
      "",
      "cohorts = " + JSON.stringify(t.cohorts.map((c) => c.name)),
      "# records in the order the test sees them: by time, then cause, then entry (none before any)",
      "groups = [[(r.t, r.cause, r.entry if r.entry > 0 else None)",
      "           for r in df[df[\"cohort\"] == c].sort_values([\"t\", \"cause\", \"entry\"], kind=\"stable\").itertuples()] for c in cohorts]",
      "stat, p = gray_permutation_test(groups, permutations=" + t.gray.permutations + ", seed=1)  # pure Python: minutes for a large cohort",
      "print(f\"Gray-type statistic {stat:.4f}, permutation p {p:.4g}\")",
      "RESULT[\"gray:statistic\"], RESULT[\"gray:p\"] = stat, p",
    ] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["aalenJohansen", "cifAt", "kaplanMeier", ...(t.gray ? ["grayPermutationTest"] : [])], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Cumulative incidence and its standard error match statsmodels " + VERIFIED.cif.version + " CumIncidenceRight to 1e-12, and with delayed entry lifelines' AalenJohansenFitter" +
      (t.gray ? "; the Gray-type statistic and permutation p match the script's port exactly" : "") + " (test/incidence-golden.test.ts).",
    python: withResult(python),
    check: {
      ...checks("incidence:", t.horizonResults, (h) => h.cohort + ":" + h.months, [["f1", "f1", { abs: 1e-9 }], ["lo", "lo", { abs: 1e-9 }], ["hi", "hi", { abs: 1e-9 }]]),
      // the port reproduces the permutation test exactly
      ...(t.gray ? { "gray:statistic": { v: t.gray.statistic, rel: 1e-12 }, "gray:p": { v: t.gray.p, abs: 0 } } : {}),
    },
  };
}

// ---- paired: concordance within patients, exact McNemar, BH --------------------------------------

export interface PairedTrace {
  pairBy: { attribute: string; a: string[]; b: string[] };
  /** each study's own sides, when they differ from `pairBy` */
  perStudy?: Record<string, { attribute: string; a: string[]; b: string[] }>;
  labels?: { a: string; b: string };
  measure: "driver" | "any";
  oncokbPin: string | null;
  /** present when every altered gene was tested and the `top` most one-sided drawn */
  scan?: { top: number };
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  panels: { cohort: string; patients: number; tested?: number }[];
  counts: { cohort: string; study: string; gene: string; pairs: number; both: number; aOnly: number; bOnly: number }[];
  /** what the view reported per cohort and gene — for the script check */
  results: { cohort: string; gene: string; p: number; q?: number }[];
}

export function pairedMethod(t: PairedTrace): MethodRecord {
  const aL = t.labels?.a ?? t.pairBy.a.join("/"), bL = t.labels?.b ?? t.pairBy.b.join("/");
  const what = t.measure === "driver" ? driverMeaning(t.oncokbPin).replace(/^driver: /, "") : ALTERED_MEANING.replace(/^altered: /, "");
  const steps: MethodStep[] = t.perSite.map((s) => {
    const sp = t.perStudy?.[s.study] || t.pairBy;
    return {
      kind: "fetch" as const, title: "Count each gene's state in paired samples",
      detail: "The paired:patients and paired:genes queries above. Patients with both a " + sp.attribute + " = " + sp.a.join("/") + " sample (" + aL + ") and a " +
        sp.attribute + " = " + sp.b.join("/") + " sample (" + bL + "); per gene" + (t.scan ? " — every gene altered (" + what + ") in some such patient" : "") +
        ", among those profiled for it on both sides by each side's own panels: altered (" + what + ") on both sides, on the " + aL +
        " side only, or the " + bL + " side only. A patient with several samples on one side counts as altered there if any is. Counts only.",
      scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
    };
  });
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's counts across its studies", detail: "The counts add exactly." });
  steps.push({ kind: "statistic", title: "Exact McNemar test per gene",
    detail: "Only the discordant patients carry information about direction: of the " + aL + "-only and " + bL + "-only patients, each is a fair coin under the null, so p is twice the smaller binomial tail (capped at 1). Concordance is both ÷ altered anywhere.",
    params: t.panels.map((p) => [p.cohort, p.patients.toLocaleString() + " patients with both kinds of sample"] as [string, string]) });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across genes, per cohort", detail: "q-values over the genes with at least one discordant patient, separately for each cohort." +
    (t.scan ? " In a scan that is every such gene, not only the ones drawn." : "") });
  if (t.scan) steps.push({ kind: "transform", title: "Draw the " + t.scan.top + " most one-sided genes",
    detail: "Of the genes with a discordant patient, ordered by McNemar p, then by the size of the imbalance between " + aL + "-only and " + bL +
      "-only patients, then by the number of discordant patients, then by name; the first " + t.scan.top + " are drawn and reported.",
    params: t.panels.map((p) => [p.cohort, (p.tested ?? 0).toLocaleString() + " genes tested"] as [string, string]) });
  const python = [
    "# Recompute with statsmodels " + VERIFIED.mcnemar.version + ", the version our code is tested against.",
    "import io",
    "import pandas as pd",
    "from statsmodels.stats.contingency_tables import mcnemar",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("counts", "What the paired:genes queries returned per cohort and study: patients altered on both sides, on the " + aL + " side only, on the " + bL + " side only, of those profiled on both",
      ["cohort", "study", "gene", "pairs", "both", "a_only", "b_only"], t.counts.map((r) => [r.cohort, r.study, r.gene, r.pairs, r.both, r.aOnly, r.bOnly]), "paired_counts.csv"),
    "g = counts.groupby([\"cohort\", \"gene\"], sort=False)[[\"pairs\", \"both\", \"a_only\", \"b_only\"]].sum().reset_index()",
    "g[\"concordance\"] = g[\"both\"] / (g[\"both\"] + g[\"a_only\"] + g[\"b_only\"])",
    "g[\"p\"] = [mcnemar([[r.both, r.a_only], [r.b_only, 0]], exact=True).pvalue if r.a_only + r.b_only else 1.0 for r in g.itertuples()]",
    "for cohort, c in g.groupby(\"cohort\", sort=False):",
    "    tested = c[c[\"a_only\"] + c[\"b_only\"] > 0]",
    "    g.loc[tested.index, \"q\"] = multipletests(tested[\"p\"], method=\"fdr_bh\")[1] if len(tested) else []",
    "print(g.to_string(index=False))",
    "for r in g.itertuples():",
    "    RESULT[f\"paired:{r.cohort}:{r.gene}:p\"] = r.p",
    "    if r.a_only + r.b_only:",
    "        RESULT[f\"paired:{r.cohort}:{r.gene}:q\"] = r.q",
  ].join("\n") + "\n";
  return { steps, implementation: { functions: ["mcnemarExact", "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "The exact McNemar test matches statsmodels " + VERIFIED.mcnemar.version + " mcnemar(exact=True) and Benjamini–Hochberg multipletests, to a relative 1e-6 (test/tables-golden.test.ts).",
    python: withResult(python),
    check: checks("paired:", t.results, (r) => r.cohort + ":" + r.gene, [["p", "p"], ["q", "q"]]) };
}

// ---- genome: per-bin gain / loss frequency, Fisher per bin, BH ----------------------------------

export interface GenomeTrace {
  build: string; binMb: number; threshold: number; includeX: boolean;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  cohorts: { name: string; samples: number; segmented: number }[];
  bins: number;
  pastEnd: number;
  /** per cohort, summed over its studies: each bin's samples covered, gained and lost (bins with coverage only) */
  counts: { cohort: string; chrom: string; bin: number; profiled: number; gain: number; loss: number }[];
  /** the view's q-value per bin tested (two cohorts only) — for the script check */
  results: { chrom: string; bin: number; gainQ: number | null; lossQ: number | null }[];
}

export function genomeMethod(t: GenomeTrace): MethodRecord {
  const two = t.cohorts.length === 2;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count gained and lost samples per bin",
    detail: "The genome:coverage and genome:bins queries above. Per " + t.binMb + " Mb bin on " + t.build + ": the cohort's SAMPLES (a patient with two segmented samples counts twice) whose segmentation covers the bin's midpoint, and of those the ones gained (log2 segment mean ≥ " +
      t.threshold + ") or lost (≤ −" + t.threshold + ") there. Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  steps.push({ kind: "transform", title: "Place the bins on one axis",
    detail: "Chromosomes 1–22" + (t.includeX ? " and X" : "") + " at " + t.build + " lengths, " + t.bins.toLocaleString() + " bins; counts add across studies (all on one build)." +
      (t.pastEnd ? " " + plural(t.pastEnd, "bin row") + " lay past a chromosome's end and were dropped." : ""),
    params: t.cohorts.map((c) => [c.name, c.segmented.toLocaleString() + " of " + c.samples.toLocaleString() + " samples segmented"] as [string, string]) });
  if (two) {
    steps.push({ kind: "statistic", title: "Fisher's exact test per bin",
      detail: "Two-sided, on gained vs not (and separately lost vs not) among each cohort's covered samples, in every bin both cohorts cover." });
    steps.push({ kind: "statistic", title: "Benjamini–Hochberg across bins",
      detail: "Separately for gains and losses. Adjacent bins are not independent: a run of significant bins is one region, not many findings." });
  }
  const python = [
    "# Recompute" + (two ? " with scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against" : "") + ".",
    "import io",
    "import pandas as pd",
    ...(two ? ["from scipy.stats import fisher_exact", "from statsmodels.stats.multitest import multipletests"] : []),
    "",
    RESULT_INIT,
    ...pyTable("counts", "Per cohort (summed over its studies) and bin: samples covered, gained and lost", ["cohort", "chrom", "bin", "profiled", "gain", "loss"],
      t.counts.map((r) => [r.cohort, r.chrom, r.bin, r.profiled, r.gain, r.loss]), "genome_bins.csv"),
    "counts[\"chrom\"] = counts[\"chrom\"].astype(str)  # \"1\"…\"22\", \"X\": names, not numbers",
    "counts[\"gain_pct\"] = 100 * counts[\"gain\"] / counts[\"profiled\"]",
    "counts[\"loss_pct\"] = 100 * counts[\"loss\"] / counts[\"profiled\"]",
    ...(two ? [
      "a, b = [counts[counts[\"cohort\"] == c].set_index([\"chrom\", \"bin\"]) for c in " + JSON.stringify(t.cohorts.map((c) => c.name)) + "]",
      "both = a.join(b, lsuffix=\"_a\", rsuffix=\"_b\", how=\"inner\")",
      "both = both[(both[\"profiled_a\"] > 0) & (both[\"profiled_b\"] > 0)]",
      "for kind in (\"gain\", \"loss\"):",
      "    p = [fisher_exact([[r[f\"{kind}_a\"], r[\"profiled_a\"] - r[f\"{kind}_a\"]], [r[f\"{kind}_b\"], r[\"profiled_b\"] - r[f\"{kind}_b\"]]]).pvalue",
      "         for _, r in both.iterrows()]",
      "    both[f\"{kind}_q\"] = multipletests(p, method=\"fdr_bh\")[1]",
      "    print(kind, \"bins with q < 0.05:\", int((both[f\"{kind}_q\"] < 0.05).sum()))",
      "    for (chrom, b), q in both[f\"{kind}_q\"].items():",
      "        RESULT[f\"genome:{chrom}:{b}:{kind}_q\"] = q",
    ] : ["print(counts.head(30).to_string(index=False))"]),
  ].join("\n") + "\n";
  return { steps, implementation: { functions: two ? ["fisherExact", "benjaminiHochberg"] : [], file: "lib/stats.ts", commit: BUILD_COMMIT },
    ...(two ? { verification: "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/tables-golden.test.ts)." } : {}),
    python: withResult(python),
    check: checks("genome:", t.results.filter((r) => r.gainQ != null), (r) => r.chrom + ":" + r.bin, [["gainQ", "gain_q"], ["lossQ", "loss_q"]]) };
}

// ---- pathways: share altered per pathway and member gene, Fisher, BH -----------------------------

export interface PathwaysTrace {
  measure: "driver" | "any";
  oncokbPin: string | null;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  sets: { name: string; source: string; genes: string[] }[];
  cohorts: string[];
  setCounts: { cohort: string; set: string; profiled: number; altered: number }[];
  geneCounts: { cohort: string; gene: string; profiled: number; altered: number }[];
  /** what the view reported (two cohorts only): each pathway's p and q, and the q of each top gene — for the script check */
  results: { pathways: { name: string; p?: number; q?: number }[]; genes: { gene: string; q: number }[] };
}

export function pathwaysMethod(t: PathwaysTrace): MethodRecord {
  const two = t.cohorts.length === 2;
  const what = t.measure === "driver" ? driverMeaning(t.oncokbPin).replace(/^driver: /, "") : ALTERED_MEANING.replace(/^altered: /, "");
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count patients altered per pathway and per gene",
    detail: "The geneCounts and pathways:sets queries above. Per pathway: patients profiled for at least one member gene (the denominator) and of those, patients with " + what +
      " in at least one member. Per member gene: the same over the patients profiled for that gene. Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
    params: [["pathways / sets", t.sets.map((x) => x.name + " (" + x.genes.length + ")").join(", ")]],
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's counts across its studies", detail: "The counts add exactly." });
  if (two) {
    steps.push({ kind: "statistic", title: "Fisher's exact test per pathway and per member gene", detail: "Two-sided, altered vs not among the profiled, between the two cohorts." });
    steps.push({ kind: "statistic", title: "Benjamini–Hochberg", detail: "Across the pathways drawn, and separately across every member gene tested, each gene once even when it sits in two pathways." });
  }
  const python = [
    "# Recompute" + (two ? " with scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against" : "") + ".",
    "import io",
    "import pandas as pd",
    ...(two ? ["from scipy.stats import fisher_exact", "from statsmodels.stats.multitest import multipletests"] : []),
    "",
    RESULT_INIT,
    ...pyTable("sets", "Per cohort and pathway: patients profiled for at least one member gene, and altered in at least one", ["cohort", "set", "profiled", "altered"],
      t.setCounts.map((r) => [r.cohort, r.set, r.profiled, r.altered]), "pathway_counts.csv"),
    ...pyTable("genes", "Per cohort and member gene: patients profiled for it, and altered in it", ["cohort", "gene", "profiled", "altered"],
      t.geneCounts.map((r) => [r.cohort, r.gene, r.profiled, r.altered]), "gene_counts.csv"),
    "cohorts = " + JSON.stringify(t.cohorts),
    "for name, table in ((\"pathway\", sets.groupby([\"set\", \"cohort\"]).sum()), (\"gene\", genes.groupby([\"gene\", \"cohort\"]).sum())):",
    "    table[\"pct\"] = 100 * table[\"altered\"] / table[\"profiled\"]",
    ...(two ? [
      "    rows = []",
      "    for key in table.index.get_level_values(0).unique():",
      "        t = table.loc[key].reindex(cohorts).fillna(0)",
      "        if (t[\"profiled\"] > 0).all():",
      "            (a, pa), (b, pb) = [(r.altered, r.profiled) for r in t.itertuples()]",
      "            rows.append((key, fisher_exact([[a, pa - a], [b, pb - b]]).pvalue))",
      "    res = pd.DataFrame(rows, columns=[name, \"p\"])",
      "    res[\"q\"] = multipletests(res[\"p\"], method=\"fdr_bh\")[1]",
      "    print(res.sort_values(\"p\").to_string(index=False))",
      "    for r in res.itertuples():",
      "        RESULT[f\"pathways:{name}:{getattr(r, name)}:p\"], RESULT[f\"pathways:{name}:{getattr(r, name)}:q\"] = r.p, r.q",
    ] : ["    print(table.to_string())"]),
  ].join("\n") + "\n";
  return { steps, implementation: { functions: two ? ["fisherExact", "benjaminiHochberg"] : [], file: "lib/stats.ts", commit: BUILD_COMMIT },
    ...(two ? { verification: "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/tables-golden.test.ts)." } : {}),
    python: withResult(python),
    check: { ...checks("pathways:pathway:", t.results.pathways, (r) => r.name, [["p", "p"], ["q", "q"]]),
      ...checks("pathways:gene:", t.results.genes, (r) => r.gene, [["q", "q"]]) } };
}

// ---- attrition: sequential cohort counts ---------------------------------------------------------

export function attritionMethod(panels: { cohort: string; base: number; steps: { label: string; n: number; excluded: number }[]; studies: string[] }[]): MethodRecord {
  return {
    steps: panels.map((p) => ({
      kind: "fetch" as const, title: "Count the cohort clause by clause",
      detail: "One attrition query per step above, per study: the patients left after ANDing that clause onto every clause before it, in the order the cohort lists them, summed across " +
        (p.studies.length === 1 ? p.studies[0] : p.studies.length + " studies (overlap not deduplicated)") + ". Nothing is computed from these counts beyond the differences between steps.",
      scope: p.cohort,
      params: [["every patient", p.base.toLocaleString()], ...p.steps.map((s) => [s.label, s.n.toLocaleString() + " (−" + s.excluded.toLocaleString() + ")"] as [string, string])],
    })),
    implementation: { functions: [], file: "lib/views/attrition.ts", commit: BUILD_COMMIT },
  };
}

// ---- clonality: FACETS calls per gene, Fisher on clonal vs subclonal and on WGD, BH -----------

export interface ClonalityTrace {
  measure: "driver" | "any";
  oncokbPin: string | null;
  qc: boolean;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  panels: { cohort: string; samples: number; ascnSamples: number; qcPass: number; qcFail: number; wgdYes: number; wgdNo: number }[];
  /** per cohort (summed over its studies) and gene: FACETS's calls */
  genes: { cohort: string; gene: string; calls: number; clonal: number; subclonal: number; indeterminate: number; loh: number; lohKnown: number }[];
  /** what the view reported (two cohorts only) — for the script check */
  results: { genes: { gene: string; p: number; q: number }[]; wgdP?: number };
}

export function clonalityMethod(t: ClonalityTrace): MethodRecord {
  const two = t.panels.length === 2;
  const what = t.measure === "driver" ? "each " + driverMeaning(t.oncokbPin).replace(/^driver: /, "") : "each mutation";
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count FACETS's calls per gene",
    detail: "The clonality:summary, clonality:purity-ploidy and clonality:genes queries above. Per gene, " + what +
      " in one sample is one call, which FACETS labels clonal, subclonal or indeterminate from its cancer-cell fraction (or leaves uncalled); loss of heterozygosity is a minor copy number of 0 where one was estimated. Per sample: whole-genome doubling, purity and ploidy as FACETS called them. Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  steps.push({ kind: "transform", title: t.qc ? "Keep samples that pass FACETS QC" : "Keep every sample",
    detail: t.qc ? "Only samples whose FACETS_QC is Pass (matched ignoring case) contribute calls, WGD, purity and ploidy." : "qc: false — FACETS_QC failures are used too.",
    params: t.panels.map((pn) => [pn.cohort, pn.qcPass.toLocaleString() + " pass, " + pn.qcFail.toLocaleString() + " fail, of " +
      pn.ascnSamples.toLocaleString() + " samples with allele-specific copy number"] as [string, string]) });
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's counts across its studies", detail: "The counts add exactly." });
  if (two) {
    steps.push({ kind: "statistic", title: "Fisher's exact test per gene, and on WGD",
      detail: "Two-sided, on clonal against subclonal calls between the two cohorts, for each gene with at least one such call in both; indeterminate and uncalled calls do not enter. And on whole-genome doubled against not, per sample." });
    steps.push({ kind: "statistic", title: "Benjamini–Hochberg across genes", detail: "q-values over the genes tested." });
  }
  const python = [
    "# Recompute" + (two ? " with scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against" : "") + ".",
    "import io",
    "import pandas as pd",
    ...(two ? ["from scipy.stats import fisher_exact", "from statsmodels.stats.multitest import multipletests"] : []),
    "",
    RESULT_INIT,
    ...pyTable("calls", "Per cohort (summed over its studies) and gene: FACETS's calls", ["cohort", "gene", "calls", "clonal", "subclonal", "indeterminate", "loh", "loh_known"],
      t.genes.map((g) => [g.cohort, g.gene, g.calls, g.clonal, g.subclonal, g.indeterminate, g.loh, g.lohKnown]), "clonality_calls.csv"),
    "wgd = " + JSON.stringify(Object.fromEntries(t.panels.map((pn) => [pn.cohort, [pn.wgdYes, pn.wgdNo]]))) + "  # cohort: [doubled, not], QC-passing samples",
    "calls[\"uncalled\"] = calls[\"calls\"] - calls[\"clonal\"] - calls[\"subclonal\"] - calls[\"indeterminate\"]",
    "print(calls.to_string(index=False))",
    "for r in calls.itertuples():",
    "    RESULT[f\"clonality:{r.cohort}:{r.gene}:clonal\"], RESULT[f\"clonality:{r.cohort}:{r.gene}:subclonal\"] = r.clonal, r.subclonal",
    ...(two ? [
      "a_name, b_name = " + JSON.stringify(t.panels.map((pn) => pn.cohort)).slice(1, -1),
      "a, b = calls[calls[\"cohort\"] == a_name].set_index(\"gene\"), calls[calls[\"cohort\"] == b_name].set_index(\"gene\")",
      "tested = [g for g in a.index if g in b.index and a.loc[g, \"clonal\"] + a.loc[g, \"subclonal\"] > 0 and b.loc[g, \"clonal\"] + b.loc[g, \"subclonal\"] > 0]",
      "p = [fisher_exact([[a.loc[g, \"clonal\"], a.loc[g, \"subclonal\"]], [b.loc[g, \"clonal\"], b.loc[g, \"subclonal\"]]]).pvalue for g in tested]",
      "q = multipletests(p, method=\"fdr_bh\")[1] if p else []",
      "for g, pv, qv in zip(tested, p, q):",
      "    print(f\"{g}: clonal vs subclonal p={pv:.4g}, q={qv:.4g}\")",
      "    RESULT[f\"clonality:{g}:p\"], RESULT[f\"clonality:{g}:q\"] = pv, qv",
      "if sum(wgd[a_name]) and sum(wgd[b_name]):",
      "    RESULT[\"clonality:wgd:p\"] = fisher_exact([wgd[a_name], wgd[b_name]]).pvalue",
      "    print(\"whole-genome doubling p =\", RESULT[\"clonality:wgd:p\"])",
    ] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: two ? ["fisherExact", "benjaminiHochberg"] : [], file: "lib/stats.ts", commit: BUILD_COMMIT },
    ...(two ? { verification: "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/tables-golden.test.ts)." } : {}),
    python: withResult(python),
    check: {
      ...checks("clonality:", t.genes, (g) => g.cohort + ":" + g.gene, [["clonal", "clonal", { abs: 0 }], ["subclonal", "subclonal", { abs: 0 }]]),
      ...checks("clonality:", t.results.genes, (g) => g.gene, [["p", "p"], ["q", "q"]]),
      ...(t.results.wgdP != null ? { "clonality:wgd:p": { v: t.results.wgdP } } : {}),
    },
  };
}

// ---- labs: % change from baseline after an anchor, its course, best response -------------------

export interface LabsTrace {
  test: string;
  anchoredTo: string;
  occurrence: "FIRST" | "LAST";
  baselineDays: number; fromWeeks: number; toWeeks: number; binWeeks: number; responseDrop: number;
  pctMin: number; pctMax: number; pctBin: number;
  minPointN: number;
  waterfallCap: number;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  panels: { cohort: string; anchored: number; baseline: number; positiveBaseline: number; evaluable: number; responders: number;
    waterfallWithheld: number; waterfallCapped: number }[];
  /** per cohort, summed over its studies: patients per (week bin, % change bin midpoint) */
  course: { cohort: string; week: number; v: number; n: number }[];
  /** what the view reported — for the script check */
  results: { course: { cohort: string; week: number; q1: number | null; median: number | null; q3: number | null }[]; responseP?: number };
}

export function labsMethod(t: LabsTrace): MethodRecord {
  const two = t.panels.length === 2;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count patients' % change from baseline",
    detail: "The labs:course and labs:best queries above (and labs:waterfall, one bar per patient, from a patient-level participant). Counts per bin and per rule, no individual value except the waterfall's bars.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  steps.push({ kind: "transform", title: "Anchor, baseline and change",
    detail: "Day 0 is each patient's " + t.occurrence.toLowerCase() + " " + t.anchoredTo + " (event type, key and value matched ignoring case); a patient without one is not anchored. " +
      t.test + " readings are those whose result parses as a number. The baseline is the mean of a patient's readings on the last day with any in the " + t.baselineDays +
      " days up to and including day 0; a patient without one has no baseline, and one whose baseline is 0 or below is left out, since a % change from it means nothing. Every later reading becomes 100·(value − baseline)/baseline; readings on the baseline day itself are not used.",
    params: t.panels.map((pn) => [pn.cohort, pn.anchored.toLocaleString() + " anchored → " + pn.baseline.toLocaleString() + " with a baseline → " +
      pn.positiveBaseline.toLocaleString() + " with a positive one → " + pn.evaluable.toLocaleString() + " with a reading after day 0"] as [string, string]) });
  steps.push({ kind: "transform", title: "Bin the course",
    detail: "Weeks " + t.fromWeeks + " to " + t.toWeeks + " around day 0 in " + t.binWeeks + "-week bins; a patient tested several times in a bin counts once, at their mean. % change in " + t.pctBin + "-point bins from " +
      t.pctMin + " to " + t.pctMax + ", values beyond either end in the end bin. The figure draws a bin only from " + t.minPointN + " patients." });
  steps.push({ kind: "statistic", title: "Median and interquartile range per week",
    detail: "From each bin's histogram, with the bin midpoints as values and linear interpolation between ranks — exact to within a " + t.pctBin + "-point bin." });
  steps.push({ kind: "statistic", title: "Best response",
    detail: "Each patient's lowest % change after day 0 within the window; a responder fell by at least " + t.responseDrop + "%, counted from the unbinned values." +
      (two ? " The two cohorts' response rates are compared with a two-sided Fisher's exact test." : ""),
    params: t.panels.map((pn) => [pn.cohort, pn.responders.toLocaleString() + " responders of " + pn.evaluable.toLocaleString() +
      (pn.waterfallWithheld ? " · " + pn.waterfallWithheld + " bars withheld (aggregate-only participant)" : "") +
      (pn.waterfallCapped ? " · " + pn.waterfallCapped + " bars past the " + t.waterfallCap.toLocaleString() + "-bar limit" : "")] as [string, string]) });
  const python = [
    "# Recompute the course's quartiles from the binned counts" + (two ? ", and the response test with scipy " + VERIFIED.fisher.version : "") + ".",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    ...(two ? ["from scipy.stats import fisher_exact"] : []),
    "",
    RESULT_INIT,
    ...pyTable("course", "Per cohort and week bin: patients whose mean % change fell in each " + t.pctBin + "-point bin (v is the bin's midpoint)",
      ["cohort", "week", "v", "n"], t.course.map((r) => [r.cohort, r.week, r.v, r.n]), "labs_course.csv"),
    "for (cohort, week), g in course.groupby([\"cohort\", \"week\"], sort=False):",
    "    values = np.repeat(g[\"v\"].to_numpy(), g[\"n\"].to_numpy())",
    "    q1, median, q3 = np.percentile(values, [25, 50, 75])",
    "    print(f\"{cohort} week {week}: n={len(values)}, median {median:.1f}%, IQR {q1:.1f} to {q3:.1f}\")",
    "    for name, x in ((\"q1\", q1), (\"median\", median), (\"q3\", q3)):",
    "        RESULT[f\"labs:{cohort}:{week}:{name}\"] = x",
    "responders = " + JSON.stringify(Object.fromEntries(t.panels.map((pn) => [pn.cohort, [pn.responders, pn.evaluable]]))) + "  # cohort: [responders, evaluable], as the query counted them",
    ...(two ? [
      "(ra, ea), (rb, eb) = responders.values()",
      "RESULT[\"labs:response:p\"] = fisher_exact([[ra, ea - ra], [rb, eb - rb]]).pvalue",
      "print(\"response rates\", {c: f\"{r}/{e}\" for c, (r, e) in responders.items()}, \"Fisher p =\", RESULT[\"labs:response:p\"])",
    ] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["quantilesFromHistogram", ...(two ? ["fisherExact"] : [])], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Quantiles from histograms match numpy percentile on the expanded values" + (two ? ", and Fisher's exact test scipy " + VERIFIED.fisher.version + " fisher_exact" : "") +
      ", to a relative 1e-6 (test/moments-golden.test.ts, test/tables-golden.test.ts).",
    python: withResult(python),
    check: {
      // quartiles are reported to 3 decimals
      ...checks("labs:", t.results.course, (c) => c.cohort + ":" + c.week,
        [["q1", "q1", { abs: 5e-4 + 1e-9 }], ["median", "median", { abs: 5e-4 + 1e-9 }], ["q3", "q3", { abs: 5e-4 + 1e-9 }]]),
      ...(t.results.responseP != null ? { "labs:response:p": { v: t.results.responseP } } : {}),
    },
  };
}

// ---- course: the share of observable patients in each state, per time bin ------------------------

export interface CourseTrace {
  anchor?: string;
  binMonths: number;
  fromBin: number; toBin: number;
  riskFloor: number;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  dropped: string[];
  /** each measured event type: its label, the spellings folded into it, and whether it carries durations */
  events: { canonical: string; label: string; variants: string[]; isInterval: boolean }[];
  cohorts: { name: string; patients: number; anchored: number; observed: number }[];
  /** per cohort, summed over its studies: patients observable in each bin (event ''), and in each state */
  counts: { cohort: string; bin: number; event: string; n: number }[];
  /** what the view reported — for the script check */
  results: { cohort: string; event: string; bin: number; atRisk: number; n: number; pct: number | null }[];
}

export function courseMethod(t: CourseTrace): MethodRecord {
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count patients per time bin",
    detail: "The timelineSpan and eventCourse queries above. Per " + t.binMonths + "-month bin: the cohort's patients observable in it, and of those the ones in each event's state (or with the event in it). Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  if (t.dropped.length) steps.push({ kind: "transform", title: "Leave out studies with no timeline structure",
    detail: "A study whose every event sits on one day cannot place anything in time: " + t.dropped.join(", ") + "." });
  const folds = t.events.filter((e) => e.variants.length > 1);
  steps.push({ kind: "transform", title: "Match event types",
    detail: "Event types, keys and values match ignoring case and surrounding whitespace; nothing else is merged." +
      (folds.length ? " Folded here: " + folds.map((e) => e.variants.join(" = ")).join("; ") + "." : ""),
    params: t.events.map((e) => [e.label, e.isInterval ? "has durations: a state the patient is in during a bin" : "no durations: an event that happened in a bin"] as [string, string]) });
  steps.push({ kind: "transform", title: t.anchor ? "Align on " + t.anchor : "Align on each study's day 0",
    detail: (t.anchor ? "Day 0 is each patient's " + t.anchor + "; a patient without one is in no bin."
      : "Day 0 is the study's own baseline, which is not comparable across studies.") +
      " A patient is observable from their first recorded event to their last contact — the later of their last recorded event and their OS follow-up (OS_MONTHS × 30.4375 days, assuming it starts at the timeline's day 0).",
    params: t.cohorts.map((c) => [c.name, c.patients.toLocaleString() + " in the cohort → " + c.anchored.toLocaleString() + (t.anchor ? " with the anchor event" : " aligned") +
      " → " + c.observed.toLocaleString() + " observable in the window"] as [string, string]) });
  steps.push({ kind: "statistic", title: "Share per bin",
    detail: "For each bin from month " + t.fromBin * t.binMonths + " to " + (t.toBin + 1) * t.binMonths + " (half-open [t, t+" + t.binMonths + ")): patients in the state ÷ patients observable, as a percentage. The figure stops each line where fewer than " +
      t.riskFloor + " patients remain observable." });
  const python = [
    "# Recompute each bin's percentage from the counts.",
    "import io",
    "import pandas as pd",
    "",
    RESULT_INIT,
    ...pyTable("counts", "Per cohort (summed over its studies) and bin: patients observable (event \"\") and in each event's state", ["cohort", "bin", "event", "n"],
      t.counts.map((r) => [r.cohort, r.bin, r.event, r.n]), "course_counts.csv"),
    "counts[\"event\"] = counts[\"event\"].fillna(\"\")",
    "n = counts.set_index([\"cohort\", \"event\", \"bin\"])[\"n\"]",
    "events = " + JSON.stringify(Object.fromEntries(t.events.map((e) => [e.canonical, e.label]))) + "  # folded name: label",
    "for cohort in " + JSON.stringify(t.cohorts.map((c) => c.name)) + ":",
    "    for event, label in events.items():",
    "        for b in range(" + t.fromBin + ", " + (t.toBin + 1) + "):",
    "            at_risk, k = n.get((cohort, \"\", b), 0), n.get((cohort, event, b), 0)",
    "            pct = 100 * k / at_risk if at_risk else None",
    "            RESULT[f\"course:{cohort}:{label}:{b}:pct\"], RESULT[f\"course:{cohort}:{label}:{b}:at_risk\"] = pct, at_risk",
    "        print(cohort, label, [round(RESULT[f'course:{cohort}:{label}:{b}:pct'], 1) if RESULT[f'course:{cohort}:{label}:{b}:pct'] is not None else None",
    "                              for b in range(" + t.fromBin + ", " + (t.toBin + 1) + ")])",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: [], file: "lib/views/course.ts", commit: BUILD_COMMIT },
    python: withResult(python),
    // percentages are reported to 1 decimal
    check: checks("course:", t.results, (r) => r.cohort + ":" + r.event + ":" + r.bin,
      [["pct", "pct", { abs: 0.05 + 1e-9 }], ["atRisk", "at_risk", { abs: 0 }]]),
  };
}

// ---- sequence: treatment lines and what follows what ---------------------------------------------

export interface SequenceTrace {
  eventType: string;
  labelKey: string;
  lineGap: number;
  maxSteps: number;
  topN: number;
  classes: "systemic" | "all" | string[];
  exclude: string[];
  truncated: boolean;
  rowLimit: number;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  /** treatment records set aside before lines were built, by class and reason */
  setAside: { cohort: string; cls: string; reason: string; records: number }[];
  /** per cohort, summed over its studies: patients per (line, from, to, fate) */
  flows: { cohort: string; step: number; from: string; to: string; fate: number; n: number }[];
  foldedLabels: number;
  /** what the view reported — for the script check */
  results: { cohort: string; started: number; censored: number; nodes: { column: number; kind: string; label: string; n: number }[] }[];
}

export function sequenceMethod(t: SequenceTrace): MethodRecord {
  const classText = t.classes === "all" ? "every " + t.eventType + " record"
    : Array.isArray(t.classes) ? t.eventType + " records whose class is one of " + t.classes.join(", ")
    : t.eventType + " records whose class is systemic therapy (" + SYSTEMIC_LINE_CLASSES.join(", ") + ")";
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Build lines and count what follows what",
    detail: "The treatmentSequence query above builds every patient's lines in the database and returns, per line number, how many patients went from one regimen to the next, stopped, or were lost to follow-up — counts only — plus how many records it set aside.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  const byReason = (reason: string) => {
    const m = new Map<string, number>();
    for (const r of t.setAside.filter((x) => x.reason === reason)) m.set(r.cls, (m.get(r.cls) || 0) + r.records);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const notLine = byReason("#not a line class"), excluded = byReason("#excluded by the document");
  steps.push({ kind: "transform", title: "Choose the records that form lines",
    detail: "The one definition every line count shares (lib/treatment-lines.ts): " + classText + ". A record's class is its SUBTYPE, or its TREATMENT_TYPE where it has none; names and values match ignoring case." +
      (t.exclude.length ? " Records labelled " + t.exclude.join(", ") + " are left out by this document." : ""),
    params: [
      ...notLine.slice(0, 12).map(([c, n]) => [c, n.toLocaleString() + " records set aside: not a line class"] as [string, string]),
      ...(notLine.length > 12 ? [["…", (notLine.length - 12) + " more classes, " + notLine.slice(12).reduce((k, [, n]) => k + n, 0).toLocaleString() + " records"] as [string, string]] : []),
      ...excluded.map(([c, n]) => [c, n.toLocaleString() + " records excluded by the document"] as [string, string]),
    ] });
  steps.push({ kind: "transform", title: "Group records into lines",
    detail: "Per patient, by start date: a record starting more than " + t.lineGap + " days after every earlier one has stopped begins a new line; anything closer — overlapping, or a switch within the gap — is the same line. A line is named by its sorted combination of " +
      (CLASS_KEYS.includes(t.labelKey.toLowerCase() as never) ? "classes" : t.labelKey + " values") + " ('A + B'); the label never decides which records form a line." });
  steps.push({ kind: "transform", title: "Decide how each path ends",
    detail: "A patient's last line ends in 'no further line' only if they were observed for at least " + t.lineGap + " days after it — their last contact being the later of their last recorded event of any type and their OS follow-up (OS_MONTHS × 30.4375 days) — and in 'record ends here' otherwise. Lines are followed up to line " + t.maxSteps + "." });
  steps.push({ kind: "transform", title: "Keep the " + t.topN + " most common regimens",
    detail: "Flows are summed across studies, then regimens ranked by the patients leaving them (or, for one seen only as a destination, arriving), ties by name, across every panel so a regimen keeps one identity; the rest are drawn as 'other'." +
      (t.truncated ? " A study's answer reached the " + t.rowLimit + "-flow limit, so its rarest flows are missing." : ""),
    params: [["regimens folded into 'other'", String(t.foldedLabels)]] });
  const python = [
    "# Recompute the diagram from the flows: the top-" + t.topN + " folding, node sizes, and who started and was censored.",
    "import io",
    "import pandas as pd",
    "",
    RESULT_INIT,
    ...pyTable("flows", "Per cohort (summed over its studies): patients per (line, from, to, fate); fate 0 another line, 1 no further line, 2 record ends",
      ["cohort", "step", "from_", "to", "fate", "n"], t.flows.map((f) => [f.cohort, f.step, f.from, f.to, f.fate, f.n]), "sequence_flows.csv"),
    "flows[\"to\"] = flows[\"to\"].fillna(\"\")",
    "out_w = flows.groupby(\"from_\")[\"n\"].sum()",
    "in_w = flows[(flows[\"fate\"] == 0) & (flows[\"to\"] != \"\")].groupby(\"to\")[\"n\"].sum()",
    "weight = {**{k: v for k, v in in_w.items() if k not in out_w}, **out_w.to_dict()}",
    "keep = {label for label, _ in sorted(weight.items(), key=lambda x: (-x[1], x[0]))[:" + t.topN + "]}",
    "fold = lambda label: label if label in keep else \"other\"",
    "kind = {0: \"regimen\", 1: \"stopped\", 2: \"censored\"}",
    "print(len(weight) - len(keep), \"regimens folded into 'other'\")",
    "for cohort, g in flows.groupby(\"cohort\", sort=False):",
    "    out_n, in_n, started, censored = {}, {}, 0, 0",
    "    for r in g.itertuples():",
    "        k = kind[r.fate]",
    "        src, dst = (r.step, \"regimen\", fold(r.from_)), (r.step + 1, k, fold(r.to) if k == \"regimen\" else \"\")",
    "        out_n[src] = out_n.get(src, 0) + r.n",
    "        in_n[dst] = in_n.get(dst, 0) + r.n",
    "        started += r.n if r.step == 1 else 0",
    "        censored += r.n if k == \"censored\" else 0",
    "    print(f\"{cohort}: {started} with a first line, {censored} paths end censored\")",
    "    RESULT[f\"sequence:{cohort}:started\"], RESULT[f\"sequence:{cohort}:censored\"] = started, censored",
    "    for node in set(out_n) | set(in_n):",
    "        RESULT[f\"sequence:{cohort}:{node[0]}:{node[1]}:{node[2]}:n\"] = out_n.get(node, in_n.get(node))",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: [], file: "lib/treatment-lines.ts, lib/views/sequence.ts", commit: BUILD_COMMIT },
    python: withResult(python),
    check: Object.assign({}, ...t.results.map((p) => ({
      ["sequence:" + p.cohort + ":started"]: { v: p.started, abs: 0 },
      ["sequence:" + p.cohort + ":censored"]: { v: p.censored, abs: 0 },
      ...checks("sequence:" + p.cohort + ":", p.nodes, (nd) => nd.column + ":" + nd.kind + ":" + nd.label, [["n", "n", { abs: 0 }]]),
    }))),
  };
}

// ---- cancertypes: alteration frequency per cancer type ------------------------------------------

export interface CancertypesTrace {
  genes: string[]; groupBy: string; measure: "driver" | "any"; oncokbPin: string | null; minSamples: number;
  unit: "patient" | "sample";
  perSite: { cohort: string; study: string; groups: number; profiled: number }[];
  panels: { cohort: string; groups: number; pooled: number; profiled: number; altered: number }[];
}

export function cancertypesMethod(t: CancertypesTrace): MethodRecord {
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count " + t.unit + "s per " + t.groupBy + " group",
    detail: "The cancertypes queries above. Per group, for the genes together and for each gene: the " + t.unit + "s profiled for it, and of those the " + t.unit + "s with " +
      (t.measure === "driver" ? "an OncoKB driver (" + t.oncokbPin + ")" : "any mutation, amplification, deep deletion or structural variant") +
      ", split by kind (one kind only, or more than one); and the whole cohort's, each " + t.unit + " once." +
      (t.unit === "patient" ? " A patient counts in each group one of their samples is in, profiled if any of those samples is, altered if any is." : "") +
      " Per group too, how many were profiled for mutations, copy number and structural variants at all. Counts only.",
    scope: s.cohort + " · " + s.study, rowsOut: s.groups,
    params: [["genes", t.genes.join(", ")], ["profiled " + t.unit + "s", s.profiled.toLocaleString("en-US")]],
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length)
    steps.push({ kind: "transform", title: "Add each group's counts across studies", detail: "Groups are matched by their folded value; the counts add exactly." });
  for (const p of t.panels) steps.push({
    kind: "transform", title: "Pool the small groups", scope: p.cohort,
    detail: p.pooled ? p.pooled + " group" + (p.pooled === 1 ? "" : "s") + " with fewer than " + t.minSamples + " profiled " + t.unit + "s drawn as one pooled bar; " + p.groups + " drawn on their own."
      : "Every group has at least " + t.minSamples + " profiled " + t.unit + "s; none pooled.",
    params: [["profiled", p.profiled.toLocaleString("en-US")], ["altered", p.altered.toLocaleString("en-US")]],
  });
  return { steps, implementation: { functions: [], file: "lib/views/cancertypes.ts", commit: BUILD_COMMIT } };
}

// ---- overlap: how cohorts intersect -------------------------------------------------------------

export function overlapMethod(t: { cohorts: string[]; perSite: { study: string; cohorts: string[]; patients: number }[]; union: number; intersections: number }): MethodRecord {
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count patients per combination of cohorts",
    detail: "The overlap query above: every patient in any of " + s.cohorts.join(", ") + " gets a bitmask of the cohorts it is in, and the study returns one count per bitmask. Counts only.",
    scope: s.study, rowsOut: s.patients,
  }));
  steps.push({ kind: "transform", title: "Add the counts across studies and name each combination",
    detail: "Each study's bits are mapped back to the view's cohort order; combinations add exactly, and a patient can only overlap within one study.",
    params: [["patients in any cohort", t.union.toLocaleString("en-US")], ["combinations with patients", String(t.intersections)]] });
  return { steps, implementation: { functions: [], file: "lib/views/overlap.ts", commit: BUILD_COMMIT } };
}

// ---- enrichment: every gene's alteration frequency between cohorts ------------------------------

export interface EnrichmentTrace {
  alteration: string; measure: "driver" | "any"; oncokbPin: string | null; cohorts: string[]; minAltered: number;
  test: string; two: boolean;
  perSite: { cohort: string; study: string; genes: number; wes: number }[];
  tested: number; untested: number;
  /** the rows the view shows, whose p and q the script must reproduce */
  results: { gene: string; p: number; q: number }[];
}

export function enrichmentMethod(t: EnrichmentTrace): MethodRecord {
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count altered and profiled samples per gene",
    detail: "The enrichment queries above: per gene, samples with " + (t.measure === "driver" ? "an OncoKB driver (" + t.oncokbPin + ") " : "a ") + t.alteration +
      "; per gene, samples on a panel listing it (counted per panel, then joined to its genes); and the whole-exome samples, profiled for every gene.",
    scope: s.cohort + " · " + s.study, rowsOut: s.genes, params: [["whole-exome samples", s.wes.toLocaleString("en-US")]],
  }));
  steps.push({ kind: "transform", title: "Profiled = panel samples + whole-exome samples, summed across studies",
    detail: "A sample altered in a gene its panel does not list still counts as measured. Genes with fewer than " + t.minAltered +
      " altered samples across the cohorts, or not profiled in one of them, are not tested.",
    params: [["tested", t.tested.toLocaleString("en-US")], ["not tested", t.untested.toLocaleString("en-US")]] });
  steps.push({ kind: "statistic", title: (t.two ? "Fisher's exact test" : "Chi-squared test") + " per gene, then Benjamini–Hochberg",
    detail: "A " + t.test + " on altered vs not among the profiled, per gene; q across every gene tested." });
  const python = [
    "# Recompute with scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against.",
    "import pandas as pd",
    t.two ? "from scipy.stats import fisher_exact" : "from scipy.stats import chi2_contingency",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    "# Per cohort and gene: altered samples, and samples profiled for the gene (panel + whole-exome),",
    "# summed across studies — export it from the enrichment queries above as enrichment_counts.csv",
    "counts = pd.read_csv(\"enrichment_counts.csv\")",
    "cohorts = " + JSON.stringify(t.cohorts),
    "MIN_ALTERED = " + t.minAltered,
    "rows = []",
    "for gene, g in counts.groupby(\"gene\"):",
    "    g = g.set_index(\"cohort\").reindex(cohorts).fillna(0)",
    "    if g[\"altered\"].sum() < MIN_ALTERED or (g[\"profiled\"] == 0).any():",
    "        continue",
    t.two
      ? "    (a, pa), (b, pb) = [(r.altered, r.profiled) for r in g.itertuples()]\n    p = fisher_exact([[a, pa - a], [b, pb - b]], alternative=\"two-sided\").pvalue"
      : "    p = chi2_contingency([[r.altered, r.profiled - r.altered] for r in g.itertuples()], correction=False).pvalue",
    "    rows.append((gene, p))",
    "res = pd.DataFrame(rows, columns=[\"gene\", \"p\"])",
    "res[\"q\"] = multipletests(res[\"p\"], method=\"fdr_bh\")[1]",
    "res = res.sort_values([\"p\", \"gene\"])",
    "print(len(res), \"genes tested\")",
    "print(res.head(30).to_string(index=False))",
    "for r in res.itertuples():",
    "    RESULT[f\"enrichment:{r.gene}:p\"], RESULT[f\"enrichment:{r.gene}:q\"] = r.p, r.q",
    "RESULT[\"enrichment:tested\"] = len(res)",
  ].join("\n") + "\n";
  return { steps, implementation: { functions: [t.two ? "fisherExact" : "chiSquareTest", "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: (t.two ? "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact" : "The chi-squared test matches scipy " + VERIFIED.chi2.version + " chi2_contingency") +
      " and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/tables-golden.test.ts).",
    python: withResult(python),
    check: { "enrichment:tested": { v: t.tested }, ...checks("enrichment:", t.results.slice(0, 40), (r) => r.gene, [["p", "p"], ["q", "q"]]) } };
}

// ---- assays: every generic-assay entity, Welch t / ANOVA or chi-squared, then BH ---------------

export interface AssaysTrace {
  profileType: string; categorical: boolean; unit: "samples" | "patients";
  cohorts: string[]; minN: number; test: string;
  perSite: { cohort: string; study: string; rows: number }[];
  tested: number; untested: number; missing: number;
  /** numeric: per cohort and entity, summed over its studies */
  moments: { cohort: string; entity: string; n: number; sx: number; sxx: number }[];
  /** categorical: per cohort, entity and called value, summed over its studies */
  counts: { cohort: string; entity: string; value: string; n: number }[];
  /** what the view reported, for the script check */
  results: { entity: string; p: number; q: number }[];
}

export function assaysMethod(t: AssaysTrace): MethodRecord {
  const k = t.cohorts.length, two = k === 2, cat = t.categorical;
  const one = t.unit.replace(/s$/, "");
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: cat ? "Count each entity's values" : "Sum each entity's values",
    detail: "The assays:" + (cat ? "values" : "moments") + " query above, on “" + t.profileType + "”: per entity, over the cohort's " + t.unit +
      (cat ? ", how many take each value." : ", n, Σv and Σv² of the values that read as numbers, and how many did not.") + " No individual value leaves the database.",
    scope: s.cohort + " · " + s.study, rowsOut: s.rows,
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's " + (cat ? "counts" : "sums") + " across its studies",
    detail: "The totals add exactly; there is no batch correction between studies." });
  steps.push({ kind: "transform", title: "Leave out what cannot be tested",
    detail: (cat ? "Values NA or blank (not called) are not a category: " : "Values that are not numbers: ") + t.missing.toLocaleString("en-US") + " left out. " +
      "An entity with fewer than " + t.minN + " " + t.unit + " with a value in any cohort" + (cat ? ", or one value throughout," : ", or no spread in any cohort (variance ≤ 1e-12 · (1 + mean²)),") + " is not tested.",
    params: [["tested", t.tested.toLocaleString("en-US")], ["not tested", t.untested.toLocaleString("en-US")]] });
  steps.push({ kind: "statistic", title: t.test + " per entity, then Benjamini–Hochberg",
    detail: (cat ? "On each entity's cohort × value table, no continuity correction; an all-zero column is dropped."
      : two ? "Unequal-variance t from each cohort's n, mean and variance (Σv² − (Σv)²/n)/(n − 1), Welch–Satterthwaite df, two-sided."
        : "The unequal-variance F test from each cohort's n, mean and variance; a cohort with fewer than 2 values or no variance is left out of that entity's test.") +
      " q across every entity tested, one value per " + one + "." });
  const file = cat ? "assays_counts.csv" : "assays_moments.csv";
  const python = [
    "# Recompute with scipy " + VERIFIED.welch.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    cat ? "from scipy.stats import chi2_contingency" : two ? "from scipy.stats import ttest_ind_from_stats" : "from statsmodels.stats.oneway import anova_generic",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    "cohorts = " + JSON.stringify(t.cohorts),
    "MIN_N = " + t.minN,
    ...(cat
      ? pyTable("data", "Per cohort, entity and called value: how many " + t.unit + ", from the assays:values queries summed over each cohort's studies (NA and blank left out)",
        ["cohort", "entity", "value", "n"], t.counts.map((r) => [r.cohort, r.entity, r.value, r.n]), file)
      : pyTable("data", "Per cohort and entity: n, sum and sum of squares of the numeric values, from the assays:moments queries summed over each cohort's studies",
        ["cohort", "entity", "n", "sx", "sxx"], t.moments.map((r) => [r.cohort, r.entity, r.n, r.sx, r.sxx]), file)),
    "rows = []",
    ...(cat ? [
      "data[\"value\"] = data[\"value\"].astype(str)",
      "for entity, g in data.groupby(\"entity\"):",
      "    table = g.pivot_table(index=\"cohort\", columns=\"value\", values=\"n\", aggfunc=\"sum\", fill_value=0).reindex(cohorts, fill_value=0)",
      "    if table.shape[1] < 2 or (table.sum(axis=1) < MIN_N).any():",
      "        continue",
      "    table = table.loc[:, table.sum(axis=0) > 0]",
      "    rows.append((entity, chi2_contingency(table.to_numpy(), correction=False).pvalue))",
    ] : [
      "data[\"mean\"] = data[\"sx\"] / data[\"n\"]",
      "data[\"var\"] = ((data[\"sxx\"] - data[\"sx\"] ** 2 / data[\"n\"]) / (data[\"n\"] - 1)).clip(lower=0)  # rounding can put a constant entity's just below 0",
      "for entity, g in data.groupby(\"entity\"):",
      "    g = g.set_index(\"cohort\").reindex(cohorts)",
      "    if g[\"n\"].isna().any() or (g[\"n\"] < MIN_N).any() or (g[\"var\"] <= 1e-12 * (1 + g[\"mean\"] ** 2)).all():",
      "        continue",
      ...(two ? [
        "    a, b = g.iloc[0], g.iloc[1]",
        "    p = ttest_ind_from_stats(a[\"mean\"], np.sqrt(a[\"var\"]), a[\"n\"], b[\"mean\"], np.sqrt(b[\"var\"]), b[\"n\"], equal_var=False).pvalue",
      ] : [
        "    g = g[(g[\"n\"] >= 2) & (g[\"var\"] > 0)]  # a cohort with under 2 values or no variance says nothing",
        "    p = anova_generic(g[\"mean\"].to_numpy(), g[\"var\"].to_numpy(), g[\"n\"].to_numpy(), use_var=\"unequal\", welch_correction=True).pvalue if len(g) >= 2 else 1.0",
      ]),
      "    rows.append((entity, p))",
    ]),
    "res = pd.DataFrame(rows, columns=[\"entity\", \"p\"])",
    "res[\"q\"] = multipletests(res[\"p\"], method=\"fdr_bh\")[1]",
    "res = res.sort_values([\"p\", \"entity\"])",
    "print(len(res), \"entities tested\")",
    "print(res.head(30).to_string(index=False))",
    "for r in res.itertuples():",
    "    RESULT[f\"assays:{r.entity}:p\"], RESULT[f\"assays:{r.entity}:q\"] = r.p, r.q",
    "RESULT[\"assays:tested\"] = len(res)",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: [cat ? "chiSquareTest" : two ? "welchT" : "welchAnovaTest", "varianceFromMoments", "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: (cat ? "The chi-squared test matches scipy " + VERIFIED.chi2.version + " chi2_contingency"
      : "Welch's t and ANOVA from moments match scipy " + VERIFIED.welch.version + " ttest_ind(equal_var=False) and statsmodels " + VERIFIED.anova.version + " " + VERIFIED.anova.fn) +
      " and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/moments-golden.test.ts, test/tables-golden.test.ts).",
    python: withResult(python),
    check: { "assays:tested": { v: t.tested }, ...checks("assays:", t.results.slice(0, 40), (r) => r.entity, [["p", "p", { rel: 1e-6, abs: 1e-300 }], ["q", "q", { rel: 1e-6, abs: 1e-300 }]]) },
  };
}

// ---- composition: parts of a whole per case, each cohort against the others pooled --------------

export interface CompositionTrace {
  source: CompositionSource; sourceName: string; cohorts: string[]; unit: "samples" | "patients"; normalize: boolean; eps: number;
  perSite: { cohort: string; study: string; n: number }[];
  /** per cohort, summed over its studies: n, per part Σp and Σp², Σ and Σ² of entropy, cases left out */
  sums: { cohort: string; n: number; sx: number[]; sxx: number[]; hx: number; hxx: number; incomplete: number; invalid: number }[];
  /** what the view reported, for the script check */
  cells: CompositionCell[];
  two: boolean;
}

export function compositionMethod(t: CompositionTrace): MethodRecord {
  const one = t.unit.replace(/s$/, ""), parts = t.source.parts, k = parts.length;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Sum each part over the cohort's " + t.unit,
    detail: "The composition:moments query above: each " + one + "'s " + k + " parts read and put in part order inside the database; a " + one +
      " with every part, none below zero and a sum above zero is kept" + (t.normalize ? ", its parts divided by their sum" : "") +
      "; then over those " + t.unit + " n, Σp and Σp² per part, and Σ and Σ² of each one's Shannon entropy. No case's values leave the database in this query.",
    scope: s.cohort + " · " + s.study, rowsOut: s.n,
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's sums across its studies",
    detail: "The sums add exactly; there is no batch correction between studies." });
  if (t.cohorts.length >= 2) steps.push({ kind: "statistic", title: "Each cohort against the others pooled, per part; then Benjamini–Hochberg",
    detail: "The other cohorts' sums are added into one group. Effect: log2((mean + " + t.eps + ") / (others' mean + " + t.eps + ")). Test: Welch's unequal-variance t " +
      "from each side's n, mean and variance (Σp² − (Σp)²/n)/(n − 1), two-sided; not tested when either side has under 2 " + t.unit + " or neither has any spread. " +
      (t.two ? "With two cohorts each part's two cells are one comparison, corrected for once. " : "") + "q across every comparison tested.",
    params: [["comparisons", String(t.cells.filter((c) => c.p != null && (!t.two || c.cohort === t.cohorts[0])).length)]] });
  const file = "composition_moments.csv";
  const python = [
    "# Recompute with scipy " + VERIFIED.welch.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import ttest_ind_from_stats",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    "cohorts = " + JSON.stringify(t.cohorts),
    "parts = " + JSON.stringify(parts),
    "EPS = " + t.eps,
    "TWO = " + (t.two ? "True" : "False"),
    ...pyTable("data", "Per cohort and part: how many " + t.unit + " have every part, and the sum and sum of squares of this part's value over them, from the composition:moments queries summed over each cohort's studies",
      ["cohort", "part", "n", "sx", "sxx"], t.sums.flatMap((s) => parts.map((p, j) => [s.cohort, p, s.n, s.sx[j], s.sxx[j]])), file),
    "def stats(n, sx, sxx):",
    "    mean = sx / n if n else 0.0",
    "    var = max(0.0, (sxx - sx ** 2 / n) / (n - 1)) if n >= 2 else 0.0",
    "    return mean, var",
    "rows = []",
    "for cohort in cohorts:",
    "    for part in parts:",
    "        a = data[(data[\"cohort\"] == cohort) & (data[\"part\"] == part)].iloc[0]",
    "        mean, var = stats(a[\"n\"], a[\"sx\"], a[\"sxx\"])",
    "        RESULT[f\"composition:{cohort}|{part}:mean\"] = mean",
    "        if len(cohorts) < 2:",
    "            continue",
    "        rest = data[(data[\"cohort\"] != cohort) & (data[\"part\"] == part)]",
    "        rn, rsx, rsxx = rest[\"n\"].sum(), rest[\"sx\"].sum(), rest[\"sxx\"].sum()",
    "        rmean, rvar = stats(rn, rsx, rsxx)",
    "        log2 = np.log2((mean + EPS) / (rmean + EPS))",
    "        RESULT[f\"composition:{cohort}|{part}:log2\"] = log2",
    "        if a[\"n\"] >= 2 and rn >= 2 and var + rvar > 0:",
    "            p = ttest_ind_from_stats(mean, np.sqrt(var), a[\"n\"], rmean, np.sqrt(rvar), rn, equal_var=False).pvalue",
    "            rows.append((cohort, part, p))",
    "res = pd.DataFrame(rows, columns=[\"cohort\", \"part\", \"p\"])",
    "tested = res[res[\"cohort\"] == cohorts[0]] if TWO else res  # two cohorts: one comparison per part",
    "if len(tested):",
    "    q = dict(zip(tested[\"part\"] + \"|\" + tested[\"cohort\"], multipletests(tested[\"p\"], method=\"fdr_bh\")[1]))",
    "    for r in res.itertuples():",
    "        RESULT[f\"composition:{r.cohort}|{r.part}:p\"] = r.p",
    "        RESULT[f\"composition:{r.cohort}|{r.part}:q\"] = q[r.part + \"|\" + (cohorts[0] if TWO else r.cohort)]",
    "print(res.assign(q=[RESULT.get(f\"composition:{c}|{p}:q\") for c, p in zip(res[\"cohort\"], res[\"part\"])]).sort_values(\"p\").head(30).to_string(index=False))",
    "RESULT[\"composition:tested\"] = len(tested)",
  ].join("\n") + "\n";
  const tol = { rel: 1e-6, abs: 1e-9 }, ptol = { rel: 1e-6, abs: 1e-300 };
  return {
    steps,
    implementation: { functions: ["welchT", "varianceFromMoments", "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Welch's t from moments matches scipy " + VERIFIED.welch.version + " ttest_ind(equal_var=False) and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/moments-golden.test.ts).",
    python: withResult(python),
    check: {
      "composition:tested": { v: t.cells.filter((c) => c.p != null && (!t.two || c.cohort === t.cohorts[0])).length },
      ...checks("composition:", t.cells as unknown as Record<string, unknown>[], (c) => c.cohort + "|" + c.part, [["mean", "mean", tol], ["log2", "log2", tol], ["p", "p", ptol], ["q", "q", ptol]])
    },
  };
}

// ---- correlates: Pearson and Spearman from sums, Fisher-z across studies, BH ------------------

export interface CorrelatesTrace {
  gene: string; profileType: string; otherProfile: string; cohort: string;
  minN: number; multi: boolean; tested: number; untested: number;
  perSite: { study: string; genes: number; patients: number }[];
  /** per study and gene: the six sums on values, and the same six on average ranks */
  sums: { study: string; gene: string; n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number;
    rsx: number; rsy: number; rsxy: number; rsxx: number; rsyy: number }[];
  /** what the view reported, for the script check */
  results: { gene: string; rho: number; rhoP: number; q: number; r: number; p: number }[];
}

export function correlatesMethod(t: CorrelatesTrace): MethodRecord {
  const same = t.profileType === t.otherProfile;
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Sum every gene's values and ranks against " + t.gene + "'s",
    detail: "The correlates:moments query above. Per patient, " + t.gene + " on “" + t.profileType + "” and every gene on “" + t.otherProfile +
      "” (a patient's samples averaged); per gene, over the patients with both: n, Σx, Σy, Σxy, Σx², Σy², and the same six over each value's average rank among those patients (ties share the mean of their ranks). Sums only.",
    scope: t.cohort + " · " + s.study, rowsIn: s.patients, rowsOut: s.genes,
  }));
  steps.push({ kind: "statistic", title: "Pearson's r and Spearman's ρ per gene",
    detail: "r from the sums: (nΣxy − ΣxΣy) / √((nΣx² − (Σx)²)(nΣy² − (Σy)²)); ρ is the same formula on the rank sums. Each p from t = r√((n − 2)/(1 − r²)) on n − 2 df, as scipy's pearsonr and spearmanr compute it." +
      (t.multi ? " Across studies, r pools the sums (exact); ρ is each study's, combined by Fisher z with weight n − 3 and a normal p, because ranks do not add." : "") +
      (same ? " " + t.gene + " against itself is left out." : "") + " A gene with fewer than " + t.minN + " patients, or no spread, is not tested.",
    params: [["tested", t.tested.toLocaleString("en-US")], ["not tested", t.untested.toLocaleString("en-US")]] });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg over ρ", detail: "q-values over every gene tested, from ρ's p." });
  const python = [
    "# Recompute with numpy, scipy " + VERIFIED.pearson.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against.",
    "import io",
    "import numpy as np",
    "import pandas as pd",
    "from scipy.stats import t as student_t, norm",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    "MIN_N = " + t.minN,
    "QUERY = " + py(t.gene) + (same ? "  # left out: a gene against itself" : ""),
    ...pyTable("sums", "Per study and gene: the six sums on values and on average ranks, from the correlates:moments queries",
      ["study", "gene", "n", "sx", "sy", "sxy", "sxx", "syy", "rsx", "rsy", "rsxy", "rsxx", "rsyy"],
      t.sums.map((r) => [r.study, r.gene, r.n, r.sx, r.sy, r.sxy, r.sxx, r.syy, r.rsx, r.rsy, r.rsxy, r.rsxx, r.rsyy]), "correlates_sums.csv"),
    "",
    "def corr(n, sx, sy, sxy, sxx, syy):",
    "    den = np.sqrt((n * sxx - sx ** 2) * (n * syy - sy ** 2))",
    "    with np.errstate(invalid=\"ignore\", divide=\"ignore\"):",
    "        return np.where(den > 0, (n * sxy - sx * sy) / den, np.nan).clip(-1, 1)",
    "",
    "def t_p(r, n):",
    "    with np.errstate(invalid=\"ignore\", divide=\"ignore\"):",
    "        tt = r * np.sqrt((n - 2) / (1 - r ** 2))",
    "    return np.where(np.abs(r) >= 1, 0.0, 2 * student_t.sf(np.abs(tt), n - 2))",
    "",
    "sums[\"rho_s\"] = corr(sums.n, sums.rsx, sums.rsy, sums.rsxy, sums.rsxx, sums.rsyy)",
    "g = sums.groupby(\"gene\")[[\"n\", \"sx\", \"sy\", \"sxy\", \"sxx\", \"syy\"]].sum()",
    "g[\"r\"] = corr(g.n, g.sx, g.sy, g.sxy, g.sxx, g.syy)",
    "g[\"p\"] = t_p(g.r, g.n)",
    ...(t.multi ? [
      "# rho: each study's own, combined by Fisher z with weight n - 3 (|rho| = 1 or n < 4 carries no z)",
      "ok = (sums.n >= 4) & (sums.rho_s.abs() < 1) & sums.rho_s.notna()",
      "s = sums[ok].assign(w=lambda d: d.n - 3, z=lambda d: np.arctanh(d.rho_s))",
      "m = s.assign(wz=s.w * s.z).groupby(\"gene\")[[\"w\", \"wz\"]].sum()",
      "z = m.wz / m.w",
      "g[\"rho\"] = np.tanh(z).reindex(g.index)",
      "g[\"rho_p\"] = pd.Series(2 * norm.sf(np.abs(z) * np.sqrt(m.w)), index=m.index).reindex(g.index)",
    ] : [
      "g[\"rho\"] = sums.set_index(\"gene\").rho_s.reindex(g.index)",
      "g[\"rho_p\"] = t_p(g.rho, g.n)",
    ]),
    "g = g[(g.n >= MIN_N) & g.rho.notna() & g.r.notna()" + (same ? " & (g.index != QUERY)" : "") + "].copy()",
    "g[\"q\"] = multipletests(g.rho_p, method=\"fdr_bh\")[1]",
    "print(len(g), \"genes tested\")",
    "print(g.sort_values(\"rho\", ascending=False)[[\"n\", \"rho\", \"rho_p\", \"q\", \"r\", \"p\"]].head(15))",
    "print(g.sort_values(\"rho\")[[\"n\", \"rho\", \"rho_p\", \"q\", \"r\", \"p\"]].head(15))",
    "RESULT[\"correlates:tested\"] = len(g)",
    "for gene, x in g.iterrows():",
    "    for f in (\"rho\", \"rho_p\", \"q\", \"r\", \"p\"):",
    "        RESULT[f\"correlates:{gene}:{f}\"] = x[f]",
  ].join("\n") + "\n";
  // ρ and r are reported to 4 decimals; their p-values come from the unrounded coefficient
  const pTol = { rel: 1e-6, abs: 1e-300 };
  return {
    steps,
    implementation: { functions: ["pearsonFromMoments", ...(t.multi ? ["fisherZMeta"] : []), "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Pearson's r from sums matches scipy " + VERIFIED.pearson.version + " pearsonr (test/moments-golden.test.ts); ρ is the same formula on average ranks, which is how scipy's spearmanr defines it — checked against spearmanr on raw values for TCGA breast cancer ESR1 (FOXA1 ρ 0.7478, PSAT1 −0.6732). Benjamini–Hochberg matches statsmodels multipletests (test/tables-golden.test.ts).",
    python: withResult(python),
    check: { "correlates:tested": { v: t.tested },
      ...checks("correlates:", t.results.slice(0, 80), (r) => r.gene, [["rho", "rho", { abs: 5e-5 + 1e-12 }], ["rhoP", "rho_p", pTol], ["q", "q", pTol], ["r", "r", { abs: 5e-5 + 1e-12 }], ["p", "p", pTol]]) },
  };
}

// ---- table views: listings, nothing computed ----------------------------------------------------

type TableLists = { cohort: string; study: string; total: number; all: number }[];

/** The steps every table view shares after its count: what the query keeps, its order, the page. */
function tableSteps(t: { label: string; what: string; queryText: string; order: string; shown: number; lists: TableLists; instances: number; excluded: { study: string }[]; source: string }): MethodStep[] {
  return [{
    kind: "fetch" as const, title: "Count the " + t.what + " per cohort and study" + (t.queryText ? ", and those the query keeps" : ""),
    detail: "The " + t.label + ":counts query above: " + t.source + (t.queryText ? " The query keeps " + t.queryText + "." : ""),
    params: t.lists.map((l) => [l.cohort + " · " + l.study, (t.queryText ? l.total.toLocaleString("en-US") + " of " : "") + l.all.toLocaleString("en-US")] as [string, string]),
  }, {
    kind: "fetch" as const, title: "Sort them together and take one page",
    detail: "The " + t.label + ":rows query above: the " + t.what + " of every cohort and study combined in one query" + (t.instances > 1 ? " per database (" + t.instances + " here, listed in turn)" : "") +
      (t.queryText ? ", kept to " + t.queryText : "") + ", sorted " + t.order + ", and the " + t.shown + " rows of the first page taken." +
      " Every other page, and the download, is the same query at another offset." +
      (t.excluded.length ? " Studies that do not disclose patients contribute no rows and are named: " + t.excluded.map((e) => e.study).join(", ") + "." : ""),
  }];
}

export function tableMethod(t: { unit: "sample" | "patient"; cohorts: string[]; columns: number; query: unknown; queryText: string; sortName: string | null; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number }): MethodRecord {
  const desc = !!(t.query as { sort?: { desc?: boolean } })?.sort?.desc;
  const steps = tableSteps({ label: "table", what: t.unit + "s", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every " + t.unit + " of each cohort's patients" + (t.unit === "sample" ? " (from the study's sample list, so a sample with no sample attribute still has a row)" : "") +
      ", each with the value of each of the " + t.columns + " attributes as recorded — blank where none was.",
    order: (t.sortName ? "by " + t.sortName + (desc ? " descending" : "") + " with missing values last, then " : "by ") + "patient and sample id" });
  return { steps, implementation: { functions: ["clinicalRowSource", "pageSql", "countsSql"], file: "lib/clinical-table.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing: no statistic is computed, so there is no script — the queries are the numbers." };
}

export function mutationsMethod(t: { gene: string; cohorts: string[]; oncokbPin: string | null; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number }): MethodRecord {
  const steps = tableSteps({ label: "mutations", what: t.gene + " mutation calls", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every called " + t.gene + " mutation in each cohort's samples (uncalled calls left out), with the sample's CANCER_TYPE_DETAILED and MUTATION_COUNT where recorded" +
      (t.oncokbPin ? " and the OncoKB " + t.oncokbPin + " call for its protein change" : "") + "; allele frequency = variant / (variant + reference) reads.",
    order: (t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + ", missing last" : "drivers first, then by codon") + ", then sample" });
  return { steps, implementation: { functions: ["mutationRowSource", "pageSql", "countsSql"], file: "lib/mutation-table.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing: no statistic is computed, so there is no script — the queries are the numbers." };
}

export function alterationsMethod(t: { cohorts: string[]; oncokbPin: string | null; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number;
  patient: { study: string; id: string } | null; tables: { name: string; total: number; all: number; queryText: string }[] }): MethodRecord {
  const steps = tableSteps({ label: "alterations", what: "patients", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every patient of each cohort, with their sample count and how many rows each of the three tables lists for them (a mutation, a gene's deep copy-number call, a structural variant — each counted once however many samples carry it).",
    order: t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + " with missing values last, then patient id" : "patients with any alteration first, then by patient id" });
  if (t.patient) steps.push({
    kind: "fetch" as const, title: "Read " + t.patient.id + "'s three tables",
    detail: "The alterations:mutations, alterations:cna and alterations:sv queries above, each paged, searched, filtered and sorted in the database like any table view. " +
      "Mutations: every called mutation of the patient's samples (uncalled calls left out), one row per variant with the samples carrying it, the highest allele frequency among them " +
      "(variant / (variant + reference) reads) with that sample's reads, and the gene's deep copy-number calls in the patient (Copy #). " +
      "Copy-number alterations: the deep calls (AMP, HOMDEL), one row per gene and call. Structural variants: one row per event (both genes and breakpoints, class, event info), the highest read counts among its samples. " +
      "Cohort % is the share of the study's samples profiled for the gene (by their gene panel) with any mutation in it, or with the same copy-number call" +
      (t.oncokbPin ? "; the annotation is the OncoKB " + t.oncokbPin + " call for the protein change, or for AMPLIFICATION / DELETION" : "") + ".",
    params: t.tables.map((x) => [x.name, (x.queryText ? x.total.toLocaleString("en-US") + " of " : "") + x.all.toLocaleString("en-US") + " rows" + (x.queryText ? " (kept: " + x.queryText + ")" : "")] as [string, string]),
  });
  return { steps, implementation: { functions: ["runAlterations", "alterationPatientRowSource", "patientMutationsSource", "patientCnaSource", "patientSvSource", "pageSql", "countsSql", "rankSql"],
    file: "lib/views/alterations.ts, lib/patient-alterations.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing: no statistic is computed, so there is no script — the queries are the numbers." };
}

// ---- riskmodel ------------------------------------------------------------------------------

export interface RiskmodelTrace {
  study: string; cohort: string; cohortPatients: number; rowsReturned: number;
  r: import("./types.ts").RiskmodelResult;
  lambdas: number; folds: number; testShare: number;
}

/**
 * The risk model's steps. No script recomputes it: the ensemble draws thousands of fits from a
 * seeded generator, and the fit itself is what test/coxnet-golden.test.ts pins against
 * scikit-survival and lifelines. The record names that test instead.
 */
export function riskmodelMethod(t: RiskmodelTrace): MethodRecord {
  const r = t.r;
  const out: [string, string][] = [["left out: no mutation panel on record", String(r.notProfiled)]];
  if (r.strata) out.push(["left out: no " + r.strata, String(r.noStratum)]);
  if (r.covariates.length) out.push(["left out: missing a covariate", String(r.noCovariate)]);
  if (r.anchoredTo) out.push(["left out: no " + r.anchoredTo + " event", String(r.noAnchor)], ["left out: anchor after the study's day 0", String(r.anchorAfterStart)],
    ["left out: no follow-up after entry", String(r.noFollowUp)]);
  const steps: MethodStep[] = [
    { kind: "fetch", title: "One row per patient", scope: t.cohort + " · " + t.study, rowsIn: t.cohortPatients, rowsOut: t.rowsReturned,
      detail: "The riskmodel:rows query above: each patient's survival time and event" + (r.anchoredTo ? " (from their " + r.anchoredTo + " event, with that event's offset to the study's day 0 as their entry time)" : "") +
        ", the panels their samples were sequenced on for mutations, the genes " + (r.measure === "driver" ? "with an OncoKB driver mutation" : "mutated") + " in them" +
        (r.strata ? ", their " + r.strata : "") + (r.covariates.length ? ", their covariate values" : "") +
        ", and their half of the engine's fixed held-out split. Patient-level: the rows never leave this server's engine, and no identifier is returned." },
    { kind: "transform", title: "Patients, candidate genes and covariates",
      detail: "A gene is a candidate only if every patient's panels cover it, so no patient is counted as wild-type for a gene they were never tested for, " +
        "and only if at least " + r.minMutated + " patients have it mutated." +
        (r.covariates.length ? " Covariates enter as they are when every value is a number, else as one indicator per value against the commonest; they are never penalised." : ""),
      params: [["genes covered for every patient", String(r.genesCovered)], ["candidates", String(r.candidates)], ...out] },
    { kind: "statistic", title: "Elastic-net Cox, " + r.runs + " random splits",
      detail: (r.validation ? "Only the discovery half (" + r.validation.discovery + " patients) is used. " : "") +
        "Each run holds out a random " + Math.round(t.testShare * 100) + "% of the patients; on the rest, the penalty is chosen from a path of " + t.lambdas +
        " by " + t.folds + "-fold cross-validated partial likelihood (Verweij & van Houwelingen), and the model at that penalty scores the held-out patients" +
        (r.validation ? " and every patient of the validation half" : "") + ". Genes are scaled to unit variance before fitting; Breslow ties" +
        (r.strata ? "; a separate baseline hazard per " + r.strata : "") + (r.anchoredTo ? "; delayed entry" : "") +
        ". A patient's risk score is the mean of the scores they got while held out (OncoCast's ensemble, Martin et al.)" +
        (r.validation ? "; a validation patient's is the mean over every run" : "") + ".",
      params: [["l1 share of the penalty (alpha)", String(r.alpha)], ["runs", String(r.runs)], ["seed", String(r.seed)],
        ["test-set C-index, median (IQR)", r.cIndex.median.toFixed(3) + " (" + r.cIndex.q1.toFixed(3) + "–" + r.cIndex.q3.toFixed(3) + ")"],
        ...(r.validation ? [["C-index on the validation half", r.validation.cIndex.toFixed(3)] as [string, string]] : []),
        ["never held out, so unscored", String(r.neverHeldOut)],
        ...r.covariates.map((c) => [c.name, "HR " + c.hr.toFixed(3) + " (mean over runs)"] as [string, string])] },
    { kind: "statistic", title: "Risk groups, their survival and hazard ratios",
      detail: "Cuts at equal quantiles of the " + (r.validation ? "discovery half's held-out scores, applied to the validation half" : "held-out scores") +
        ", each moved to the nearer edge of any run of tied scores so equal scores share a group — no outcome is used to place them. Each group is drawn as a Kaplan–Meier curve" +
        (r.anchoredTo ? " with delayed entry" : "") + " and read at 12 and 36 months; the groups are compared with a " + (r.strata ? "stratified " : "") +
        "log-rank test, and a Cox model of the outcome on the group indicators gives each group's hazard ratio against the lowest (Newton–Raphson, full information matrix, 95% Wald intervals). " +
        "A second Cox model on the standardised score alone gives the hazard ratio per standard deviation. " +
        "The score is also shown on OncoCast's 0–10 scale, (score − min) / (max − min) × 10, min and max the lowest and highest " +
        (r.validation ? "held-out score in the discovery half (so a validation patient can fall outside 0–10)" : "held-out score") +
        "; the scale is linear, so it moves no patient between groups and changes no number above.",
      params: [["0 on the 0–10 scale (raw score)", r.scale.min.toFixed(4)], ["10 on the 0–10 scale (raw score)", r.scale.max.toFixed(4)],
        ...r.groups.map((g) => [g.name, g.curve.n.toLocaleString() + " patients, " + g.curve.events.toLocaleString() + " events, median " +
        (g.curve.median == null ? "not reached" : g.curve.median.toFixed(1) + " months") + (g.hr != null ? ", HR " + g.hr.toFixed(2) : "")] as [string, string])] },
  ];
  return { steps, implementation: { functions: ["coxnetEnsemble", "coxnetPath", "cvLambda", "concordance", "coxFit"], file: "lib/coxnet.ts", commit: BUILD_COMMIT },
    verification: "lib/coxnet.ts's path is checked against scikit-survival's CoxnetSurvivalAnalysis, its delayed-entry, stratified fits (with standard errors) against statsmodels' PHReg and its C-index against lifelines, by test/coxnet-golden.test.ts (fixtures from python/golden/coxnet.py)." };
}

export function timelineMethod(t: { cohorts: string[]; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number;
  patient: { study: string; id: string; events: number; samples: number } | null }): MethodRecord {
  const steps = tableSteps({ label: "timeline", what: "patients", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every patient of each cohort, with their sample count and, from the study's timeline, the number of events, the first and last event day (a range counted to its stop) and the event types — a patient with no timeline is listed with none.",
    order: t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + " with missing values last, then patient id" : "patients with events first, then by patient id" });
  if (t.patient) steps.push({
    kind: "fetch" as const, title: "Read " + t.patient.id + "'s timeline",
    detail: "The timeline:events and timeline:samples queries above: every clinical event recorded for " + t.patient.id + " in " + t.patient.study +
      " with all its attributes, and the patient's samples with their SAMPLE_TYPE. Events are drawn as stored, in days from diagnosis; tracks group them by event type (case-folded) and nest them by attribute as cBioPortal's patient view does.",
    params: [["events", t.patient.events.toLocaleString("en-US")], ["samples", t.patient.samples.toLocaleString("en-US")]],
  });
  return { steps, implementation: { functions: ["runTimeline", "timelinePatientRowSource", "patientEventsSql", "buildTracks", "pageSql", "countsSql", "rankSql"], file: "lib/views/timeline.ts, lib/patient-timeline.ts, lib/timeline-tracks.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing and one patient's record: no statistic is computed, so there is no script — the queries are the numbers." };
}

