// Planted bugs: hovering a lollipop stem highlights the mutation table's rows at its codon (MUT-LP-11). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "stem-hover-any-gene", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "Hovering a KRAS stem highlights rows at that codon in another gene's mutation table too.",
    find: "if (!hover || hover.gene !== gene || pos == null || pos === \"\") return false;", replace: "if (!hover || pos == null || pos === \"\") return false;" },
  { id: "stem-hover-blank-is-zero", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "A row with no protein position is highlighted as codon 0.",
    find: "if (!hover || hover.gene !== gene || pos == null || pos === \"\") return false;", replace: "if (!hover || hover.gene !== gene || pos == null) return false;" },
];
