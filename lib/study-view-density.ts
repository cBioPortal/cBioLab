// The Study View's density chart (mutation count against fraction genome altered) as cBioPortal
// draws it: its request, colours, legend, correlation text, tooltip and the filter a drag box makes.
// The rules are listed case by case, with the portal's source lines, in
// docs/legacy-spec/parity/density-cases.md. Browser-safe: no database access.
import { interpolatePlasma } from "d3-scale-chromatic";
import type { View } from "./types.ts";
import { studentTP } from "./stats.ts";
import { portalFixed, portalLocale, portalRange } from "./chart/format.ts";

export const MUTATION_COUNT = "MUTATION_COUNT";
export const FGA = "FRACTION_GENOME_ALTERED";
/** the portal's grid: ceil(263.282 / 6) bins along x, ceil(223.372 / 6) up y */
export const DENSITY_GRID: [number, number] = [44, 38];

/** a reader's choices on the chart's menu */
export interface DensitySettings { swapped?: boolean; xLog?: boolean; yLog?: boolean }
export interface DensityAxis { attribute: string; log: boolean }

/** which attribute each axis holds and whether it is on Log Scale (only a mutation-count axis can be) */
export function densityAxes(s: DensitySettings): { x: DensityAxis; y: DensityAxis } {
  const [xa, ya] = s.swapped ? [MUTATION_COUNT, FGA] : [FGA, MUTATION_COUNT];
  return { x: { attribute: xa, log: !!s.xLog && logOffered(xa) }, y: { attribute: ya, log: !!s.yLog && logOffered(ya) } };
}

/** Swap Axes: the attributes trade places and take their Log Scale settings with them */
export function swapDensity(s: DensitySettings): DensitySettings {
  return { swapped: !s.swapped, xLog: !!s.yLog, yLog: !!s.xLog };
}

/** whether an axis holding this attribute offers Log Scale */
export function logOffered(attribute: string): boolean {
  return attribute === MUTATION_COUNT;
}

/** FGA runs from 0 to 1 and a mutation count from 0, whatever the data */
function fixedRange(attribute: string): { min?: number; max?: number } | undefined {
  if (attribute === FGA) return { min: 0, max: 1 };
  if (attribute === MUTATION_COUNT) return { min: 0 };
  return undefined;
}

/** the plot view the chart asks the engine for */
export function densityView(s: DensitySettings): View {
  const { x, y } = densityAxes(s);
  const rx = fixedRange(x.attribute), ry = fixedRange(y.attribute);
  return {
    kind: "plot", unit: "sample",
    x: { source: "clinical", attribute: x.attribute, log: x.log },
    y: { source: "clinical", attribute: y.attribute, log: y.log },
    bins: DENSITY_GRID,
    range: { ...(rx ? { x: rx } : {}), ...(ry ? { y: ry } : {}) },
    allPoints: false, points: []
  } as View;
}

export function densityTitle(xName: string, yName: string): string {
  return yName + " vs " + xName;
}

export function densityAxisLabel(name: string, log: boolean): string {
  return name + (log ? " (log)" : "");
}

/** an engine log value, log2(1 + v), as the portal's ln(1 + v) */
export function lnFromEngine(v: number): number {
  return v * Math.LN2;
}

export interface DensityLegend { max: number; mid: number | null; min: number }

/** the top of the plasma ramp the portal uses, so the densest cells stay visible on white */
const COLOR_MAX = 0.75;

/** the fill for each bin's count, and the legend (null when the portal draws none) */
export function densityColors(counts: number[]): { color: (count: number) => string; legend: DensityLegend | null } {
  if (!counts.length) return { color: () => interpolatePlasma(0), legend: null };
  const max = Math.max(...counts);
  let min = Math.min(...counts);
  if (min === max) min = 1;
  if (min === max) return { color: () => interpolatePlasma(0), legend: null };
  const lo = Math.log(min), hi = Math.log(max);
  const color = (c: number) => interpolatePlasma(COLOR_MAX * ((Math.log(c) - lo) / (hi - lo)));
  return { color, legend: { max, min, mid: max - min >= 2 ? Math.round(Math.exp((lo + hi) / 2)) : null } };
}

/** the legend's bar as a CSS gradient: plasma from 0 at the bottom to the chart's top colour, in the portal's 30 steps */
export function densityGradient(): string {
  return "linear-gradient(to top, " + densityGradientStops().map((s) => s.color + " " + s.offset).join(", ") + ")";
}

/** the legend bar's 30 stops, bottom first: each colour and its offset up the bar */
export function densityGradientStops(): { color: string; offset: string }[] {
  return Array.from({ length: 30 }, (_, i) => ({ color: interpolatePlasma(COLOR_MAX * i / 30), offset: Math.round(i / 30 * 100) + "%" }));
}

/** a coefficient's two-sided p-value as the portal computes it (PlotUtils.ts:462-482): Student's t on n − 2 degrees of freedom, 0 at |r| = 1 */
function correlationP(r: number, n: number): number {
  if (Math.abs(r) >= 1) return 0;
  return studentTP(Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r)), n - 2);
}

export interface CorrelationLine { name: "Pearson:" | "Spearman:"; r: string; p: string }

/** the correlation text beside the legend, or null when none is shown */
export function correlationLines(stats: { pearson: number | null; spearman: number | null }, n: number): CorrelationLine[] | null {
  if (n <= 2) return null;
  const line = (name: CorrelationLine["name"], r: number | null): CorrelationLine => {
    const p = r == null || !Number.isFinite(r) ? null : correlationP(r, n);
    return r == null || !Number.isFinite(r) || p == null
      ? { name, r: "–", p: "–" }
      : { name, r: portalFixed(r, 4), p: "p=" + portalFixed(p, 2) };
  };
  return [line("Pearson:", stats.pearson), line("Spearman:", stats.spearman)];
}

export interface DensityBin { n: number; minX: number; maxX: number; minY: number; maxY: number }

/** the tooltip's three lines for a bin, its values in the axes' display units (ln on a Log Scale axis) */
export function densityTip(bin: DensityBin, x: { name: string; log: boolean }, y: { name: string; log: boolean }): string[] {
  const lo = portalFixed(bin.minX, 2), hi = portalFixed(bin.maxX, 2);
  return [
    "Number of Samples: " + portalLocale(bin.n),
    densityAxisLabel(x.name, x.log) + ": " + (lo === hi ? lo : lo + "-" + hi),
    densityAxisLabel(y.name, y.log) + ": " + portalRange(bin.minY, bin.maxY)
  ];
}

type RangeClause = { kind: "clinical"; attribute: string; range: { gte: number; lte: number } };

/** one axis's stretch of a drag box as a range of its attribute */
function axisRange(a: DensityAxis, v0: number, v1: number, span: number): RangeClause {
  if (a.attribute === MUTATION_COUNT) {
    const raw = (v: number) => a.log ? Math.exp(v) - 1 : v;
    return { kind: "clinical", attribute: a.attribute, range: { gte: Math.ceil(raw(v0) - 1e-9), lte: Math.floor(raw(v1) + 1e-9) } };
  }
  const d = Math.max(0, 2 - Math.floor(Math.log10(Math.max(1e-9, span))));
  const round = (v: number) => Number(portalFixed(v, d));
  return { kind: "clinical", attribute: a.attribute, range: { gte: round(v0), lte: round(v1) } };
}

/**
 * The edges a drag box's ranges add to their attributes' bar charts, as the portal adds them as
 * custom bins (STS-SC-6, _customBinsFromScatterPlotSelectionSet): each range's two ends.
 */
export interface DensityBins { attribute: string; range: { gte: number; lte: number }; edges: number[] }

/**
 * The charts' bins with a density drag's edges laid over them, as the portal's separate, temporary
 * set of scatter-selection bins (STS-SC-6): an attribute's bars take the drag's edges only while the
 * draft still holds that drag's range on it, so removing the filter, Clear All, or a selection on the
 * bars (which replaces the chart's filter) drops them. The reader's own bins are left as they are.
 */
export function withDensityBins<T extends { bins?: unknown }>(bins: Record<string, T>, density: DensityBins[], draft: { all?: unknown[] } | null | undefined): Record<string, T | (T & { bins: { method: "custom"; edges: number[] } })> {
  const out: Record<string, T | (T & { bins: { method: "custom"; edges: number[] } })> = { ...bins };
  for (const d of density) {
    const held = (draft?.all || []).some((c) => {
      const l = c as { kind?: string; attribute?: string; range?: { gte?: number; lte?: number } };
      return !!l && l.kind === "clinical" && l.attribute === d.attribute && l.range?.gte === d.range.gte && l.range?.lte === d.range.lte;
    });
    if (held) out[d.attribute] = { ...(bins[d.attribute] || {}) as T, bins: { method: "custom", edges: d.edges } };
  }
  return out;
}
export function densityBinEdges(clauses: { attribute: string; range: { gte: number; lte: number } }[]): { attribute: string; ends: number[] }[] {
  return clauses.map((c) => ({ attribute: c.attribute, ends: [c.range.gte, c.range.lte] }));
}

/**
 * The filter clauses a drag box makes: one range per attribute, whichever axis it is on. `box` is
 * in the axes' display units (ln(1 + count) on a Log Scale axis); `span` is each axis's length in
 * those units, for rounding a fraction to the axis's precision.
 */
export function densitySelection(box: { x0: number; x1: number; y0: number; y1: number }, s: DensitySettings,
  span: { x: number; y: number }): RangeClause[] {
  const { x, y } = densityAxes(s);
  return [axisRange(x, box.x0, box.x1, span.x), axisRange(y, box.y0, box.y1, span.y)];
}
