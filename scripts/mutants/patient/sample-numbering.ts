// Planted bugs: the Patient page's sample numbering by collection day (PAT-STM-12). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "patient-tables-number-without-days", layer: "counts", guard: "unit", file: "lib/views/alterations/run.ts",
    effect: "The Patient page's tables number the samples without their collection days, so a sample taken first can be labelled 2 there while the header calls it 1 (PAT-STM-12).",
    find: "const marks = sampleMarks(samples, ev.events);",
    replace: "const marks = sampleMarks(samples, []);" },
  { id: "patient-timeline-failure-refuses", layer: "counts", guard: "unit", file: "lib/views/shared.ts",
    effect: "A participant that refuses or fails to give a patient's timeline makes the Patient page's alteration tables and signatures refuse, where only the samples' numbering needs it.",
    find: "    if (isAbortError(e)) throw e;\n",
    replace: "    throw e;\n" },
];
