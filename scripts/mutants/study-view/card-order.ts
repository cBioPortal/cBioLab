// Planted bugs: Explore's card order by the portal's priorities (STS-LY-3, STS-LY-8). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "card-order-cna-before-sv", layer: "counts", guard: "unit", file: "lib/study-view-config.ts",
    effect: "The structural-variant gene table ranks below the CNA table, where the portal puts SV (85) before CNA (80).",
    find: "{ selector: '[data-genetable=\"sv\"]', name: \"Structural Variant Genes\", priority: 85 },", replace: "{ selector: '[data-genetable=\"sv\"]', name: \"Structural Variant Genes\", priority: 79 }," },
  { id: "add-chart-offers-negative-priority", layer: "counts", guard: "unit", file: "lib/study-view-config.ts",
    effect: "Add chart offers an attribute whose priority is below 0, which the portal drops entirely.",
    find: "(priority ?? 0) >= 0;", replace: "true;" },
];
