// Planted bugs: Genomic Evolution's Show Timeline (PTB-GE-LC-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-timeline-unaligned", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "With the timeline shown, the line chart keeps its own margin, so a sample no longer sits under its day on the timeline.",
    find: "lineChart(v, W, p, tl && e.x === \"time\" && e.axis?.length ? tl.layout.plot : undefined)",
    replace: "lineChart(v, W, p)" },
  { id: "evolution-timeline-always", layer: "counts", guard: "unit", file: "lib/views/evolution/run.ts",
    effect: "The patient's timeline is drawn above every line chart, Show Timeline or not.",
    find: "...(display.showTimeline && display.chart === \"line\" && events.length ? { timeline } : {})",
    replace: "...(display.chart === \"line\" && events.length ? { timeline } : {})" },
];
