// Planted bugs: the Patient page's not-profiled alerts (PAT-CNA-2, PAT-SV-2, PAT-NP-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "patient-profiled-ignores-sample", layer: "counts", guard: "patient-sv", file: "lib/views/alterations/run.ts",
    effect: "The Patient tables call every sample profiled, so a sample outside the study's profile gets no \"not profiled\" alert and its empty row reads as wild-type.",
    find: "profiled: has ? page.rows.filter((x) => Number(x[t]) === 1).map((x) => String(x.sid)) : []",
    replace: "profiled: has ? [] : []" },
];
