// The clonality view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Clonality from FACETS allele-specific copy number: for each gene, whether the cohort's
 * mutation calls are clonal or subclonal, how often the mutated locus has lost its other allele,
 * and their cancer-cell fractions; per cohort, whole-genome doubling, purity and ploidy. Only
 * studies with allele-specific copy number can answer. Counts only.
 */
export interface ClonalityView {
  note?: string;
  kind: "clonality"; cohorts?: string[];
  genes: string[];
  /** OncoKB driver mutations only (default) or every mutation call */
  measure?: "driver" | "any";
  /** use only samples whose FACETS_QC is Pass (default true) */
  qc?: boolean;
}
export interface ClonalityGene {
  gene: string;
  /** mutation calls with a FACETS estimate, and the samples they are in */
  calls: number; samples: number;
  clonal: number; subclonal: number; indeterminate: number; uncalled: number;
  /** calls where the locus has no minor allele, of calls where the minor copy number is known */
  loh: number; lohKnown: number;
  /** cancer-cell fraction, ten bins of 0.1 */
  ccf: number[];
  /** two cohorts: Fisher on clonal vs subclonal, BH across genes */
  p?: number; q?: number;
}
export interface ClonalityPanel {
  cohort: string; samples: number; ascnSamples: number; qcPass: number; qcFail: number;
  wgd: { yes: number; no: number };
  /** FACETS purity in 0.05 bins over 0–1, ploidy in 0.25 bins over 0–8 */
  purity: number[]; ploidy: number[];
  genes: ClonalityGene[];
}
export interface ClonalityResult {
  measure: "driver" | "any"; qc: boolean;
  panels: ClonalityPanel[];
  /** two cohorts: Fisher on whole-genome doubling */
  wgdP?: number;
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { clonality: ClonalityView }
  interface ViewResultFields {
    clonality: {
      clonality?: ClonalityResult;
    };
  }
  interface ViewResultMain { clonality: "clonality" }
}
