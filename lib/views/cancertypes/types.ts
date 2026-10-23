// The cancertypes view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";
import type { GeneTrackSpec } from "../../gene-tracks.ts";

/**
 * Cancer Types Summary (cBioPortal's results-view tab): for a gene list, the share of the cohort's
 * samples altered in at least one of the genes, per cancer type (or any sample attribute, or per
 * study), split by kind of alteration. Each group's denominator is its samples profiled for at least
 * one of the genes. Counts only.
 */
export interface CancertypesView {
  note?: string;
  kind: "cancertypes"; cohorts?: string[];
  genes: GeneTrackSpec[];
  /** a sample attribute to group by, or "study" (default "CANCER_TYPE") */
  groupBy?: string;
  /** count OncoKB drivers only, or any alteration (default) */
  measure?: "driver" | "any";
  /** groups with fewer profiled samples than this are pooled into one "other" bar (default 10) */
  minSamples?: number;
  /** draw percentages (default) or counts */
  show?: "frequency" | "count";
  /** count patients (default, as the portal does — a patient counts in each group a sample of theirs is in) or samples */
  unit?: "patient" | "sample";
}
export interface CancertypesGroup {
  key: string; label: string;
  /** the group's units (patients or samples), profiled or not */
  samples: number;
  profiled: number; altered: number;
  mutation: number; amp: number; homdel: number; sv: number; multiple: number;
  /** units profiled for each data type at all (any gene) — the portal's "+" rows */
  profiledFor?: { mutation: number; cna: number; sv: number };
}
export interface CancertypesPanel {
  cohort: string; samples: number; profiled: number; altered: number;
  groups: CancertypesGroup[];
  /** groups under the size floor, pooled into one — counted, never dropped */
  pooled?: CancertypesGroup & { count: number };
  /** the same, one gene at a time (the portal's per-gene tabs) */
  perGene?: { gene: string; groups: CancertypesGroup[]; pooled?: CancertypesGroup & { count: number } }[];
}
export interface CancertypesResult {
  groupBy: string; measure: "driver" | "any"; genes: string[]; minSamples: number; show: "frequency" | "count";
  unit: "patient" | "sample";
  panels: CancertypesPanel[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { cancertypes: CancertypesView }
  interface ViewResultFields {
    cancertypes: {
      cancertypes?: CancertypesResult;
    };
  }
  interface ViewResultMain { cancertypes: "cancertypes" }
}
