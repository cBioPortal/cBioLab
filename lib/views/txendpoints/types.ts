// The txendpoints view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve, LogRankK } from "../../types.ts";

export interface TxendpointsView {
  note?: string;
  kind: "txendpoints"; cohorts?: string[];
  /** the clock's start: a treatment record (event type, key = value), its first occurrence unless LAST */
  anchor: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** ttnt time to next treatment (default), tot time on treatment, rwpfs real-world progression-free survival */
  endpoint?: "ttnt" | "tot" | "rwpfs";
  /** treatment lines (lib/treatment-lines.ts): days without therapy that start a new line (default 90), and which records form lines */
  lineGap?: number; lineClasses?: "systemic" | "all" | string[];
  /** rwpfs: the progression event (default event type Diagnosis, key PROGRESSION, values Y / Yes), and an optional probability floor */
  progression?: { eventType?: string; key?: string; values?: string[]; probabilityKey?: string; minProbability?: number };
  /** tot: a living patient whose stop lies within this many days of the last follow-up is censored as still on treatment (default 30) */
  ongoingDays?: number;
  /** administrative censoring, months */
  cutoffMonths?: number;
}
export interface TxendpointsCurve extends Omit<KmCurve, "cohort"> {
  cohort: string;
  /** the median's 95% interval (Greenwood, log scale), null where the band never reaches 0.5 */
  medianLo: number | null; medianHi: number | null;
  /** the cohort's patients, those anchored, and those left out with why */
  cohortPatients: number; anchored: number;
  excluded: { noAnchor: number; noFollowup: number; noStop: number };
  /** patients whose timeline runs past their last follow-up (the clock check) */
  late: number;
}
export interface TxendpointsResult {
  endpoint: "ttnt" | "tot" | "rwpfs"; endpointLabel: string; anchoredTo: string;
  lineGap: number; lineClasses: string;
  progression?: { eventType: string; key: string; values: string[]; probabilityKey?: string; minProbability?: number };
  ongoingDays?: number; cutoffMonths?: number;
  curves: TxendpointsCurve[];
  /** k-group log-rank over the cohorts, stratified by study where several answer */
  logrank: LogRankK | null;
  /** why there is no test */
  noTest?: string;
  excludedStudies?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { txendpoints: TxendpointsView }
  interface ViewResultFields {
    txendpoints: {
      txendpoints?: TxendpointsResult;
    };
  }
  interface ViewResultMain { txendpoints: "txendpoints" }
}
