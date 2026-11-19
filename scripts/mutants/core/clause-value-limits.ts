// Planted bugs: a clause listing more values than it may is refused, naming the limit (invariant 1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clause-values-cut-silently", layer: "cohorts", guard: "unit", file: "lib/cohort2.ts",
    effect: "A clinical, genomicData or genericAssay clause listing more values than its limit compiles with no error, so a cohort is built from values the definition does not name, or (cut short) leaves out values it does.",
    find: "if (n > limit) throw new Error(what + \": at most \" + limit + \" values; this lists \" + n);", replace: "if (n > limit + 1e9) throw new Error(what);" },
];
