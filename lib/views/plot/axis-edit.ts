// A plot view's axis changed as its controls change it (app/lab/plot-controls.tsx), keeping a box's
// Filter categories and Sort Categories by Median as cBioPortal's Plots tab keeps them.
import type { PlotView } from "./types.ts";

type Axis = PlotView["x"];

/**
 * What an axis reads, without the gene or generic-assay entity it reads it for, nor how it is drawn
 * (log, title, driver sources): its data type and source, as the portal's Data type and source
 * selects choose them (PLT-AX-1, PLT-AX-2). A mutation axis's "Plot Mutations by" is its source.
 */
function sourceOf(a: Axis | undefined): string {
  if (!a) return "";
  const rest: Record<string, unknown> = { ...a };
  for (const k of ["gene", "genes", "entity", "log", "label", "drivers"]) delete rest[k];
  return JSON.stringify(Object.keys(rest).filter((k) => rest[k] !== undefined).sort().map((k) => [k, rest[k]]));
}

/**
 * The view with one axis replaced. The box's category filter belongs to its categorical axis, and
 * as on cBioPortal it is cleared only when that axis's data type or source changes (PLT-AX-1b,
 * PLT-AX-9): a new gene or entity keeps it, and so does any change to the numeric axis. `filterSide`
 * is the categorical axis of the box on screen. With no box on screen the filter is set aside (said
 * in the caption) and no axis is known to hold it, so it is kept, to apply again when the pair is a
 * box. The median order is never cleared (PLT-AX-10).
 */
export function withAxis<V extends Partial<PlotView>>(view: V, side: "x" | "y", axis: Axis, filterSide?: "x" | "y"): V {
  const next: V = { ...view, [side]: axis };
  if (filterSide === side && sourceOf(view[side]) !== sourceOf(axis)) delete next.categories;
  return next;
}

/** the axes swapped, the box's filter and median order kept: the portal swaps the selected categories with their axis (PLT-AX-11) */
export function swapAxes<V extends Partial<PlotView>>(view: V): V {
  return { ...view, x: view.y, y: view.x };
}
