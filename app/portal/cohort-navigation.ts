// What a Patient page stepping through a cohort carries in its link, and the one-view document that
// lists the cohort's patients (app/portal/cohort-nav.tsx draws the pager). The link holds the
// cohort's definition (?cohort=) and the list's order (?order=), never its patients. Pure.
import type { AnalysisDoc, CohortDef, View } from "../../lib/types.ts";
import type { TableQuery } from "../../lib/table-query.ts";
import { decodeParam, encodeParam } from "./page-doc.ts";

export const NAV_COHORT = "Patients";
export type PatientKey = { study: string; id: string };

/** The cohort a Patient page steps through, and the order it steps in, as its link carries them. */
export interface CohortNavigation { def: CohortDef; order: TableQuery }

export function readNavigation(q: URLSearchParams): { nav: CohortNavigation | null; error: string | null } {
  const raw = q.get("cohort");
  if (!raw) return { nav: null, error: null };
  const def = decodeParam<CohortDef>(raw);
  if (!def || typeof def !== "object" || Array.isArray(def)) return { nav: null, error: "this link's cohort cannot be read" };
  const order = decodeParam<TableQuery>(q.get("order")) || {};
  return { nav: { def, order: typeof order === "object" ? order : {} }, error: null };
}

/** The URL parameters that carry a navigation: what every link the page makes keeps. */
export function navigationParams(nav: CohortNavigation | null): Record<string, string> {
  if (!nav) return {};
  const order = { search: nav.order.search, filters: nav.order.filters, sort: nav.order.sort };
  const hasOrder = !!(order.search || order.filters && Object.keys(order.filters).length || order.sort);
  return { cohort: encodeParam(nav.def), ...(hasOrder ? { order: encodeParam(order) } : {}) };
}

/** The Patient page's link for a patient of the cohort. */
export function patientHref(to: PatientKey, nav: CohortNavigation | null, tab?: string | null): string {
  return "/portal/patient?" + new URLSearchParams({ study: to.study, patient: to.id, ...(tab ? { tab } : {}), ...navigationParams(nav) }).toString();
}

const studyOf = (def: CohortDef): string => def.study || def.studies?.[0] || "";

/** The one-view document that lists the cohort's patients in the navigation's order. */
export function listDoc(nav: CohortNavigation, opts: { rows: number; at?: PatientKey | null; columns?: string[] }): AnalysisDoc {
  const { search, filters, sort } = nav.order;
  return {
    study: studyOf(nav.def), cohorts: { [NAV_COHORT]: nav.def },
    views: [{ kind: "table", unit: "patient", cohorts: [NAV_COHORT], rows: opts.rows, ...(opts.columns ? { columns: opts.columns } : {}),
      ...(search ? { search } : {}), ...(filters ? { filters } : {}), ...(sort ? { sort } : {}), ...(opts.at ? { patient: opts.at } : {}) } as unknown as View],
  };
}
