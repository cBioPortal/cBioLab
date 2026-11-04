// The mutexpr view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/** how expression values are read: as the profile stores them, as log2(v + 1), or a z-score profile as stored */
export type MutexprScale = "linear" | "log2" | "zscore";
/** what a mutant group is: one protein change, or one codon (reference residue and first position) */
export type MutexprResolution = "protein" | "codon";
/** what the samples are split by before grouping */
export type MutexprStratum = "cancerType" | "fusion";

/**
 * Expression of one gene against the mutations of a gene (the same gene or another), one group per
 * protein change or codon, with "Not mutated" and "Not profiled" kept apart. Every sample of the
 * cohort with an expression value is one observation.
 */
export interface MutexprView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "mutexpr"; cohorts?: string[];
  /** the gene whose mutations make the groups */
  gene: string;
  /** the gene whose expression is plotted; the mutated gene when omitted */
  expressionGene?: string;
  /** the expression profile (mrna_seq_tpm, rna_seq_v2_mrna, rna_seq_v2_mrna_median_Zscores, …) */
  profileType: string;
  /** default: zscore for a z-score profile, log2 for any other continuous one */
  scale?: MutexprScale;
  /** default "protein" */
  resolution?: MutexprResolution;
  /** split by cancer type, by a fusion of `fusionGene`, or both (crossed); none when omitted */
  stratify?: MutexprStratum[];
  /** the gene whose fusions split the samples; the mutated gene when omitted */
  fusionGene?: string;
  /** a group (or stratum) with fewer samples than this is withheld: no statistic is reported for it. Default 5 */
  minCount?: number;
}

export type MutexprRole = "allMutated" | "variant" | "multiple" | "other" | "notMutated" | "notProfiled";

/** one group's samples within one stratum; n and every statistic are absent when it is withheld */
export interface MutexprGroup {
  label: string;
  role: MutexprRole;
  /** null: fewer than minCount samples, withheld */
  n: number | null;
  /** the "other" group: how many groups it pools, and why */
  pooled?: { small: number; beyondCap: number };
  mean?: number; sd?: number;
  p5?: number; q1?: number; median?: number; q3?: number; p95?: number;
  /** against "Not mutated" in the same stratum: mean difference, Welch t, p and BH q */
  diff?: number; t?: number; p?: number; q?: number;
}

export interface MutexprStratumResult {
  key: string;
  /** "All samples" when the view is not stratified */
  label: string;
  n: number;
  groups: MutexprGroup[];
  /** why nothing in this stratum was tested, when nothing was */
  untested?: string;
}

export interface MutexprResult {
  gene: string; expressionGene: string; profileType: string;
  scale: MutexprScale; resolution: MutexprResolution;
  stratify: MutexprStratum[]; fusionGene?: string;
  minCount: number;
  /** the value axis's name, e.g. "MDM2 expression, log2(v + 1) of mrna_seq_tpm" */
  valueLabel: string;
  /** the shared value range the bins (and so the quantiles) are cut over, and how many bins */
  range: [number, number]; bins: number;
  strata: MutexprStratumResult[];
  /** strata with fewer than minCount samples, withheld whole */
  withheldStrata: number;
  samples: { cohort: number; withValue: number; negativeDropped: number };
  /** comparisons made against "Not mutated" */
  tested: number;
  /** the participants that could not answer, named */
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { mutexpr: MutexprView }
  interface ViewResultFields {
    mutexpr: {
      mutexpr?: MutexprResult;
    };
  }
  interface ViewResultMain { mutexpr: "mutexpr" }
}
