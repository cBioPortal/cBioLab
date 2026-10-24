// The overlap view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import type { MethodRecord, MethodStep } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function overlapMethod(t: { cohorts: string[]; perSite: { study: string; cohorts: string[]; patients: number }[]; union: number; intersections: number }): MethodRecord {
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count patients per combination of cohorts",
    detail: "The overlap query above: every patient in any of " + s.cohorts.join(", ") + " gets a bitmask of the cohorts it is in, and the study returns one count per bitmask. Counts only.",
    scope: s.study, rowsOut: s.patients,
  }));
  steps.push({ kind: "transform", title: "Add the counts across studies and name each combination",
    detail: "Each study's bits are mapped back to the view's cohort order; combinations add exactly, and a patient can only overlap within one study.",
    params: [["patients in any cohort", t.union.toLocaleString("en-US")], ["combinations with patients", String(t.intersections)]] });
  return { steps, implementation: { functions: [], file: "lib/views/overlap/run.ts", commit: BUILD_COMMIT } };
}
