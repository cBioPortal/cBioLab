// Planted bugs: the Cancer Types Summary's Show Genomic Alteration Types checkbox
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cts-types-hidden-keeps-legend",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "With Show Genomic Alteration Types unticked the legend still lists the kinds, where the portal hides it.",
    find: "const items: LegendItem[] = r.alterationTypes === false ? [] : [...CT_KINDS]",
    replace: "const items: LegendItem[] = [...CT_KINDS]" },
  { id: "cts-types-hidden-bar-mutations-only",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "The whole bar drawn with its types hidden is as tall as its mutations only, not its altered total.",
    find: "const h = (T + PLOT_H) - ys(Math.min(ys.domain[1], value(g, \"altered\")));",
    replace: "const h = (T + PLOT_H) - ys(Math.min(ys.domain[1], value(g, \"mutation\")));" },
  { id: "cts-types-unchecked",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/run.ts",
    effect: "alterationTypes: \"no\" is taken without a word, and draws the types.",
    find: "if (view.alterationTypes !== undefined && typeof view.alterationTypes !== \"boolean\")",
    replace: "if (false)" },
  { id: "cts-types-hidden-no-popover",
    layer: "counts",
    guard: "unit",
    file: "lib/views/cancertypes/figure.ts",
    effect: "With Show Genomic Alteration Types unticked, hovering a bar opens no popover, where the portal's opens it on the whole bar too.",
    find: "(o.popover ? ` data-group=\"${esc(g.key)}\" role=\"img\" aria-label=",
    replace: "(false ? ` data-group=\"${esc(g.key)}\" role=\"img\" aria-label=" },
];
