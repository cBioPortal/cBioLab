// Planted bugs: Explore's histograms as the portal's bar charts (STS-BAR-2, STS-BAR-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "bar-drag-drops-last-bar", layer: "cohorts", guard: "unit", file: "lib/explore-selection.ts",
    effect: "A drag across a histogram's bars leaves the last bar it touched out of the filter, so the cohort misses those cases though the bar was under the brush.",
    find: "bins.map((_, i) => i >= lo && i <= hi)", replace: "bins.map((_, i) => i >= lo && i < hi)" },
  { id: "count-axis-fractional-ticks", layer: "counts", guard: "unit", file: "lib/chart/scale.ts",
    effect: "A histogram's count axis is labelled with fractions of a case (0.4, 0.8) on a short chart, where the portal's has integer ticks only.",
    find: "let ticks = s.ticks.filter((t) => Number.isInteger(t) && t >= 0);", replace: "let ticks = s.ticks.filter((t) => t >= 0);" },
];
