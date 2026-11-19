// Planted bugs: every numeric chart on Explore gets its bars (STS-BAR-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "numeric-charts-capped-at-14", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "Numeric charts past the 14th get no bars and no word why (coadread's PFS_MONTHS, RAGNUM_HYPOXIA_SCORE, TMB_NONSYNONYMOUS, TBL_SCORE, WINTER_HYPOXIA_SCORE).",
    find: "const numFacets = clinical.filter((c): c is Extract<ClinicalFacet, { kind: \"num\" }> => c.kind === \"num\");",
    replace: "const numFacets = clinical.filter((c): c is Extract<ClinicalFacet, { kind: \"num\" }> => c.kind === \"num\").slice(0, 14);" },
];
