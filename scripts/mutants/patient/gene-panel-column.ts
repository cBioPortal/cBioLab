// Planted bugs: the Patient tables' Gene panel column and the gene panel window (PAT-GP-2…4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "gene-panel-lists-every-sample", layer: "counts", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "The Gene panel cell lists every sample's panel, where the portal leaves out a sample profiled for the gene that does not carry the row.",
    find: "arrayFilter(s -> has(splitByString(', ', g.samples), s) OR has(miss.np, s), ",
    replace: "arrayFilter(s -> 1, " },
  { id: "gene-panel-wes-named", layer: "counts", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "A whole-exome sample's panel reads \"WES\", where the portal has no panel for it and writes N/A.",
    find: "AS m FROM pan WHERE panel != 'WES'),",
    replace: "AS m FROM pan),",
  },
  { id: "gene-panel-columns-even-split", layer: "counts", guard: "unit", file: "lib/gene-panel-list.ts",
    effect: "The gene panel window splits the genes evenly down its columns (10 genes: 4, 3, 3), where the portal cuts equal chunks (4, 4, 2).",
    find: "if (chunked.length === left) { cols.push(...chunked); break; }",
    replace: "if (chunked.length === left && left === 1) { cols.push(...chunked); break; }" },
  { id: "gene-panel-filter-case-sensitive", layer: "counts", guard: "unit", file: "lib/gene-panel-list.ts",
    effect: "The gene panel window's filter is case-sensitive, where the portal's is not.",
    find: "try { re = new RegExp(filter, \"i\"); }",
    replace: "try { re = new RegExp(filter); }" },
];
