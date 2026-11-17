// Planted bugs: the Mutations table's Allele Freq and read counts written as the portal writes them (MUT-STM-5, MUT-STM-6, MUT-COL-29). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "mutation-vaf-two-decimals-always", layer: "counts", guard: "mutation-columns", file: "lib/mutation-table.ts",
    effect: "An allele frequency below 0.01 is written with 2 decimals (0.0098 as 0.01) in the table's search and CSV, where the portal writes 4.",
    find: "if(vaf < 0.01, toDecimalString(vaf, 4), toDecimalString(vaf, 2))", replace: "toDecimalString(vaf, 2)" },
  { id: "mutation-vaf-value-unformatted", layer: "counts", guard: "unit", file: "lib/views/mutations/run.ts",
    effect: "The table's allele frequency and its CSV carry the raw ratio (0.13144758735440932), where the portal writes 0.13.",
    find: "case \"vaf\": return r.vafText ? String(r.vafText) : null;", replace: "case \"vaf\": return r.vaf == null ? null : Number(r.vaf);" },
];
