// Planted bugs: Add chart's X vs Y tab and its density charts (STV-AC-7, STS-SC-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "xvsy-pair-order-matters", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "Asking for Mutation Count against FGA the other way round is not seen as the chart that exists, so the same pair is drawn twice.",
    find: "if (existing.includes([x.attribute, y.attribute].sort().join(\"|\")))", replace: "if (existing.includes([x.attribute, y.attribute].join(\"|\")))" },
  { id: "xvsy-pair-axes-ignored", layer: "counts", guard: "unit", file: "lib/study-view-density.ts",
    effect: "Every X vs Y chart draws Mutation Count against FGA, whatever pair was asked for.",
    find: "const [xa, ya] = s.swapped ? [pair.y, pair.x] : [pair.x, pair.y];", replace: "const [xa, ya] = s.swapped ? [MUTATION_COUNT, FGA] : [FGA, MUTATION_COUNT]; void pair;" },
];
