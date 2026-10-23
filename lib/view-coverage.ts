// Whether a view can be drawn over every study its cohorts span. A federated participant answers
// some views only in part — a remote MCP peer serves no patient rows and none of the aggregates in
// lib/federation-views.ts, an aggregate-only instance no patient rows — and a view drawn without
// one study's patients is a picture of a different cohort than the one it names. So such a view
// is not drawn: the engine refuses it (lib/analysis.ts) and the page does not offer it
// (app/lab/use-view-options.ts, use-view-edits.ts), both from this one rule. Browser-safe.

/** How this app reaches one study, as far as drawing views goes. */
export interface StudyAccess {
  /** the instance that answers for it, as the page names it */
  instance: string;
  /** its patients may be listed by any view */
  patientLevel: boolean;
  /** a remote MCP peer (the simulated one included) */
  remote: boolean;
  /** the patient-level kinds of data a remote peer shares with this app (lib/disclosure.ts) */
  shares: string[];
}

/** What a view kind needs of every study it draws; a kind not listed needs only counts. */
type Need = "patients" | "timeline" | "alterations" | "local";
const NEEDS: Record<string, Need> = {
  // their output is patients: columns, rows, or a model fitted on each patient
  oncoprint: "patients", table: "patients", mutations: "patients", cox: "patients", logistic: "patients", riskmodel: "patients",
  // patient views a peer may share by kind
  timeline: "timeline", alterations: "alterations",
  // aggregates every local participant computes and a remote peer does not serve yet
  genome: "local", pathways: "local", enrichment: "local", diffexpr: "local", paired: "local", clonality: "local",
  incidence: "local", labs: "local", cancertypes: "local", overlap: "local", assays: "local", composition: "local",
  correlates: "local", plot: "local", acquired: "local", ctdna: "local"
};

/** What `kind` needs of every study it draws (null: only counts, which every participant gives). */
export const viewNeed = (kind: string): Need | null => NEEDS[kind] ?? null;

const why = (need: Need, a: StudyAccess): string | null => {
  if (need === "local") return a.remote ? "is a remote peer, which does not answer this view yet" : null;
  if (a.patientLevel) return null;
  if (need !== "patients" && a.remote && a.shares.includes(need)) return null;
  if (!a.remote) return "answers with aggregate counts only";
  return need === "patients" ? "is a remote peer, which shares no patient-level data for this view"
    : "is a remote peer, which does not share patient " + (need === "timeline" ? "timelines" : "alterations") + " with this instance";
};

/**
 * Why `kind` cannot be drawn over `studies` without leaving some of their patients out, or null
 * when it can. A study whose access is unknown (`access` returns undefined) is not held against it.
 */
export function cantDraw(kind: string, studies: string[], access: (study: string) => StudyAccess | undefined): string | null {
  const need = NEEDS[kind];
  if (!need) return null;
  const out = studies.flatMap((s) => {
    const a = access(s);
    const w = a && why(need, a);
    return w ? [s + " — " + a.instance + " " + w] : [];
  });
  return out.length ? "Cannot be drawn without leaving out the patients of " + out.join("; ") + "." : null;
}

/** The studies a document's cohort definition spans. */
export function cohortStudies(def: { study?: string; studies?: string[] } | undefined, docStudy: string): string[] {
  return Array.isArray(def?.studies) && def.studies.length ? def.studies : [def?.study || docStudy];
}
