// Planted bugs: the filter bar's generic-assay pills (STV-FB-3 #13, #14). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "assay-pill-row-unnamed", layer: "counts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "A frequency table's pills read only the value (\"high\", \"high\"), not which entity's row they are (\"SBS2 high\").",
    find: "text: chart?.freq || !one ? entity + \" \" + value : value", replace: "text: value" },
  { id: "assay-pill-last-value-clinical", layer: "counts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "Removing a row leaves its entity's one other value as a clinical clause, which filters on an attribute that does not exist.",
    find: "rest.length === 1 && l.kind === \"clinical\"", replace: "rest.length === 1" },
  { id: "assay-interval-edit-clinical", layer: "counts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "Editing a generic-assay interval pill turns its filter into a clinical one on no attribute.",
    find: "return a.kind === \"genericAssay\" ?", replace: "return false ?" },
  { id: "assay-pills-no-and", layer: "counts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "Two bars picked on one generic-assay chart sit side by side with no \"and\" between them.",
    find: "return g.label === prev.label;", replace: "return false;" },
];
