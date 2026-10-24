// The incidence view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { IncidenceCurve } from "../../types.ts";

/**
 * Cumulative incidence of a timeline event with death as a competing risk (Aalen–Johansen, with
 * the survival view's left truncation), Gray's test between cohorts, and — beside it — what
 * 1 − Kaplan–Meier would have claimed, which treats the dead as still at risk and so overstates
 * incidence whenever death is common. Counts only: (entry, time, cause) tallies per site.
 */
export interface IncidenceView {
  note?: string;
  kind: "incidence"; cohorts?: string[];
  /** the event of interest: its first occurrence after the anchor */
  event: { eventType: string; attrs?: { key: string; value: string }[]; label?: string };
  /** the clock's start (default: the study's day 0), as in the survival view */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** months at which incidence is read off and compared (default [12, 24, 60]) */
  horizons?: number[];
}
export interface IncidenceResult {
  eventLabel: string; anchoredTo?: string;
  curves: IncidenceCurve[];
  horizons: { months: number; cells: { cohort: string; f1: number; lo: number; hi: number; naive: number; atRisk: number }[] }[];
  gray?: import("../../stats.ts").GrayTest;
  excludedStudies?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { incidence: IncidenceView }
  interface ViewResultFields {
    incidence: {
      incidence?: IncidenceResult;
    };
  }
  interface ViewResultMain { incidence: "incidence" }
}
