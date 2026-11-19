// The cancertypes view's threshold controls, as the portal's (CancerSummaryContent): the sliders' ends,
// the Min. # Total clamp and which box is highlighted. The page's Controls read these.
import type { CancertypesGroup, CancertypesResult, CancertypesView } from "./types.ts";

/** every group drawn: each chart's genes-together groups and each of its gene tabs' */
function drawn(r: CancertypesResult): CancertypesGroup[] {
  return r.panels.flatMap((p) => [...p.groups, ...(p.perGene || []).flatMap((g) => g.groups)]);
}

/**
 * The sliders' ends (totalCasesMax, altCasesMax): the largest profiled total drawn, and the largest altered
 * share (freq mode, the portal's (altered / profiled) * 100) or count drawn; 0 with nothing drawn. The
 * portal's are one tab's; ours are over every chart and gene tab, since the boxes are shared by them.
 */
export function thresholdEnds(r: CancertypesResult): { total: number; altered: number } {
  let total = 0, altered = 0;
  for (const g of drawn(r)) {
    total = Math.max(total, g.profiled);
    altered = Math.max(altered, r.show === "count" ? g.altered : g.profiled ? (g.altered / g.profiled) * 100 : 0);
  }
  return { total, altered };
}

/** Min. # Total on Enter (handleTotalInputKeyPress): over the slider's end, the end */
export function clampMinTotal(n: number, end: number): number {
  return n > end ? end : n;
}

/** the portal's highlightInput: a box whose applied value is above 0; an unset Min. # Total applies each chart's and gene tab's default */
export function thresholdHighlight(r: CancertypesResult, spec: Pick<CancertypesView, "minSamples" | "minAltered">): { total: boolean; altered: boolean } {
  return {
    total: spec.minSamples != null ? spec.minSamples > 0 : r.panels.some((p) => p.minSamples > 0 || (p.perGene || []).some((g) => g.minSamples > 0)),
    altered: (spec.minAltered ?? 0) > 0,
  };
}

/** the altered slider's end label: ceil(max) and "%" in freq mode, else the count */
export function alteredEndLabel(end: number, show: CancertypesResult["show"]): string {
  return String(Math.ceil(end)) + (show === "count" ? "" : "%");
}
