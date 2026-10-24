// The cutpoint view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve } from "../../types.ts";

export interface CutpointView {
  note?: string;
  kind: "cutpoint"; cohorts?: string[];
  /** the numeric marker (default TMB_NONSYNONYMOUS): the patient's value, or a sample attribute's value on the patient's first sample */
  attribute?: string;
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** permutations of the marker for the corrected p (default 1000, 100 to 5000), and their seed (default 1) */
  permutations?: number; seed?: number;
  /** a categorical attribute: a cut-point per stratum (its largest values, at most 8, each with at least minStratum patients) */
  stratifyBy?: string; minStratum?: number;
}
export interface CutpointScan {
  /** patients with a survival time and a marker value, and their events */
  n: number; events: number;
  /** the chosen cut: high is marker > cut */
  cut: number;
  /** the share of patients at or below it */
  lowShare: number;
  /** the maximally selected standardized log-rank statistic (z², chi-squared scale) at the cut, and its permutation-corrected p */
  maxStat: number; permP: number;
  /** the ordinary log-rank test of the two groups at the cut, as if the cut had been fixed in advance */
  naiveChi2: number; naiveP: number;
  /** the 95th percentile of the permutation distribution of the maximum: the statistic a cut must pass to be significant at 0.05 */
  critical95: number;
  /** high against low, Cox */
  hr: { hr: number; ciLow: number; ciHigh: number; p: number } | null;
  low: { n: number; events: number; median: number | null }; high: { n: number; events: number; median: number | null };
  /** candidate cuts scanned and the statistic at each */
  candidates: { cut: number; stat: number }[];
}
export interface CutpointResult extends CutpointScan {
  attribute: string; endpoint: string; permutations: number; seed: number;
  /** cohort patients with a survival time but no marker value */
  noValue: number;
  curves: { low: Omit<KmCurve, "cohort">; high: Omit<KmCurve, "cohort"> };
  strata?: {
    attribute: string; minStratum: number;
    rows: ({ stratum: string } & Omit<CutpointScan, "candidates">)[];
    /** strata not scanned: too small, past the eighth, or no value */
    omitted: { values: number; patients: number };
  };
}

declare module "../../types.ts" {
  interface ViewSpecs { cutpoint: CutpointView }
  interface ViewResultFields {
    cutpoint: {
      cutpoint?: CutpointResult;
    };
  }
  interface ViewResultMain { cutpoint: "cutpoint" }
}
