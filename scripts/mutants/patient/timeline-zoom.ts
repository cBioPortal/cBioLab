// Planted bugs: the Patient timeline's drag to zoom (PAT-TL-ZM-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "timeline-zoom-any-drag", layer: "counts", guard: "unit", file: "lib/timeline-svg.ts",
    effect: "Any drag zooms the timeline, where the portal takes a drag of 10 px or less for a click.",
    find: "if (Math.abs(x1 - x0) <= ZOOM_MIN_DRAG || plot.width <= 0) return null;",
    replace: "if (plot.width <= 0) return null;" },
  { id: "timeline-zoom-from-unzoomed", layer: "counts", guard: "unit", file: "lib/timeline-svg.ts",
    effect: "A drag inside a zoomed timeline is read against the whole plot, so it jumps elsewhere instead of zooming further.",
    find: "const [a, b] = current || [0, 1];",
    replace: "const [a, b] = [0, 1];" },
  { id: "timeline-zoom-not-stretched", layer: "counts", guard: "unit", file: "lib/timeline-svg.ts",
    effect: "The zoomed timeline draws every event where it was, so the stretch dragged is not shown larger.",
    find: "const X = z ? (d: number) => HW + (dx(d) / PW - z[0]) / (z[1] - z[0]) * PW : (d: number) => HW + dx(d);",
    replace: "const X = (d: number) => HW + dx(d);" },
];
