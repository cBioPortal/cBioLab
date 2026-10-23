// The course view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { SplitBy } from "../../types.ts";

/**
 * The clinical course: what fraction of the still-observable cohort is in each
 * event state, over time relative to an anchor.
 *
 * `anchor` is optional for a single study (its own day 0 is a consistent
 * baseline) but REQUIRED once more than one study participates: day 0 means
 * different things in different studies — birth in one, first sequencing in
 * another — and the database records nowhere which it is, so aligning on raw
 * day 0 across studies compares incomparable clocks.
 */
export interface CourseView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "course"; cohorts?: string[]; splitBy?: SplitBy;
  /** canonical event names to measure; case is folded (lib/event-names.ts) */
  eventTypes: string[];
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** bin width in months (default 3) */
  binMonths?: number;
  /** window in months relative to the anchor (default -12 to 60) */
  fromMonths?: number; toMonths?: number;
}

/** One cohort x event-type line of the clinical course. */
export interface CourseSeries {
  cohort: string;
  /** display spelling of the event type; `variants` records what folded into it */
  eventType: string; variants: string[];
  /** true when this event type carries real durations, so it reads as a state */
  isInterval: boolean;
  points: CoursePoint[];
}
export interface CoursePoint {
  /** months from the anchor at the START of the half-open bin */
  t: number;
  /** patients still under observation in this bin — the denominator */
  atRisk: number;
  /** patients in this state during the bin */
  n: number;
  /** n / atRisk as a percentage, null when nobody was observable */
  pct: number | null;
}

declare module "../../types.ts" {
  interface ViewSpecs { course: CourseView }
  interface ViewResultFields {
    course: {
      course?: CourseSeries[];
      /** bin width and window actually used, in months */
      courseAxis?: { binMonths: number; from: number; to: number };
      /**
       * every event type this cohort's timeline actually holds, so the UI
       * can offer the choice without a round trip. `perPatient` and `hasDurations`
       * are what separate a clinical event from an administrative marker — a type
       * with exactly one event per patient and no duration (Sequencing, Sample
       * acquisition) is a filing record, not a course.
       */
      eventOptions?: { canonical: string; label: string; patients: number; perPatient: number; hasDurations: boolean }[];
    };
  }
  interface ViewResultMain { course: "course" }
}
