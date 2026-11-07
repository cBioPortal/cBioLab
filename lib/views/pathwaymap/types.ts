// The pathwaymap view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";
import type { RankedPathway, RankSettings } from "./rank.ts";

/**
 * A PathwayMapper pathway diagram (genes as nodes, interactions as edges, each gene node carrying
 * the cohort's altered %), beside the library's pathways ranked by how many query genes each holds.
 * Which pathway is drawn and how the list is ranked are the document's (`pathway`, `rank`,
 * `byFrequency`, `pancanOnly`), applied in the browser from the whole result: every library gene's
 * counts come back with it, so choosing another pathway re-runs nothing.
 */
export interface PathwayMapView {
  note?: string;
  kind: "pathwaymap"; cohorts?: string[];
  /** the query genes the ranking matches; without them, the library genes altered in the cohort (a patient's, on the Patient page) */
  genes?: string[];
  /** the pathway drawn; without one, the first of the ranking */
  pathway?: string;
  /** rank by the number of query genes a pathway holds (default) or by that as a % of its gene nodes */
  rank?: "count" | "percent";
  /** weight each matched gene by its altered % (default false) */
  byFrequency?: boolean;
  /** list only the ten TCGA PanCanAtlas pathways (default true) */
  pancanOnly?: boolean;
}

export interface PathwayMapCell { cohort: string; profiled: number; altered: number; pct: number | null }
export interface PathwayMapGene { gene: string; cells: PathwayMapCell[] }

export interface PathwayMapResult {
  /** the genes the ranking matches, and where they came from */
  query: string[];
  queryFrom: "genes" | "altered";
  /** every gene the library names as a gene symbol, and every query gene: its counts in each cohort */
  genes: PathwayMapGene[];
  /** the settings the ranking below was made with */
  settings: RankSettings;
  ranked: RankedPathway[];
  /** the pathway drawn, and whether it is the ranking's first because the document names none */
  pathway: string;
  defaulted: boolean;
  /** gene nodes of the drawn pathway that are labels rather than gene symbols, so carry no frequency */
  labels: string[];
}

declare module "../../types.ts" {
  interface ViewSpecs { pathwaymap: PathwayMapView }
  interface ViewResultFields {
    pathwaymap: {
      pathwaymap?: PathwayMapResult;
    };
  }
  interface ViewResultMain { pathwaymap: "pathwaymap" }
}
