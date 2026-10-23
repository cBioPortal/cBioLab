// The correlates view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Genome-wide co-expression (cBioPortal's results-view Co-expression tab): one gene's expression
 * against every gene's in a profile, over one cohort's patients — Spearman's ρ (ranked by it, as
 * the portal ranks) and Pearson's r, each with a p, and Benjamini–Hochberg over ρ. Sums only.
 */
export interface CorrelatesView {
  note?: string;
  kind: "correlates"; cohorts?: string[];
  /** the query gene */
  gene: string;
  /** the query gene's profile */
  profileType: string;
  /** the profile every other gene is read from (default: the same one) — e.g. protein against mRNA */
  otherProfile?: string;
  /** genes listed in each direction (default 100, at most 250) */
  show?: number;
  /** a gene with fewer patients having both values is not tested (default 10) */
  minN?: number;
}
export interface CorrelatesGene {
  gene: string; n: number;
  /** in the study's reference genome, when known */
  cytoband?: string;
  /** Spearman's ρ with its p (the t approximation scipy uses, or the Fisher-z meta p across studies) and BH q */
  rho: number | null; rhoP: number; q: number;
  /** Pearson's r and its p, from the pooled sums */
  r: number | null; p: number;
}
export interface CorrelatesResult {
  gene: string; profileType: string; otherProfile: string; cohort: string;
  tested: number; untested: number; significant: number; minN: number;
  /** "rank" when ρ is one study's; "meta" when ρ combines several studies' by Fisher z */
  rhoFrom: "rank" | "meta";
  /** the most positively and most negatively correlated genes, by ρ */
  positive: CorrelatesGene[]; negative: CorrelatesGene[];
  /** ρ of every gene tested, in bins of 0.05 from −1 to 1: [bin low edge, count] */
  histogram: [number, number][];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { correlates: CorrelatesView }
  interface ViewResultFields {
    correlates: {
      correlates?: CorrelatesResult;
    };
  }
  interface ViewResultMain { correlates: "correlates" }
}
