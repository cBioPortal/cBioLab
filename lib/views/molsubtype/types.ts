// The molsubtype view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve, LogRankK } from "../../types.ts";

/**
 * A published molecular classifier applied per patient as derived subtypes — the endometrial
 * classification (TCGA 2013 / ProMisE / WHO 2020): POLE-ultramutated, else MMR-deficient (MSI-high),
 * else p53-abnormal, else no specific molecular profile, with "not classifiable" where an input is
 * missing. Per cohort: subtype shares, subtype by an attribute, and OS by subtype. Counts only.
 */
export interface MolsubtypeView {
  note?: string;
  kind: "molsubtype"; cohorts?: string[];
  /** the classifier (only "endometrial" so far) */
  classifier?: "endometrial";
  /** the MSI call: a categorical attribute's MSI-high and stable values, or a numeric score's cut-offs (default MSI_TYPE Instable / Stable, else MSI_SCORE ≥ 10 / < 3) */
  msi?: { attribute?: string; high?: string[]; stable?: string[]; threshold?: number; stableBelow?: number };
  /** an abnormal p53: an OncoKB-driver TP53 mutation (default) or any protein-changing TP53 mutation */
  p53?: "driver" | "nonsynonymous";
  /** a patient attribute to cross the subtypes with (e.g. ANCESTRY_LABEL, STAGE_HIGHEST_RECORDED) */
  by?: string;
  /** groups of `by` drawn (largest first; default 8), the rest pooled into a named Other */
  top?: number;
  /** draw OS by subtype (default true) */
  survival?: boolean;
}
export interface MolsubtypeCounts { counts: number[]; classified: number; notClassifiable: number; why: Record<string, number> }
export interface MolsubtypePanel extends MolsubtypeCounts {
  cohort: string; patients: number;
  groups?: (MolsubtypeCounts & { label: string })[];
  /** cohort's classified patients by group: chi-squared over group × subtype */
  byTest?: import("../../stats.ts").ChiSquareTest;
  pooled?: string[];
}
export interface MolsubtypeResult {
  classifier: string; classifierLabel: string;
  /** the subtypes in hierarchy order */
  subtypes: string[];
  msi: string; p53: string; poleHotspots: string[];
  by: string | null;
  panels: MolsubtypePanel[];
  /** classified patients' subtype shares between cohorts (two or more) */
  cohortTest?: import("../../stats.ts").ChiSquareTest;
  /** OS by subtype, per cohort (classified patients with OS_MONTHS) */
  survival?: { cohort: string; curves: (Omit<KmCurve, "cohort"> & { subtype: string })[]; logrank: LogRankK | null; noTest?: string }[];
  noSurvival?: string;
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { molsubtype: MolsubtypeView }
  interface ViewResultFields {
    molsubtype: {
      molsubtype?: MolsubtypeResult;
    };
  }
  interface ViewResultMain { molsubtype: "molsubtype" }
}
