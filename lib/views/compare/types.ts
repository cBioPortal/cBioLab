// The compare view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { SplitBy } from "../../types.ts";

export interface CompareView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "compare"; genes: string[]; cohorts?: string[]; splitBy?: SplitBy;
}
export interface CompareCell {
  cohort: string; profiled: number; any: number; driver: number;
  anyPct: number | null; driverPct: number | null;
  /**
   * profiled/altered split by alteration type (mutation/cna/structuralVariant) — lets a reader
   * (or the UI) tell "0% altered, fully assayed" apart from "0% altered because this whole type
   * was never assayed for this cohort's study". `any`/`anyPct` above combine all three, matching
   * the oncoprint's "any alteration" convention, and can look like a real negative result even
   * when a whole type contributed zero because it was never checked.
   */
  byType: { mutation: { profiled: number; altered: number }; cna: { profiled: number; altered: number };
    structuralVariant: { profiled: number; altered: number } };
}
export interface CompareRow {
  gene: string; cells: CompareCell[]; pAny?: number; pDriver?: number;
  /** Benjamini–Hochberg across the genes tested in this view, computed separately for
   *  each of pAny/pDriver — only present once 2+ cohorts produce a p-value to correct. */
  qAny?: number; qDriver?: number;
}

declare module "../../types.ts" {
  interface ViewSpecs { compare: CompareView }
  interface ViewResultFields {
    compare: {
      rows?: CompareRow[];
    };
  }
  interface ViewResultMain { compare: "rows" }
}
