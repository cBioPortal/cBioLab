// Planted bugs: the Genomic Evolution line chart's timeline axis (PTB-GE-LC-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-axis-samples-only", layer: "counts", guard: "unit", file: "lib/views/evolution/run.ts",
    effect: "The Genomic Evolution line chart's time axis ends at the last sample, not the patient's last clinical event, so it is shorter than the portal's (the timeline's axis).",
    find: "axisTicks(timelineAxisItems(events), !view.expandGaps)",
    replace: "axisTicks(timelineAxisItems(events.filter((ev) => sampleDays([ev]).size > 0)), !view.expandGaps)" },
];
