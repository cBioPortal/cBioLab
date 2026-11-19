// Planted bugs: the Patient page's Clinical Data patient table, its numbers to one decimal (PTB-STM-11). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-patient-values-raw", layer: "statistics", guard: "unit", file: "lib/views/table/transpose.ts",
    effect: "The Patient page's Clinical Data patient table writes OS_MONTHS 43.75842457 as stored, where the portal writes 43.8.",
    find: "perSample ? v : portalClinicalValue(v)",
    replace: "v" },
];
