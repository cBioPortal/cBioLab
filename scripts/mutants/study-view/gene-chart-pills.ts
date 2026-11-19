// Planted bugs: a gene chart's filter named in the filter bar (STV-FB-3 #5, #7). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "gene-pill-state-removes-chart", layer: "cohorts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "A gene chart state's × removes the chart's whole filter, where the portal removes only that state (EGFR Amplified or Gained, × on Gained, keeps nothing).",
    find: "const rest = g.states.filter((s) => s !== state);", replace: "const rest: string[] = [];" },
  { id: "gene-pill-wrong-state-names", layer: "cohorts", guard: "unit", file: "lib/gene-state-clauses.ts",
    effect: "A copy-number state is named by its key (amp) in the filter bar instead of the chart's name for it (Amplified).",
    find: "return CNA_LEVELS.find((l) => l.state === state)?.label ?? state;", replace: "return state;" },
  { id: "gene-pill-mutation-type-removes-all", layer: "cohorts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "A mutation type's × removes the table's whole filter instead of that type.",
    find: "const rest = c.values.map(String).filter((v) => v !== type);", replace: "const rest: string[] = [];" },
];
