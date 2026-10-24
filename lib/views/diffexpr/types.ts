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
}
export interface DiffexprGene { gene: string; nA: number; nB: number; meanA: number; meanB: number; effect: number; t: number; p: number; q: number }
export interface DiffexprResult {
  profileType: string; log2: boolean;
  /** what `effect` is: a difference of means on the compared scale */
  effectLabel: string;
  /** cohorts in order: effect = first − second */
  groups: [string, string];
  tested: number;
  /** genes left out for fewer than 3 patients in a cohort, or no variance in either */
  skipped: number;
  up: number; down: number;
  /** genes at q < 0.05, and the labelled ones, drawn individually (≤1,500, the most significant) */
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
