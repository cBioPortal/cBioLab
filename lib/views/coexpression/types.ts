// The coexpression view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { PlotData } from "../../plot.ts";
import type {  } from "../../types.ts";

export interface CoexpressionView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "coexpression"; genes: string[]; profileType: string; cohorts?: string[] }
/** One gene pair's correlation on a continuous profile, from six sums per site. */
export interface CoexprRow {
  a: string; b: string;
  /** correlation of the pooled population, from summed moments (exact) */
  r: number | null; n: number; p: number; q: number;
  /** present with >1 study: per-site correlations combined by Fisher z */
  rMeta?: number | null; pMeta?: number; sites?: number;
  /** per-site r and n, so a reader can see whether the sites agree */
  perStudy?: { study: string; r: number | null; n: number }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { coexpression: CoexpressionView }
  interface ViewResultFields {
    coexpression: {
      coexpression?: CoexprRow[];
      /** a plot's aggregated contract: bins, groups or cells — never points */
      plot?: PlotData;
    };
  }
  interface ViewResultMain { coexpression: "coexpression" }
}
