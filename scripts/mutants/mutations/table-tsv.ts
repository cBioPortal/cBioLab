// Planted bugs: the mutation table's download as the portal's table.tsv (MUT-TB-8). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "table-tsv-keeps-filters", layer: "counts", guard: "unit", file: "lib/table-tsv.ts",
    effect: "The mutation table's TSV holds only the rows its search and filters keep, where the portal's holds every row.",
    find: "delete out.search; delete out.filters;", replace: "" },
  { id: "table-tsv-tab-in-value", layer: "counts", guard: "unit", file: "lib/table-tsv.ts",
    effect: "A value holding a tab splits into two fields, shifting the line's later columns.",
    find: "String(x).replace(/[\\t\\r\\n]+/g, \" \")", replace: "String(x)" },
  { id: "table-tsv-lf", layer: "counts", guard: "unit", file: "lib/table-tsv.ts",
    effect: "The TSV's lines end in LF alone, where the portal's end in CRLF.",
    find: ".join(\"\\t\") + \"\\r\\n\"", replace: ".join(\"\\t\") + \"\\n\"" },
];
