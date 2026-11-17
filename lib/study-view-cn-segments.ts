// The Explore page's CN Segments tab, as cBioPortal's study view draws it
// (docs/legacy-spec/parity/study-cn-segments-cases.md): when it is offered, its info line, and the
// `segments` view it draws over the selection.
import { DOC_VERSION } from "./doc-version.ts";
import type { AnalysisDoc, CohortDef, View } from "./types.ts";

/** the most selected samples the tab reads segments for (the portal's sampleThreshold) */
export const CN_SEGMENTS_SAMPLE_LIMIT = 20000;

/** the cohort the tab's view draws */
export const CN_SEGMENTS_COHORT = "Selection";

/** the view's own settings the tab keeps: where, how many rows, their order */
export interface CnSegmentsSettings { gene?: string; region?: string; rows?: number; sort?: "gained" | "lost" }

/** whether the tab is offered: a selected study holds copy-number segments */
export function cnSegmentsTab(studies: { caps?: Record<string, boolean> }[]): boolean {
  return studies.some((s) => !!s.caps?.seg);
}

/** whether the tab reads segments for this many selected samples */
export function cnSegmentsReads(selected: number): boolean {
  return selected <= CN_SEGMENTS_SAMPLE_LIMIT;
}

/** the info line above the figure; `segmented` the selected samples with segments, null until read */
export function cnSegmentsInfo(selected: number, segmented: number | null): string {
  if (!cnSegmentsReads(selected))
    return "Too many samples (>" + CN_SEGMENTS_SAMPLE_LIMIT + ") for copy number segmentation view, make a selection on Summary tab first.";
  return (segmented === 0 ? "No segmented" : "Segmented") + " copy-number data for the selected " + selected + " " + (selected === 1 ? "sample" : "samples") + ".";
}

/** the analysis document the tab runs: the segments view over the selection */
export function cnSegmentsDoc(def: CohortDef, study: string, settings: CnSegmentsSettings = {}): AnalysisDoc {
  const given = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
  const view = { kind: "segments", cohorts: [CN_SEGMENTS_COHORT], ...given } as unknown as View;
  return { dsl: DOC_VERSION, study, cohorts: { [CN_SEGMENTS_COHORT]: def }, views: [view] };
}
