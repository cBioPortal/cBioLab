// The survival view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve, LogRank, LogRankK } from "../../types.ts";
import type { SplitBy } from "../../types.ts";

export interface SurvivalView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "survival"; cohorts?: string[]; splitBy?: SplitBy;
  /** endpoint prefix: OS (default), PFS, DFS, DSS… reads <X>_MONTHS/<X>_STATUS */
  endpoint?: string;
  /**
   * Override the <endpoint>_MONTHS/<endpoint>_STATUS naming convention with the exact clinical
   * attribute names, for a study whose outcome columns don't follow it (some do not — e.g.
   * PFS_MONTHS_FIRST_LINE_TX/PROGRESSION_STATUS). Both must be given together; `endpoint`, if
   * also given, is then just a display label, not something column names are derived from.
   */
  monthsAttribute?: string; statusAttribute?: string;
  /**
   * Re-anchor the clock to a timeline event instead of the study's day 0.
   * Delayed entry is applied automatically — without it, anchoring earlier than
   * day 0 manufactures immortal time.
   */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** administratively censor everyone still at risk past this month; truncates the plot too */
  cutoffMonths?: number;
  /** x-axis tick spacing in months (default: 12, or 24 past 60mo of plotted range) */
  tickMonths?: number;
  /** draw 1 - S(t), cumulative incidence, instead of survival (default "survival") */
  display?: "survival" | "incidence";
  /**
   * when the cohorts share a patient (so the patient is in two curves), give no log-rank test
   * rather than one whose groups are not independent; the curves still draw. The Comparison page
   * sets it, for its Include mode. Unset, the test is given and the caveat says how many are shared.
   */
  noTestWhenShared?: boolean;
  /**
   * the survival-type table, as cBioPortal's Comparison page has it: every endpoint the studies
   * declare (an <X>_MONTHS / <X>_STATUS pair), each with its patients, log-rank p and BH q, so the
   * reader can pick the one drawn (`endpoint`)
   */
  types?: boolean;
}

/** One endpoint in the survival-type table. */
export interface SurvivalType {
  endpoint: string;
  /** the <X>_STATUS attribute's display name without "status" and "survival", as the portal titles it */
  title: string;
  /** the portal's order: OS 400, DFS 300, PFS and DSS 250, others their _STATUS attribute's priority */
  priority: number;
  /** patients in the curves, over every cohort */
  patients: number;
  groups: { cohort: string; n: number; events: number; median: number | null }[];
  /** the log-rank p, by the same rules as the drawn curves' (absent with `why`) and its BH q over the types tested */
  p?: number; q?: number; why?: string;
}

declare module "../../types.ts" {
  interface ViewSpecs { survival: SurvivalView }
  interface ViewResultFields {
    survival: {
      curves?: KmCurve[];
      /** which endpoint was used */
      endpoint?: string;
      /** the event the clock was reset to */
      anchoredTo?: string;
      /** delayed entry was applied */
      truncated?: boolean;
      /** how long after the anchor patients became observable */
      entryMonths?: { median: number; p90: number; max: number };
      /** administrative censoring applied, echoed for the renderers */
      cutoffMonths?: number;
      /** requested x-axis tick spacing, echoed for the renderers */
      tickMonths?: number;
      /** which curve was drawn */
      display?: "survival" | "incidence";
      logrank?: LogRank; logrankPooled?: LogRank;
      /** 3+ cohorts: the k-group generalization (tests whether the groups differ AT ALL) */
      logrankK?: LogRankK; logrankKPooled?: LogRankK;
      /** patients in more than one cohort, so in more than one curve */
      sharedPatients?: number;
      /** no log-rank test was given because of them (the view's noTestWhenShared) */
      testWithheld?: boolean;
      /** the survival-type table (the view's `types`) */
      types?: SurvivalType[];
    };
  }
  interface ViewResultMain { survival: "curves" }
}
