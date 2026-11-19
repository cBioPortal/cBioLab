// Planted bugs: a gene's Mutation Type Counts table and its filter (STS-OT-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "mutation-types-own-filter-counted", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "A gene's mutation-type table is counted under its own filter: after Missense is applied every other type reads 0, and no second type can be added.",
    find: "const own = !!o.draft && Array.isArray(o.draft.all) && o.draft.all.some((c) => isMutationTypeClauseFor(c, gene));",
    replace: "const own = false;" },
  { id: "mutation-type-filter-any-type", layer: "cohorts", guard: "unit", file: "lib/cohort2.ts",
    effect: "A click on a mutation type keeps every sample with any mutation of the gene, whatever its type, so the cohort is larger than the row's count.",
    find: "\" AND mutation_type IN (\" + leaf.values.map((v) => sq(String(v))).join(\",\") + \")\"",
    replace: "\"\"" },
  { id: "mutation-types-summed-wrongly", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "Over studies on two connections, a type's samples are taken from the last connection only, so the table undercounts.",
    find: "samples: was.samples + Number(x.n) }", replace: "samples: Number(x.n) }" },
];
