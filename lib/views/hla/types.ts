// The hla view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve, LogRank } from "../../types.ts";

/**
 * HLA class I genotype and HLA loss of heterozygosity against outcome (Chowell et al. 2018;
 * McGranahan et al. 2017): per cohort, the share of fully typed patients homozygous at 0, 1 or
 * 2+ of HLA-A, -B and -C, the share with HLA LOH in a tumour sample, and overall survival by
 * homozygous-at-any-locus against fully heterozygous and by HLA LOH against none.
 */
export interface HlaView {
  note?: string;
  kind: "hla"; cohorts?: string[];
  /** fields of the allele name compared: 1 (allele group, A*02), 2 (protein, A*02:01; default) or "full" */
  resolution?: 1 | 2 | "full";
  /** per locus, the attributes holding its two alleles ([first, second]) or one holding both ("A*02:01/A*24:02"); default: the layouts MSK-IMPACT and the melanoma/NSCLC immunotherapy studies use */
  alleles?: { A?: string[]; B?: string[]; C?: string[] };
  /** sample attributes calling HLA LOH (default HLA_A1_LOH … HLA_C2_LOH, HLA_LOH) and the values that mean loss (default Loss, Yes, LOH, True) */
  lohAttributes?: string[]; lohValues?: string[];
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** clinical attributes the adjusted Cox fit adds (at most 4; numbers as they are, categories against the commonest) */
  covariates?: string[];
}
export interface HlaHr { hr: number; ciLow: number; ciHigh: number; p: number; n: number; events: number }
export interface HlaSplit {
  /** the two groups' OS curves (exposed first), the log-rank test (stratified by study when pooled) and Cox HRs of exposed against not */
  curves: (Omit<KmCurve, "cohort"> & { label: string })[];
  logrank: LogRank | null;
  hr: HlaHr | null;
  /** with covariates: the HR adjusted for them, on the patients with every covariate */
  adjusted: HlaHr | null;
}
export interface HlaPanel {
  cohort: string;
  /** cohort patients, patients with any class I allele recorded, and those typed at all three loci */
  patients: number; anyTyped: number; typed: number;
  /** fully typed patients homozygous at 0, 1, 2 and 3 loci */
  homozygous: [number, number, number, number];
  /** per locus (A, B, C): patients typed there and homozygous there */
  loci: { locus: "A" | "B" | "C"; typed: number; homozygous: number }[];
  /** typed at fewer allele-name fields than the resolution asks (compared at what they have) */
  coarser: number;
  /** patients with an HLA LOH call in some sample, and those with a loss */
  lohEvaluated: number; loh: number;
  /** OS by homozygous at ≥ 1 locus vs none, and by HLA LOH vs none; null with why when not drawn */
  byHomozygosity: HlaSplit | null; byHomozygosityWhy?: string;
  byLoh: HlaSplit | null; byLohWhy?: string;
  /** patients without the endpoint, and (with covariates) without a covariate, left out of the fits */
  noOutcome: number; noCovariate: number;
}
export interface HlaResult {
  resolution: 1 | 2 | "full"; endpoint: string; covariates: string[];
  panels: HlaPanel[];
}

declare module "../../types.ts" {
  interface ViewSpecs { hla: HlaView }
  interface ViewResultFields {
    hla: {
      hla?: HlaResult;
    };
  }
  interface ViewResultMain { hla: "hla" }
}
