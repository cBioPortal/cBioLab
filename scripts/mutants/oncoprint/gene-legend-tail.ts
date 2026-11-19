// Planted bugs: the gene legend's "No alterations" and "Not profiled" entries, as the portal lists them (ONC-GL-6)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-legend-no-unaltered-entry",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-style.ts",
    effect: "With a cell not profiled the legend drops \"No alterations\", where the portal lists it whenever a gene row is drawn.",
    find: "if (!present || present.genes) items.push({ label: G.unalteredLabel,",
    replace: "if (!present || (present.genes && !present.notProfiled)) items.push({ label: G.unalteredLabel," },
  { id: "onc-legend-derived-last",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-style.ts",
    effect: "Derived event is listed after Not profiled, where the screen and the SVG put it before the closing two.",
    find: "  if (present?.derived) items.push({ label: \"Derived event\", color: S.palette.derived, kind: \"swatch\" });\n",
    replace: "" },
  { id: "onc-legend-not-profiled-always",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-style.ts",
    effect: "\"Not profiled\" is listed though every cell was profiled, where the portal lists it only when one is not.",
    find: "if (!present || present.notProfiled) items.push({ label: G.notProfiled.label,",
    replace: "items.push({ label: G.notProfiled.label," },
];
