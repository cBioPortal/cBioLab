// The sv view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { TableRows } from "../../types.ts";
import type { TableQuery } from "../../table-query.ts";

/**
 * The structural-variant table (cBioPortal's Results View "Structural Variants" tab): every
 * structural variant in each cohort's samples with one of `genes` as either partner, a row per
 * call with the portal's columns; searchable, filterable, sortable, paged, and downloadable whole.
 * Its rows name samples, so only a patient-level participant contributes them.
 */
export interface SvView extends TableQuery {
  note?: string;
  kind: "sv"; cohorts?: string[];
  /** the genes: a call is listed when gene 1 or gene 2 is one of them */
  genes: string[];
  /** rows per page (default 25, at most 1000); every page and the download are slices of one order */
  rows?: number;
}

/** Per gene and study: how many of the cohort's samples were profiled for its structural variants, and how many carry one. */
export interface SvProfiled {
  cohort: string; study: string; gene: string;
  samples: number; profiled: number; altered: number;
  /** of `altered`, those whose panel lists the gene (the rest had the call reported through its partner) */
  alteredProfiled: number;
}

export interface SvResult extends TableRows<string | number | null> {
  genes: string[];
  /** the OncoKB version the annotation column reads, or null when none is pinned */
  oncokbPin: string | null;
  /** the panel-aware counts behind the caveat; absent on a page or a column's values */
  profiled?: SvProfiled[];
}

declare module "../../types.ts" {
  interface ViewSpecs { sv: SvView }
  interface ViewResultFields {
    sv: {
      sv?: SvResult;
    };
  }
  interface ViewResultMain { sv: "sv" }
}
