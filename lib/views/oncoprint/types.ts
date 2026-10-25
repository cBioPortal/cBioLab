// The oncoprint view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { SplitBy, DisplaySpec, CohortDef } from "../../types.ts";
import type { GeneTrackSpec } from "../../gene-tracks.ts";

export interface HeatmapSpec {
  profileType: string; genes?: string[];
  /** a generic-assay profile's tracks: its entities (signatures, probes, …), at most 12, in place of genes */
  entities?: string[];
  /**
   * "federation" z-scores the drawn values against a reference distribution
   * pooled from EVERY participating study — including instances that disclose
   * no patients and so contribute no columns. Default "cohort" leaves values
   * as the profile stores them.
   */
  reference?: "cohort" | "federation";
}
/** Pooled reference distribution for one (profileType, gene), from per-site moments. */
export interface ZReference { mean: number; sd: number; n: number; studies: string[] }
/** A sort key: "genomic" (staircase), "id", or a track label; "-label" or {dir:"desc"} descends. */
export type SortKeySpec = string | { track: string; dir?: "asc" | "desc" };
export interface OncoprintView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  /** rows: a gene symbol, or {label?, genes} for one merged row over several genes */
  kind: "oncoprint"; genes: GeneTrackSpec[]; cohorts?: string[]; splitBy?: SplitBy;
  clinical?: string[]; heatmap?: HeatmapSpec[]; sort?: SortKeySpec[]; display?: DisplaySpec;
  /** what a column is (default "patient"); "sample" draws every sample of the cohort's patients */
  unit?: "patient" | "sample";
  /** mRNA / protein evidence drawn into the gene cells (see OncoprintSpec.overlays) */
  overlays?: { kind: "mrna" | "protein"; profileType: string; threshold?: number }[];
  /**
   * Document cohorts drawn as binary rows: a column is filled when that patient is in the
   * cohort. Any cohort definition can be a row, which is what this engine has that the portal
   * does not. Single-study and patient-level, like the definitions themselves.
   */
  derivedCohorts?: string[];
}

export interface OncoprintSpec {
  study?: string; studies?: string[];
  /** rows: a gene symbol, or {label?, genes} for one merged row over several genes */
  genes: GeneTrackSpec[]; clinical?: string[]; heatmap?: HeatmapSpec[]; sort?: SortKeySpec[]; display?: DisplaySpec;
  /** what a column is (default "patient") */
  unit?: "patient" | "sample";
  /**
   * Molecular evidence drawn INTO the gene cells rather than as tracks: mRNA as an outline,
   * protein as thin bars. Values at or beyond ±threshold (default 2, the portal's z-score rule)
   * set the high/low bit. Expression is not an alteration, so it never enters the altered %.
   */
  overlays?: { kind: "mrna" | "protein"; profileType: string; threshold?: number }[];
  derivedEvents?: { label: string; expression: CohortDef }[];
  cohort?: { dsl: CohortDef } | null;
  layout?: { groupBy: { kind: "cohorts"; groups: { name: string; dsl: CohortDef }[] } } | null;
  conventions?: { lineGap?: number };
  /** "<profileType>|<gene>" -> pooled reference, supplied by the analysis layer */
  zReference?: Record<string, ZReference>;
}

declare module "../../types.ts" {
  interface ViewSpecs { oncoprint: OncoprintView }
  interface ViewResultFields {
    oncoprint: {
      /**
       * only for `runAnalysis(doc, {oncoprint:"spec"})`: what to POST to
       * /api/oncoprint to get the figure. Carries cohort DEFINITIONS, never compiled SQL.
       */
      spec?: OncoprintSpec;
      svg?: string; nColumns?: number;
      genes?: { gene: string; driverPct: number | null; anyPct: number | null }[];
    };
  }
  interface ViewResultMain { oncoprint: never }
}
