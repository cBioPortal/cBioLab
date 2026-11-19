// Planted bugs: the gene tables' Freq as the portal writes it (STS-GT-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "gene-freq-from-rounded", layer: "counts", guard: "unit", file: "lib/study-view-gene-tables.ts",
    effect: "A gene altered in under 0.05 % of its profiled samples shows Freq \"0%\" (msk_impact_2017: 376 CNA rows), where the portal writes \"<0.1%\".",
    find: "return f == null ? \"NA\" : portalFreq(f * 100);", replace: "return f == null ? \"NA\" : portalFreq(Math.round(f * 1000) / 10);" },
];
