// Planted bugs: a density drag's filter without pills, shown and reset on its chart (STV-FB-3b). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "density-drag-pills-shown", layer: "cohorts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "A density drag's two ranges show as pills in the filter bar again, where the portal shows the selection on its chart only.",
    find: "if (String((c as { chart?: unknown }).chart || \"\").startsWith(\"density:\")) return { kind: \"hidden\", clause: i };", replace: "" },
  { id: "density-drag-untagged", layer: "cohorts", guard: "unit", file: "lib/study-view-density.ts",
    effect: "A drag's clauses carry no chart name, so the chart cannot find its selection to show or reset it.",
    find: "].map((c) => ({ ...c, chart }));", replace: "];" },
  { id: "density-drag-stacks", layer: "cohorts", guard: "unit", file: "lib/study-view-density.ts",
    effect: "A second drag on a density chart adds to its first selection instead of replacing it, so the samples kept are those in both boxes.",
    find: "return { ...draft, all: [...(draft.all || []).filter((c) => !(c && names.has((c as RangeClause).chart))), ...clauses] };", replace: "return { ...draft, all: [...(draft.all || []), ...clauses] };" },
];
