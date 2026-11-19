// Planted bugs: the timeline's root track labels, sub-track order and hovered row (PAT-TL-TR-1, PAT-TL-TR-2, PAT-TL-TR-5). How they are planted and run: scripts/check-mutants.ts.
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
  { id: "timeline-parent-tracks-last", layer: "counts", guard: "unit", file: "lib/timeline-tracks.ts",
    effect: "A sub-track whose events are all in its own sub-tracks sorts after its siblings, where the portal sorts it at 0, before every track starting after diagnosis.",
    find: "t.items.length ? t.items[0].start : 0;",
    replace: "t.items.length ? t.items[0].start : Infinity;" },
];
