// The predictive view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

export interface PredictiveView {
  note?: string;
  kind: "predictive"; cohorts?: string[];
  /** the exposure: patients with a timeline event of this type (and key = value) are exposed, the rest unexposed */
  exposure: { eventType: string; key?: string; value?: string };
  /** the candidate biomarkers (at most 20); each is fitted alone, over the patients profiled for it */
  genes: string[];
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** "any" mutation (default) or OncoKB drivers only */
  measure?: "any" | "driver";
  /** clinical attributes adjusted for (at most 6): numbers as they are, categories as indicators against the commonest level */
  covariates?: string[];
  /** a gene is fitted only with at least this many mutated patients in each exposure group (default 5) */
  minMutated?: number;
}
export interface PredictiveEffect { hr: number; ciLow: number; ciHigh: number; p: number }
export interface PredictiveGene {
  gene: string;
  /** patients profiled for the gene (and with every covariate), by exposure, and those of them mutated */
  exposed: number; unexposed: number; mutatedExposed: number; mutatedUnexposed: number; events: number;
  /** the gene's hazard ratio among the exposed and among the unexposed, and their ratio (the interaction); null when not fitted */
  inExposed: PredictiveEffect | null; inUnexposed: PredictiveEffect | null; interaction: PredictiveEffect | null;
  /** Benjamini–Hochberg over the fitted genes' interaction p */
  q: number | null;
  /** why the gene was not fitted */
  skipped?: string;
}
export interface PredictiveResult {
  exposure: string; endpoint: string; measure: "any" | "driver";
  /** patients with a survival time and every covariate, and how many of them are exposed */
  n: number; exposed: number; events: number;
  /** patients left out: no mutation panel on record, a covariate missing */
  notProfiled: number; noCovariate: number;
  covariates: string[]; minMutated: number;
  /** the fits' baseline hazard is stratified by these (cohort and study, when several) */
  strata: number;
  genes: PredictiveGene[];
}

declare module "../../types.ts" {
  interface ViewSpecs { predictive: PredictiveView }
  interface ViewResultFields {
    predictive: {
      predictive?: PredictiveResult;
    };
  }
  interface ViewResultMain { predictive: "predictive" }
}
