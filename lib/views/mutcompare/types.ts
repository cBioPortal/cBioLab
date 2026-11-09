// The mutcompare view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { buildLollipopGene } from "../../lollipop.ts";

/**
 * cBioPortal's group-comparison Mutations tab: one gene's mutations in two cohorts, the first drawn
 * above the protein and the second below it, and every protein change with its patients in each
 * cohort, the log ratio of their shares and a Fisher test. The gene picker ranks genes by their
 * highest mutated share in either cohort, as the portal's does.
 */
export interface MutcompareView {
  note?: string;
  kind: "mutcompare"; cohorts?: string[];
  /** the gene drawn; unset, the one with the highest mutated share in either cohort */
  gene?: string;
  /** the y axis: share of the cohort's profiled patients (the portal's default) or a count of patients */
  axis?: "percent" | "count";
  /** cells of the Driver/VUS × alteration class grid left out of both plots ("missense.vus", …); re-runs nothing */
  hide?: string[];
  /** the codons selected on the plot (clicking a stem); the table is filtered to them. Re-runs nothing */
  positions?: number[];
}

/** One cohort's lollipop: the shared drawing rules (lib/lollipop.ts) over this cohort's mutations. */
export type MutcompareLollipop = ReturnType<typeof buildLollipopGene>;

export interface MutcompareGroup {
  name: string;
  /** patients with a sample in the cohort profiled for the gene (a panel listing it, or whole-exome): every share's denominator */
  profiled: number;
  /** patients with a mutation in the gene */
  mutated: number;
  lollipop: MutcompareLollipop;
}

/** One protein change, both cohorts' counts side by side: a row of the portal's table. */
export interface MutcompareRow {
  change: string; pos: number | null;
  /** its protein impact class and whether OncoKB calls it a driver */
  impact: string; driver: boolean;
  /** patients with the change in each cohort, and that over the cohort's profiled patients, in percent */
  n: [number, number]; pct: [number, number];
  /** log2 of the first share over the second; null when either is zero (the portal shows ±Infinity as >10 / <-10) */
  log2Ratio: number | null;
  p: number; q: number;
  /** the cohort whose share is higher (a tie: the second, as the portal's) */
  enrichedIn: string;
}

export interface MutcompareResult {
  gene: string;
  /** the genes the picker offers, by their highest mutated share (samples, as the portal ranks them); at most 200 */
  ranking: { gene: string; pct: number }[];
  groups: [MutcompareGroup, MutcompareGroup];
  rows: MutcompareRow[];
  /** the gene as a whole: mutated vs not among each cohort's profiled patients, two-sided Fisher */
  geneP: number;
  axis: "percent" | "count";
  /** OncoKB drivers are called (a pin is available); without one every mutation is coloured a driver */
  annotated: boolean;
  /** the gene has no mutation in either cohort: the portal's "Selected gene has no mutations for profiled samples." */
  empty?: string;
}

declare module "../../types.ts" {
  interface ViewSpecs { mutcompare: MutcompareView }
  interface ViewResultFields {
    mutcompare: {
      mutcompare?: MutcompareResult;
      /** the cells hidden and the codons selected, as the figure applies them (the result itself stays whole) */
      hide?: string[];
      positions?: number[];
    };
  }
  interface ViewResultMain { mutcompare: "mutcompare" }
}
