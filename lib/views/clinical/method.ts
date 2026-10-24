// The clinical view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, pFmt, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

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
