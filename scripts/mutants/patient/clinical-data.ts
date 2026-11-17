// Planted bugs: the Patient page's Clinical Data tables (PTB-CD-1…3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-samples-patient-attrs-unmarked", layer: "counts", guard: "unit", file: "lib/views/table/run.ts",
    effect: "The Patient page's Samples table lists the patient's attributes in every sample's column, where the portal lists a sample's own.",
    find: "const patientAttrs = unit === \"sample\" ? held.filter((c) => c.per === \"patient\").map((c) => c.id) : [];",
    replace: "const patientAttrs: string[] = [];" },
];
