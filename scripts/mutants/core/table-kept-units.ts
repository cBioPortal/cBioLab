// Planted bugs: a filtered table's kept samples and patients (MUT-STM-16, MUT-FM-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "table-kept-units": ["node", "--env-file=.env.local", "scripts/check-table-kept-units.ts"],
};

export const mutants: Mutant[] = [
  { id: "kept-patients-are-samples", layer: "counts", guard: "table-kept-units", file: "lib/table-query.ts",
    effect: "A filtered Mutations table counts its kept patients as its kept samples, where the portal counts each patient once across their samples.",
    find: "uniqExactIf(\" + src.units.patient + \", \"", replace: "uniqExactIf(\" + src.units.sample + \", \"" },
];
