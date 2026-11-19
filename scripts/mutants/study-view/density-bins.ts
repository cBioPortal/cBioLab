// Planted bugs: a density drag's ranges added to the bar charts as custom bins (STS-SC-6). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "density-edges-drop-end", layer: "counts", guard: "unit", file: "lib/study-view-density.ts",
    effect: "A density drag adds only its ranges' starts to the bar charts, so the dragged range's top is not a bar edge and the filter is not drawn as its own bars.",
    find: "ends: [c.range.gte, c.range.lte] }", replace: "ends: [c.range.gte] }" },
];
