// Planted bugs: the Genomic Evolution table's "Show only selected mutations" (PTB-GE-TB-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-table-selected-page-only", layer: "counts", guard: "unit", file: "lib/views/evolution/table.ts",
    effect: "\"Show only selected mutations\" keeps only the picked rows on the page shown, losing a mutation picked on another page or on the chart.",
    find: "const rows = all.filter((r) => keys.has(",
    replace: "const rows = t.rows.filter((r) => keys.has(" },
  { id: "evolution-table-selected-empty-hides-all", layer: "counts", guard: "unit", file: "lib/views/evolution/table.ts",
    effect: "With nothing picked, \"Show only selected mutations\" empties the table, where the portal shows every row.",
    find: "if (!keys.size) return t;",
    replace: "if (!keys.size) return { ...t, rows: [], total: 0 };" },
];
