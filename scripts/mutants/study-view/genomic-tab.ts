// Planted bugs: Add chart's Genomic tab (STV-AC-2, STV-AC-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "genomic-freq-of-all-profiled", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "A gene table's Freq in the Genomic tab is 100 % whatever share of the selection is profiled for it (coadread Mutated Genes reads 100 % where the portal's is 89.9 %).",
    find: "? [{ key: c.key, name: c.name, freq: pct(profiled[c.table]) }]", replace: "? [{ key: c.key, name: c.name, freq: 100 }]" },
  { id: "gene-table-uncheck-drops-gene-status", layer: "cohorts", guard: "unit", file: "lib/study-view-gene-tables.ts",
    effect: "Unchecking a gene table also removes any untagged OQL clause: a Gene status chart's alteration goes while its profiled clause stays, widening the cohort from mutated to profiled.",
    find: "return !!l && l.kind === \"oql\" && l.chart === kind; };", replace: "return !!l && l.kind === \"oql\" && (l.chart === kind || l.chart === undefined); };" },
];
