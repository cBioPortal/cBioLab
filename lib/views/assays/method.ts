// The assays view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

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
