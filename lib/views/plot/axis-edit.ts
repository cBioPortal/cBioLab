// A plot view's axis changed as its controls change it (app/lab/plot-controls.tsx): the box's
// Filter categories and Sort Categories by Median belong to the pair of axes they were chosen on.
import type { PlotView } from "./types.ts";

/**
 * The view with one axis replaced. Either axis changing drops the box's category filter and median
 * order: the categories were the old axis's, as cBioPortal clears Filter categories when an axis's
 * data type or source changes (PLT-AX-1b), and the new pair may not be a box, where both are
 * refused. Swapping the axes keeps them, as the portal swaps the selected categories (PLT-AX-11).
 */
export function withAxis<V extends Partial<PlotView>>(view: V, side: "x" | "y", axis: PlotView["x"]): V {
  const next: V = { ...view, [side]: axis };
  delete next.categories;
  delete next.sortByMedian;
  return next;
}
