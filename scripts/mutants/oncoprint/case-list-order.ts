// Planted bugs: the OncoPrint's "case list order" (ONC-SO-3), the columns in a user-defined list's typed order
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-caselist-set-sorted",
    layer: "counts",
    guard: "unit",
    file: "lib/id-sets.ts",
    effect: "A typed list is saved sorted, so the case list order is the ids' alphabetical order, not the order typed.",
    find: "    if (!ordered) ids.sort();",
    replace: "    ids.sort();" },
  { id: "onc-caselist-patient-last-sample",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-case-list.ts",
    effect: "A patient column takes its last listed sample's place, where the portal places it at its first (the uniq of the samples' patients).",
    find: "if (p !== undefined && (r === undefined || p < r)) r = p;",
    replace: "if (p !== undefined && (r === undefined || p > r)) r = p;" },
  { id: "onc-caselist-unlisted-first-desc",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-assemble.ts",
    effect: "Descending, the columns the list does not reach come first, where they always go last.",
    find: "if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;\n        return sign * (a - b);",
    replace: "if (a === undefined || b === undefined) return sign * (a === b ? 0 : a === undefined ? 1 : -1);\n        return sign * (a - b);" },
];
