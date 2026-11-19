// Planted bugs: the Allele Freq header's VAF plot (PAT-STM-7). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "vaf-plot-edge-in-lower-bin", layer: "counts", guard: "unit", file: "lib/views/alterations/vaf-plot.ts",
    effect: "A frequency on a bin's edge (0.15, 0.5) is counted in the bin below it, where the portal's histogram counts it in the bin above.",
    find: "while (j < counts.length - 1 && v >= e[j + 1]) j++;",
    replace: "while (j < counts.length - 1 && v > e[j + 1]) j++;" },
  { id: "vaf-plot-no-min-bandwidth", layer: "counts", guard: "unit", file: "lib/views/alterations/vaf-plot.ts",
    effect: "A sample with one frequency (or several equal ones) has a bandwidth of 0, so its curve is not a number and is not drawn.",
    find: "return Math.max(1.06 * sd * n ** (-1 / 5), MIN_BANDWIDTH);",
    replace: "return 1.06 * sd * n ** (-1 / 5);" },
  { id: "vaf-plot-bars-per-sample-share", layer: "counts", guard: "unit", file: "lib/views/alterations/vaf-plot.ts",
    effect: "Each sample's bars are its share of its own mutations, so they no longer read against the mutation count axis.",
    find: "const h = n / maxCount * V.height;",
    replace: "const h = n / bins[i].reduce((a, b) => a + b, 0) * V.height;" },
  { id: "vaf-plot-counts-samples-with-reads", layer: "counts", guard: "unit", file: "lib/views/alterations/vaf-plot.ts",
    effect: "A patient's samples are counted only when they have allele counts, so two samples in view, one without reads, get the one-sample bars (0.3 opaque), where the portal counts both (0.1).",
    find: "series.samples.length > 1 ? V.barOpacityMany",
    replace: "series.drawn.length > 1 ? V.barOpacityMany" },
  { id: "vaf-plot-alt-over-ref", layer: "counts", guard: "patient-vaf", file: "lib/patient-alterations.ts",
    effect: "The plot's frequencies are variant ÷ reference reads, not ÷ all reads: FX-P02's KRAS in T2 (190 of 280) plotted at 2.1.",
    find: "arraySort(groupArray(x.2 / (x.2 + x.3)))",
    replace: "arraySort(groupArray(x.2 / x.3))" },
];
