// Planted bugs: the Cancer Types Summary's profiled-data strip
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cts-strip-profiled-any-type",
    layer: "counts",
    guard: "results-oql",
    file: "lib/views/cancertypes/sql.ts",
    effect: "The strip's mutation row counts a sample profiled for any alteration type, so a gene off the mutation panel still shows \"+\".",
    find: "countIf(has(pts, 'mut')) AS pmut",
    replace: "count() AS pmut" },
  { id: "cts-strip-no-minus",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "A group nobody in which was profiled for a data type shows \"+\", where the portal shows \"−\" and \"Not profiled\".",
    find: "return { plus: c > 0, tip:",
    replace: "return { plus: true, tip:" },
  { id: "cts-strip-rows-from-drawn",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "A gene tab where no group was profiled for a data type drops that row, where the portal keeps it with \"−\" marks.",
    find: "PROFILES.filter(([k]) => types.includes(k))",
    replace: "PROFILES.filter(([k]) => types.includes(k) && groups.some((g) => n(g, k) > 0))" },
  { id: "cts-strip-rows-every-type",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/run.ts",
    effect: "A \"KRAS: MUT\" query draws CNA and structural variant rows too, where the portal lists only the selected profiles.",
    find: "lines ? lines.flatMap((l) => parseOql(l).flatMap((e) => e.specs.flatMap((x) => SPEC_TYPES[x.type] || []))) : [\"mutation\", \"cna\", \"sv\"]",
    replace: "[\"mutation\", \"cna\", \"sv\"]" },
];
