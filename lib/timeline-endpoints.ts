// What the views reading an endpoint off the timeline share: the progression event (its defaults,
// checks and words) and the check that the timeline and OS_MONTHS run on one clock.
import type { ProgressionEvent } from "./federation-views.ts";

/** the progression event as a view names it; every field optional */
export interface ProgressionInput { eventType?: string; key?: string; values?: string[]; probabilityKey?: string; minProbability?: number }

/** The progression event with its defaults: event type Diagnosis, key PROGRESSION, values Y / Yes (matched folded). */
export function progressionEvent(raw: ProgressionInput | undefined): ProgressionEvent {
  const pr0 = raw || {};
  return {
    eventType: String(pr0.eventType || "Diagnosis").slice(0, 120), key: String(pr0.key || "PROGRESSION").slice(0, 120),
    values: (pr0.values && pr0.values.length ? pr0.values : ["Y", "Yes"]).map((v) => String(v).slice(0, 80)),
    ...(pr0.probabilityKey ? { probabilityKey: String(pr0.probabilityKey).slice(0, 120), minProbability: Number(pr0.minProbability) } : {}),
  };
}

/** why a progression event cannot be used, or null */
export function progressionError(p: ProgressionEvent): string | null {
  if (p.values.length > 10) return "progression.values takes at most 10 values";
  if (p.probabilityKey && !Number.isFinite(p.minProbability)) return "progression.probabilityKey needs minProbability, the least probability counted as progression";
  return null;
}

/** what makes an event a progression, in words: "PROGRESSION in Y / Yes and NLP_PROGRESSION_PROBABILITY ≥ 0.8" */
export const progressionCondition = (p: ProgressionEvent): string =>
  p.key + " in " + p.values.join(" / ") + (p.probabilityKey ? " and " + p.probabilityKey + " ≥ " + p.minProbability : "");

/** a study whose timeline runs past OS follow-up for more than this share of its patients is refused */
export const CLOCK_TOLERANCE = 0.05;

/** the studies failing the clock check, from each study's count of late patients over those checked */
export function clockFailures(byStudy: Map<string, { late: number; anchored: number }>): [string, { late: number; anchored: number }][] {
  return [...byStudy].filter(([, x]) => x.anchored > 0 && x.late / x.anchored > CLOCK_TOLERANCE);
}
