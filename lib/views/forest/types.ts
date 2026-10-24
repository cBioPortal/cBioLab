// The forest view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { CoxCovariate } from "../../types.ts";
import type { PlotAxis } from "../../plot.ts";

/**
 * Pan-cancer forest: one exposure's hazard ratio within each stratum of the cohort (a cancer type,
 * a study, or a cohort), each from its own Cox fit, pooled by a DerSimonian–Laird random-effects
 * meta-analysis (and the fixed-effect estimate beside it). Fit from per-patient rows within each
 * local study, the same boundary as `cox`.
 */
export interface ForestView {
  note?: string;
  kind: "forest"; cohorts?: string[];
  /** the exposure, as a plot axis: a gene's alteration (not profiled is left out, never unaltered), a numeric or categorical attribute */
  exposure: PlotAxis;
  /** a categorical exposure's level counted as exposed (default for an alteration axis: any alteration) */
  exposed?: string;
  /** a numeric exposure: exposed when the value is at least this */
  threshold?: number;
  /** endpoint prefix (default OS), and the cox view's escape hatch for other column names */
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** what a row is: a categorical attribute (default CANCER_TYPE), "study", or "cohort" (the view's cohorts) */
  strata?: string;
  /** adjust each stratum's fit for these (default none) */
  covariates?: CoxCovariate[];
  /** a stratum with fewer patients or events than these is pooled into "Other" (defaults 30 and 10) */
  minPatients?: number; minEvents?: number;
  /** at most this many strata are drawn, the largest; the rest pool into "Other" (default 30) */
  maxStrata?: number;
  /** what happens to the small strata: pooled into one "Other" row (default) or left out, listed */
  small?: "pool" | "drop";
}
export interface ForestRow {
  label: string; n: number; events: number; exposed: number; exposedEvents: number;
  beta: number; se: number; hr: number; ciLow: number; ciHigh: number; p: number;
  /** the row's share of the random-effects weight */
  weight: number;
  /** an "Other" row: the strata it pools */
  pooled?: string[];
}
export interface ForestPooled { hr: number; ciLow: number; ciHigh: number; p: number; beta: number; se: number }
export interface ForestResult {
  exposure: string; exposedLabel: string; endpoint: string; strata: string; covariates: string[];
  rows: ForestRow[];
  /** strata that are not rows, and why */
  left: { label: string; n: number; events: number; reason: string }[];
  /** pooled estimates; null with fewer than two rows */
  fixed: ForestPooled | null; random: ForestPooled | null;
  tau2: number; q: number; qDf: number; qP: number; i2: number;
  /** patients with a time, the exposure and the stratum (and every covariate) */
  n: number; events: number;
  notProfiled: number; missing: number;
  excludedRemote?: { study: string; patients: number }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { forest: ForestView }
  interface ViewResultFields {
    forest: {
      forest?: ForestResult;
    };
  }
  interface ViewResultMain { forest: "forest" }
}
