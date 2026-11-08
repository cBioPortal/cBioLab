// The diffexpr view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Differential expression between cohorts on one molecular profile: every gene's Welch t-test (two
 * cohorts) or one-way ANOVA (three or more, as cBioPortal's group comparison) from per-cohort moments (n, Σv, Σv² — additive, so exact
 * across sites). Two cohorts are drawn as a volcano, with preranked GSEA of the t ranking against
 * MSigDB gene sets; more are drawn as each cohort's mean of the most significant genes.
 */
export interface DiffexprView {
  note?: string;
  kind: "diffexpr"; cohorts?: string[];
  /** the profile to compare on (mRNA z-scores, RNA-seq, protein, methylation…) */
  profileType: string;
  /** compare log2(v + 1) rather than v; defaults to true for a non-z-score RNA-seq profile */
  log2?: boolean;
  /** MSigDB sets to test (≤12 names); default every HALLMARK_ set. [] skips enrichment, which needs two cohorts */
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
  gene: string;
  /** per cohort, in the result's `groups` order: samples with a value, and their mean and sample standard deviation on the compared scale */
  n: number[]; mean: number[]; sd: number[];
  /** two cohorts: the first's mean minus the second's, and Welch's t (unrounded, the enrichment's ranking) */
  effect?: number; t?: number;
  /** three or more cohorts: the one-way ANOVA's F */
  f?: number;
  p: number; q: number;
  cytoband?: string;
}
export interface DiffexprResult {
  profileType: string; log2: boolean;
  /** the view's picked gene, ringed on the volcano */
  gene?: string;
  /** the profile as the study names it, and its kind (cBioPortal's genetic_alteration_type: MRNA_EXPRESSION, PROTEIN_LEVEL, METHYLATION, …) */
  profileName?: string; profileKind?: string;
  /** what `effect` is: a difference of means on the compared scale (two cohorts) */
  effectLabel: string;
  /** cohorts in order; with two, effect = first − second */
  groups: string[];
  /** "Welch's t-test" (two cohorts) or "one-way ANOVA" */
  test: string;
  tested: number;
  /** genes left out for fewer than 3 samples with a value in a cohort, or no variance in any */
  skipped: number;
  /** genes at q < 0.05; with two cohorts, `up` of them higher in the first and `down` in the second */
  significant: number;
  up?: number; down?: number;
  /** the most significant genes by p (≤1,500) and the labelled ones: the volcano's points and the table's rows */
  points: DiffexprGene[];
  /** two cohorts: every other tested gene, binned on the volcano's axes: [x bin, y bin, count, 0 not significant | 1 higher in the first cohort | 2 in the second] */
  grid?: { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number, 0 | 1 | 2][] };
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
