// The rmst view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve } from "../../types.ts";

export interface RmstView {
  note?: string;
  kind: "rmst"; cohorts?: string[];
  /** the endpoint (default OS), its <endpoint>_MONTHS/_STATUS columns or monthsAttribute/statusAttribute */
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** start the clock at a treatment record instead of day 0 (overall survival from it; txendpoints' anchor and clock check) */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** the restriction time, months; default the largest time at which every cohort still has 10 at risk */
  tau?: number;
  /** landmarks, months: each keeps the patients still followed then and restarts the clock there (default [0]) */
  landmarkMonths?: number[];
}
export interface RmstCurve extends Omit<KmCurve, "cohort"> {
  cohort: string;
  /** restricted mean survival time to tau, its standard error and 95% interval, months */
  rmst: number; se: number; lo: number; hi: number;
  /** the number at risk just before tau */
  atRiskTau: number;
  /** patients dropped at the landmark: died or censored before it */
  beforeLandmark: number;
}
export interface RmstComparison {
  cohort: string; vs: string;
  /** RMST difference (cohort − vs) and ratio (cohort / vs), each with a 95% interval and a two-sided p */
  diff: number; diffLo: number; diffHi: number; diffP: number;
  ratio: number; ratioLo: number; ratioHi: number; ratioP: number;
}
export interface RmstPanel {
  landmark: number; tau: number;
  /** whether tau was set in the view or is the default (every cohort ≥ 10 at risk) */
  tauSet: boolean;
  curves: RmstCurve[];
  comparisons: RmstComparison[];
}
export interface RmstResult {
  endpointLabel: string; anchoredTo?: string;
  panels: RmstPanel[];
  /** per cohort: its patients, and those without follow-up (or without the anchor) */
  cohorts: { cohort: string; cohortPatients: number; n: number; noFollowup: number; noAnchor: number }[];
  excludedStudies?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { rmst: RmstView }
  interface ViewResultFields {
    rmst: {
      rmst?: RmstResult;
    };
  }
  interface ViewResultMain { rmst: "rmst" }
}
