// The evolution view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { TableRows, TimelineResult } from "../../types.ts";
import type { TableQuery } from "../../table-query.ts";
import type { AxisTick } from "../../timeline-tracks.ts";

/** The mutation table as the spec holds it: its query, and its page size. */
export interface EvolutionTableQuery extends TableQuery {
  /** rows per page (default 25, at most 1000) */
  rows?: number;
}

/**
 * One patient's mutations followed across their samples — cBioPortal's patient-view Genomic Evolution
 * tab: each mutation's variant allele frequency (VAF) in each of the patient's samples, drawn as a
 * line per mutation through the samples in their order or as a heatmap of sample × mutation, above
 * the mutations as a table view. The cohort's patients with two or more samples and allele counts
 * are listed to choose from. Everything names a patient, so only a patient-level participant
 * contributes.
 */
export interface EvolutionView extends TableQuery {
  note?: string;
  kind: "evolution"; cohorts?: string[];
  /** the patient drawn; with none, the list's first row */
  patient?: { study: string; id: string };
  /** patients per page of the list (default 25, at most 1000) */
  rows?: number;
  /** the mutation table's query; the figure draws every mutation it keeps (the top-level query is the patient list's) */
  mutations?: EvolutionTableQuery;
  /** "line" (the default: a line per mutation across the samples) or "heatmap" (a row per sample, a column per mutation) */
  chart?: "line" | "heatmap";
  /**
   * place the samples evenly in their order rather than by the day each was collected (default
   * false; a patient with a sample whose collection day is not recorded is drawn in sequence anyway, and the result says so)
   */
  sequential?: boolean;
  /** the line chart's y axis on a log scale (default false); a VAF of 0 sits at the axis floor, 0.001 */
  logScale?: boolean;
  /** the line chart's y axis spans the VAFs drawn rather than 0 to 1 (default false) */
  dataRange?: boolean;
  /** the heatmap with a row per mutation and a column per sample (default false: a row per sample, as the portal's) */
  transpose?: boolean;
  /** the heatmap's rows and columns clustered as the portal clusters an oncoprint heatmap (default true) */
  cluster?: boolean;
  /** the heatmap labels each mutation "GENE pChange" (default true) */
  mutationLabels?: boolean;
  /** the line chart's time axis draws every year, rather than cutting runs of four or more years with no event (default false), as the timeline's expandGaps */
  expandGaps?: boolean;
  /**
   * the line chart's Group by, as the portal's VAF chart: a sample clinical attribute's id (one of the
   * result's `groupOptions`); a mutation's line is drawn once per group of samples sharing a value,
   * through that group's samples alone, in the group's colour. Default none
   */
  groupBy?: string;
}

/**
 * A mutation in one sample: "called" (a called mutation with allele counts), "noVaf" (called, with
 * no allele counts), "uncalled" (not called, but variant reads found at the position — the
 * portal's uncalled mutations), "absent" (the sample was sequenced for the gene and the mutation
 * was not found: VAF 0) or "np" (not profiled: the sample's panel does not cover the gene, or the
 * sample was not sequenced for mutations — never VAF 0).
 */
export type EvolutionStatus = "called" | "noVaf" | "uncalled" | "absent" | "np";
export interface EvolutionCell {
  status: EvolutionStatus;
  /** variant / (variant + reference) reads; null where there are no reads (noVaf, np, and absent with no uncalled record) */
  vaf: number | null;
  alt: number | null; ref: number | null;
}
/** One of the patient's samples, in their order: its numbered marker, and the day it was collected when the timeline records it. */
export interface EvolutionSample {
  id: string; type: string; label: string; color: string;
  /** days from diagnosis, from the study's timeline; null when no sample event names it */
  day: number | null;
  /** its mutation panel; null when it was not sequenced for mutations */
  panel: string | null;
}
/** A drawn mutation: its name, and its state in each sample, aligned with the patient's samples. */
export interface EvolutionMutation {
  /** the mutation's identity (gene, protein change and genomic event), shared with its table row — `evolutionKey` */
  key: string;
  gene: string; proteinChange: string; mutationType: string;
  cells: EvolutionCell[];
}
export interface EvolutionResult extends TableRows<string | number | null> {
  /** the patient drawn, with their samples in order, or null when the list is empty */
  patient: { study: string; id: string; samples: EvolutionSample[] } | null;
  /** where that patient falls in the list's order, and the patients either side (as the timeline's) */
  position?: TimelineResult["position"];
  /** the patient's mutations as a table view (absent on a page request for the patient list) */
  mutations?: TableRows<string | number | null>;
  /** what the figure draws: the mutations the table's query keeps that have a VAF in some sample, in the table's order; null when not drawn */
  drawn: EvolutionMutation[] | null;
  /** why the figure is not drawn (the table's query keeps more mutations than one figure draws) */
  undrawn?: string;
  /** mutations the query keeps that carry no allele counts in any sample, so have no line or row */
  noVaf: number;
  /** how the samples are placed along the line chart's x axis: by collection day, or evenly in order */
  x: "time" | "sequence";
  /** sequence was not asked for, but these samples have no collection day, so the samples are drawn in sequence */
  noDay?: string[];
  /** the heatmap's order (chart "heatmap" only): indices into `drawn` and the patient's samples, clustered or by name */
  heatmapOrder?: { mutations: number[]; samples: number[] };
  /** placed by day: the patient's timeline axis, a tick a year from the first to the last of all the patient's events, empty stretches of four or more years cut, as the portal's line chart shares the timeline's axis */
  axis?: AxisTick[];
  /** the attributes the line chart can be grouped by: the patient's samples' own clinical attributes, id and display name */
  groupOptions?: { id: string; name: string }[];
  /** the samples' groups when grouped: in order of a value's first sample; samples without a value last, unlabelled ("") */
  groupBy?: { attribute: string; name: string; groups: EvolutionGroup[] };
  /** why the chart is not grouped though groupBy was asked for, or why the attributes to group by could not be listed */
  ungrouped?: string;
  /** the display as drawn, from the spec */
  display: { chart: "line" | "heatmap"; logScale: boolean; dataRange: boolean; expandGaps: boolean; transpose: boolean; cluster: boolean; mutationLabels: boolean; /** the Group by attribute applied, or null when the chart is not grouped */ groupBy: string | null };
}

declare module "../../types.ts" {
  interface ViewSpecs { evolution: EvolutionView }
  interface ViewResultFields {
    evolution: {
      evolution?: EvolutionResult;
    };
  }
  interface ViewResultMain { evolution: "evolution" }
}

/** A group of the patient's samples sharing a value of the Group by attribute. */
export interface EvolutionGroup {
  /** the value; "" for the samples without one */
  value: string;
  /** its colour (the portal's unique colours, in order), or null when there is one group or no value: the default ink */
  color: string | null;
  /** indices into the patient's samples, in their order */
  samples: number[];
}
