// Planted bugs: the Patient page's Pathways table, "Pathway altered" (PTB-PW-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "pathways-altered-at-zero", layer: "counts", guard: "unit", file: "lib/views/pathwaymap/rank.ts",
    effect: "The Patient page's Pathways table calls every pathway altered, even one holding none of the patient's altered genes.",
    find: "(r: Pick<RankedPathway, \"score\">): boolean => r.score > 0;",
    replace: "(r: Pick<RankedPathway, \"score\">): boolean => r.score >= 0;" },
];
