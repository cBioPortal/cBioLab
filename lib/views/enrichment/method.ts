// The enrichment view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

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
