// Planted bugs: a gene's Mutation Type Counts table and its filter (STS-OT-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "mutation-types": ["node", "--env-file=.env.local", "scripts/check-mutation-types.ts"],
};

export const mutants: Mutant[] = [
  { id: "mutation-types-own-filter-counted", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "A gene's mutation-type table is counted under its own filter: after Missense is applied every other type reads 0, and no second type can be added.",
    find: "const mine = !!o.draft && Array.isArray(o.draft.all) && o.draft.all.some(own(gene));",
    replace: "const mine = false;" },
  { id: "mutation-type-filter-any-type", layer: "cohorts", guard: "mutation-types", file: "lib/cohort2.ts",
    effect: "A click on a mutation type keeps every sample with any mutation of the gene, whatever its type, so the cohort is larger than the row's count.",
    find: "\" AND mutation_type IN (\" + leaf.values.map((v) => sq(String(v))).join(\",\") + \")\"",
    replace: "\"\"" },
  { id: "mutation-types-summed-wrongly", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "Over studies on two connections, a type's samples are taken from the last connection only, so the table undercounts.",
    find: "samples: was.samples + Number(x.n) }", replace: "samples: Number(x.n) }" },
  { id: "mutation-types-drop-uncalled", layer: "counts", guard: "mutation-types", file: "lib/explore.ts",
    effect: "The table leaves out uncalled mutations, which the portal counts: glioma_msk_2018 ABL1 Missense reads 5 samples where cbioportal.org's reads 6, and a click selects 6.",
    find: "\" AND variant_type = 'mutation' AND hugo_gene_symbol = \" + sq(gene) + inSamples(g.set)",
    replace: "\" AND variant_type = 'mutation' AND mutation_status != 'UNCALLED' AND hugo_gene_symbol = \" + sq(gene) + inSamples(g.set)" },
];
