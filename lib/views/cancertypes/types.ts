// The cancertypes view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";
import type { DriverSettings } from "../../driver-settings.ts";
import type { GeneTrackSpec } from "../../gene-tracks.ts";

/**
 * Cancer Types Summary (cBioPortal's results-view tab): for a gene list, the share of the cohort's
 * patients (or samples, `unit`) altered in at least one of the genes, per cancer type (or any sample
 * attribute, or per study), split by kind of alteration. Each group's denominator is its patients
 * (or samples) profiled for at least one of the genes. Counts only.
 */
export interface CancertypesView {
  note?: string;
  kind: "cancertypes"; cohorts?: string[];
  genes: GeneTrackSpec[];
  /**
   * a sample attribute to group by, or "study". Unset, the portal's default (CancerSummaryContainer
   * groupAlterationsBy): "study" when the cohorts span several studies; else "CANCER_TYPE_DETAILED" when
   * every sample has one cancer type, else "CANCER_TYPE". A sample without a CANCER_TYPE takes its
   * study's type of cancer, and one without a CANCER_TYPE_DETAILED its cancer type, as the portal's
   * extendSamplesWithCancerType does.
   */
  groupBy?: string;
  /** count OncoKB drivers only, or any alteration (default) */
  measure?: "driver" | "any";
  /**
   * the portal's Min. # Total: a group is drawn only with at least this many profiled units (patients or
   * samples). Unset: 10 when the panel's largest group has more than 10, else 0 (per gene tab). Groups not
   * drawn are counted in the panel's `categories`.
   */
  minSamples?: number;
  /** the portal's Min. % Altered (frequencies drawn: a percentage) or Min. # Altered (counts drawn: a count); default 0 */
  minAltered?: number;
  /** the portal's Sort X-Axis By: by the y-axis value (default), or alphabetically by group (a study by its id) */
  sort?: "alphabetical";
  /** draw percentages (default) or counts */
  show?: "frequency" | "count";
  /** count patients (default, as the portal does — a patient counts in each group a sample of theirs is in) or samples */
  unit?: "patient" | "sample";
  /**
   * The query's OQL, one line per entry, one gene each: what counts as altered is what the lines
   * match, each under its gene (the portal's OQL-filtered data); `genes` are then the lines' genes.
   */
  oql?: string[];
  /** how a line's DRIVER reads (the page's driver settings), and the profiles its EXP / PROT read, as an oql clause's */
  drivers?: DriverSettings; exp?: string; prot?: string; ifHeld?: boolean;
}
export interface CancertypesGroup {
  key: string; label: string;
  /** the group's units (patients or samples), profiled or not */
  samples: number;
  profiled: number; altered: number;
  mutation: number; amp: number; homdel: number; sv: number; multiple: number;
  /** a line's EXP / PROT: mRNA and protein high and low */
  mrnaHigh?: number; mrnaLow?: number; protHigh?: number; protLow?: number;
  /** units profiled for each data type at all (any gene) — the portal's "+" rows */
  profiledFor?: { mutation: number; cna: number; sv: number };
}
/** a panel's (or one gene tab's) drawn groups */
export interface CancertypesGroups {
  groups: CancertypesGroup[];
  /** every group, drawn or not; with `filtered`, the figure says "<groups> of <categories> categories are shown" */
  categories: number;
  /** the Min. # Total applied (the view's, or its default for this panel) */
  minSamples: number;
  /** a threshold above 0 hides some group (the portal's filter alert) */
  filtered?: true;
}
export interface CancertypesPanel extends CancertypesGroups {
  cohort: string; samples: number; profiled: number; altered: number;
  /**
   * the same, one gene at a time (the portal's per-gene tabs); `altered` / `profiled` the gene's altered and
   * profiled units in the whole cohort, each once, before the filters
   */
  perGene?: ({ gene: string; altered: number; profiled: number } & CancertypesGroups)[];
}
export interface CancertypesResult {
  groupBy: string; measure: "driver" | "any"; genes: string[];
  /** the view's Min. # Total, or null for the default (each panel's `minSamples` is the one applied) */
  minSamples: number | null; minAltered: number; sort?: "alphabetical"; show: "frequency" | "count";
  unit: "patient" | "sample";
  panels: CancertypesPanel[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { cancertypes: CancertypesView }
  interface ViewResultFields {
    cancertypes: {
      cancertypes?: CancertypesResult;
    };
  }
  interface ViewResultMain { cancertypes: "cancertypes" }
}
