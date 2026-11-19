// Planted bugs: the Study View's survival colour and the gene mutation chart's labels (STS-KM-2, STS-GS-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "study-view-km-series-colour", layer: "counts", guard: "unit", file: "lib/views/survival/figure.ts",
    effect: "The Study View's survival curve is drawn in the analysis series blue (#0072B2) rather than the portal's #2986E2.",
    find: "const styleOf = (i: number) => single ? { color: single, dash: \"\" } : seriesStyle(i);",
    replace: "const styleOf = (i: number) => seriesStyle(i);" },
];
