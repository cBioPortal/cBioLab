// Planted bugs: the timeline's root track labels (PAT-TL-TR-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "timeline-root-label-as-spelled", layer: "counts", guard: "unit", file: "lib/timeline-tracks.ts",
    effect: "The timeline's root tracks keep the study's spelling (\"Specimen\", \"Sample acquisition\"), where the portal upper-cases every event type.",
    find: "export const rootLabel = (type: string): string => type.toUpperCase();",
    replace: "export const rootLabel = (type: string): string => type;" },
];
