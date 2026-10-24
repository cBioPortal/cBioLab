// The ctdna view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { KmCurve, LogRank } from "../../types.ts";

/** what the clonal-haematopoiesis filter removed from a cohort's plasma calls, and the headline numbers without it */
export interface CtdnaChPanel {
  /** plasma mutation calls, those with matched-normal counts loaded, removed by gene / by the normal / by either, and the patients with a removed call */
  calls: number; withNormal: number; byGene: number; byNormal: number; removed: number; patients: number;
  /** per gene, the calls and patients removed */
  genes: { gene: string; calls: number; patients: number; byGene: number; byNormal: number }[];
  /** without the filter */
  before: {
    detected: number; detectedLow: number | null; detectedHigh: number | null;
    genes: { gene: string; both: number; plasmaOnly: number; ppa: number | null }[];
    survival: { curves: { label: string; n: number; events: number; median: number | null }[]; p: number | null } | null;
  };
}
/**
 * ctDNA against tissue: patients with a plasma (cfDNA) sample and a tissue sample, per gene covered
 * by both, altered in both, tissue only, plasma only or neither; plasma's positive percent
 * agreement with tissue as the reference; the share of plasma patients with any alteration
 * detected; and overall survival by ctDNA detected or not.
 */
export interface CtdnaView {
  note?: string;
  kind: "ctdna"; cohorts?: string[];
  /** the genes (at most 30); omitted, the `top` (default 15, at most 30) most altered in the paired patients */
  genes?: string[]; top?: number;
  /** the sample attribute classing samples (default SAMPLE_CLASS) and its plasma (default cfDNA, ctDNA) and tissue (default Tumor) values */
  attribute?: string; plasma?: string[]; tissue?: string[];
  /** samples on these panels count as plasma whatever the attribute says (e.g. ["ACCESS129"]) */
  plasmaPanels?: string[];
  /** keep only samples the timeline dates within this many days of a sample of the other kind (default: no dates needed) */
  withinDays?: number;
  sampleEvents?: string[]; sampleKey?: string;
  /** any alteration (default) or OncoKB oncogenic only */
  measure?: "driver" | "any";
  /**
   * leave out plasma mutation calls likely from clonal haematopoiesis: true for the defaults, or
   * `genes` (default the canonical CH genes; [] for none) and `normal` (default true: calls whose
   * matched white-cell sample has at least `normalMinAlt`, default 2, alternate reads at an allele
   * fraction at least `normalMinRatio`, default 0.3, of the plasma's)
   */
  chFilter?: boolean | { genes?: string[]; normal?: boolean; normalMinAlt?: number; normalMinRatio?: number };
}
export interface CtdnaGene {
  gene: string;
  /** patients whose plasma and tissue samples both cover the gene */
  pairs: number; both: number; tissueOnly: number; plasmaOnly: number; neither: number;
  /** positive percent agreement: both ÷ altered in tissue, with its 95% Wilson interval (null when tissue has none) */
  ppa: number | null; ppaLow: number | null; ppaHigh: number | null;
  /** (both + neither) ÷ pairs */
  concordance: number | null;
}
export interface CtdnaPanel {
  cohort: string;
  /** patients with a plasma sample, a tissue sample, both; samples of each kind among those with both */
  plasmaPatients: number; tissuePatients: number; patients: number; plasmaSamples: number; tissueSamples: number;
  /** with withinDays: before the date rule, patients with plasma and tissue; and the classed samples the timeline dated */
  undated?: { plasmaPatients: number; tissuePatients: number; datedSamples: number };
  /** of the plasma patients, those with any (driver) alteration called in plasma, with a 95% Wilson interval */
  detected: number; detectedLow: number | null; detectedHigh: number | null;
  genes: CtdnaGene[];
  /** overall survival of the plasma patients by ctDNA detected or not; null with why when not drawn */
  survival: { curves: (Omit<KmCurve, "cohort"> & { label: string })[]; logrank: LogRank | null; missing: number } | null;
  survivalWhy?: string;
  /** with chFilter */
  ch?: CtdnaChPanel;
}
export interface CtdnaResult {
  attribute: string; plasma: string[]; tissue: string[]; plasmaPanels: string[];
  withinDays: number | null;
  measure: "driver" | "any";
  /** present when the genes were chosen as the most altered */
  top?: number;
  panels: CtdnaPanel[];
  excluded?: { study: string; reason: string }[];
  /** with chFilter: the rule applied */
  chFilter?: { genes: string[]; normalMinAlt: number | null; normalMinRatio: number };
}

declare module "../../types.ts" {
  interface ViewSpecs { ctdna: CtdnaView }
  interface ViewResultFields {
    ctdna: {
      ctdna?: CtdnaResult;
    };
  }
  interface ViewResultMain { ctdna: "ctdna" }
}
