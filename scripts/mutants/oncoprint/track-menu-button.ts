// Planted bugs: each track's ⋮ button (ONC-LY-2)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-track-button-over-pct",
    layer: "counts",
    guard: "unit",
    file: "app/_oncoprint/canvas.ts",
    effect: "A gene row's ⋮ button sits on its altered %, hiding the number, where the portal puts the button between the label and the %.",
    find: "  const pctW = t.freqPct !== undefined ? measure(pctText) + 6 : 0;\n  return GEOM.gutter - 8 - pctW - GEOM.menuW;",
    replace: "  return GEOM.gutter - 8 - GEOM.menuW;" },
  { id: "onc-track-button-over-oql",
    layer: "counts",
    guard: "unit",
    file: "app/_oncoprint/canvas.ts",
    effect: "A row's OQL line runs under its ⋮ button on screen, so the end of the line is hidden while the figure is hovered.",
    find: "    const subEnd = opts.menuButtons ? menuButtonX(",
    replace: "    const subEnd = false ? menuButtonX(" },
];
