// The course view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface CourseTrace {
  anchor?: string;
  binMonths: number;
  fromBin: number; toBin: number;
  riskFloor: number;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  dropped: string[];
  /** each measured event type: its label, the spellings folded into it, and whether it carries durations */
  events: { canonical: string; label: string; variants: string[]; isInterval: boolean }[];
  cohorts: { name: string; patients: number; anchored: number; observed: number }[];
  /** per cohort, summed over its studies: patients observable in each bin (event ''), and in each state */
  counts: { cohort: string; bin: number; event: string; n: number }[];
  /** what the view reported — for the script check */
  results: { cohort: string; event: string; bin: number; atRisk: number; n: number; pct: number | null }[];
}

export function courseMethod(t: CourseTrace): MethodRecord {
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count patients per time bin",
    detail: "The timelineSpan and eventCourse queries above. Per " + t.binMonths + "-month bin: the cohort's patients observable in it, and of those the ones in each event's state (or with the event in it). Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  if (t.dropped.length) steps.push({ kind: "transform", title: "Leave out studies with no timeline structure",
    detail: "A study whose every event sits on one day cannot place anything in time: " + t.dropped.join(", ") + "." });
  const folds = t.events.filter((e) => e.variants.length > 1);
  steps.push({ kind: "transform", title: "Match event types",
    detail: "Event types, keys and values match ignoring case and surrounding whitespace; nothing else is merged." +
      (folds.length ? " Folded here: " + folds.map((e) => e.variants.join(" = ")).join("; ") + "." : ""),
    params: t.events.map((e) => [e.label, e.isInterval ? "has durations: a state the patient is in during a bin" : "no durations: an event that happened in a bin"] as [string, string]) });
  steps.push({ kind: "transform", title: t.anchor ? "Align on " + t.anchor : "Align on each study's day 0",
    detail: (t.anchor ? "Day 0 is each patient's " + t.anchor + "; a patient without one is in no bin."
      : "Day 0 is the study's own baseline, which is not comparable across studies.") +
      " A patient is observable from their first recorded event to their last contact — the later of their last recorded event and their OS follow-up (OS_MONTHS × 30.4375 days, assuming it starts at the timeline's day 0).",
    params: t.cohorts.map((c) => [c.name, c.patients.toLocaleString() + " in the cohort → " + c.anchored.toLocaleString() + (t.anchor ? " with the anchor event" : " aligned") +
      " → " + c.observed.toLocaleString() + " observable in the window"] as [string, string]) });
  steps.push({ kind: "statistic", title: "Share per bin",
    detail: "For each bin from month " + t.fromBin * t.binMonths + " to " + (t.toBin + 1) * t.binMonths + " (half-open [t, t+" + t.binMonths + ")): patients in the state ÷ patients observable, as a percentage. The figure stops each line where fewer than " +
      t.riskFloor + " patients remain observable." });
  const python = [
    "# Recompute each bin's percentage from the counts.",
    "import io",
    "import pandas as pd",
    "",
    RESULT_INIT,
    ...pyTable("counts", "Per cohort (summed over its studies) and bin: patients observable (event \"\") and in each event's state", ["cohort", "bin", "event", "n"],
      t.counts.map((r) => [r.cohort, r.bin, r.event, r.n]), "course_counts.csv"),
    "counts[\"event\"] = counts[\"event\"].fillna(\"\")",
    "n = counts.set_index([\"cohort\", \"event\", \"bin\"])[\"n\"]",
    "events = " + JSON.stringify(Object.fromEntries(t.events.map((e) => [e.canonical, e.label]))) + "  # folded name: label",
    "for cohort in " + JSON.stringify(t.cohorts.map((c) => c.name)) + ":",
    "    for event, label in events.items():",
    "        for b in range(" + t.fromBin + ", " + (t.toBin + 1) + "):",
    "            at_risk, k = n.get((cohort, \"\", b), 0), n.get((cohort, event, b), 0)",
    "            pct = 100 * k / at_risk if at_risk else None",
    "            RESULT[f\"course:{cohort}:{label}:{b}:pct\"], RESULT[f\"course:{cohort}:{label}:{b}:at_risk\"] = pct, at_risk",
    "        print(cohort, label, [round(RESULT[f'course:{cohort}:{label}:{b}:pct'], 1) if RESULT[f'course:{cohort}:{label}:{b}:pct'] is not None else None",
    "                              for b in range(" + t.fromBin + ", " + (t.toBin + 1) + ")])",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: [], file: "lib/views/course/run.ts", commit: BUILD_COMMIT },
    python: withResult(python),
    // percentages are reported to 1 decimal
    check: checks("course:", t.results, (r) => r.cohort + ":" + r.event + ":" + r.bin,
      [["pct", "pct", { abs: 0.05 + 1e-9 }], ["atRisk", "at_risk", { abs: 0 }]]),
  };
}
