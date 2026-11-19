// Planted bugs: the Patient Summary's layout, as the portal lays it out (PAT-SUM). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "summary-timeline-without-events", layer: "counts", guard: "unit", file: "app/portal/patient-layout.ts",
    effect: "The Summary lays out a Clinical timeline card for a patient with no clinical event (msk_impact_2017 P-0000004), where the portal shows none.",
    find: "...(data.events === 0 ? [] : [v(\"Clinical timeline\", { kind: \"timeline\" })]),",
    replace: "v(\"Clinical timeline\", { kind: \"timeline\" })," },
];
