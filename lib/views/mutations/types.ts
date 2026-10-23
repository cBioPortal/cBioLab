// The mutations view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { TableRows } from "../../types.ts";
import type { TableQuery } from "../../table-query.ts";

/**
 * The mutation table (cBioPortal's Mutations tab, under the lollipop): one gene's mutations in each
 * cohort, a row per call with the portal's columns; searchable, filterable, sortable, paged, and
 * downloadable whole. Its rows name samples, so only a patient-level participant contributes them.
 */
export interface MutationsView extends TableQuery {
  note?: string;
  kind: "mutations"; cohorts?: string[];
  gene: string;
  /** rows per page (default 25, at most 1000); every page and the download are slices of one order */
  rows?: number;
}
export interface MutationsResult extends TableRows<string | number | null> {
  gene: string;
  /** the OncoKB version the annotation column reads, or null when none is pinned */
  oncokbPin: string | null;
}

declare module "../../types.ts" {
  interface ViewSpecs { mutations: MutationsView }
  interface ViewResultFields {
    mutations: {
      mutations?: MutationsResult;
    };
  }
  interface ViewResultMain { mutations: "mutations" }
}
