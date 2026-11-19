// Planted bugs: the gutter's label cut (ONC-LY-2)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-label-cut-one-short",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-style.ts",
    effect: "A label is cut to its first 16 characters and an ellipsis, where the portal prints the first 15 and \"...\".",
    find: "  return label.length > n ? label.slice(0, n - 3) + \"...\" : label;",
    replace: "  return label.length > n ? label.slice(0, n - 2) + \"…\" : label;" },
  { id: "onc-label-cut-at-eighteen",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-style.ts",
    effect: "An 18-character label is cut, where the portal prints labels of up to 18 characters whole.",
    find: "  return label.length > n ? label.slice(0, n - 3) + \"...\" : label;",
    replace: "  return label.length >= n ? label.slice(0, n - 3) + \"...\" : label;" },
];
