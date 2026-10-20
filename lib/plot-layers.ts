// A plot's point layers as the document asks for them: how many, their colours, their defaults and
// what the key calls each. Browser-safe, so the page's picker and the server's figure agree.

/**
 * How many cases a plot draws as points before it stops being a drawing: at or under it every case
 * is a point; past it the plotted cohort is density, and the point layers share this many points.
 * Set from a measurement (docs/plot-case-level.md): an SVG of n points paints in about 18 ms per
 * thousand on the dev server's headless Chrome, so 10,000 keeps a redraw near 200 ms; the points
 * travel as about 44 bytes each.
 */
export const POINTS_CAP = 10000;
/** layers one plot may draw: each takes a colour of its own, and past four they stop being told apart */
export const POINT_LAYER_CAP = 4;
/** a layer's colour, by its place in the view's list */
export const LAYER_COLORS = ["#D55E00", "#0072B2", "#009E73", "#CC79A7"] as const;
/** the plotted cohort under its layers: a grey lighter than a colour key's "other", so the two never read alike */
export const LAYER_BASE = "#adb6bc";

/**
 * A point layer, as the document asks for it: a subset of the plotted cohort's cases drawn in its
 * own colour over the plot. A rule picks the subset (the outliers, the extremes on an axis, the
 * cases furthest from the fitted line) or a cohort does (its cases that are in the plotted one).
 */
export type PointLayerSpec =
  | { rule: "outliers" }
  | { rule: "extremes"; axis: "x" | "y"; n?: number }
  | { rule: "trend"; n?: number }
  | { cohort: string };
/** the layers a view without `points` gets: past the cap, the outliers */
export const DEFAULT_POINT_LAYERS: PointLayerSpec[] = [{ rule: "outliers" }];
/** how many cases an extremes or trend layer takes when the view does not say (per end, per group for extremes on a box) */
export const POINT_RULE_N = 50;
/** the most an extremes or trend layer may ask for */
export const POINT_RULE_N_MAX = 500;

/** what the key and the picker call a layer; `axis` names an axis by its label */
export function layerLabel(l: PointLayerSpec, axis: (side: "x" | "y") => string): string {
  if ("cohort" in l) return l.cohort;
  if (l.rule === "outliers") return "outliers";
  if (l.rule === "trend") return (l.n ?? POINT_RULE_N) + " furthest from the fit";
  return "top and bottom " + (l.n ?? POINT_RULE_N) + " by " + axis(l.axis);
}
