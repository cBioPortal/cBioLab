// Planted bugs: the Mutations table's Protein Change and Chromosome sort keys (MUT-STM-9). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "pc-sort-letters-ignored", layer: "counts", guard: "unit", file: "lib/mutation-sort.ts",
    effect: "Protein changes at one codon tie in the sort (V600E and V600K in any order), where the portal orders them by their letters.",
    find: "return parseFloat(codes ? position + \".\" + codes : position);", replace: "return parseFloat(position);" },
  { id: "chr-sort-x-y-swapped", layer: "counts", guard: "unit", file: "lib/mutation-sort.ts",
    effect: "Chromosome sorts Y before X.",
    find: "lower.includes(\"x\") ? 23 : lower.includes(\"y\") ? 24 : -1", replace: "lower.includes(\"x\") ? 24 : lower.includes(\"y\") ? 23 : -1" },
  { id: "chr-sort-unknown-null", layer: "counts", guard: "unit", file: "lib/mutation-sort.ts",
    effect: "A chromosome with no number, X or Y (MT) sorts last as if blank, where the portal puts it first (−1).",
    find: "? 24 : -1;", replace: "? 24 : null;" },
  { id: "pc-sort-sql-codon-only", layer: "counts", guard: "mutation-columns", file: "lib/mutation-table.ts",
    effect: "The Mutations table sorts Protein Change by codon alone, so KRAS G12C/D/V come in sample order.",
    find: "order: proteinChangeSortSql(\"proteinChange\")", replace: "order: \"pos\"" },
  { id: "chr-sort-sql-text", layer: "counts", guard: "mutation-columns", file: "lib/mutation-table.ts",
    effect: "The Mutations table sorts Chromosome as text (\"10\" < \"17\" < \"2\" < \"chr10\").",
    find: ", order: chromosomeSortSql(\"chr\") }", replace: " }" },
  { id: "pc-sort-sql-letters-dropped", layer: "counts", guard: "mutation-columns", file: "lib/mutation-sort.ts",
    effect: "The table's Protein Change sort ignores the letters after the codon, so R130G and R130Q tie.",
    find: "if(\" + codes + \" = '', '', concat('.', \" + codes + \"))", replace: "''" },
  { id: "chr-sort-sql-x-is-y", layer: "counts", guard: "mutation-columns", file: "lib/mutation-sort.ts",
    effect: "The table's Chromosome sort gives X the value 24, ordering it with Y.",
    find: "'x') > 0, 23", replace: "'x') > 0, 24" },
];
