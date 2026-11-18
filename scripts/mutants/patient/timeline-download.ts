// Planted bugs: the Timeline's PDF / PNG / SVG download (PAT-TL-ZM-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "timeline-download-interactive-marks", layer: "counts", guard: "unit", file: "lib/timeline-svg.ts",
    effect: "The Timeline's downloaded SVG carries the page's event hooks (class=\"tl-m\" data-ev) on every mark, unlike the portal's file.",
    find: "const tag = (ix: number[]) => (o.interactive ? ",
    replace: "const tag = (ix: number[]) => (true ? " },
];
