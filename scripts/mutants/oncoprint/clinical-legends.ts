// Planted bugs: the clinical tracks' legends, the portal's "Show legends for clinical tracks" / "only for altered" (ONC-VI-4, ONC-VI-5)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-legends-altered-ignored",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-svg.ts",
    effect: "With only altered legends asked for, the server SVG still lists the values of unaltered columns (P12's No data).",
    find: "contract.display?.clinicalLegends === \"altered\" ? alteredColumns(contract.tracks) : undefined",
    replace: "undefined" },
  { id: "onc-altered-columns-take-unaltered",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-style.ts",
    effect: "An unaltered column counts as altered for the legends, so \"only altered\" lists every column's values.",
    find: "if (genes.some((t) => t.cells[i] > 0)) out.push(i);",
    replace: "if (genes.some((t) => t.cells[i] >= 0)) out.push(i);" },
  { id: "onc-legends-none-drops-heatmap",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-svg.ts",
    effect: "Turning the clinical legends off also drops the heatmap keys, where the portal's switch covers clinical tracks only.",
    find: "&& !emptyClinicalKey(t, keyColumns)) || t.kind === \"heatmap\");",
    replace: "&& !emptyClinicalKey(t, keyColumns)) || (t.kind === \"heatmap\" && contract.display?.clinicalLegends !== \"none\"));" },
  { id: "onc-legends-empty-row",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-svg.ts",
    effect: "With only altered legends and no altered column, each clinical track still gets a key row, empty.",
    find: "((t.categories && t.categories.length) || t.numeric || t.stack) && !emptyClinicalKey(t, keyColumns))",
    replace: "((t.categories && t.categories.length) || t.numeric || t.stack))" },
];
