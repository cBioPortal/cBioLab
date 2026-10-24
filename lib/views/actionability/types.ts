// The actionability view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Clinical actionability from the version-pinned OncoKB store: each sequenced patient's highest
 * sensitive therapeutic level (1, 2, 3A, 3B, 4) and any resistance level (R1, R2) over their
 * alterations, as shares per cohort (optionally per group of an attribute), and for patients with
 * a sample on each side of `pairBy` the concordance of their highest level between the two. Counts only.
 */
export interface ActionabilityView {
  note?: string;
  kind: "actionability"; cohorts?: string[];
  /** split each cohort by a categorical attribute (e.g. CANCER_TYPE); default none */
  groupBy?: string;
  /** with groupBy, the largest groups drawn (default 8); the rest are pooled into a disclosed "Other" */
  top?: number;
  /** the two sides compared for concordance (default SAMPLE_TYPE Primary against Metastasis); null turns it off */
  pairBy?: { attribute: string; a: string[]; b: string[] } | null;
}
/** patients per highest level: [1, 2, 3A, 3B, 4, none], and with a resistance level [R1, R2] */
export interface ActionLevels { sequenced: number; levels: number[]; resistance: number[] }
export interface ActionabilityPanel extends ActionLevels {
  cohort: string;
  /** the cohort's patients, sequenced or not */
  patients: number;
  groups?: (ActionLevels & { label: string })[];
  /** groups past `top`, pooled into the last group */
  pooled?: string[];
  /** patients with a sequenced sample on each side: table[a][b] over the six highest levels, and how many differ */
  concordance?: { pairs: number; table: number[][]; discordant: number };
}
export interface ActionabilityResult {
  pin: string; levels: string[]; groupBy: string | null; top: number;
  pairBy: { attribute: string; a: string[]; b: string[] } | null;
  panels: ActionabilityPanel[];
  /** the alteration types the store has levels for at this pin */
  storeTypes: string[];
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { actionability: ActionabilityView }
  interface ViewResultFields {
    actionability: {
      actionability?: ActionabilityResult;
    };
  }
  interface ViewResultMain { actionability: "actionability" }
}
