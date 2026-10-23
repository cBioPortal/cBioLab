// The hotspots view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

export interface HotspotsView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "hotspots"; genes: string[]; cohorts?: string[]; minCount?: number;
  /**
   * The cells of the Driver/VUS × alteration class grid left out of the plot ("missense.vus",
   * "truncating.driver", …): the grid beside it selects them. Applied where the figure is drawn,
   * so a change re-runs nothing; the counts in the grid stay whole.
   */
  hide?: string[] }
/** Recurrent protein changes in one gene, with the cohort's mutated total. */
/** One drawn stem: a codon, its height (distinct patient + change pairs), and how it is coloured. */
export interface LollipopPosition {
  pos: number; n: number; color: string; impact: string; driver: boolean;
  /** every change at this codon, by raw rows then name — the label and tooltip read these; each with its
   *  protein impact class and driver status, so a selection can leave it out (no class: a site on older code) */
  changes: { change: string; n: number; rows: number; impact?: string; driver?: boolean }[];
  /** the raw rows here by mutation type and driver status — the colour, recomputed when cells are hidden */
  types?: { mtype: string; driver: boolean; rows: number }[];
}
export interface LollipopDomain { accession: string; name: string; start: number; end: number; color: string }
/**
 * One gene's lollipop, drawn the way cBioPortal's results-page mutation tab draws it (see
 * lib/lollipop.ts): one stem per codon, height = distinct (patient, protein change) pairs.
 */
export interface HotspotGene {
  gene: string;
  /** patients with any mutation in the gene, and distinct (patient, change) pairs */
  mutated: number; mutations: number;
  positions: LollipopPosition[];
  domains: LollipopDomain[];
  proteinLength: number;
  /** genome-nexus: the canonical transcript; observed: the service was unreachable, so the highest codon seen */
  lengthSource: "genome-nexus" | "observed"; transcript?: string;
  /** pairs not drawn because they have no codon (or one past the protein) */
  unpositioned: number;
  /** pairs a site withheld under its suppression floor */
  withheld: number;
  label?: { pos: number; text: string };
  /** the commonest changes, for text summaries (chat, MCP) */
  topChanges: { change: string; pos: number | null; n: number; pct: number }[];
  /** samples with a somatic mutation in the gene, and samples in the cohort */
  somaticSamples: number; cohortSamples: number;
  /**
   * Mutation rows by protein impact type, putative driver vs VUS — the portal's badge tally
   * beside the lollipop. Every row counts, drawn or not; `other` covers silent and unknown types.
   */
  tally: Record<"missense" | "truncating" | "inframe" | "splice" | "fusion" | "other", { driver: number; vus: number }>;
  /** the transcript's other identifiers, as the portal's gene summary lists them */
  ids?: { refseq?: string; ensembl?: string; ccds?: string; uniprotAccession?: string; uniprotName?: string };
}

declare module "../../types.ts" {
  interface ViewSpecs { hotspots: HotspotsView }
  interface ViewResultFields {
    hotspots: {
      hotspots?: HotspotGene[];
      /** the cells the view hides, as applied to its figure (`hotspots` itself stays whole, so the app can re-filter it) */
      hide?: string[];
    };
  }
  interface ViewResultMain { hotspots: "hotspots" }
}
