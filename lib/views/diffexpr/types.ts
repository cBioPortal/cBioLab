// The diffexpr view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Differential expression between exactly two cohorts on one molecular profile: every gene's
 * Welch t-test from per-cohort moments (n, Σv, Σv² — additive, so exact across sites), drawn as
 * a volcano, and preranked GSEA of that t ranking against MSigDB gene sets.
 */
export interface DiffexprView {
  note?: string;
  kind: "diffexpr"; cohorts?: string[];
  /** the profile to compare on (mRNA z-scores, RNA-seq, protein, methylation…) */
  profileType: string;
  /** compare log2(v + 1) rather than v; defaults to true for a non-z-score RNA-seq profile */
  log2?: boolean;
  /** MSigDB sets to test (≤12 names); default every HALLMARK_ set. [] skips enrichment */
  geneSets?: string[];
  /** genes labelled on the volcano (default 12, max 40) */
  label?: number;
  /**
   * The gene picked on the volcano or in the table (what clicking one sets): ringed on the volcano,
   * and in the web app its values per group drawn beside it. Applied where the figure is drawn, so a
   * change re-runs nothing.
   */
  gene?: string;
}
export interface DiffexprGene {
  gene: string; nA: number; nB: number; meanA: number; meanB: number;
  /** each cohort's sample standard deviation, on the compared scale */
  sdA: number; sdB: number;
  effect: number; t: number; p: number; q: number;
  cytoband?: string;
}
export interface DiffexprResult {
  profileType: string; log2: boolean;
  /** the view's picked gene, ringed on the volcano */
  gene?: string;
  /** the profile as the study names it, and its kind (cBioPortal's genetic_alteration_type: MRNA_EXPRESSION, PROTEIN_LEVEL, METHYLATION, …) */
  profileName?: string; profileKind?: string;
  /** what `effect` is: a difference of means on the compared scale */
  effectLabel: string;
  /** cohorts in order: effect = first − second */
  groups: [string, string];
  tested: number;
  /** genes left out for fewer than 3 patients in a cohort, or no variance in either */
  skipped: number;
  up: number; down: number;
  /** the most significant genes by p (≤1,500) and the labelled ones: the volcano's points and the table's rows */
  points: DiffexprGene[];
  /** every other tested gene, binned on the axes below: [x bin, y bin, count, 0 not significant | 1 higher in the first cohort | 2 in the second] */
  grid: { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number, 0 | 1 | 2][] };
  /** genes q < 0.05 not drawn individually because of the cap */
  pooledSignificant: number;
  labels: string[];
  gsea?: { ranking: string; permutations: number; sets: (import("../../stats.ts").GseaResult & { q: number })[]; skipped: string[] };
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { diffexpr: DiffexprView }
  interface ViewResultFields {
    diffexpr: {
      diffexpr?: DiffexprResult;
    };
  }
  interface ViewResultMain { diffexpr: "diffexpr" }
}
