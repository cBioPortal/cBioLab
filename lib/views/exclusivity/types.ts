// The exclusivity view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Mutual exclusivity and co-occurrence against each tumour's own alteration burden (DISCOVER,
 * Canisius et al. 2016): per sample and gene a background probability fitted from the sample and
 * gene marginals of the whole altered-gene matrix, so that heavily altered tumours are expected to
 * share alterations; each pair's co-altered count tested against its Poisson-binomial null.
 */
export interface ExclusivityView {
  note?: string;
  kind: "exclusivity"; cohorts?: string[];
  /** 2 to 20 genes */
  genes: string[];
  /** estimate the background within each value of this sample attribute (e.g. CANCER_TYPE) */
  stratifyBy?: string;
  /** any alteration (default) or OncoKB oncogenic only */
  measure?: "driver" | "any";
}
export interface ExclusivityPair {
  a: string; b: string;
  /** samples profiled for both genes, those altered in both, and the background's expected number */
  profiled: number; both: number; expected: number;
  /** DISCOVER: lower tail (exclusivity) and upper tail (co-occurrence), BH q in each direction */
  pExclusive: number; qExclusive: number; pCooccur: number; qCooccur: number;
  /** false when the tails came from the refined normal approximation, not the exact distribution */
  exact: boolean;
  /** the plain two-sided Fisher test on the same samples' 2×2, BH across the pairs */
  onlyA: number; onlyB: number; neither: number; fisherP: number; fisherQ: number; log2Odds: number | null;
}
export interface ExclusivityResult {
  cohort: string; genes: string[];
  stratifyBy: string | null; strata: { name: string; samples: number }[];
  measure: "driver" | "any";
  /** samples with a panel, the genes in the background matrix, and how the fit ended */
  samples: number; matrixGenes: number; iterations: number; converged: boolean; maxResidual: number;
  pairs: ExclusivityPair[];
  /** pairs no sample was profiled for both genes of */
  unassessable: string[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { exclusivity: ExclusivityView }
  interface ViewResultFields {
    exclusivity: {
      exclusivity?: ExclusivityResult;
    };
  }
  interface ViewResultMain { exclusivity: "exclusivity" }
}
