// Planted bugs: the Patient page's tabs, Genomic Evolution's gate and Files & Links (PTB-TAB-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-gate-called-reads-only", layer: "counts", guard: "unit", file: "lib/views/evolution/sql.ts",
    effect: "Genomic Evolution's gate counts only a called record's reads, where the portal also counts the uncalled record of a mutation called elsewhere in the patient.",
    find: "\" AS k, max(\" + CALLED + \") AS cl, max(\" + HAS_VAF + \") AS rd\\n\"",
    replace: "\" AS k, max(\" + CALLED + \") AS cl, max(\" + CALLED + \" AND \" + HAS_VAF + \") AS rd\\n\"" },
  { id: "patient-files-links-placeholder", layer: "counts", guard: "unit", file: "app/portal/patient-layout.ts",
    effect: "The Patient page lays out a Files & Links tab with no resource data to list, where the portal shows none.",
    find: "    // no Files & Links tab: the portal shows it only when the study has resource data",
    replace: "    { title: \"Files & Links\", views: [], pending: \"resource data\" },\n    // no Files & Links tab: the portal shows it only when the study has resource data" },
];
