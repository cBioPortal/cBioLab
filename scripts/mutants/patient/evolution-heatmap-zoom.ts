// Planted bugs: the Genomic Evolution heatmap's zoom (PTB-GE-HM-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-zoom-ignored", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "The heatmap's zoom changes nothing: its columns always fit the card.",
    find: "const colW = zoom == null ? cols.fit : Math.max(cols.floor, zoom * HEAT_CELL);",
    replace: "const colW = cols.fit;" },
  { id: "evolution-zoom-no-floor", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "Zoomed far out, the heatmap's columns shrink below a label's line height and the labels overprint.",
    find: "const colW = zoom == null ? cols.fit : Math.max(cols.floor, zoom * HEAT_CELL);",
    replace: "const colW = zoom == null ? cols.fit : zoom * HEAT_CELL;" },
  { id: "evolution-zoom-shrunk-back", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "A heatmap zoomed past the card's width is shrunk back to it, so zooming in draws nothing larger.",
    find: "o.zoom != null && e.display.chart === \"heatmap\" && FW > W",
    replace: "false" },
];
