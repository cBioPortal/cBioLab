// Planted bugs: the Cancer Types Summary chart's geometry, as the portal's CancerSummaryChart
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cts-bars-stretched",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "A few groups' bars spread over the card's width, far apart, where the portal keeps them 8 px apart.",
    find: "const band = BAND, bw = BAR, n = Math.max(1, groups.length);",
    replace: "const band = Math.max(BAND, (W - L - 12) / Math.max(1, groups.length)), bw = BAR, n = Math.max(1, groups.length);" },
  { id: "cts-plot-short",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "The tallest bar is 240 px, where the portal's is 280 under a 300 px axis.",
    find: "const PLOT_H = 300, TOP_PAD = 20;",
    replace: "const PLOT_H = 240, TOP_PAD = 0;" },
  { id: "cts-labels-turned-back",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "Group labels turn 45° up-left of their bar, where the portal's run down-right at 50°.",
    find: "rotate: LABEL_ANGLE, baseline: \"hanging\"",
    replace: "rotate: -45, baseline: \"hanging\"" },
  { id: "cts-many-groups-cut",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "With more groups than the card holds, the figure stays the card's width and the last bars fall off it.",
    find: "if (grown) W = Math.ceil(Math.max(L + band * n + 12, reach));",
    replace: "" },
];
