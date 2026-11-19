// Planted bugs: a gene's copy-number chart on Explore, the levels of the discrete profile (STS-GS-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "gene-facets": ["node", "--env-file=.env.local", "scripts/check-gene-facets.ts"],
};

export const mutants: Mutant[] = [
  { id: "cna-chart-drops-gain", layer: "counts", guard: "unit", file: "lib/gene-state-clauses.ts",
    effect: "A gene's copy-number chart has no Gained row; its gained samples are counted as not profiled (KRAS on coadread: Not profiled 130 where the portal's NA is 2).",
    find: "  { state: \"gain\", value: 1, label: \"Gained\" },\n", replace: "" },
  { id: "cna-chart-reads-any-profile", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "A gene's copy-number levels are counted from every profile of the gene, the continuous log2 values included, not from the study's discrete calls alone.",
    find: "        \"  AND profile_type = \" + discreteCnaProfileSql(study, db) + \"\\n\" +\n", replace: "" },
  { id: "cna-click-diploid-adds-gain", layer: "cohorts", guard: "gene-facets", file: "lib/gene-state-clauses.ts",
    effect: "Clicking Diploid on a gene's copy-number chart also selects its Gained samples, so the filter keeps more samples than the row shows.",
    find: "const picked = CNA_LEVELS.filter((l) => states.includes(l.state)).map((l) => l.value);",
    replace: "const picked = CNA_LEVELS.filter((l) => states.includes(l.state) || (l.state === \"gain\" && states.includes(\"diploid\"))).map((l) => l.value);" },
  { id: "cna-not-profiled-wrong-complement", layer: "cohorts", guard: "unit", file: "lib/gene-state-clauses.ts",
    effect: "Not profiled checked with some levels selects the samples at the checked levels instead of those at none of the unchecked ones.",
    find: "const rest = CNA_LEVELS.filter((l) => !states.includes(l.state)).map((l) => l.value);",
    replace: "const rest = CNA_LEVELS.filter((l) => states.includes(l.state)).map((l) => l.value);" },
  { id: "cna-leaf-names-stored-type", layer: "cohorts", guard: "gene-facets", file: "lib/cohort2.ts",
    effect: "A click on a copy-number level filters on a profile literally named 'CNA', which no study has, so it selects no sample.",
    find: "(discrete ? discreteCnaProfileSql(ctx.study, dbOf(ctx)) : sq(pt))", replace: "sq(pt)" },
  { id: "cna-chart-not-disjunctive", layer: "counts", guard: "gene-facets", file: "lib/explore.ts",
    effect: "A gene's copy-number chart filtered on one level redraws with every other level at 0, so no other level can be added.",
    find: "(l.kind === \"genomicData\" && l.profileType === DISCRETE_CNA_PROFILE)", replace: "false" },
];
