// Planted bugs: the generic-assay frequency table (STS-OT-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "freq-table-binary-absent-kept", layer: "counts", guard: "unit", file: "lib/assay-frequency-table.ts",
    effect: "A binary profile's table lists its absent values (0, no, negative) as rows, where the portal counts presence only.",
    find: "return !NO_VALUE.includes(v) && !(binary && BINARY_ABSENT.includes(v));", replace: "return !NO_VALUE.includes(v);" },
  { id: "freq-table-unchanged-shown", layer: "counts", guard: "unit", file: "lib/assay-frequency-table.ts",
    effect: "An arm-level CNA table lists Unchanged rows by default, burying the altered arms the portal shows first.",
    find: "rows.filter((r) => !curated || all || !unchangedCategory(r.value))", replace: "rows.filter(() => true)" },
  { id: "freq-table-entity-values-split", layer: "cohorts", guard: "unit", file: "lib/assay-frequency-table.ts",
    effect: "Two checked values of one arm become two leaves, so a filter of 1p Loss or Unchanged on nine arms is refused as past eight alternatives.",
    find: "byEntity.set(entity, [...(byEntity.get(entity) || []), value]);", replace: "byEntity.set(k, [value]);" },
];
