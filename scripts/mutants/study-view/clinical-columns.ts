// Planted bugs: the Clinical Data tab's Columns menu (STV-CD-9). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "columns-menu-every-tab", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "The Clinical Data tab's Columns menu offers every chart-menu tab (Gene status, generic assays, timelines, custom data), where the portal's has Clinical, Genomic and X vs Y only.",
    find: "return tabs.filter(([t]) => COLUMNS_TABS.includes(t));", replace: "return [...tabs];" },
];
