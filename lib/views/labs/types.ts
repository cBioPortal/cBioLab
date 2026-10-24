// The labs view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type {  } from "../../types.ts";

export interface LabsView {
  note?: string;
  kind: "labs"; cohorts?: string[];
  /** the test, as its event attribute names it (e.g. "PSA", "CEA") */
  test: string;
  /** where lab results live (defaults: event type Lab_Test, the test in TEST, the value in RESULT) */
  eventType?: string; testKey?: string; resultKey?: string;
  /** the clock's start: the treatment whose effect is read */
  anchor: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** baseline is the last value this many days before, or on, the anchor (default 90) */
  baselineDays?: number;
  /** the window, in weeks around the anchor (default −12 to 52), and its bin width (default 4) */
  fromWeeks?: number; toWeeks?: number; binWeeks?: number;
  /** a responder's best fall from baseline, in percent (default 50, PCWG3's PSA50) */
  responseDrop?: number;
}
export interface LabsPanel {
  cohort: string;
  /** the denominators: anchored, with a baseline, with a positive baseline, with a value after the anchor */
  anchored: number; baseline: number; positiveBaseline: number; evaluable: number;
  /** per bin: its start in weeks, the patients measured, and the quartiles of % change */
  course: { week: number; n: number; q1: number | null; median: number | null; q3: number | null }[];
  /** best % change after the anchor, in 2-point bins centred on −100, −98, … +300 (the last holds everything above) */
  best: number[];
  responders: number;
  /** each patient's best % change, sorted — present only from patient-level participants */
  waterfall?: number[];
  /** patients whose best could not be drawn as a bar (an aggregate-only participant's) */
  waterfallWithheld?: number;
  /** evaluable patients whose bars were cut by the waterfall's bar limit (drawn ones are the lowest) */
  waterfallCapped?: number;
}
export interface LabsResult {
  test: string; anchoredTo: string; responseDrop: number;
  fromWeeks: number; toWeeks: number; binWeeks: number; baselineDays: number;
  panels: LabsPanel[];
  /** two cohorts: Fisher on responders */
  responseP?: number;
  excluded?: { study: string; reason: string }[];
}

declare module "../../types.ts" {
  interface ViewSpecs { labs: LabsView }
  interface ViewResultFields {
    labs: {
      labs?: LabsResult;
    };
  }
  interface ViewResultMain { labs: "labs" }
}
