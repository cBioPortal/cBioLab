// The alterations view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { TableRows, PatientSample, TimelineResult } from "../../types.ts";
import type { TableQuery } from "../../table-query.ts";

/** One of the alterations view's tables as the spec holds it: its query, and its page size. */
export interface AlterationTableQuery extends TableQuery {
  /** rows per page (default 25, at most 1000) */
  rows?: number;
}
/**
 * One patient's genomic alterations as cBioPortal's patient view lists them — three tables in one
 * view: Mutations, Copy Number Alterations and Structural Variants — with the list of the cohort's
 * patients to choose them from. The list and each table is a table view (lib/table-query.ts: paged,
 * searched, filtered, sorted, downloadable), with its own query. All of them name a patient, so only
 * a patient-level participant contributes.
 */
export interface AlterationsView extends TableQuery {
  note?: string;
  kind: "alterations"; cohorts?: string[];
  /** the patient whose alterations are listed; with none, the list's first row */
  patient?: { study: string; id: string };
  /** patients per page of the list (default 25, at most 1000) */
  rows?: number;
  /** each table's own query (the top-level columns/search/filters/sort are the patient list's) */
  mutations?: AlterationTableQuery;
  cna?: AlterationTableQuery;
  sv?: AlterationTableQuery;
}
export interface AlterationsResult extends TableRows<string | number | null> {
  /** the patient listed, with their samples (none on a page request), or null when the list is empty */
  patient: { study: string; id: string; samples: PatientSample[]; source?: { label: string; remote: boolean } } | null;
  /** where that patient falls in the list's order, and the patients either side (as the timeline's) */
  position?: TimelineResult["position"];
  /** the patient's three tables; on a page or values request, only the one asked for */
  tables: Partial<Record<"mutations" | "cna" | "sv", TableRows<string | number | null>>>;
  /** the OncoKB version the annotation columns read, or null when none is pinned */
  oncokbPin: string | null;
}

declare module "../../types.ts" {
  interface ViewSpecs { alterations: AlterationsView }
  interface ViewResultFields {
    alterations: {
      alterations?: AlterationsResult;
    };
  }
  interface ViewResultMain { alterations: "alterations" }
}
