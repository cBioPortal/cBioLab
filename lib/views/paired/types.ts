// The paired view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Paired samples: among patients with a sample of each of two kinds (by default primary and
 * metastasis), gene by gene, how often an alteration is on both, only the first or only the
 * second — counted only where BOTH sides were profiled for the gene — with an exact McNemar test
 * of whether discordance runs one way. Counts only.
 *
 * Without `genes` it scans: every gene altered in some paired patient is tested, and the `top`
 * most discordant are drawn — the way to ask "what is acquired after treatment" without
 * guessing the genes first.
 */
export interface PairSides { attribute: string; a: string | string[]; b: string | string[] }
export interface PairedView {
  note?: string;
  kind: "paired"; cohorts?: string[];
  /** the genes to test; omitted or empty scans every gene altered in a paired patient */
  genes?: string[];
  /** with no `genes`: how many of the most discordant genes to draw (default 20, at most 40) */
  top?: number;
  /**
   * a sample-level attribute and the values on each side (default SAMPLE_TYPE: Primary / Metastasis).
   * `studies` gives a study its own attribute and values — studies label the same two kinds of
   * sample differently (PRE-TX / POST-TX, pre-treatment / post-treatment) — and the counts are
   * pooled across them; a study not listed uses the attribute and values at the top.
   */
  pairBy?: Partial<PairSides> & {
    studies?: Record<string, PairSides>;
    /** what to call each side in the figure and text (default: its values) */
    labels?: { a: string; b: string };
  };
  /** count OncoKB drivers only (default) or any alteration */
  measure?: "driver" | "any";
}
export interface PairedGene {
  gene: string;
  /** patients with each side profiled for this gene */
  pairs: number; both: number; aOnly: number; bOnly: number; neither: number;
  /** both ÷ (both + aOnly + bOnly): of the patients altered anywhere, altered on both sides */
  concordance: number | null;
  /** exact McNemar p on aOnly vs bOnly, and BH q across the genes of this cohort */
  p: number; q: number;
}
export interface PairedPanel {
  cohort: string; patients: number; aSamples: number; bSamples: number; genes: PairedGene[];
  /** a scan: the genes with at least one discordant patient, which q is taken across (only `genes` are drawn) */
  tested?: number;
}
export interface PairedResult {
  /** the sides as each answering study resolved them; `labels` names them in the figure and text */
  pairBy: { attribute: string; a: string[]; b: string[] };
  perStudy?: Record<string, { attribute: string; a: string[]; b: string[] }>;
  labels: { a: string; b: string };
  /** present when the view scanned rather than testing named genes */
  scan?: { top: number };
  measure: "driver" | "any";
  panels: PairedPanel[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { paired: PairedView }
  interface ViewResultFields {
    paired: {
      paired?: PairedResult;
    };
  }
  interface ViewResultMain { paired: "paired" }
}
