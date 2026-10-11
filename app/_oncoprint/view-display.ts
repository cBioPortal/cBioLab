// How an oncoprint VIEW (the document) and the figure's own viewing state map onto each other —
// one definition for every page that draws an oncoprint from a document. The figure's display
// options and sort live in the view (invariant 9: they change what a shared link shows), written
// down only where they differ from the defaults, and changing them never re-runs the view.
import { DEFAULT_FIGURE_DISPLAY, type FigureDisplay } from "./OncoprintFigure.tsx";

/** the display keys the figure owns — written back without a re-run */
export const FIGURE_KEYS = new Set(["showUnaltered", "whitespace", "gaps", "colorByType", "colors", "whiteBackground"]);

export const figureDisplayOf = (v: { display?: unknown }): FigureDisplay => ({ ...DEFAULT_FIGURE_DISPLAY, ...((v.display || {}) as object) });

/** the view with the figure's display options written in (only those off their default) */
export function withFigureDisplay<V extends { display?: unknown }>(v: V, d: FigureDisplay): V {
  const display: Record<string, unknown> = { ...((v.display || {}) as Record<string, unknown>) };
  for (const k of FIGURE_KEYS) {
    const val = (d as unknown as Record<string, unknown>)[k], dflt = (DEFAULT_FIGURE_DISPLAY as unknown as Record<string, unknown>)[k];
    if (val === undefined || val === dflt) delete display[k]; else display[k] = val;
  }
  const next = { ...v };
  if (Object.keys(display).length) next.display = display; else delete next.display;
  return next;
}

/** a sort key as the figure spells it: "label" / "-label" / "genomic" */
export const sortKeyText = (k: unknown): string =>
  k == null ? "genomic" : typeof k === "string" ? k : ((k as { dir?: string }).dir === "desc" ? "-" : "") + String((k as { track?: string }).track || "genomic");

export const sortKeysOf = (v: { sort?: unknown[] }): string[] => (v.sort || []).map(sortKeyText);

/** the view with the figure's sort written in (at most four keys; none = the engine's order) */
export function withSortKeys<V extends { sort?: unknown }>(v: V, keys: string[]): V {
  const next = { ...v };
  if (keys.length) next.sort = keys.slice(0, 4); else delete next.sort;
  return next;
}

/** the view without what the figure applies in the browser — what decides whether a re-run is needed */
export function dataPart(v: Record<string, unknown>): Record<string, unknown> {
  // the lollipop's alteration grid is applied in the browser, from the whole result
  if (v.kind === "hotspots") { const { hide, ...rest } = v; void hide; return rest; }
  // the timeline's folded tracks and its gap cuts are drawn in the browser, from the whole result
  if (v.kind === "timeline") { const { collapsed, expandGaps, ...rest } = v; void collapsed; void expandGaps; return rest; }
  if (v.kind !== "oncoprint") return v;
  const { sort, display, ...rest } = v;
  void sort;
  const d = Object.fromEntries(Object.entries((display || {}) as Record<string, unknown>).filter(([k]) => !FIGURE_KEYS.has(k)));
  return Object.keys(d).length ? { ...rest, display: d } : rest;
}
