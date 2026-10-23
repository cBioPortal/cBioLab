// The pathways view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Oncogenic signalling pathways: for each pathway (the ten of Sanchez-Vega et al. 2018, and/or
 * the document's own gene sets), the share of each cohort with at least one member altered —
 * over the union of the members' panels, the oncoprint's merged-row rule — and its most-altered
 * member genes, each with its own panel-aware denominator. Counts only.
 */
export interface PathwaysView {
  note?: string;
  kind: "pathways"; cohorts?: string[];
  /** which of the ten canonical pathways to draw (default: all ten) */
  pathways?: string[];
  /** the document's own gene sets, drawn after the canonical ones: ≤4 sets of ≤40 genes */
  sets?: { name: string; genes: string[] }[];
  /** count OncoKB drivers only (default, as the paper curated oncogenic events) or any alteration */
  measure?: "driver" | "any";
  /** member genes drawn per pathway, the rest pooled and counted (default 6, max 12) */
  topGenes?: number;
}
export interface PathwayCell { cohort: string; profiled: number; altered: number; pct: number | null }
export interface PathwayRow {
  name: string; source: "Sanchez-Vega 2018" | "document";
  /** member genes, and how many were profiled in at least one cohort */
  genes: number; profiledGenes: number;
  cells: PathwayCell[];
  /** two cohorts: two-sided Fisher p, and BH q across the pathways drawn */
  p?: number; q?: number;
  top: { gene: string; role: "OG" | "TSG" | null; cells: PathwayCell[]; q?: number }[];
  /** member genes altered somewhere but not among `top` — pooled, never dropped */
  otherAltered: number;
  /** member genes no cohort was profiled for */
  notProfiled: string[];
}
export interface PathwaysResult {
  measure: "driver" | "any"; rows: PathwayRow[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { pathways: PathwaysView }
  interface ViewResultFields {
    pathways: {
      pathways?: PathwaysResult;
    };
  }
  interface ViewResultMain { pathways: "pathways" }
}
