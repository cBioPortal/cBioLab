// The germline view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve, LogRankK } from "../../types.ts";

/**
 * Germline carriers and their somatic second hits: per gene, the patients with a germline call,
 * their share of the patients sequenced for the gene, and how often the tumour carries a second,
 * somatic hit in the same gene, against the somatic rate in non-carriers; optionally OS by carrier
 * status for one gene. Patient-level counts only.
 */
export interface GermlineView {
  note?: string;
  kind: "germline"; cohorts?: string[];
  /** the genes (at most 60); default every gene with at least minCarriers carriers in a cohort */
  genes?: string[];
  minCarriers?: number;
  /** draw OS for one gene's carriers against non-carriers */
  survival?: { gene: string };
}
export interface GermlineCounts {
  /** patients sequenced for the gene (a mutation panel listing it, or WES), carriers among them, and carriers whose panel does not list it (left out) */
  sequenced: number; carriers: number; outsidePanel: number;
  carrierSomatic: number; carrierCnaProfiled: number; carrierDeletion: number; carrierEither: number;
  noncarriers: number; noncarrierSomatic: number; noncarrierCnaProfiled: number; noncarrierDeletion: number; noncarrierEither: number;
}
export interface GermlineGene extends GermlineCounts {
  gene: string;
  /** Fisher's exact test of carriers' second-hit rate against non-carriers' somatic rate, and BH q */
  p: number | null; q: number | null;
}
export interface GermlineResult {
  genes: string[]; minCarriers: number; chosen?: string;
  panels: { cohort: string; patients: number; genes: GermlineGene[] }[];
  survival?: { cohort: string; gene: string; curves: (Omit<KmCurve, "cohort"> & { group: string })[]; logrank: LogRankK | null; noTest?: string }[];
  /** what was done about loss of heterozygosity */
  loh: string;
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { germline: GermlineView }
  interface ViewResultFields {
    germline: {
      germline?: GermlineResult;
    };
  }
  interface ViewResultMain { germline: "germline" }
}
