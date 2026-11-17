// Planted bugs: the Structural Variants tab's "Beta!" label (a PageTab badge).
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "sv-tab-badge-dropped", layer: "counts", guard: "unit", file: "app/portal/page-doc.ts",
    effect: "The Structural Variants tab loses its \"Beta!\" beside the name, which the portal shows.",
    find: ", ...(t.badge ? { badge: t.badge } : {}) });",
    replace: " });" },
];
