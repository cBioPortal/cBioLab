// Planted bugs: the Patient page's cohort navigation (PAT-URL-4, PAT-NAV-3, PAT-NAV-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "patient-exclude-keeps-patient", layer: "cohorts", guard: "unit", file: "app/portal/cohort-navigation.ts",
    effect: "The Patient page's ⊖ steps on but keeps the patient in the cohort, so the count does not drop and the patient comes round again.",
    find: "  return { def: { ...nav.def, all }, order: nav.order, ...(nav.listed ? { listed: true } : {}) };\n}",
    replace: "  return { def: nav.def, order: nav.order, ...(nav.listed ? { listed: true } : {}) };\n}" },
];
