// Planted bugs: the timeline's Data (ZIP) download (PAT-TL-ZM-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "timeline-zip-style-dropped", layer: "counts", guard: "unit", file: "lib/timeline-tables.ts",
    effect: "The timeline's Data (ZIP) leaves out the STYLE_* columns, where the portal's data_timeline_<type>.txt files keep every attribute of the events.",
    find: "byType(events, (k) => k === \"PATIENT_ID\")",
    replace: "byType(events, (k) => k === \"PATIENT_ID\" || /^STYLE_/.test(k))" },
];
