// Planted bugs: a quantile split over several studies' pooled values (STS-STM-12). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "pooled-cut-off-by-one", layer: "cohorts", guard: "unit", file: "lib/partition-arms.ts",
    effect: "A quartile split over several studies cuts one value below the one-study rule (quantilesExact's ⌊p·n⌋), so its groups differ from the same selection's in one study.",
    find: "qs: ps.map((p) => at(Math.min(n - 1, Math.floor(p * n))))", replace: "qs: ps.map((p) => at(Math.max(0, Math.floor(p * n) - 1)))" },
  { id: "pooled-cut-counts-ignored", layer: "cohorts", guard: "unit", file: "lib/partition-arms.ts",
    effect: "Each value counts once whatever how many cases hold it, so a common value weighs as little as a rare one in the cut.",
    find: "merged.set(c.v, (merged.get(c.v) || 0) + c.n);", replace: "merged.set(c.v, 1);" },
];
