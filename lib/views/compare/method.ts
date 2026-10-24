// The compare view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, ALTERED_MEANING, driverMeaning, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

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
