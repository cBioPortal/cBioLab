// Planted bugs: the Study View's selection line (STV-AB-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "selected-prefix-always", layer: "counts", guard: "unit", file: "lib/chart/format.ts",
    effect: "The header says \"Selected:\" before any filter is applied, so an unfiltered study reads as a selection.",
    find: "(filtered ? \"Selected: \" : \"\")", replace: "\"Selected: \"" },
];
