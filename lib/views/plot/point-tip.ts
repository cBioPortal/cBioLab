// What a plot's point says on hover, as the portal's Plots tab says it: the case, its value on the
// horizontal and the vertical axis, the categories it is coloured and ringed by, and the point
// layers it belongs to. Read from the result the figure was drawn from, so it is never a second
// query; the page finds which case is under the pointer (app/lab/plot-hover.tsx).
import type { PlotData } from "../../plot.ts";
import { axisTitle } from "./figure.ts";

export interface PointTip {
  id: string;
  /** label and value, horizontal axis first */
  rows: [string, string][];
  /** the point layers that hold the case, in the view's order */
  layers: string[];
}

/** a value as the portal's tooltip prints it: two decimals at most, no trailing zeros; a log axis's value in its own units */
function value(a: PlotData["x"], t: number): string {
  const v = a.log ? 10 ** t - 1 : t;
  return String(Math.round(v * 100) / 100);
}

/** the tip for case `id` drawn by `layer` ("base" for the plotted cohort, else its place in the view's list); null when the result does not hold it */
export function pointTip(d: PlotData, id: string, layer: string): PointTip | null {
  const ls = d.layers || [];
  const own = layer === "base" ? null : ls[Number(layer)];
  const inLayer = own && [...(own.points || []), ...(own.shared || [])].find((p) => p.id === id);
  const rows: [string, string][] = [];
  if (d.shape === "scatter") {
    const pt = inLayer && "x" in inLayer ? inLayer : (d.xyPoints || []).find((p) => p.id === id);
    if (!pt) return null;
    rows.push([axisTitle(d.x), value(d.x, pt.x)], [axisTitle(d.y), value(d.y, pt.y)]);
  } else if (d.shape === "box") {
    // a layer's point carries no colour or ring; the plotted cohort's own point for the case does
    const base = (d.points || []).find((p) => p.id === id);
    const pt = inLayer && "g" in inLayer ? inLayer : base;
    if (!pt) return null;
    const numOnX = d.x.kind === "num";
    const num = value(numOnX ? d.x : d.y, pt.v);
    rows.push([axisTitle(d.x), numOnX ? num : pt.g], [axisTitle(d.y), numOnX ? pt.g : num]);
    if (d.colorLabel && base?.c != null) rows.push([d.colorLabel, base.c || "no value"]);
    if (d.ringLabel && base?.r != null) rows.push([d.ringLabel, base.r || "no value"]);
  } else return null;
  const layers = ls.filter((l) => l.shown === "points" && [...(l.points || []), ...(l.shared || [])].some((p) => p.id === id)).map((l) => l.label);
  return { id, rows, layers };
}
