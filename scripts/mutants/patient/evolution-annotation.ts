// Planted bugs: the Genomic Evolution table's Annotation column (PTB-GE-TB-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "evolution-annotation": ["node", "--env-file=.env.local", "scripts/check-evolution-annotation.ts"],
};

export const mutants: Mutant[] = [
  { id: "evolution-annotation-any-alteration", layer: "counts", guard: "evolution-annotation", file: "lib/views/evolution/sql.ts",
    effect: "A Genomic Evolution row takes OncoKB's call for any alteration of its gene, so KRAS G12D reads G12C's Level 1.",
    find: "ann.alteration = g.proteinChange\" : \"\")",
    replace: "1 = 1\" : \"\")" },
  { id: "evolution-annotation-unpinned", layer: "counts", guard: "evolution-annotation", file: "lib/views/evolution/run.ts",
    effect: "The Genomic Evolution table never reads the OncoKB pin, so its Annotation column is always blank.",
    find: "evolutionMutationsSource(parts[0], pt.id, db, order, ctx.pin)",
    replace: "evolutionMutationsSource(parts[0], pt.id, db, order, null)" },
];
