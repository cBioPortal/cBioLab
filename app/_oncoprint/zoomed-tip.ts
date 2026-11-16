// The tooltip's value lines when several columns sit under the pointer, as the portal writes them
// (TooltipUtils makeClinicalTrackTooltip, makeHeatmapTrackTooltip).
import { portalTipNumber } from "../../lib/chart/format.ts";

export interface TipTrack {
  label: string; kind: string; numeric?: boolean; categories?: string[]; profiledFor?: string;
  /** a counts track (the mutation spectrum): its category names; `values` holds that many per column */
  stack?: readonly string[];
  values?: ArrayLike<number>; cells: ArrayLike<number>;
}

/** "n sample" / "n samples", as the portal's per-value line writes it */
const samples = (n: number) => n + " sample" + (n === 1 ? "" : "s");

/**
 * The value lines for the columns `cols` (drawn order): a number's mean ("(average of n values)"
 * past one value), a category's count of each value, a spectrum's first column, a gene's altered
 * of profiled.
 */
export function zoomedTip(t: TipTrack, cols: number[]): string[] {
  if (t.kind === "gene" || t.kind === "derivedEvent") {
    let alt = 0, prof = 0;
    for (const c of cols) { const v = t.cells[c]; if (v !== -1) prof++; if (v > 0) alt++; }
    return [t.label + ": " + alt + " altered of " + prof + " profiled"];
  }
  if (t.stack && t.values) {
    const k = t.stack.length, c = cols[0];
    return t.stack.map((name, i) => name + ": " + t.values![c * k + i]);
  }
  if (t.numeric || t.kind === "heatmap") {
    let sum = 0, n = 0;
    for (const c of cols) { const x = t.values ? t.values[c] : NaN; if (t.cells[c] !== -1 && !Number.isNaN(x)) { sum += x; n++; } }
    const clinical = t.kind !== "heatmap";
    if (!n) return [t.label + ": " + (clinical ? "no data" : "N/A")];
    return [t.label + ": " + portalTipNumber(sum / n, clinical) + (n > 1 ? " (average of " + n + " values)" : "")];
  }
  // the counts of each value, keyed as the portal's object is, so integer-like values come first
  const counts: Record<string, number> = {};
  let none = 0;
  for (const c of cols) {
    const v = t.cells[c];
    if (v === -1) { none++; continue; }
    const name = (t.categories && t.categories[v]) || "Other";
    counts[name] = (counts[name] || 0) + 1;
  }
  const keys = Object.keys(counts);
  const lines = keys.length > 1 ? [t.label + ":", ...keys.map((x) => x + ": " + samples(counts[x]))]
    : keys.length === 1 ? [t.label + ": " + keys[0] + (cols.length > 1 ? " (" + counts[keys[0]] + " samples)" : "")] : [];
  if (t.profiledFor && none) lines.push(t.label + ": No" + (cols.length > 1 ? " (" + none + " samples)" : ""));
  return lines;
}
