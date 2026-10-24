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
    };
  }
  interface ViewResultMain { survival: "curves" }
}
