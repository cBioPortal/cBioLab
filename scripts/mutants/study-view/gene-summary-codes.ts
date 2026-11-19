// Planted bugs: a gene-state chart's Summary Data in the portal's codes (SD14). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "gene-summary-names-not-codes", layer: "counts", guard: "unit", file: "lib/study-view-download.ts",
    effect: "A gene-state chart's Summary Data writes the names on screen (Mutated, Amplified) where the portal's file writes its codes (MUTATED, 2), so the two files differ.",
    find: "return (type === \"CNA\" ? CNA_CODES : MUTATION_CODES)[state] ?? label;", replace: "return label;" },
  { id: "gene-summary-cna-not-profiled-code", layer: "counts", guard: "unit", file: "lib/study-view-download.ts",
    effect: "A copy-number chart's Not profiled row is written NOT_PROFILED where the portal's file writes NA (and sorts it last).",
    find: "del: \"-2\", notProfiled: \"NA\" };", replace: "del: \"-2\", notProfiled: \"NOT_PROFILED\" };" },
];
