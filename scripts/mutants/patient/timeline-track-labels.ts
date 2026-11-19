// Planted bugs: the timeline's root track labels and hovered row (PAT-TL-TR-1, PAT-TL-TR-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "timeline-root-label-as-spelled", layer: "counts", guard: "unit", file: "lib/timeline-tracks.ts",
    effect: "The timeline's root tracks keep the study's spelling (\"Specimen\", \"Sample acquisition\"), where the portal upper-cases every event type.",
    find: "export const rootLabel = (type: string): string => type.toUpperCase();",
    replace: "export const rootLabel = (type: string): string => type;" },
  { id: "timeline-hot-row-edge", layer: "counts", guard: "unit", file: "lib/timeline-svg.ts",
    effect: "On the line between two timeline rows the pointer highlights the upper one, a row's band reaching into the next.",
    find: "rows.findIndex((r) => y >= r.y && y < r.y + r.h)",
    replace: "rows.findIndex((r) => y >= r.y && y <= r.y + r.h)" },
];
