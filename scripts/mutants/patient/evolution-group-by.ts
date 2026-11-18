// Planted bugs: the Genomic Evolution line chart's Group by (PTB-GE-LC-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-group-lines-joined", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "Grouped (Group by), each group's line runs through every sample, joining samples of different groups, where the portal draws a mutation's line within one group's samples (splitMutationsBySampleGroup).",
    find: "    const pts = lineCells(m, grp.samples);",
    replace: "    const pts = lineCells(m);" },
];
