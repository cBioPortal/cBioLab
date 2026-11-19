// Planted bugs: the Clinical Data tab's header tooltips (STV-CD-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-tab-tip-drops-id", layer: "counts", guard: "unit", file: "lib/study-view-clinical-tab.ts",
    effect: "A Clinical Data column's tooltip leaves out the attribute id, so a reader cannot tell which stored attribute a renamed column is.",
    find: "[c.name, c.description || \"\", c.attribute]", replace: "[c.name, c.description || \"\"]" },
];
