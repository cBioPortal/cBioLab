// The composition view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Composition: what each case is made of — cell types, cell states, signature contributions — as
 * parts of a whole, compared between cohorts (the stacked-bar panels of single-cell studies). The
 * parts are every entity of one generic-assay profile, or a list of numeric clinical attributes
 * (custom: uploads included). Each cohort's mean composition and every (cohort, part) enrichment
 * against the view's other cohorts come from sums computed in the database; the per-case bars are
 * drawn only where a participant may show cases.
 */
export interface CompositionView {
  note?: string;
  kind: "composition"; cohorts?: string[];
  /** a generic-assay profile whose entities are the parts (e.g. cell_type_relative_counts) */
  profileType?: string;
  /** with profileType: only these of its entities, in this order */
  entities?: string[];
  /** numeric clinical attributes that are the parts, in this order (2–16); custom: names allowed */
  attributes?: string[];
  /** attributes only: one bar per patient (default) or per sample */
  unit?: "patient" | "sample";
  /** divide each case's parts by their sum, so every bar is a whole (default true) */
  normalize?: boolean;
  /** the part cases are ordered by, highest first (default the first part) */
  sort?: string;
}
export interface CompositionPart {
  /** the entity or attribute it reads */
  id: string;
  /** how the figure names it: the entity's name, or the attribute with the parts' shared prefix taken off */
  name: string;
}
export interface CompositionCell {
  cohort: string; part: string;
  n: number; mean: number; sd: number | null;
  /** this cohort against the view's other cohorts pooled: log2 of the ratio of means (each + 0.001) */
  log2?: number;
  /** Welch's t on the same split, and Benjamini–Hochberg across every (cohort, part) tested */
  p?: number; q?: number;
}
export interface CompositionResult {
  source: "genericAssay" | "clinical";
  /** the profile, or "clinical attributes" */
  sourceName: string;
  unit: "samples" | "patients";
  normalize: boolean;
  parts: CompositionPart[];
  sort: string;
  /** per cohort: cases with every part, cases left out (some part missing, or a part below zero, or all zero) */
  groups: { cohort: string; n: number; incomplete: number; invalid: number;
    /** Shannon entropy (natural log) of the normalised parts, mean and SD over the cohort's cases */
    entropy: { mean: number; sd: number | null } | null;
    /** the cases' own compositions, sorted by `sort`, highest first; absent when they may not be shown */
    cases?: number[][];
    /** why `cases` is absent */
    casesWhy?: string;
  }[];
  cells: CompositionCell[];
  tested: number; significant: number;
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { composition: CompositionView }
  interface ViewResultFields {
    composition: {
      composition?: CompositionResult;
    };
  }
  interface ViewResultMain { composition: "composition" }
}
