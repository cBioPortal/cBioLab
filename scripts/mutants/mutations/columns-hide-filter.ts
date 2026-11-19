// Planted bugs: hiding a column in the Columns menu clears its header filter (MUT-TB-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "hidden-column-keeps-filter", layer: "counts", guard: "unit", file: "lib/table-columns.ts",
    effect: "A column hidden in the Columns menu keeps filtering the table, its filter out of sight, where the portal's clears it.",
    find: "  for (const id of hidden) delete filters[id];\n", replace: "" },
  { id: "hide-clears-every-filter", layer: "counts", guard: "unit", file: "lib/table-columns.ts",
    effect: "Hiding one column clears every column's filter, not that column's alone.",
    find: "const hidden = shown.filter((id) => !after.has(id) && q.filters && id in q.filters);", replace: "const hidden = Object.keys(q.filters || {});" },
];
