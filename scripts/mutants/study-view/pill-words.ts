// Planted bugs: the words between the Study View filter bar's groups (STV-FB-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "pill-and-across-charts", layer: "counts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "An \"and\" is written between generic groups of different charts (a case list after a gene), where the portal writes none.",
    find: "&& chartOfClause(all[g.clause]) === chartOfClause(all[prev.clause]);", replace: ";" },
];
