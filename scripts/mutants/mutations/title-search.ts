// Planted bugs: the Mutations table's title unit (MUT-TB-1) and Protein Change's search value (MUT-COL-6). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "title-unit-never-singular", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "One mutation is titled \"1 Mutations\", where the portal writes \"1 Mutation\".",
    find: "return n === 1 ? \"Mutation\" : \"Mutations\";", replace: "return \"Mutations\";" },
  { id: "search-ignores-own-search-value", layer: "counts", guard: "unit", file: "lib/table-query.ts",
    effect: "The table's search reads each column's text alone, so \"germline\" finds no germline call through Protein Change.",
    find: "positionCaseInsensitiveUTF8(\" + (c.search ?? c.text) + \"", replace: "positionCaseInsensitiveUTF8(\" + c.text + \"" },
  { id: "germline-search-misses-status", layer: "counts", guard: "mutation-columns", file: "lib/mutation-table.ts",
    effect: "A germline call's status is never added to its Protein Change search value, so \"germline\" finds no row while MS is hidden.",
    find: "\", 'germline') > 0, concat(", replace: "\", 'no-such-status') > 0, concat(" },
  { id: "title-unit-by-kept-rows", layer: "counts", guard: "unit", file: "lib/mutation-cell-text.ts",
    effect: "A table filtered to one of 223 rows is titled \"1 of 223 Mutation\": the word numbered by the kept rows, not the total it follows.",
    find: "export function mutationTableUnit(t: { all: number }): string {\n  return mutationUnit(t.all);", replace: "export function mutationTableUnit(t: { all: number }): string {\n  return mutationUnit((t as { total?: number }).total ?? t.all);" },
];
