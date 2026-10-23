// The assays view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Generic-assay comparison (cBioPortal's group-comparison tabs for mutational signatures, arm-level
 * copy number, treatment response and every other generic assay): every entity of one generic-assay
 * profile compared between cohorts. Numeric profiles by Welch's t (two cohorts) or Welch's ANOVA;
 * categorical ones by chi-squared on values × cohorts; Benjamini–Hochberg across the entities.
 * Counts and moments only.
 */
export interface AssaysView {
  note?: string;
  kind: "assays"; cohorts?: string[];
  /** the generic-assay profile, as the genericAssay clause names it (e.g. mutational_signatures_contribution_v2) */
  profileType: string;
  /** an entity with fewer measured samples than this in any cohort is not tested (default 3) */
  minN?: number;
  /** entities named on the volcano (default 12) */
  label?: number;
}
export interface AssaysEntity {
  entity: string; name: string;
  /** numeric: n, mean and SD per cohort; categorical: n and the count of each value */
  cells: { cohort: string; n: number; mean?: number | null; sd?: number | null; values?: Record<string, number> }[];
  /** numeric, two cohorts: first cohort's mean minus the second's */
  diff?: number;
  statistic: number; p: number; q: number;
  /** numeric: the cohort with the highest mean; categorical: the cohort and value most over-represented */
  higherIn: string;
  value?: string;
}
export interface AssaysResult {
  profileType: string; profileName: string; assayType: string;
  datatype: "numeric" | "categorical";
  /** what one value describes */
  unit: "samples" | "patients";
  groups: string[];
  tested: number; untested: number; significant: number; minN: number;
  test: string;
  /** categorical: every value seen, in order of frequency; missing ones (NA, blank) are counted apart */
  values?: string[];
  /** values left out: non-numeric entries of a numeric profile (a limit like ">8", NA), or NA/blank in a categorical one */
  missing: number;
  /** the most significant entities (≤300), the rest summarised in `grid` */
  rows: AssaysEntity[];
  grid?: { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number][] };
  labels: string[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { assays: AssaysView }
  interface ViewResultFields {
    assays: {
      assays?: AssaysResult;
    };
  }
  interface ViewResultMain { assays: "assays" }
}
