// The timeline view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { TimelineResult } from "../../types.ts";
import type { TableQuery } from "../../table-query.ts";

/**
 * One patient's clinical timeline (cBioPortal's patient-view Timeline), with the list of the
 * cohorts' patients to choose them from. The list is a table view (lib/table-query.ts: paged,
 * searched, filtered, sorted, downloadable); the timeline is the chosen patient's events as tracks
 * (lib/timeline-tracks.ts). Both name a patient, so only a patient-level participant contributes.
 */
export interface TimelineView extends TableQuery {
  note?: string;
  kind: "timeline"; cohorts?: string[];
  /** the patient whose timeline is drawn; with none, the list's first row */
  patient?: { study: string; id: string };
  /** track uids drawn collapsed (their events folded into one row), e.g. "treatment.Chemo" */
  collapsed?: string[];
  /** draw every year rather than cutting runs of four or more empty years to one mark (default false) */
  expandGaps?: boolean;
  /** patients per page of the list (default 25, at most 1000) */
  rows?: number;
}

declare module "../../types.ts" {
  interface ViewSpecs { timeline: TimelineView }
  interface ViewResultFields {
    timeline: {
      timeline?: TimelineResult;
    };
  }
  interface ViewResultMain { timeline: "timeline" }
}
