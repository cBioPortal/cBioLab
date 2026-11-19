// Planted bugs: Add chart's tab per generic-assay type (STV-AC-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "assay-tab-raw-type", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "A generic-assay tab is named by its raw type (\"GENETIC_ANCESTRY\") where the portal writes \"Genetic Ancestry\".",
    find: "return ASSAY_TAB_TEXT[type] ?? type.split(\"_\")", replace: "return ASSAY_TAB_TEXT[type] ?? type; void type.split(\"_\")" },
];
