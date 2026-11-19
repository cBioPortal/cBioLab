// Planted bugs: a pill's chart name when the answer has no charts. How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "pill-name-ignores-vocabulary", layer: "counts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "With no sample left, the filter bar names a pill by the attribute's id (FRACTION_GENOME_ALTERED) instead of its chart (Fraction Genome Altered).",
    find: "for (const f of [...current, ...kept]) if", replace: "for (const f of [...current]) if" },
];
