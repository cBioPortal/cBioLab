// How an oncoprint VIEW (the document) and the figure's own viewing state map onto each other —
// one definition for every page that draws an oncoprint from a document. The figure's display
// options and sort live in the view (invariant 9: they change what a shared link shows), written
// down only where they differ from the defaults, and changing them never re-runs the view.
import { DEFAULT_FIGURE_DISPLAY, type FigureDisplay } from "./OncoprintFigure.tsx";
import { sortKeyText } from "./track-edits.ts";
import { FIGURE_KEYS, dataPart } from "./view-data.ts";
export { FIGURE_KEYS, dataPart };


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

export { sortKeyText };

export const sortKeysOf = (v: { sort?: unknown[] }): string[] => (v.sort || []).map(sortKeyText);

/** the view with the figure's sort written in (at most four keys; none = the engine's order) */
export function withSortKeys<V extends { sort?: unknown }>(v: V, keys: string[]): V {
  const next = { ...v };
  if (keys.length) next.sort = keys.slice(0, 4); else delete next.sort;
  return next;
}


/** where the settings apply, for the menu's tip */
export const DRIVER_SCOPE = "this oncoprint; on a Results page they apply to its Oncoprint and Plots tabs together, and the other tabs do not follow them yet";
