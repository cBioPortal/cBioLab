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
    ...pyTable("counts", "What the geneCounts query returned for each cohort and study: patients profiled for, altered in, and with a driver in each gene",
      ["cohort", "study", "gene", "profiled", "altered", "driver"],
      t.counts.map((r) => [r.cohort, r.study, r.gene, r.profiled, r.altered, r.driver]), "gene_counts.csv"),
    "cohorts = " + JSON.stringify(t.cohorts),
    "per_cohort = counts.groupby([\"gene\", \"cohort\"])[[\"profiled\", \"altered\", \"driver\"]].sum()",
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
    ]),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: k === 2 ? ["fisherExact", "benjaminiHochberg"] : k > 2 ? ["chiSquareTest", "benjaminiHochberg"] : [],
      file: "lib/stats.ts", commit: BUILD_COMMIT },
    ...(k >= 2 ? { verification: (k === 2 ? "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact"
      : "The χ² test matches scipy " + VERIFIED.chi2.version + " chi2_contingency(correction=False)") +
      " and Benjamini–Hochberg matches statsmodels " + VERIFIED.bh.version + " " + VERIFIED.bh.fn + ", to a relative 1e-6 (test/tables-golden.test.ts)." } : {}),
    python,
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
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["fisherExact", ...(stratified ? ["cochranMantelHaenszel"] : []), "log2OddsRatio", "benjaminiHochberg"],
      file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact" +
      (stratified ? ", the CMH test and Mantel–Haenszel odds ratio statsmodels " + VERIFIED.cmh.version + " " + VERIFIED.cmh.fn : "") +
      " and Benjamini–Hochberg statsmodels " + VERIFIED.bh.version + " " + VERIFIED.bh.fn + ", to a relative 1e-6 (test/tables-golden.test.ts).",
    python,
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
      k === 2
        ? "    print(f\"{attr}: Mann-Whitney p={mannwhitneyu(*values, alternative='two-sided', use_continuity=True, method='asymptotic').pvalue:.4g}\")"
        : "    print(f\"{attr}: Kruskal-Wallis p={kruskal(*values).pvalue:.4g}\")",
    ] : []),
    "",
    "q = multipletests(list(p_values.values()), method=\"fdr_bh\")[1]",
    "print(pd.DataFrame({\"attribute\": list(p_values), \"p\": list(p_values.values()), \"q\": q}).sort_values(\"p\").to_string(index=False))",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: [...(cat.length ? ["chiSquareTest"] : []), ...(num.length ? [k === 2 ? "welchT" : "welchAnovaTest"] : []),
      ...(num.length && t.singleStudy ? [k === 2 ? "mannWhitneyU" : "kruskalWallis", "quantilesFromHistogram"] : []), "benjaminiHochberg"],
      file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "χ² matches scipy " + VERIFIED.chi2.version + " chi2_contingency; Welch's t scipy ttest_ind(equal_var=False) and Welch's ANOVA statsmodels " +
      VERIFIED.anova.version + " anova_generic from the same moments; Mann–Whitney, Kruskal–Wallis and quantiles scipy/numpy on the expanded distribution; " +
      "Benjamini–Hochberg statsmodels multipletests — all to a relative 1e-6 (test/tables-golden.test.ts, test/moments-golden.test.ts).",
    python,
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
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["pearsonFromMoments", ...(multi ? ["fisherZMeta"] : []), "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Pearson's r and p from the six sums match scipy " + VERIFIED.pearson.version + " pearsonr on the underlying values" +
      (multi ? ", and the Fisher-z meta-analysis statsmodels " + VERIFIED.meta.version + " " + VERIFIED.meta.fn : "") +
      ", to a relative 1e-6 (test/moments-golden.test.ts).",
    python,
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
    ] : []),
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: ["welchT", "benjaminiHochberg", ...(t.gsea ? ["preRankedGsea"] : [])], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Welch's t from moments matches scipy " + VERIFIED.welch.version + " ttest_ind(equal_var=False) and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/moments-golden.test.ts, test/tables-golden.test.ts)" +
      (t.gsea ? "; enrichment scores match gseapy " + VERIFIED.gsea.version + " prerank, and NES and p match the script's port of our seeded null exactly (test/gsea-golden.test.ts)" : "") + ".",
    python,
  };
}
