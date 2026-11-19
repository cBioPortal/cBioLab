// Planted bugs: Genomic Evolution's "only selected" (PTB-GE-LC-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-only-selected-ignored", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "Ticking only selected still draws every mutation the table keeps.",
    find: "drawn: d.filter((m) => keys.has(m.key))",
    replace: "drawn: d" },
  { id: "evolution-only-selected-empty-draws-all", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "With nothing selected, only selected draws every mutation, where the portal draws none.",
    find: "d.filter((m) => keys.has(m.key))",
    replace: "d.filter((m) => keys.size === 0 || keys.has(m.key))" },
];
