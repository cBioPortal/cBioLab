// Planted bugs: the Download tab's gene frequency table (sort, filter, paging, file)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "rdl-frequency-sort-unstable",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/frequency.ts",
    effect: "Lines tied on the sort column come out in a different order, where the portal's table keeps their order.",
    find: "return c || a.i - b.i;",
    replace: "return c || b.i - a.i;" },
  { id: "rdl-frequency-tsv-filtered-line",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/frequency.ts",
    effect: "The filter matches a line's OQL while its column is hidden, where the portal's reads only the shown columns.",
    find: "(lineShown && r.line.toUpperCase().includes(t))",
    replace: "r.line.toUpperCase().includes(t)" },
];
