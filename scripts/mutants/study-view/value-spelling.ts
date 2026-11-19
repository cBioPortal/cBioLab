// Planted bugs: a clinical value's kept spelling and its merge across studies (STS-STM-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "spelling-least-not-greatest", layer: "counts", guard: "unit", file: "lib/event-names.ts",
    effect: "A value spelled two ways is shown under the least spelling (\"Active\") where the portal keeps the greatest (\"active\").",
    find: "(a > b ? a : b)", replace: "(a < b ? a : b)" },
  { id: "studies-merge-by-spelling", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "Over several studies, \"Female\" and \"FEMALE\" are two rows of a chart, each with part of the count, where the portal lists one.",
    find: "const k = clinicalValueFold(String(v.v)), was = vals.get(k);", replace: "const k = String(v.v), was = vals.get(k);" },
];
