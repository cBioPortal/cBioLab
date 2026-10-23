// The attrition view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Cohort attrition: for each cohort, the patients remaining after each successive clause of its
 * `all`, CONSORT-style — so a reader sees which criterion removed whom before trusting any
 * downstream number. Counts only; every participant can answer.
 */
export interface AttritionView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "attrition"; cohorts?: string[];
}
export interface AttritionStep {
  /** the clause, in the same plain language as the cohort readback */
  label: string;
  /** patients left after this clause and every clause above it */
  n: number;
  /** removed by this clause alone, given the ones above it */
  excluded: number;
  /** n as a share of the study base, one decimal */
  pctOfBase: number | null;
}
export interface AttritionPanel { cohort: string; base: number; steps: AttritionStep[]; studies: string[] }

declare module "../../types.ts" {
  interface ViewSpecs { attrition: AttritionView }
  interface ViewResultFields {
    attrition: {
      attrition?: AttritionPanel[];
    };
  }
  interface ViewResultMain { attrition: "attrition" }
}
