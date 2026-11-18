// Planted bugs: the Cancer Types Summary for a gene with no alterations
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cts-unaltered-any-panel",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "A gene altered in one of two cohorts has its tab greyed, where the portal greys only a gene altered nowhere.",
    find: "return r.panels.every((pn) => !geneSource(pn, gene).altered);",
    replace: "return r.panels.some((pn) => !geneSource(pn, gene).altered);" },
  { id: "cts-unaltered-draws-bars",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "A gene with no alterations draws empty bars, where the portal says \"There are no alterations in this gene.\"",
    find: "if (!groups.length || cancertypesUnaltered(r, o.gene ?? null)) {",
    replace: "if (!groups.length) {" },
  { id: "cts-gene-header-panel-total",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "A gene tab's header counts the genes together (315 of 594 on DAZ1's tab), not that gene.",
    find: "    const tot = src;",
    replace: "    const tot = pn;" },
];
