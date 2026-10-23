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

/** a treatment anchor as a view names it */
export interface AnchorInput { eventType?: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" }
export interface TreatmentAnchor { eventType: string; key?: string; value?: string; occurrence: "FIRST" | "LAST" }

/**
 * The anchor whose start begins a patient's clock — a timeline event (optionally with key = value),
 * its first occurrence unless LAST — and its words ("first Treatment [SUBTYPE=Immuno]"); or why it
 * cannot be one. `what` names the view in the refusal ("a treatment-endpoints view").
 */
export function treatmentAnchor(a0: AnchorInput | undefined, what: string): { anchor: TreatmentAnchor; anchoredTo: string } | { error: string } {
  if (!a0 || typeof a0 !== "object" || !String(a0.eventType || "").trim())
    return { error: what + " needs anchor: {eventType, key?, value?} — the treatment whose start begins the clock, e.g. {eventType: \"Treatment\", key: \"SUBTYPE\", value: \"Immuno\"}" };
  if (!!a0.key !== (a0.value != null && a0.value !== "")) return { error: "anchor's key and value go together" };
  const anchor = { eventType: String(a0.eventType).trim().slice(0, 120), ...(a0.key ? { key: String(a0.key).slice(0, 120), value: String(a0.value).slice(0, 200) } : {}),
    occurrence: a0.occurrence === "LAST" ? "LAST" as const : "FIRST" as const };
  const anchoredTo = (anchor.occurrence === "LAST" ? "last " : "first ") + anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "");
  return { anchor, anchoredTo };
}

/** the refusal when no cohort patient has the anchor, listing the values its key takes (rows of labTestsSql) */
export function noAnchorMessage(anchor: TreatmentAnchor, vNames: string[], vals: Record<string, unknown>[]): string {
  return "no patient of " + (vNames.length === 1 ? "“" + vNames[0] + "”" : "these cohorts") + " has a " + anchor.eventType + " event" +
    (anchor.key ? " with " + anchor.key + " = " + anchor.value : "") +
    (vals.length ? ". " + anchor.key + " takes: " + vals.slice(0, 20).map((v) => String(v.test) + " (" + Number(v.patients).toLocaleString("en-US") + " patients)").join(", ") : "");
}
