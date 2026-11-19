// Planted bugs: the Cancer Studies chart, samples per study (STS-SP-1, STS-STM-19). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "studies-chart-counts-patients", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "The Cancer Studies chart counts each study's patients (msk_impact_2017 10,336) where the portal counts its samples (10,945).",
    find: "{ study, n: Number(pre.totals.smp), instance: conn.id", replace: "{ study, n: Number(pre.totals.pts), instance: conn.id" },
];
