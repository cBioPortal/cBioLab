// The clinical view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { SplitBy } from "../../types.ts";

export interface ClinicalView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "clinical"; attributes: string[]; cohorts?: string[]; splitBy?: SplitBy }
/** One clinical attribute compared across cohorts. */
export interface ClinicalCell {
  cohort: string; n: number;
  /** categorical: the most common values */
  top?: { v: string; n: number }[];
  /** numeric: computed from additive moments, never from transmitted values */
  mean?: number | null; sd?: number; min?: number | null; max?: number | null;
  /**
   * numeric, single-study views only: exact median/quartiles from the cohort's complete value
   * histogram. Absent (not approximated) when the view spans more than one study, or when the
   * attribute had more distinct values than the histogram cap allows.
   */
  median?: number | null; q1?: number | null; q3?: number | null;
  /** true when the attribute had more distinct values than the histogram cap allows, so median/
   *  IQR (and the rank test, if this cell is one of exactly 2) were refused rather than computed
   *  from a partial distribution — stated, not silently absent */
  histogramTruncated?: boolean;
}
export interface ClinicalRow {
  attribute: string; per: "patient" | "sample"; kind: "cat" | "num";
  cells: ClinicalCell[];
  test?: string; statistic?: number; df?: number; p?: number; q?: number;
  /** Welch's ANOVA (3+ numeric cohorts) only: the denominator degrees of freedom — `df` above
   *  holds df1 (groups − 1), an F-test's other, non-integer, Welch-Satterthwaite-style df */
  df2?: number;
  /**
   * numeric, single-study: a rank-based test alongside the moment-based one (never in place of
   * it) — Mann-Whitney U for exactly 2 cohorts, Kruskal-Wallis for 3+ — a check worth having when
   * the attribute is skewed or has outliers the mean can mislead on. Deliberately not itself part
   * of the q-value correction above, which stays Welch's t/ANOVA only.
   */
  rankStatistic?: number; rankP?: number;
  /** categorical only: vocabulary size, and the smallest expected cell */
  distinct?: number; minExpected?: number;
  /** why this attribute was not tested — stated, never silently omitted */
  skipped?: string;
}

declare module "../../types.ts" {
  interface ViewSpecs { clinical: ClinicalView }
  interface ViewResultFields {
    clinical: {
      clinical?: ClinicalRow[];
    };
  }
  interface ViewResultMain { clinical: "clinical" }
}
