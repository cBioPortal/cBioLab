// The log scales of cBioPortal's Plots tab, with no server code in reach so the figure and the page can use them.

/** the fields of a plot axis (lib/plot.ts PlotAxis) a log scale reads */
type LogAxis = { source: string; log?: boolean; profileType?: string; profile?: string; [field: string]: unknown };

/**
 * cBioPortal's Plots tab log transforms (PlotsTabUtils.tsx makeAxisLogScaleFunction, PLT-STM-11):
 * `log2` is log2(max(v, 0) + 1), for every axis but a generic assay's, so a zero stays on the axis
 * and a value below zero is drawn at 0; `log10` is a generic assay's log10(v), with 0 read as 0.
 * An axis with negative values has no log scale (logScalePossible, PLT-AX-4) except an RNA-seq
 * profile's (logScaleExempt); lib/views/plot/run.ts turns the others' off before they get here.
 */
export type LogRule = "log2" | "log10";
/** what the portal appends to a log axis's title */
export const LOG_SUFFIX: Record<LogRule, string> = { log2: " (log2(value + 1))", log10: " (log10)" };
/** the log rule an axis is drawn with, if it is on a log scale */
export function logRuleOf(a: LogAxis): LogRule | undefined {
  if (!a.log) return undefined;
  return a.source === "assay" ? "log10" : "log2";
}
/** an axis whose log scale the portal keeps when it has negative values: an RNA-seq profile, not a z-score (logScalePossibleForProfile) */
export function logScaleExempt(a: LogAxis): boolean {
  const id = (a.source === "molecular" ? a.profileType : a.source === "profile" ? a.profile : "") || "";
  return /rna_seq/i.test(id) && !/zscore/i.test(id);
}
/** a value in a log axis's units */
export function toLog(rule: LogRule, v: number): number {
  return rule === "log2" ? Math.log2(Math.max(v, 0) + 1) : v === 0 ? 0 : Math.log10(v);
}
/** a log axis's position back in the axis's own units */
export function fromLog(rule: LogRule, t: number): number {
  return rule === "log2" ? 2 ** t - 1 : 10 ** t;
}
