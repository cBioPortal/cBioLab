// The genome view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, plural, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

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
