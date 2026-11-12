// The segments view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Per-sample copy-number segment tracks: one heat strip per sample of the cohort, coloured by each
 * segment's mean log2 ratio (IGV's seg-track scale, as the portal's CN Segments tab draws it), over
 * the whole genome or zoomed to a gene or region. The rows name samples, so only a patient-level
 * participant draws them.
 */
export interface SegmentsView {
  note?: string;
  kind: "segments"; cohorts?: string[];
  /** zoom to this gene: its span in IGV's refGene annotation, 1 kb either side (the portal's IGV locus) */
  gene?: string;
  /** zoom to a chromosome ("17", "chrX") or a stretch of one ("chr17:37,000,000-38,000,000"); not with gene */
  region?: string;
  /** sample rows drawn at most (default 300, 1–2000); the rest are counted and named as left out */
  rows?: number;
  /**
   * row order: "order" (default) the study's own sample order (internal sample id) — for one
   * patient, their samples numbered in collection order; "gained" / "lost" by the sample's mean over
   * the region drawn (covered bases weighted), highest / lowest first
   */
  sort?: "order" | "gained" | "lost";
  /**
   * the patient page's genomic overview, as the portal's patient view draws it: the samples'
   * mutations as a track above the segments, each sample's gene panels, and a row for a sample with
   * mutations but no segments
   */
  overview?: boolean;
}

/** One mutation on the overview's mutation track. */
export interface SegmentsMutation {
  /** index into `samples` */
  s: number;
  /** chromosome as the axis names it (1–22, X, Y, or as stored), and 1-based start and end */
  chrom: string; start: number; end: number;
  gene: string; change: string; type: string;
}

/** One sample's row. */
export interface SegmentsSample {
  study: string; patient: string; sample: string;
  /** the sample's mean log2 ratio over the region drawn, weighted by covered bases; null when no segment reaches it */
  score: number | null;
  /** for one patient's samples: their number and colour, as the patient's other views mark them */
  mark?: { label: string; color: string };
  /** its segments over the whole genome, flat: [chromosome index into `segChroms`, start, end, mean] per segment */
  segs: number[];
  /** the overview's gene panels: the panel the sample's mutations and copy number were called on ('WES'/'WGS' or absent: whole exome/genome) */
  panels?: { mutation?: string; cna?: string };
}

export interface SegmentsResult {
  build: "hg19" | "hg38";
  /** what is drawn: the whole genome, or one chromosome's stretch (a gene's span, with its flank) */
  region: { label: string; chrom: string | null; start: number; end: number;
    gene?: { name: string; start: number; end: number } };
  /** the chromosomes along the axis, with their lengths (one, when zoomed) */
  chroms: { c: string; length: number }[];
  /** the chromosomes a sample's `segs` index: 1–22, X, Y */
  segChroms: string[];
  sort: "order" | "gained" | "lost";
  samples: SegmentsSample[];
  /** the cohort's samples, those with any segment, and how many of those were drawn */
  cohortSamples: number; segmented: number; rowsLimit: number;
  /** segmented samples left out by the row limit */
  leftOut: number;
  /** drawn samples with no segment in the region (an unmeasured row, not copy-neutral) */
  noSegment: number;
  /** segments on chromosomes the axis does not hold (not 1–22, X, Y), not drawn */
  otherChrom: number;
  /** the overview's mutations (only with `overview`), in sample order */
  mutations?: SegmentsMutation[];
  /** studies left out: aggregate-only or remote participants, or no segments */
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { segments: SegmentsView }
  interface ViewResultFields {
    segments: {
      segments?: SegmentsResult;
    };
  }
  interface ViewResultMain { segments: "segments" }
}
