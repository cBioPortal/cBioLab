// The Explore page's Clinical Data tab, as cBioPortal's study view draws it: the clinical `table`
// view over the selection, a column per visible clinical-attribute chart. The rules, case by case:
// docs/legacy-spec/parity/clinical-tab-cases.md (CT). Browser-safe; no I/O.
import type { AnalysisDoc, CohortDef } from "./types.ts";
import type { TableQuery } from "./table-query.ts";
import type { TableView } from "./views/table/types.ts";
import { DOC_VERSION } from "./doc-version.ts";
import { CASE_FILE_COHORT } from "./study-view-case-files.ts";

/** a visible clinical-attribute chart: its attribute id, display name and priority */
export interface TabChart { attribute: string; name: string; priority: number }

/** rows a page holds */
export const CLINICAL_TAB_ROWS = 20;

/** the table's columns: Patient ID, Sample ID, then each chart's attribute by priority (highest first), then name */
export function clinicalTabColumns(charts: TabChart[]): string[] {
  const sorted = [...charts].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  return ["patient", "sample", ...sorted.map((c) => c.attribute)];
}

/**
 * The document whose one view is the tab's table: the clinical `table` view, a row per sample of
 * the selection (`def`, in `study`'s document), `columns` shown, 20 rows a page, and the reader's
 * search and sort (`query`).
 */
export function clinicalTabDoc(def: CohortDef, study: string, columns: string[], query: TableQuery): AnalysisDoc {
  const view: TableView = { kind: "table", cohorts: [CASE_FILE_COHORT], unit: "sample", rows: CLINICAL_TAB_ROWS, columns,
    ...(query.search ? { search: query.search } : {}), ...(query.sort ? { sort: query.sort } : {}) };
  return { dsl: DOC_VERSION, study, cohorts: { [CASE_FILE_COHORT]: def }, views: [view] };
}

/** how a cell draws its value: a grey "—" when empty, a link when it is a web address, else the text */
export function clinicalCell(value: string): "missing" | "url" | "text" {
  return value === "" ? "missing" : /^https?:\/\//.test(value) ? "url" : "text";
}
