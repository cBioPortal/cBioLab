// The multistate view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

export interface MultistateView {
  note?: string;
  kind: "multistate"; cohorts?: string[];
  /** the progression event (default event type Diagnosis, key PROGRESSION, values Y / Yes), and an optional probability floor */
  progression?: { eventType?: string; key?: string; values?: string[]; probabilityKey?: string; minProbability?: number };
  /** patients with a progression on or before day 0: start in the progression state (include, default) or are left out (exclude) */
  prevalent?: "include" | "exclude";
  /** months at which the state occupation is tabled (default [12, 24, 60]) */
  horizons?: number[];
  /** administrative censoring, months */
  cutoffMonths?: number;
}
/** a transition of the illness–death model: 01 start → progression, 02 start → death, 12 progression → death */
export type MultistateTransitionKey = "01" | "02" | "12";
export interface MultistateRate {
  key: MultistateTransitionKey; events: number; personMonths: number;
  /** events per 100 person-months in the state left, with its 95% interval (log scale, Poisson) */
  rate: number; lo: number | null; hi: number | null;
}
export interface MultistateCohort {
  cohort: string;
  /** the cohort's patients; those in the model (n), and of them those starting in the progression state */
  cohortPatients: number; n: number; prevalent: number;
  excluded: { noFollowup: number; prevalent: number };
  /** in the model: patients with no record of the progression key at all, a progression only on or after the end of follow-up, a Sequencing event on day 0, a timeline past follow-up */
  notAssessed: number; afterEnd: number; seq0: number; late: number;
  /** censored in the start and in the progression state */
  censored: { start: number; progression: number };
  rates: MultistateRate[];
  /** Aalen–Johansen state occupation: p0 alive without progression, p1 alive after progression, p2 dead */
  occupation: { t: number; p0: number; p1: number; p2: number }[];
  /** Nelson–Aalen cumulative hazard per transition, with its 95% interval (log scale) */
  cumhaz: Record<MultistateTransitionKey, { t: number; h: number; lo: number; hi: number }[]>;
  /** curves are drawn to here: the last time at least 10 of the cohort's patients are still followed */
  drawnTo: number;
  /** occupation at each horizon, with the number still followed; null past drawnTo */
  atHorizon: { months: number; p0: number | null; p1: number | null; p2: number | null; atRisk: number }[];
}
export interface MultistateCox {
  key: MultistateTransitionKey;
  /** each cohort's hazard ratio against the first (a Cox model per transition, stratified by study) */
  rows: { cohort: string; hr: number; lo: number; hi: number; p: number }[];
  n: number; events: number;
  /** why it was not fitted */
  noFit?: string;
}
export interface MultistateResult {
  progression: { eventType: string; key: string; values: string[]; probabilityKey?: string; minProbability?: number };
  prevalent: "include" | "exclude"; horizons: number[]; cutoffMonths?: number;
  /** the figures' time axis end: the latest cohort's drawnTo */
  tMax: number;
  /** "first sequencing" when day 0 is a Sequencing event for most patients, else "the timeline's day 0" */
  origin: string;
  cohorts: MultistateCohort[];
  /** reference cohort for the hazard ratios */
  reference: string;
  cox: MultistateCox[];
  excludedStudies?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { multistate: MultistateView }
  interface ViewResultFields {
    multistate: {
      multistate?: MultistateResult;
    };
  }
  interface ViewResultMain { multistate: "multistate" }
}
