// Planted bugs: #305, colouring a plot by a gene as the portal's Plots tab colours (PLT-CL-8, PLT-STM-14…16). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "oncoprint-class-inframe-truncating", layer: "counts", guard: "plot-stats", file: "lib/plot.ts",
    effect: "A gene colouring classes an in-frame insertion or deletion as Truncating, where the portal's getOncoprintMutationType makes it Inframe.",
    find: "const PLOT_CLASS: Record<string, string> = { missense: \"Missense\", splice: \"Splice\", inframe: \"Inframe\" };",
    replace: "const PLOT_CLASS: Record<string, string> = { missense: \"Missense\", splice: \"Splice\" };" },
  { id: "gene-ring-sv-not-over-cna", layer: "counts", guard: "plot-stats", file: "lib/plot.ts",
    effect: "A sample with a structural variant of the colouring gene is ringed by its copy number, where the portal rings it as a Structural Variant.",
    find: "multiIf(svs > 0, 'Structural Variant', ",
    replace: "multiIf(0, 'Structural Variant', " },
  { id: "gene-ring-diploid-unprofiled", layer: "counts", guard: "plot-stats", file: "lib/plot.ts",
    effect: "A sample not profiled for the gene's copy number is ringed Diploid, a call nothing made, where it is Not profiled (invariant 7).",
    find: "'Structural Variant', pc = 0, 'Not profiled', ",
    replace: "'Structural Variant', 0, 'Not profiled', " },
  { id: "gene-fill-generic-colours", layer: "counts", guard: "unit", file: "lib/plot.ts",
    effect: "Points coloured by a gene draw Not mutated in the generic grey, where the portal fills them light blue (#c4e5f5).",
    find: "if (by === \"topMutationType\" && STYLE.plotGene.fill[l]) return STYLE.plotGene.fill[l];",
    replace: "" },
];
