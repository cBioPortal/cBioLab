// The overlap view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Overlap (cBioPortal's group-comparison Overlap tab): how the cohorts' patients intersect, as an
 * UpSet plot — every combination of cohorts with how many patients are in exactly those. Counts only.
 */
export interface OverlapView {
  note?: string;
  kind: "overlap"; cohorts?: string[];
}
export interface OverlapResult {
  /** the cohorts, in bit order, with each one's own size in patients and in their samples */
  sets: { name: string; size: number; samples?: number }[];
  /** patients (and their samples) in exactly the named cohorts and no other, largest first */
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
