// The overlap view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Overlap (cBioPortal's group-comparison Overlap tab): how the cohorts' samples and patients intersect —
 * every combination of cohorts with how many patients, and how many samples, are in exactly those.
 * A patient is in a cohort when any of its samples is. Counts only.
 */
export interface OverlapView {
  note?: string;
  kind: "overlap"; cohorts?: string[];
}
export interface OverlapResult {
  /** the cohorts, in bit order, with each one's own size in patients and in samples */
  sets: { name: string; size: number; samples?: number }[];
  /** patients (n) and samples in exactly the named cohorts and no other, largest first by patients;
   *  each unit's own pattern, so a combination can hold samples and no patients, or the reverse */
  intersections: { members: string[]; n: number; samples?: number }[];
  /** patients in at least one cohort */
  union: number;
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { overlap: OverlapView }
  interface ViewResultFields {
    overlap: {
      overlap?: OverlapResult;
    };
  }
  interface ViewResultMain { overlap: "overlap" }
}
