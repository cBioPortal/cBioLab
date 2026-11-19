// Planted bugs: the gene legend's "No alterations" and "Not profiled" entries, as the portal lists them (ONC-GL-6)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-legend-no-unaltered-entry",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-style.ts",
    effect: "The legend has no \"No alterations\" entry for the grey cell, where the portal lists it whenever a cell is profiled.",
    find: "if (!present || present.profiled) items.push({ label: G.unalteredLabel,",
    replace: "if (!present) items.push({ label: G.unalteredLabel," },
  { id: "onc-legend-not-profiled-always",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-style.ts",
    effect: "\"Not profiled\" is listed though every cell was profiled, where the portal lists it only when one is not.",
    find: "if (!present || present.notProfiled) items.push({ label: G.notProfiled.label,",
    replace: "items.push({ label: G.notProfiled.label," },
];
