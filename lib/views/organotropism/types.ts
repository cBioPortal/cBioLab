// The organotropism view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { IncidenceCurve } from "../../types.ts";

/**
 * Metastatic organotropism: for each organ a cohort's patients metastasised to and each gene,
 * whether the gene's alteration goes with metastasis there, stratified by cancer type
 * (Cochran–Mantel–Haenszel); with dated sites on the timeline, the cumulative incidence of
 * metastasis to one site by one gene's status, death competing. Counts only.
 */
export interface OrganotropismView {
  note?: string;
  kind: "organotropism"; cohorts?: string[];
  /** where the sites come from (default auto: per-organ flags, else the timeline, else a biopsy-site attribute) */
  source?: "auto" | "flags" | "timeline" | "sample";
  /** flags: the per-organ Yes/No attributes' prefix (default DMETS_DX_, MSK-MET's) */
  flagPrefix?: string;
  /** timeline: the event type and key whose value names a site (default Diagnosis / TUMOR_SITE) */
  timeline?: { eventType?: string; key?: string };
  /** sample: the biopsy-site attribute of metastasis samples (default METASTATIC_SITE), mapped to organs by our disclosed rules */
  siteAttribute?: string;
  /** only these sites (labels as the result names them); default every site with enough patients */
  sites?: string[];
  /** the genes (at most 20); default the `top` most altered in the cohort */
  genes?: string[];
  /** how many most-altered genes when `genes` is not given (default 12, at most 20) */
  top?: number;
  /** what counts as altered (default mutation) and whether only OncoKB drivers count (default driver) */
  alteration?: "mutation" | "cna" | "amp" | "homdel" | "sv";
  measure?: "any" | "driver";
  /** the stratifying covariate (default CANCER_TYPE); null for none */
  stratifyBy?: string | null;
  /** a cell is tested only with at least this many altered patients and this many with the site (default 5) */
  minPatients?: number;
  /** timeline source: the cumulative-incidence panel's site and gene (default the grid's most significant cell); null for none */
  incidence?: { site?: string; gene?: string } | null;
}
export interface OrganotropismSite { site: string; label: string; evaluable: number; withSite: number }
export interface OrganotropismCell {
  site: string; gene: string;
  /** patients evaluable for the site and profiled for the gene, pooled over strata: with the site (and of them altered), without it (and altered) */
  withSite: number; withAltered: number; without: number; withoutAltered: number;
  /** Mantel–Haenszel common odds ratio over the strata, its log2, CMH chi-squared p and BH q; null when not tested */
  or: number | null; log2Or: number | null; p: number | null; q: number | null; strata: number;
}
export interface OrganotropismIncidence {
  site: string; gene: string;
  curves: IncidenceCurve[];
  horizons: { months: number; cells: { cohort: string; f1: number; lo: number; hi: number; atRisk: number }[] }[];
  gray?: import("../../stats.ts").GrayTest;
  /** patients whose first site event came after their last follow-up (the clock check) */
  late: number; records: number;
}
export interface OrganotropismResult {
  source: "flags" | "timeline" | "sample"; sourceLabel: string;
  alteration: string; measure: "any" | "driver"; stratifyBy: string | null; minPatients: number;
  patients: number;
  sites: OrganotropismSite[];
  genes: { gene: string; altered?: number }[];
  /** every (site, gene) cell, tested or not */
  cells: OrganotropismCell[];
  tested: number; significant: number;
  /** sample source: the biopsy-site values counted as "Other", with their patients */
  otherValues?: { value: string; patients: number }[];
  incidence?: OrganotropismIncidence;
  /** why there is no incidence panel */
  noIncidence?: string;
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { organotropism: OrganotropismView }
  interface ViewResultFields {
    organotropism: {
      organotropism?: OrganotropismResult;
    };
  }
  interface ViewResultMain { organotropism: "organotropism" }
}
