/**
 * A numeric chart's menu (STS-BAR-6…8, STS-HD-5): when Log Scale is offered, the Custom Bins
 * dialog's edges as typed, and the edges an interval typed into a filter pill adds to the chart
 * (STV-FB-4). The settings are each reader's own, kept by the browser (app/lab/use-explore-state.ts);
 * the server bins by them (lib/data-binner.ts BinSettings).
 */
import type { NumericBin } from "./types.ts";
import type { BinMethod, BinSettings } from "./data-binner.ts";

export type { BinMethod, BinSettings };

/** what the browser keeps per chart: the server's settings, plus whether the NA bar is drawn */
export type ChartBins = BinSettings & { showNa?: boolean };

const isInterval = (b: NumericBin) => b.value == null && b.start != null && b.end != null;

/** the portal's getExponent: log10 |v|, to 1 decimal under 50 and 2 above */
const exponent = (v: number) => { const k = Math.abs(v) < 50 ? 10 : 100; return Math.round(Math.log10(Math.abs(v)) * k) / k; };

/**
 * isLogScaleByDataBins: the interval bars' edges are all 0 or powers of ten in half steps (1, 3,
 * 10, 31, 100, …), and not every bar is one value.
 */
export function looksLogarithmic(bins: NumericBin[] | undefined): boolean {
  const iv = (bins || []).filter(isInterval);
  if (!iv.length || iv.every((b) => b.start === b.end)) return false;
  const values = iv.map((b) => b.start!);
  const last = iv[iv.length - 1];
  if (last.start !== last.end) values.push(last.end!);
  return values.every((v) => v === 0 || (Math.abs(v) >= 1 && exponent(v) % 0.5 === 0));
}

/** Log Scale is offered while it is switched off, or while the bars are drawn on it (isLogScaleToggleVisible) */
export const logScaleOffered = (bins: NumericBin[] | undefined, s: ChartBins | undefined): boolean => !!s?.disableLog || looksLogarithmic(bins);

/** the bars' numeric edges, each once, in order: the Custom Bins box's starting text */
export function binEdges(bins: NumericBin[] | undefined): number[] {
  const out = new Set<number>();
  for (const b of bins || []) {
    if (b.value != null) continue;
    if (b.start != null) out.add(b.start);
    if (b.end != null) out.add(b.end);
  }
  return [...out].sort((a, b) => a - b);
}

/** every bar holds one value: the chart has at most 10 distinct values, and bins don't apply to it */
export const oneValueBars = (bins: NumericBin[] | undefined): boolean => {
  const num = (bins || []).filter((b) => b.value == null);
  return num.length > 0 && num.every((b) => b.start != null && b.start === b.end);
};

/**
 * The Custom Bins box: numbers split on commas, sorted, each once. Empty restores the default bins
 * (STS-STM-10), so it reads as null; anything that is not a number is refused, named.
 */
export function parseEdges(text: string): { edges: number[] | null } | { why: string } {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { edges: null };
  const bad = parts.filter((p) => !Number.isFinite(Number(p)));
  if (bad.length) return { why: "not a number: " + bad.slice(0, 3).join(", ") };
  if (parts.length > 100) return { why: "at most 100 bin edges" };
  return { edges: [...new Set(parts.map(Number))].sort((a, b) => a - b) };
}

/** Generate bins: a size above 0 and a starting value, both numbers */
export function parseGenerate(size: string, anchor: string): { bins: BinMethod } | { why: string } {
  const s = Number(size.trim()), a = Number(anchor.trim() || "0");
  if (!size.trim() || !Number.isFinite(s) || s <= 0) return { why: "the bin size is a number above 0" };
  if (!Number.isFinite(a)) return { why: "the starting value is a number" };
  return { bins: { method: "generate", size: s, anchor: a } };
}

/**
 * The chart's bins after an interval typed into its filter pill (updateCustomIntervalFilter): its
 * current edges plus the interval's ends, as custom bins, so the filter is drawn as bars.
 */
export function binsAfterEdit(current: ChartBins | undefined, bars: NumericBin[] | undefined, ends: (number | undefined)[]): ChartBins {
  const edges = [...new Set([...binEdges(bars), ...ends.filter((x): x is number => x != null && Number.isFinite(x))])].sort((a, b) => a - b);
  return { ...(current || {}), bins: { method: "custom", edges } };
}

/** a bin method as the menu names it */
export function binMethodName(m: BinMethod): string {
  if (m.method === "quartile") return "quartiles";
  if (m.method === "median") return "a median split";
  if (m.method === "generate") return "bins of " + m.size + " from " + m.anchor;
  return "custom edges";
}

/** what the server is sent: the settings that change the bars, charts with none left out */
export function serverBins(all: Record<string, ChartBins>): Record<string, BinSettings> {
  const out: Record<string, BinSettings> = {};
  for (const [attr, { bins, disableLog }] of Object.entries(all)) {
    if (bins !== undefined || disableLog) out[attr] = { ...(bins !== undefined ? { bins } : {}), ...(disableLog ? { disableLog } : {}) };
  }
  return out;
}
