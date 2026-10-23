// The sequence view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

/**
 * Treatment sequences: what follows what, as lines of therapy.
 *
 * `exclude` drops label values that are not therapies. It is a parameter rather
 * than an engine rule because such markers are not structurally distinguishable
 * from real treatments — in MSK-CHORD the SUBTYPE `Prior Medications to MSK`
 * carries no duration, but neither do `Radiation Therapy` or `Investigational`.
 * Putting the choice in the document keeps it visible to whoever reads the result.
 */
export interface SequenceView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "sequence"; cohorts?: string[];
  /** event type carrying therapies (default: treatment) */
  eventType?: string;
  /** attribute key labelling each therapy (default: SUBTYPE) */
  labelKey?: string;
  exclude?: string[];
  /** days with no therapy that begin a new line (default 90) */
  lineGap?: number;
  /** lines to follow (default 3) */
  maxSteps?: number;
  /** distinct labels kept before the rest fold into "other" (default 8) */
  topN?: number;
  /** which treatment records form lines: "systemic" (default), "all", or class names — lib/treatment-lines.ts */
  lineClasses?: "systemic" | "all" | string[];
}
/**
 * Therapy transitions, ready to draw: nodes in columns, flows between them.
 * One panel per cohort, sharing one scale and one colour assignment so two
 * cohorts can be compared without re-reading the legend.
 */
export interface SequenceResult {
  labelKey: string; lineGap: number; steps: number;
  foldedLabels: number; truncated: boolean;
  /** other attribute keys that could label a line, with how granular each is */
  keyOptions?: { key: string; label: string; patients: number; values: number }[];
  panels: SequencePanel[];
}
/**
 * `kind` distinguishes the two ways a path can end, which the label text alone
 * cannot: a regimen name is study data and could say anything.
 *   regimen  — a real line of therapy
 *   stopped  — observed for at least one line gap and began no further line
 *   censored — the record simply ends, so nothing can be concluded
 */
export type SequenceNodeKind = "regimen" | "stopped" | "censored";
export interface SequencePanel {
  cohort: string;
  nodes: { column: number; label: string; n: number; kind: SequenceNodeKind }[];
  /** `kind` describes the TARGET of the flow */
  flows: { column: number; from: string; to: string; n: number; kind: SequenceNodeKind }[];
  /** patients with a first line */
  started: number;
  /** of those, how many end in a censored terminal at any column */
  censored: number;
}

declare module "../../types.ts" {
  interface ViewSpecs { sequence: SequenceView }
  interface ViewResultFields {
    sequence: {
      sequence?: SequenceResult;
    };
  }
  interface ViewResultMain { sequence: "sequence" }
}
