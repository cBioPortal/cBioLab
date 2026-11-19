// Planted bugs: the lollipop stem's tooltip (MUT-LP-10, MUT-STM-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "stem-tip-changes-cut", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "A stem's tooltip lists only the top three protein changes at the codon (\"G12D/V/C and 3 more\"), where the portal lists every one.",
    find: "\"\\nAA Change: \" + lollipopLabelText(q.changes, 0)", replace: "\"\\nAA Change: \" + lollipopLabelText(q.changes, 3)" },
  { id: "stem-tip-patients-not-summed", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "A lollipop over several studies says \"of M profiled patients\" with M left at 0 instead of the studies' patients summed.",
    find: "cohortPatients + rep.cohortPatients : undefined", replace: "cohortPatients : undefined" },
  { id: "stem-tip-mutations-wording", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "A stem's tooltip reads \"N mutations\" even when the cohort's patients are known, where the portal's results page reads \"N mutated of M profiled patients\".",
    find: "const count = cohortPatients != null ?", replace: "const count = cohortPatients == null ?" },
];
