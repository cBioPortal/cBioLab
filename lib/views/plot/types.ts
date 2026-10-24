// The plot view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";
import type { PlotAxis, PlotData } from "../../plot.ts";
import type { PointLayerSpec } from "../../plot-layers.ts";

/**
 * A plot: two axes over the same cases. The shape — scatter, box, contingency — follows from
 * what the axes are, exactly as it does in the portal, rather than being asked for.
 */
export interface PlotView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "plot"; x: PlotAxis; y: PlotAxis; cohorts?: string[];
  /** what a point is (default "sample"); patient mode combines a patient's samples (mean, common value or "Multiple", any alteration) */
  unit?: "patient" | "sample";
  /** the grid a scatter is binned onto (default 240 x 160) */
  bins?: [number, number];
  /**
   * Every case is a point when there are at most POINTS_CAP (10,000) of them and the reader may see cases
   * (default true); false draws the density alone at any size.
   */
  allPoints?: boolean;
  /**
   * Subsets of the plotted cohort's cases drawn in colour over the plot, in order (at most 4): the
   * outliers (past the cap: a box's values beyond its whiskers, a scatter's sparse cells), the
   * extremes on an axis, the cases furthest from the fitted line, or a cohort's cases. Default
   * [{rule:"outliers"}]; [] draws none. A case in two layers is drawn by the first. Every layer
   * shares one POINTS_CAP budget; a cohort layer past it is drawn as density cells or boxes.
   */
  points?: PointLayerSpec[];
  /**
   * Colour the values by a category, as the portal's "Color samples by" does: `colorBy` fills
   * each point, `ringBy` rings it, so a case that is both amplified and mutated stays legible.
   * Above the points cap the fill splits the density instead.
   */
  colorBy?: PlotAxis;
  ringBy?: PlotAxis;
}

declare module "../../types.ts" {
  interface ViewSpecs { plot: PlotView }
  interface ViewResultFields {
    plot: {
      /** a plot's aggregated contract: bins, groups or cells — never points */
      plot?: PlotData;
    };
  }
  interface ViewResultMain { plot: "plot" }
}
