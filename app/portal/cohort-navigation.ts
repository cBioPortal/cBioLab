// What a Patient page stepping through a cohort carries in its link, and the one-view document that
// lists the cohort's patients (app/portal/cohort-nav.tsx draws the pager). The link holds the
// cohort's definition (?cohort=, or a stored link holding it: ?s=, app/_links) and the list's order
// (?order=), never its patients. Pure.
import type { AnalysisDoc, CohortDef, View } from "../../lib/types.ts";
import type { TableQuery } from "../../lib/table-query.ts";
import { decodeParam, encodeParam } from "./page-doc.ts";
import { writeFilters } from "../../lib/study-view-url.ts";

export const NAV_COHORT = "Patients";
const studyOf = (def: CohortDef): string => def.study || def.studies?.[0] || "";
export type PatientKey = { study: string; id: string };

/**
 * The cohort a Patient page steps through, and the order it steps in, as its link carries them.
 * `link` is a stored link holding exactly the cohort, which the page's own links carry (?s=)
 * instead of a ?cohort= too long for the address bar.
 */
export interface CohortNavigation { def: CohortDef; order: TableQuery; link?: string }

/**
 * The navigation a page's parameters carry (`q`, a stored link's put back). `link` is the stored
 * link the address bar names, if any: kept when it holds this cohort and nothing else.
 */
export function readNavigation(q: URLSearchParams, link?: { id: string; params: Record<string, string> } | null): { nav: CohortNavigation | null; error: string | null } {
  const raw = q.get("cohort");
  if (!raw) return { nav: null, error: null };
  const def = decodeParam<CohortDef>(raw);
  if (!def || typeof def !== "object" || Array.isArray(def)) return { nav: null, error: "this link's cohort cannot be read" };
  const order = decodeParam<TableQuery>(q.get("order")) || {};
  const holdsCohort = !!link && link.params.cohort === raw && Object.keys(link.params).every((k) => k === "cohort");
  return { nav: { def, order: typeof order === "object" ? order : {}, ...(holdsCohort ? { link: link!.id } : {}) }, error: null };
}

/**
 * A cbioportal.org link's cohort: the hash `#navCaseIds=<study>:<patient>,…` its study view and
 * results pages hand the patient page (PAT-URL-4), as a cohort of those patients. An id without its
 * study is refused: the portal itself cannot read one (parseCohortIds, PAT-URL-6). The patients are
 * stepped through in the cohort list's order, not the link's.
 */
export function navigationFromHash(hash: string): { nav: CohortNavigation | null; error: string | null } {
  // an unreadable list leaves the page showing its patient, without the pager, and says why (`error`)
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("navCaseIds");
  if (!raw) return { nav: null, error: null };
  const ids = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const bad = ids.filter((x) => !/^[^:\s]+:[^:\s]+$/.test(x));
  if (!ids.length || bad.length) return { nav: null, error: "this link's patients (#navCaseIds) must each be study:patient; " + (bad.length ? "not " + bad.slice(0, 3).join(", ") : "it names none") };
  const studies = [...new Set(ids.map((x) => x.split(":")[0]))];
  const def: CohortDef = { ...(studies.length === 1 ? { study: studies[0] } : { studies }), all: [{ kind: "patientList", ids }] };
  return { nav: { def, order: {} }, error: null };
}

/**
 * The navigation without one of its patients (the portal's ⊖, PAT-NAV-4): the cohort's definition,
 * excluding that patient — added to the exclusion the cohort already ends with, so excluding one
 * patient after another stays one clause.
 */
export function excludePatient(nav: CohortNavigation, at: PatientKey): CohortNavigation {
  const id = at.study + ":" + at.id, all = [...(nav.def.all || [])];
  const last = all[all.length - 1] as { not?: { kind?: string; ids?: string[]; set?: string } } | undefined;
  if (last?.not?.kind === "patientList" && Array.isArray(last.not.ids) && !last.not.set) all[all.length - 1] = { not: { kind: "patientList", ids: [...last.not.ids.filter((x) => x !== id), id] } };
  else all.push({ not: { kind: "patientList", ids: [id] } });
  return { def: { ...nav.def, all }, order: nav.order };
}

/** the parts of a cohort's definition the Study View's filters carry: its studies and its clauses */
const STUDY_VIEW_KEYS = new Set(["study", "studies", "all"]);

/**
 * The Study View over the navigation's cohort (the portal's "N patients", PAT-NAV-3): the parameters
 * of /lab's Explore, its studies filtered by the cohort's clauses — or, for a cohort defined by more
 * than clauses (an event, a gap), why it cannot be shown there, never a larger cohort silently.
 */
export function studyViewParams(nav: CohortNavigation): { params: Record<string, string> } | { refused: string } {
  const extra = Object.keys(nav.def).filter((k) => !STUDY_VIEW_KEYS.has(k) && (nav.def as Record<string, unknown>)[k] != null);
  if (extra.length) return { refused: "the Study View filters by clauses only; this cohort is also defined by " + extra.join(", ") };
  const studies = nav.def.studies?.length ? nav.def.studies : [studyOf(nav.def)];
  const filters = writeFilters(nav.def.all);
  return { params: { tab: "explore", study: studies.join(","), ...(filters ? { filters } : {}) } };
}

/** The URL parameters that carry a navigation: what every link the page makes keeps. */
export function navigationParams(nav: CohortNavigation | null): Record<string, string> {
  if (!nav) return {};
  const order = { search: nav.order.search, filters: nav.order.filters, sort: nav.order.sort };
  const hasOrder = !!(order.search || order.filters && Object.keys(order.filters).length || order.sort);
  return { ...(nav.link ? { s: nav.link } : { cohort: encodeParam(nav.def) }), ...(hasOrder ? { order: encodeParam(order) } : {}) };
}

/** The Patient page's link for a patient of the cohort. */
export function patientHref(to: PatientKey, nav: CohortNavigation | null, tab?: string | null): string {
  return "/portal/patient?" + new URLSearchParams({ study: to.study, patient: to.id, ...(tab ? { tab } : {}), ...navigationParams(nav) }).toString();
}

/** A sample's own page (the Patient page's sample view), as the portal's tables link a sample id: no cohort to step through. */
export function sampleHref(study: string, sample: string): string {
  return "/portal/patient?" + new URLSearchParams({ study, sample }).toString();
}


/** The one-view document that lists the cohort's patients in the navigation's order. */
export function listDoc(nav: CohortNavigation, opts: { rows: number; at?: PatientKey | null; columns?: string[] }): AnalysisDoc {
  const { search, filters, sort } = nav.order;
  return {
    study: studyOf(nav.def), cohorts: { [NAV_COHORT]: nav.def },
    views: [{ kind: "table", unit: "patient", cohorts: [NAV_COHORT], rows: opts.rows, ...(opts.columns ? { columns: opts.columns } : {}),
      ...(search ? { search } : {}), ...(filters ? { filters } : {}), ...(sort ? { sort } : {}), ...(opts.at ? { patient: opts.at } : {}) } as unknown as View],
  };
}
