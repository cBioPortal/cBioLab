// The adjusted view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Covariate-adjusted alteration enrichment between two cohorts: for every gene mutated in at least
 * a minimum share of the patients profiled for it, a logistic regression of altered on cohort and
 * covariates, reported as the adjusted odds ratio for the first cohort beside the raw one. Fit from
 * per-patient rows inside each local study (patient-level participants only).
 */
export interface AdjustedView {
  note?: string;
  kind: "adjusted"; cohorts?: string[];
  /** clinical attributes adjusted for (default none): a number as recorded, a category against its commonest value */
  covariates?: string[];
  /** count every called mutation (default), or only OncoKB drivers */
  measure?: "any" | "driver";
  /** genes tested: mutated in at least this share of the patients profiled for them, both cohorts together (default 0.05) */
  minShare?: number;
  /** and in at least this many patients (default 10) */
  minAltered?: number;
  /** genes named on the volcano (default 12) */
  label?: number;
}
export interface AdjustedGene {
  gene: string;
  /** per cohort, in the view's order: patients altered, and patients profiled for the gene with every covariate */
  altered: [number, number]; profiled: [number, number];
  /** unadjusted odds ratio (null with an empty cell) and its two-sided Fisher p */
  rawOr: number | null; fisherP: number;
  /** the cohort term's adjusted odds ratio, Wald 95% CI and p; q is Benjamini–Hochberg over the genes fit */
  or: number; ciLow: number; ciHigh: number; p: number; q: number;
  /** a covariate category that would separate was merged into its reference for this gene */
  merged?: boolean;
}
export interface AdjustedResult {
  groups: [string, string]; covariates: string[]; measure: "any" | "driver"; minShare: number; minAltered: number;
  /** per cohort: patients with a mutation panel, and of those with every covariate (the ones fit) */
  patients: { cohort: string; withPanel: number; used: number }[];
  /** genes fit, by adjusted p */
  rows: AdjustedGene[];
  /** genes that passed the share threshold but could not be fit, and why */
  failed: { gene: string; reason: string }[];
  significant: number;
  labels: string[];
  excludedRemote?: { study: string; patients: number }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { adjusted: AdjustedView }
  interface ViewResultFields {
    adjusted: {
      adjusted?: AdjustedResult;
    };
  }
  interface ViewResultMain { adjusted: "adjusted" }
}
