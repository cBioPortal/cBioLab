// Planted bugs: #315, a pooled plot's axis titles (PLT-DT-19). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-title-first-study-only", layer: "counts", guard: "unit", file: "lib/clinical-titles.ts",
    effect: "A pooled plot titles a clinical axis only by the first study's display name, so an attribute that study does not name reads as its raw id though another study names it.",
    find: "  for (const st of studies) {",
    replace: "  for (const st of studies.slice(0, 1)) {" },
];
