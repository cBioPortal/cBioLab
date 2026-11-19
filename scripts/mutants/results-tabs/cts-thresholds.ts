// Planted bugs: the Cancer Types Summary's threshold sliders, the Min. # Total clamp and the highlighted box
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cts-total-not-clamped",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/thresholds.ts",
    effect: "A Min. # Total of 999999 hides every category, where the portal sets it to the largest drawn (1668).",
    find: "return n > end ? end : n;",
    replace: "return n;" },
  { id: "cts-total-end-counts-units",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/thresholds.ts",
    effect: "The Min. # Total slider runs to the largest group's units, profiled or not, not its profiled total.",
    find: "total = Math.max(total, g.profiled);",
    replace: "total = Math.max(total, g.samples);" },
  { id: "cts-ends-genes-together-only",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/thresholds.ts",
    effect: "A gene tab's larger share is left out of the Min. % Altered slider, whose end then cuts it off.",
    find: "[...p.groups, ...(p.perGene || []).flatMap((g) => g.groups)]",
    replace: "[...p.groups]" },
  { id: "cts-default-total-not-highlighted",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/thresholds.ts",
    effect: "The Min. # Total box is not highlighted at its default of 10, where the portal highlights it.",
    find: "total: spec.minSamples != null ? spec.minSamples > 0 : r.panels.some((p) => p.minSamples > 0 || (p.perGene || []).some((g) => g.minSamples > 0)),",
    replace: "total: (spec.minSamples ?? 0) > 0," },
];
