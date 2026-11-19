// Planted bugs: the Mutations tab's greyed gene chip (MUT-GT-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "gene-chip-check-keeps-table", layer: "counts", guard: "unit", file: "app/portal/results-layout.ts",
    effect: "The chip check keeps the table's search and filters, so a gene greys when the table is merely narrowed.",
    find: "genes, codons: undefined, table: undefined, yMax: undefined, hide: undefined } as unknown as View),", replace: "genes, codons: undefined, yMax: undefined, hide: undefined } as unknown as View)," },
  { id: "gene-chip-check-one-gene", layer: "counts", guard: "unit", file: "app/portal/results-layout.ts",
    effect: "The chip check asks about the open gene only, so no other gene's chip is ever greyed.",
    find: "view: (vs: View[]) => ({ ...vs[0], genes, codons:", replace: "view: (vs: View[]) => ({ ...vs[0], codons:" },
  { id: "gene-chip-grey-unmutated-fusions", layer: "counts", guard: "unit", file: "app/portal/results-layout.ts",
    effect: "A gene with fusion rows but no mutated sample is greyed, though the tab lists its fusions.",
    find: ".filter(lollipopGeneEmpty).map((g) => g.gene)", replace: ".filter((g) => g.mutated === 0).map((g) => g.gene)" },
];
