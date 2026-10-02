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

import type { CoxCovariate } from "./types.ts";
import type { AxisKind } from "./plot.ts";
import { BUILD_COMMIT } from "./build-info.ts";

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
  /** a script that refits the same model from the query's own output columns */
  python: string;
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
}

export interface LogisticTrace extends FitTrace {
  outcomeKind: AxisKind;
  outcomeEvent?: string;
  outcomeOther: string[];
}

const plural = (n: number, one: string, many = one + "s") => n.toLocaleString() + " " + (n === 1 ? one : many);
const py = (s: string) => JSON.stringify(s);

/** Why a categorical covariate's reference level is the one it is — mirrors buildCoxColumns. */
function referenceReason(cov: CoxCovariate, reference: string): string {
  if (cov.reference && cov.reference === reference) return "declared in the view";
  const isMutatedAxis = cov.source === "alteration" && (cov.by === "mutated" || cov.by === undefined);
  const fallback = isMutatedAxis && reference === "Not mutated"
    ? "the fixed default for a mutated-vs-not axis" : "the most frequent level";
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
      : "(df[" + c + "] == " + py(col.level!) + ").astype(float),  # reference: " + col.reference);
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
        ["fit", t.fit.iterations < 25 ? "converged in " + plural(t.fit.iterations, "iteration") : "stopped at the 25-iteration limit without converging"],
        ["log partial likelihood", t.fit.loglik.toFixed(4)],
      ],
    });
  }
  return {
    steps,
    implementation: { functions: ["coxRegression"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Matches " + VERIFIED.cox.library + " " + VERIFIED.cox.version + " " + VERIFIED.cox.fn +
      " (" + VERIFIED.cox.ties + " ties) to a relative 1e-6 on coefficients, SEs, p-values and intervals (" + GOLDEN_TEST + ").",
    python: coxPython(traces, o),
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
      ["fit", t.fit.iterations < 50 ? "converged in " + plural(t.fit.iterations, "iteration") : "stopped at the 50-iteration limit without converging"],
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
    "df = pd.read_csv(\"logistic_rows.csv\"" + pyCategoricalDtypes(t, t.outcomeKind === "num" ? [] : ["y"]) + ")",
    "y = " + y + "  # the outcome: " + (t.outcomeKind === "num" ? "already 0/1" : "event = " + t.outcomeEvent),
    "X = pd.DataFrame({",
    pyTerms(t, "    "),
    "})",
    "fit = sm.Logit(y, sm.add_constant(X)).fit(method=\"newton\")",
    "print(fit.summary())  # coefficients, SEs and p-values",
    "print(np.exp(fit.conf_int()))  # the odds-ratio 95% intervals drawn in the forest plot",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["logisticRegression"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Matches " + VERIFIED.logistic.library + " " + VERIFIED.logistic.version + " " + VERIFIED.logistic.fn +
      " to a relative 1e-6 on coefficients, SEs, p-values and intervals (" + GOLDEN_TEST + ").",
    python,
  };
}

// ---- aggregate inputs, embedded in a script ---------------------------------------------------
// The aggregate views' inputs are counts with no identifiers in them, so a script can carry them
// and run as is. Past this many rows it names the query instead of inlining a table that size.

export const INLINE_ROWS_MAX = 20000;

function csvField(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
}

/** `name = pd.read_csv(...)`: inline when small enough, else from a file the reader exports. */
function pyTable(name: string, what: string, columns: string[], rows: (string | number | null | undefined)[][], file: string): string[] {
  if (rows.length > INLINE_ROWS_MAX) {
    return ["# " + what + " — " + rows.length.toLocaleString() + " rows, too many to include here: export them as " + file,
      "# with columns " + columns.join(", ") + ".",
      name + " = pd.read_csv(" + py(file) + ")"];
  }
  return ["# " + what + ".",
    name + " = pd.read_csv(io.StringIO(\"\"\"" + columns.join(","),
    ...rows.map((r) => r.map(csvField).join(",")),
    "\"\"\"))"];
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
    ...pyTable("counts", "What the " + t.queryLabel + " query returned for each cohort and study: n patients per (months, event" +
      (hasEntry ? ", entry" : "") + ")", cols, t.counts.map((r) => [r.cohort, r.study, r.months, r.event, r.n, ...(hasEntry ? [r.entry] : [])]),
      "survival_counts.csv"),
    "# one row per patient again: a count row stands for n patients with exactly those values",
    "df = counts.loc[counts.index.repeat(counts[\"n\"])].reset_index(drop=True)",
    ...(t.cutoffMonths != null ? [
      "df.loc[df[\"months\"] > " + t.cutoffMonths + ", \"event\"] = 0  # censor at " + t.cutoffMonths + " months",
      "df[\"months\"] = df[\"months\"].clip(upper=" + t.cutoffMonths + ")"] : []),
    "df = df[df[\"months\"] >= 0]",
    "",
    "for cohort, g in df.groupby(\"cohort\", sort=False):",
    "    km = KaplanMeierFitter().fit(g[\"months\"], g[\"event\"]" + (hasEntry ? ", entry=g[\"entry\"]" : "") + ", label=cohort)",
    "    print(f\"{cohort}: n={len(g)}, events={g['event'].sum()}, median={km.median_survival_time_}\")",
    ...(t.test.kind === "none" ? [] : [
      "",
      "# p from the chi-squared tail directly: survdiff's own p rounds to 0 below about 1e-16",
      ...(t.test.stratified ? [
        "chi2, p = survdiff(df[\"months\"], df[\"event\"], df[\"cohort\"], strata=df[\"study\"]" + (hasEntry ? ", entry=df[\"entry\"]" : "") + ")",
        "print(f\"log-rank, stratified by study: chi2={chi2:.4f}, p={chi2_dist.sf(chi2, " + t.test.df + "):.4g}\")",
        "chi2, p = survdiff(df[\"months\"], df[\"event\"], df[\"cohort\"]" + (hasEntry ? ", entry=df[\"entry\"]" : "") + ")",
        "print(f\"log-rank, pooled: chi2={chi2:.4f}, p={chi2_dist.sf(chi2, " + t.test.df + "):.4g}\")",
      ] : [
        "chi2, p = survdiff(df[\"months\"], df[\"event\"], df[\"cohort\"]" + (hasEntry ? ", entry=df[\"entry\"]" : "") + ")",
        "print(f\"log-rank: chi2={chi2:.4f}, p={chi2_dist.sf(chi2, " + t.test.df + "):.4g}\")",
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
    python,
  };
}
