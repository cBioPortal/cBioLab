// Planted bugs: the first click on a Mutations table header (MUT-COL-0). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "first-sort-dbsnp-ascending", layer: "counts", guard: "unit", file: "lib/mutation-table.ts",
    effect: "dbSNP's first header click sorts ascending, where the portal's sorts it descending.",
    find: "new Set([\"gnomad\", \"clinvar\", \"dbsnp\"])", replace: "new Set([\"gnomad\", \"clinvar\"])" },
  { id: "first-sort-numbers-descending", layer: "counts", guard: "unit", file: "lib/mutation-table.ts",
    effect: "A numeric Mutations column (Allele Freq, # Mut in Sample) sorts highest first on its first click, where the portal's sorts lowest first.",
    find: "FIRST_SORT_DESC.has(c.id) ? \"desc\" : \"asc\"", replace: "FIRST_SORT_DESC.has(c.id) || c.numeric ? \"desc\" : \"asc\"" },
  { id: "first-sort-no-flip", layer: "counts", guard: "unit", file: "lib/table-sort.ts",
    effect: "Clicking the sorted column again keeps it descending instead of flipping it.",
    find: "return current.desc ? { column: c.id } : { column: c.id, desc: true };", replace: "return { column: c.id, desc: true };" },
  { id: "first-sort-column-direction-ignored", layer: "counts", guard: "unit", file: "lib/table-sort.ts",
    effect: "A column's own first-click direction is ignored: numbers sort descending first and ClinVar ascending.",
    find: "const desc = c.firstSort ? c.firstSort === \"desc\" : c.numeric;", replace: "const desc = c.numeric;" },
];
