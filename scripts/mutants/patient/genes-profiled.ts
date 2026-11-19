// Planted bugs: the Patient mutation table's genes-profiled-in-all-samples filter (PAT-MT-6, PAT-STM-15). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "patient-genes-all-ignored", layer: "counts", guard: "patient-sv", file: "lib/patient-alterations.ts",
    effect: "The Patient mutation table's \"Genes profiled in all samples\" keeps a gene one sample's panel leaves out (FX-P33's EGFR).",
    find: "      (covered ? missCte(p, patient, db, \"MUTATION_EXTENDED\", samples, cover.panels) : \"\") +",
    replace: "      (covered ? missCte(p, patient, db, \"MUTATION_EXTENDED\", samples, cover.panels).replace(\"AND (gg.gene, vs.su) NOT IN\", \"AND 0 AND (gg.gene, vs.su) NOT IN\") : \"\") +" },
];
