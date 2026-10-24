// The acquired view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Alterations acquired under therapy: patients with a dated sample on or before a treatment start
 * and another after it, per gene, altered after but not before (acquired), before but not after
 * (lost), on both (shared) or neither — among patients whose two samples' panels both cover the gene.
 */
export interface AcquiredView {
  note?: string;
  kind: "acquired"; cohorts?: string[];
  /** the treatment start: the FIRST event of this type, with key = value when given (default Treatment, any) */
  anchor?: { eventType: string; key?: string; value?: string };
  /** the genes to test (at most 30); omitted or empty scans every gene altered in at least `minPost` after-samples */
  genes?: string[];
  /** a scan: the fewest patients altered after treatment for a gene to be tested (default 3) */
  minPost?: number;
  /** a scan: how many genes to draw, most significant first (default 20, at most 40) */
  top?: number;
  /** the before-sample is the last on or before the start, at most this many days before it (default: any) */
  preWindowDays?: number;
  /** the after-sample is the first at least this many days after the start (default 30) */
  minGapDays?: number;
  /** the timeline event types that date a sample (default Sample acquisition, Sequencing, Specimen) and the attribute naming it (default SAMPLE_ID) */
  sampleEvents?: string[]; sampleKey?: string;
  /** any alteration (default) or OncoKB oncogenic only */
  measure?: "driver" | "any";
}
export interface AcquiredGene {
  gene: string;
  /** patients whose before- and after-sample both cover the gene */
  pairs: number; acquired: number; lost: number; shared: number; neither: number;
  /** exact McNemar p on acquired vs lost, and BH q across the genes tested in this cohort */
  p: number; q: number;
}
export interface AcquiredPanel {
  cohort: string;
  /** the funnel: anchored, with a dated sample, with one before, with one after, with both */
  anchored: number; dated: number; withPre: number; withPost: number; patients: number;
  /** among the pairs: median days from the before-sample to the start, from the start to the after-sample, and the pairs' spacing (quartiles) */
  preDays: number | null; postDays: number | null; gapDays: { q1: number; median: number; q3: number } | null;
  genes: AcquiredGene[];
  /** a scan: the genes tested (altered after in at least minPost patients), which q is taken across */
  tested?: number;
}
export interface AcquiredResult {
  anchoredTo: string;
  preWindowDays: number | null; minGapDays: number;
  sampleEvents: string[]; sampleKey: string;
  measure: "driver" | "any";
  scan?: { top: number; minPost: number };
  panels: AcquiredPanel[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { acquired: AcquiredView }
  interface ViewResultFields {
    acquired: {
      acquired?: AcquiredResult;
    };
  }
  interface ViewResultMain { acquired: "acquired" }
}
