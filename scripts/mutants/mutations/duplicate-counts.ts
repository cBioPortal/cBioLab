// Planted bugs: the Mutations and Structural Variants tables' duplicate counts (MUT-TB-1, MUT-STM-14, SV-TB-1, SV-STM-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "table-duplicates": ["node", "--env-file=.env.local", "scripts/check-table-duplicates.ts"],
};

export const mutants: Mutant[] = [
  { id: "mutation-duplicates-across-patients", layer: "counts", guard: "table-duplicates", file: "lib/mutation-table.ts",
    effect: "The Mutations table's count says it includes duplicates for one change in different patients, where the portal counts only a patient's own repeats.",
    find: "duplicateKey: \"(study, patient, ifNull(proteinChange, ''))\"", replace: "duplicateKey: \"(study, ifNull(proteinChange, ''))\"" },
  { id: "sv-duplicates-ignore-breakpoints", layer: "counts", guard: "table-duplicates", file: "lib/sv-table.ts",
    effect: "The Structural Variants table counts every second SV of a patient as a duplicate, where the portal requires the same breakpoints.",
    find: "duplicateKey: \"(study, patient, ifNull(toString(site1Chr), ''), ifNull(toString(site1Pos), ''), ifNull(toString(site2Chr), ''), ifNull(toString(site2Pos), ''))\"", replace: "duplicateKey: \"(study, patient)\"" },
];
