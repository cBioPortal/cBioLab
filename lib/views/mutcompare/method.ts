// The mutcompare view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, VERIFIED, RESULT_INIT, withResult, checks, pyTable } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";
import type { MutcompareRow } from "./types.ts";

export interface MutcompareTrace {
  gene: string; cohorts: [string, string]; profiled: [number, number]; mutated: [number, number];
  rows: MutcompareRow[]; geneP: number;
}

export function mutcompareMethod(t: MutcompareTrace): MethodRecord {
  const steps: MethodStep[] = [
    { kind: "fetch", title: "Rank genes by their higher mutated share",
      detail: "The mutcompare:mutated / panels / wes queries above: per gene, the cohort's samples with a called mutation, and the samples profiled for it (a panel listing it, or whole-exome). Genes are ordered by the higher of the two cohorts' shares, as the portal's gene picker orders them." },
    { kind: "fetch", title: "Count each protein change's patients in " + t.gene,
      detail: "The lollipop queries above, once per cohort: per (codon, protein change), the distinct patients carrying it in one of the cohort's samples; and the cohort's patients profiled for " + t.gene + " (mutcompare:profiled).",
      params: t.cohorts.map((c, i) => [c + " profiled patients", t.profiled[i].toLocaleString("en-US")] as [string, string]) },
    { kind: "statistic", title: "Fisher's exact test per protein change, then Benjamini–Hochberg",
      detail: "Carriers against the rest of the profiled patients, two-sided, per change; q across the changes listed. The log ratio is log2 of the first cohort's share over the second's." },
  ];
  const python = [
    "# Recompute with scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against.",
    "import io",
    "import pandas as pd",
    "from scipy.stats import fisher_exact",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    "PROFILED = " + JSON.stringify(t.profiled) + "  # each cohort's patients profiled for " + t.gene,
    "MUTATED = " + JSON.stringify(t.mutated) + "  # each cohort's patients with any mutation in " + t.gene,
    ...pyTable("counts", "Patients per protein change in each cohort, from the lollipop queries above", ["change", "a", "b"],
      t.rows.map((r) => [r.change, r.n[0], r.n[1]]), "mutcompare_counts.csv"),
    "def fisher(a, b):",
    "    return fisher_exact([[a, max(0, PROFILED[0] - a)], [b, max(0, PROFILED[1] - b)]], alternative=\"two-sided\").pvalue",
    "counts[\"p\"] = [fisher(r.a, r.b) for r in counts.itertuples()]",
    "counts = counts.sort_values([\"p\", \"change\"]).reset_index(drop=True)",
    "counts[\"q\"] = multipletests(counts[\"p\"], method=\"fdr_bh\")[1] if len(counts) else []",
    "print(counts.head(30).to_string(index=False))",
    "for r in counts.itertuples():",
    "    RESULT[f\"mutcompare:{r.change}:p\"], RESULT[f\"mutcompare:{r.change}:q\"] = r.p, r.q",
    "RESULT[\"mutcompare:gene:p\"] = fisher(*MUTATED)",
    "print(\"" + t.gene + " as a whole: p =\", RESULT[\"mutcompare:gene:p\"])",
  ].join("\n") + "\n";
  return { steps, implementation: { functions: ["fisherExact", "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/tables-golden.test.ts).",
    python: withResult(python),
    check: { "mutcompare:gene:p": { v: t.geneP }, ...checks("mutcompare:", t.rows.slice(0, 40) as unknown as Record<string, unknown>[], (r) => r.change, [["p", "p"], ["q", "q"]]) } };
}
