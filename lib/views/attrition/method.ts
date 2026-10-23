// The attrition view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import type { MethodRecord } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function attritionMethod(panels: { cohort: string; base: number; steps: { label: string; n: number; excluded: number }[]; studies: string[] }[]): MethodRecord {
  return {
    steps: panels.map((p) => ({
      kind: "fetch" as const, title: "Count the cohort clause by clause",
      detail: "One attrition query per step above, per study: the patients left after ANDing that clause onto every clause before it, in the order the cohort lists them, summed across " +
        (p.studies.length === 1 ? p.studies[0] : p.studies.length + " studies (overlap not deduplicated)") + ". Nothing is computed from these counts beyond the differences between steps.",
      scope: p.cohort,
      params: [["every patient", p.base.toLocaleString()], ...p.steps.map((s) => [s.label, s.n.toLocaleString() + " (−" + s.excluded.toLocaleString() + ")"] as [string, string])],
    })),
    implementation: { functions: [], file: "lib/views/attrition/run.ts", commit: BUILD_COMMIT },
  };
}
