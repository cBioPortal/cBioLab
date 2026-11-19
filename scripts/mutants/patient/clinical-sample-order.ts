// Planted bugs: the Clinical Data tab's samples table in the page's sample order (PTB-CD-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-samples-id-order", layer: "counts", guard: "unit", file: "lib/views/table/transpose.ts",
    effect: "The Clinical Data tab's samples table lists its samples by id, not in the page's sample order, so a metastasis can sit before the primary the header numbers 1.",
    find: "const cols = perSample && sampleOrder ?",
    replace: "const cols = false && sampleOrder ?" },
];
