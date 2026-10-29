// The table view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { TableRows } from "../../types.ts";
import type { TableQuery } from "../../table-query.ts";

/**
 * The clinical data table (cBioPortal's Clinical Data tab): one row per sample — or per patient —
 * of each cohort, with every clinical attribute the study records; searchable, filterable,
 * sortable, paged, and downloadable whole as CSV. Its rows are patients, so only a patient-level
 * participant contributes them; the rest are named with how many patients they hold.
 */
export interface TableView extends TableQuery {
  note?: string;
  kind: "table"; cohorts?: string[];
  /** a row per sample (default, with its patient's attributes too) or per patient */
  unit?: "sample" | "patient";
  /** older spelling of `columns`: the attribute columns shown */
  attributes?: string[];
  /** rows per page (default 25, at most 1000); every page and the download are slices of one order */
  rows?: number;
  /** with `unit: "patient"`, a patient to place in the list's order: the result's `position` */
  patient?: { study: string; id: string };
}
export interface TableResult extends TableRows<string> {
  unit: "sample" | "patient";
  /**
   * Where the named patient falls in the list's order (its search, filters and sort), with the
   * patients either side; null when the list leaves it out. Only when the view names a patient.
   */
  position?: { index: number; prev: { study: string; id: string } | null; next: { study: string; id: string } | null } | null;
}

declare module "../../types.ts" {
  interface ViewSpecs { table: TableView }
  interface ViewResultFields {
    table: {
      table?: TableResult;
    };
  }
  interface ViewResultMain { table: "table" }
}
