// Planted bugs: the Genomic Evolution heatmap's order (PTB-GE-HM-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-heatmap-cluster-ignored", layer: "counts", guard: "unit", file: "lib/views/evolution/order.ts",
    effect: "The Genomic Evolution heatmap draws mutations by name with Cluster on, so mutations with the same VAFs across samples sit apart, unlike the portal's clustered heatmap.",
    find: "  if (!o.cluster) return",
    replace: "  if (!o.cluster || true) return" },
];
