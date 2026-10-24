// The instability view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Genomic instability from copy-number segments (hg19): per sample, the fraction of the genome
 * altered and arm-level gains and losses, whose count is the aneuploidy score (Taylor et al. 2018);
 * per cohort their distributions, a rank test between cohorts, and each arm's gain/loss frequency.
 */
export interface InstabilityView {
  note?: string;
  kind: "instability"; cohorts?: string[];
  /** |log2 segment mean| at or past which a segment is gained or lost (default 0.2) */
  threshold?: number;
  /** an arm is called when more than this share of its length is past the threshold (default 0.5) */
  armShare?: number;
  /** score chromosome X too (default false: its log ratio mostly records sex) */
  includeX?: boolean;
}
export interface InstabilitySpread { p5: number | null; q1: number | null; median: number | null; q3: number | null; p95: number | null; mean: number | null }
export interface InstabilityPanel {
  cohort: string;
  /** the cohort's samples, those with segments, and those with every scored arm measured */
  samples: number; segmented: number; allArms: number;
  /** samples by aneuploidy score (index = arms altered), and by FGA in 1-point bins (index = percent) */
  score: number[]; fga: number[];
  scoreSpread: InstabilitySpread; fgaSpread: InstabilitySpread;
  /** per arm (in `arms` order): the samples that measured it, and those gaining or losing it */
  arms: { arm: string; measured: number; gain: number; loss: number }[];
}
export interface InstabilityResult {
  build: "hg19"; threshold: number; armShare: number; includeX: boolean;
  arms: string[];
  panels: InstabilityPanel[];
  /** two cohorts: Mann–Whitney; more: Kruskal–Wallis — on the aneuploidy score and on FGA */
  test: { name: "Mann–Whitney U" | "Kruskal–Wallis"; scoreP: number; fgaP: number } | null;
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { instability: InstabilityView }
  interface ViewResultFields {
    instability: {
      instability?: InstabilityResult;
    };
  }
  interface ViewResultMain { instability: "instability" }
}
