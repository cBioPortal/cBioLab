// Planted bugs: the Pathways tab's "Sample(s) … not profiled for …" alert (PTB-PW-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "pathways-alert-profile-study-lacks", layer: "counts", guard: "unit", file: "lib/views/pathwaymap/profiled.ts",
    effect: "A study with no copy-number profile gets a Pathways alert calling every sample not profiled for copy number alterations, where the portal says nothing.",
    find: "if (!rows.length || rows.some((x) => Number(x[col]) === -1)) continue;",
    replace: "if (!rows.length) continue;" },
  { id: "pathways-alert-reads-sv-for-cna", layer: "counts", guard: "unit", file: "lib/views/pathwaymap/profiled.ts",
    effect: "The Pathways alert's copy-number line reads the structural-variant profile, naming the wrong samples or none.",
    find: "[\"cna\", \"copy number alterations\"]",
    replace: "[\"sv\", \"copy number alterations\"]" },
  { id: "pathways-alert-patient-outside-cohort", layer: "counts", guard: "unit", file: "lib/views/pathwaymap/profiled.ts",
    effect: "A pathwaymap naming a patient outside its cohort gives that patient's samples an alert, as if they were the cohort's.",
    find: "if (!inCohort.rows.length) return",
    replace: "if (inCohort.rows.length < 0) return" },
];
