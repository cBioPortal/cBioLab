// Planted bugs: the Tracks menu's item text (ONC-TR-1)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-tracks-menu-raw-id",
    layer: "counts",
    guard: "unit",
    file: "app/_oncoprint/track-edits.ts",
    effect: "The Tracks menu lists clinical attributes by id (AGE), not by the display name the portal lists (Diagnosis Age).",
    find: "return o.rowLabel ?? attributeLabel(name, o.tab === \"custom\" ? \"short\" : \"long\");",
    replace: "return attributeLabel(name, o.tab === \"custom\" ? \"short\" : \"long\");" },
];
