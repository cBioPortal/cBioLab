// Planted bugs: the Genomic Evolution point tooltip (PTB-GE-LC-6). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-tip-absent-uncalled", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "The Genomic Evolution tooltip calls a sample sequenced without the mutation \"Mutation uncalled\", where the portal says \"Mutation not detected\".",
    find: "case \"absent\": return reads ? \"Mutation not detected (\" + reads",
    replace: "case \"absent\": return reads ? \"Mutation uncalled (\" + reads" },
];
