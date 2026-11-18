// Planted bugs: a patient's samples' own clinical attributes (lib/patient-sample-attributes.ts), read for
// the timeline's sample tooltip (PAT-TL-TT-3) and the Genomic Evolution Group by. How they are planted
// and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "sample-tip-patient-attrs", layer: "counts", guard: "unit", file: "lib/patient-sample-attributes.ts",
    effect: "A timeline sample's tooltip lists its patient's attributes as the sample's own, and the Genomic Evolution Group by offers them, where the portal lists the sample's.",
    find: "const cols = meta.filter((m) => Number(m.patient) !== 1)",
    replace: "const cols = meta.filter(() => true)" },
];
