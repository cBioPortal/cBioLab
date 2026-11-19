// Planted bugs: the tables offered in Add chart rather than shown by default (STS-OT-2, STS-OT-7). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "case-lists-hidden-while-filtered", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "A case-list filter leaves the Case Lists table hidden, so the reader cannot see or change what the selection is narrowed to.",
    find: "caseLists: checked(SPECIAL_CHART_KEYS.caseLists) || kind(\"caseList\"),", replace: "caseLists: checked(SPECIAL_CHART_KEYS.caseLists)," },
  { id: "timeline-events-shown-by-default", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "Timeline Events Availability is drawn on every study with events, where the portal offers it in Add chart only.",
    find: "events: hasEvents && (checked(SPECIAL_CHART_KEYS.events) || eventFilter),", replace: "events: hasEvents," },
];
