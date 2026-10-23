// The genome view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Genome-wide copy-number frequency: the share of each cohort's segmented samples gained or lost
 * in every bin along the genome, from the copy-number SEGMENTS (not the per-gene calls), with a
 * per-bin Fisher test when exactly two cohorts are drawn. Counts only.
 */
export interface GenomeView {
  note?: string;
  kind: "genome"; cohorts?: string[];
  /** bin width in megabases, 1-50 (default 2) */
  binMb?: number;
  /** |log2 segment mean| at or past which a bin is gained / lost (default 0.2) */
  threshold?: number;
  /** draw chromosome X too (default false: its log ratio mostly records sex) */
  includeX?: boolean;
}
export interface GenomeSeries {
  cohort: string;
  /** the cohort's samples, and how many of them have any segment at all */
  samples: number; segmented: number;
  /** per bin, aligned with GenomeResult.bins */
  profiled: number[]; gain: number[]; loss: number[];
}
export interface GenomeResult {
  build: "hg19" | "hg38"; binMb: number; threshold: number; includeX: boolean;
  /** every bin, in genome order: its chromosome and start (bp) */
  bins: { chrom: string; start: number }[];
  series: GenomeSeries[];
  /** exactly two cohorts: Benjamini–Hochberg q per bin (null where either cohort has no sample) */
  test?: { gainQ: (number | null)[]; lossQ: (number | null)[]; significantGain: number; significantLoss: number };
  /** studies left out because they could not answer (a remote peer, or no segments at all) */
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { genome: GenomeView }
  interface ViewResultFields {
    genome: {
      genome?: GenomeResult;
    };
  }
  interface ViewResultMain { genome: "genome" }
}
