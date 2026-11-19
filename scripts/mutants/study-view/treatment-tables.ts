// Planted bugs: the treatment tables and their clause (STS-OT-6). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  treatments: ["node", "--env-file=.env.local", "scripts/check-treatments.ts"],
};

export const mutants: Mutant[] = [
  { id: "treatment-table-latest-start", layer: "counts", guard: "treatments", file: "lib/explore.ts",
    effect: "A sample is placed against the patient's LAST course of an agent rather than the first, so a sample taken between two courses reads Pre where the portal's reads Post.",
    find: "arrayMap(a -> (a, arrayMin(arrayMap(x -> x.2, arrayFilter(x -> x.1 = a, t))))",
    replace: "arrayMap(a -> (a, arrayMax(arrayMap(x -> x.2, arrayFilter(x -> x.1 = a, t))))" },
  { id: "treatment-click-swaps-pre-post", layer: "cohorts", guard: "treatments", file: "lib/cohort2.ts",
    effect: "A click on a Pre row keeps the samples taken after the treatment, so the cohort is not the row it counts.",
    find: "\"  WHERE sa.t \" + (leaf.time === \"Pre\" ? \"<=\" : \">\") + \" tx.st\"",
    replace: "\"  WHERE sa.t \" + (leaf.time === \"Pre\" ? \">\" : \"<=\") + \" tx.st\"" },
  { id: "treatment-sample-rows-split", layer: "counts", guard: "unit", file: "lib/treatment-tables.ts",
    effect: "The sample table sorts rows by their own count, so a treatment's Post row lands far from its Pre row, unlike the portal's table.",
    find: "return [...rows].sort((a, b) => top.get(b.agent)! - top.get(a.agent)! ||",
    replace: "return [...rows].sort((a, b) => b.n - a.n ||" },
];
