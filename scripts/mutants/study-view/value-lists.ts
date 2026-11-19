// Planted bugs: Explore's value lists as the portal's tables (STS-TBL-2, -3, -5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "value-list-applied-not-pinned", layer: "cohorts", guard: "unit", file: "lib/value-list.ts",
    effect: "The values a chart's filter holds stay in count order instead of first, so in a long list they scroll out of sight.",
    find: "return [...shown.filter((r) => r.on), ...shown.filter((r) => !r.on)];", replace: "return shown;" },
  { id: "value-list-select-all-rechecks-applied", layer: "cohorts", guard: "unit", file: "lib/value-list.ts",
    effect: "Select all also checks the values the chart's filter already holds, so applying adds them to the filter a second time.",
    find: "const checkable = shown.filter((r) => !r.on && !r.disabled && !r.solo).map((r) => r.key);", replace: "const checkable = shown.filter((r) => !r.disabled && !r.solo).map((r) => r.key);" },
  { id: "value-list-select-all-checks-na", layer: "cohorts", guard: "unit", file: "lib/value-list.ts",
    effect: "Select all on a list with an NA row checks NA too, which cannot join other values, so its Apply filter stays disabled.",
    find: "const checkable = shown.filter((r) => !r.on && !r.disabled && !r.solo)", replace: "const checkable = shown.filter((r) => !r.on && !r.disabled)" },
  { id: "filter-limit-off-by-one", layer: "cohorts", guard: "unit", file: "lib/filter-limits.ts",
    effect: "A selection one past a filter's limit (9 case lists, 51 values) is applied, and the compiler rejects it or cuts it short without a word.",
    find: "return n > limit ?", replace: "return n > limit + 1 ?" },
];
