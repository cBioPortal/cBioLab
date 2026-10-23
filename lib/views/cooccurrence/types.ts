// The cooccurrence view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

export interface CooccurrenceView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "cooccurrence"; genes: string[]; cohorts?: string[] }
/** One gene pair, as a 2x2 among patients profiled for both, plus its inference. */
export interface CooccurRow {
  a: string; b: string;
  both: number; onlyA: number; onlyB: number; neither: number; profiled: number;
  log2Odds: number | null;
  /** two-sided Fisher on the POOLED table */
  p: number;
  /** BH-adjusted across all pairs in this view, using whichever p is primary */
  q: number;
  /** present when more than one study contributed: the site-stratified answer */
  pStratified?: number; oddsRatioMH?: number | null; strata?: number;
  tendency: "co-occurrence" | "mutual exclusivity" | null;
}

declare module "../../types.ts" {
  interface ViewSpecs { cooccurrence: CooccurrenceView }
  interface ViewResultFields {
    cooccurrence: {
      pairs?: CooccurRow[];
    };
  }
  interface ViewResultMain { cooccurrence: "pairs" }
}
