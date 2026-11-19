// Planted bugs: the Genomic Evolution heatmap's Data download (PTB-GE-HM-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-download-not-found-rows", layer: "counts", guard: "unit", file: "lib/views/evolution/download.ts",
    effect: "The heatmap's Data lists a not-found mutation at VAF 0, where the portal lists only cells with a VAF.",
    find: "if (!c || (c.status !== \"called\" && c.status !== \"uncalled\") || c.vaf == null) return;",
    replace: "if (!c || c.status === \"np\" || c.vaf == null) return;" },
  { id: "evolution-download-rounded-vaf", layer: "counts", guard: "unit", file: "lib/views/evolution/download.ts",
    effect: "The heatmap's Data writes each VAF to 4 places (0.6923), where the portal writes the reads' ratio (0.6923076923076923).",
    find: "const vaf = c.alt != null && c.ref != null && c.alt + c.ref > 0 ? c.alt / (c.alt + c.ref) : c.vaf;",
    replace: "const vaf = c.vaf;" },
  { id: "evolution-download-transposed-unsorted", layer: "counts", guard: "unit", file: "lib/views/evolution/download.ts",
    effect: "Transposed, the heatmap's Data follows the table's order, not the tracks' alphabetical GENE pChange.",
    find: "[...drawn].sort((a, b) => mutationName(a).localeCompare(mutationName(b)))",
    replace: "[...drawn]" },
];
