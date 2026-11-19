// Planted bugs: the Mutations tab's somatic / germline frequency text (MUT-STM-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "rate-trailing-zero-dropped", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "A whole-percent frequency reads \"100%\" where the portal writes \"100.0%\".",
    find: "return of > 0 ? portalPct(samples / of) + \"%\" : \"–\";", replace: "return of > 0 ? String(Number(portalPct(samples / of))) + \"%\" : \"–\";" },
  { id: "rate-as-fraction", layer: "counts", guard: "unit", file: "lib/lollipop.ts",
    effect: "The frequency is written as a share of 1 (\"0.4%\" for 36.7%), a hundredfold too small.",
    find: "portalPct(samples / of) + \"%\"", replace: "portalPct(samples / of / 100) + \"%\"" },
];
