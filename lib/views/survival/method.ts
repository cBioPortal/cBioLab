// The survival view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, plural, pFmt, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

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
