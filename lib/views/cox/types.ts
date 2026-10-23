// The cox view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { SplitBy, CoxCovariate } from "../../types.ts";

/**
 * Multivariate Cox proportional-hazards regression: several covariates at once, each
 * reported as a hazard ratio with a confidence interval (drawn as a forest plot), rather than
 * KM's one categorical split. Fit from real per-patient rows within each LOCAL study — unlike
 * survival/compare, this does not pool aggregate counts across remote peers, so a participant
 * without patient-level access simply cannot contribute to it (see CoxResult.excludedRemote).
 */
export interface CoxView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "cox"; cohorts?: string[]; splitBy?: SplitBy;
  /** endpoint prefix: OS (default), PFS, DFS, DSS… reads <X>_MONTHS/<X>_STATUS */
  endpoint?: string;
  /** same escape hatch as SurvivalView.monthsAttribute/statusAttribute, for the same reason */
  monthsAttribute?: string; statusAttribute?: string;
  /** one or more covariates to fit simultaneously; each becomes one or more forest-plot rows */
  covariates: CoxCovariate[];
  /** fit separate baseline hazards per study rather than pooling them (default false) */
  stratifyByStudy?: boolean;
  /**
   * Fit each named cohort as its own separate Cox model — its own coefficients, its own chosen
   * reference levels, its own N/events — instead of pooling every cohort's patients into one
   * fit (default false). Unlike `stratifyByStudy` (one shared model, a per-study baseline
   * hazard via Cox's `stratum`), this produces N independent models: the right tool when the
   * covariate EFFECT itself, not just the baseline hazard, might differ between cohorts (e.g.
   * a gene's hazard ratio in NSCLC vs in CRC). A no-op when only one cohort is named.
   */
  stratifyByCohort?: boolean;
  /** administratively censor everyone still at risk past this month, same semantics as SurvivalView */
  cutoffMonths?: number;
}
export interface CoxCoefficient {
  /** covariate name, or "<covariate>: <level>" for a categorical level */
  label: string;
  /** the baseline level this coefficient is measured against, for a categorical covariate */
  reference?: string;
  /** this coefficient's own level (the non-reference side), for a categorical covariate */
  level?: string;
  /** which entry of the view's `covariates` array this came from — lets the UI group a
   *  categorical covariate's coefficients back together to offer its observed levels as a
   *  reference-level picker, without re-deriving them from raw rows */
  axisIndex?: number;
  beta: number; se: number; hr: number; ciLow: number; ciHigh: number; p: number;
}
export interface CoxResult {
  coefficients: CoxCoefficient[];
  n: number; events: number;
  /** studies whose patients were left out of the fit for lacking patient-level access */
  excludedRemote?: { study: string; patients: number }[];
  /**
   * Present only when the view asked for `stratifyByCohort` (and named 2+ cohorts): one
   * independent Cox fit per cohort, in place of the single pooled fit above (`coefficients`
   * here is then empty; `n`/`events` are the sum across cohorts, for the header only). Each
   * cohort's `coefficients` chose its OWN reference levels from what IT observed, so the same
   * covariate can read against a different reference in different cohorts — real information,
   * not an inconsistency to paper over.
   */
  byCohort?: { cohort: string; coefficients: CoxCoefficient[]; n: number; events: number;
    excludedRemote?: { study: string; patients: number }[]; error?: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { cox: CoxView }
  interface ViewResultFields {
    cox: {
      cox?: CoxResult;
      /** which endpoint was fitted */
      endpoint?: string;
    };
  }
  interface ViewResultMain { cox: "cox" }
}
