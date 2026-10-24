// The logistic view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { SplitBy, CoxCovariate } from "../../types.ts";
import type { PlotAxis } from "../../plot.ts";

/**
 * Multivariate logistic regression: a BINARY outcome (not time-to-event) regressed on several
 * covariates at once, reported as odds ratios with a forest plot — the same shape as `cox`, but
 * for "did X happen" rather than "when did X happen". Reuses the exact same covariate/dummy-
 * coding machinery as `cox` (buildCoxColumns): a categorical covariate is dummy-coded the same
 * way, with the same reference-level rules (a mutated-vs-not axis defaults to "Not mutated";
 * others default to the most frequent level; `reference` overrides either). Fit from real
 * per-patient rows within each LOCAL study, same boundary as `cox`.
 */
export interface LogisticView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "logistic"; cohorts?: string[]; splitBy?: SplitBy;
  /** the binary outcome, as a plot axis (clinical, molecular, or alteration status) */
  outcome: PlotAxis;
  /**
   * Which observed value of a CATEGORICAL outcome counts as the event (1) — every other observed
   * value is collapsed into "not event" (0), and which values got collapsed is disclosed in the
   * caveat rather than left implicit. Required for a categorical outcome; refused (not guessed)
   * if omitted, or if it names a value the outcome never actually takes. Not used, and must be
   * omitted, for a NUMERIC outcome — that one must already be coded exactly 0/1, refused
   * otherwise (a continuous number silently coerced to 0/1 would be a guess about a threshold
   * nobody asked for).
   */
  outcomeEvent?: string;
  /** one or more covariates to fit simultaneously; each becomes one or more forest-plot rows */
  covariates: CoxCovariate[];
}
export interface LogisticCoefficient {
  /** covariate name, or "<covariate>: <level>" for a categorical level */
  label: string;
  /** the baseline level this coefficient is measured against, for a categorical covariate */
  reference?: string;
  /** this coefficient's own level (the non-reference side), for a categorical covariate */
  level?: string;
  axisIndex?: number;
  beta: number; se: number; or: number; ciLow: number; ciHigh: number; p: number;
}
export interface LogisticResult {
  coefficients: LogisticCoefficient[];
  n: number; events: number;
  /** a categorical outcome's other observed values, collapsed into "not event" — named so that
   *  is a disclosed choice, not a silent one */
  outcomeOther?: string[];
  /** studies whose patients were left out of the fit for lacking patient-level access */
  excludedRemote?: { study: string; patients: number }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { logistic: LogisticView }
  interface ViewResultFields {
    logistic: {
      logistic?: LogisticResult;
    };
  }
  interface ViewResultMain { logistic: "logistic" }
}
