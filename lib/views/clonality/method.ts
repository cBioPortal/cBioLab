// The clonality view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, driverMeaning, type MethodStep, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

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
