// The drivernegative view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Driver-negative analysis: one cohort split into patients with an OncoKB driver in a canonical
 * driver list, patients with none who were profiled for every listed gene, and those not fully
 * profiled (neither); then every other gene's alteration frequency compared between the first two.
 * Counts only.
 */
export interface DrivernegativeView {
  note?: string;
  kind: "drivernegative"; cohorts?: string[];
  /** the canonical drivers (default the NSCLC set: EGFR, KRAS, ALK, ROS1, BRAF, MET, RET, ERBB2, NTRK1–3) */
  drivers?: string[];
  /** what is compared between the groups (default mutation; sv counts either fusion partner) */
  alteration?: "mutation" | "sv" | "cna";
  /** count every alteration (default), or only OncoKB drivers */
  measure?: "any" | "driver";
  /** genes altered in fewer patients than this, both groups together, are not tested (default 5) */
  minAltered?: number;
  /** genes named on the volcano (default 12) */
  label?: number;
}
export interface DrivernegativeGene {
  gene: string; cytoband?: string;
  /** [driver-negative, driver-positive] patients altered, and profiled for the gene */
  altered: [number, number]; profiled: [number, number];
  log2Ratio: number | null; p: number; q: number;
}
export interface DrivernegativeResult {
  drivers: string[]; alteration: string; measure: "any" | "driver"; minAltered: number;
  /** the cohort's patients, those sequenced for mutations, and the three groups of those */
  patients: number; sequenced: number; positive: number; negative: number; unprofiled: number;
  tested: number; untested: number; significant: number;
  /** the most significant genes (≤300) */
  rows: DrivernegativeGene[];
  labels: string[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { drivernegative: DrivernegativeView }
  interface ViewResultFields {
    drivernegative: {
      drivernegative?: DrivernegativeResult;
    };
  }
  interface ViewResultMain { drivernegative: "drivernegative" }
}
