// The enrichment view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Genomic-alteration enrichment (cBioPortal's group-comparison Genomic Alterations tab): every gene's
 * frequency of one alteration type in each cohort, counted in samples over the samples profiled for
 * that gene, with a test per gene and Benjamini–Hochberg across all genes tested. Counts only.
 */
export interface EnrichmentView {
  note?: string;
  kind: "enrichment"; cohorts?: string[];
  /** which alteration (default mutation); "cna" is amplification or deep deletion */
  alteration?: "mutation" | "cna" | "amp" | "homdel" | "sv";
  /** count OncoKB drivers only, or any alteration (default) */
  measure?: "driver" | "any";
  /** genes altered in fewer samples than this, across all cohorts, are not tested (default 5) */
  minAltered?: number;
  /** genes named on the volcano (default 12) */
  label?: number;
}
export interface EnrichmentGene {
  gene: string;
  /** in the study's reference genome, when known */
  cytoband?: string;
  cells: { cohort: string; altered: number; profiled: number; pct: number | null }[];
  /** two cohorts: log2 of the first cohort's altered share over the second's; null when either is zero */
  log2Ratio?: number | null;
  p: number; q: number;
  /** the cohort with the highest altered share */
  enrichedIn: string;
}
export interface EnrichmentResult {
  alteration: string; measure: "driver" | "any"; groups: string[];
  tested: number; untested: number; significant: number; minAltered: number;
  test: string;
  /** the most significant genes (≤300), the rest summarised in `grid` */
  rows: EnrichmentGene[];
  /** two cohorts: every other tested gene binned on the volcano's axes, [x bin, y bin, count] */
  grid?: { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number][] };
  labels: string[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { enrichment: EnrichmentView }
  interface ViewResultFields {
    enrichment: {
      enrichment?: EnrichmentResult;
    };
  }
  interface ViewResultMain { enrichment: "enrichment" }
}
