// Planted bugs: an attribute patient-level in one study and sample-level in another, charted once per sample (STS-MD-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "conflicting-level-not-found", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "An attribute patient-level in one selected study and sample-level in another is drawn as two charts, one in patients (blca_tcga + ampca_bcm_2016 GRADE: High Grade 388 patients), where the portal draws one in samples (389).",
    find: "return [...levels].filter(([, l]) => l.size > 1)", replace: "return [...levels].filter(([, l]) => l.size > 2)" },
  { id: "lifted-attribute-counted-twice", layer: "counts", guard: "unit", file: "lib/custom-data.ts",
    effect: "A patient-level value read per sample is also kept as its patient row, so the attribute is charted at both levels again.",
    find: "\" AND NOT (type = 'patient' AND attribute_name IN (\" + names + \"))\\n\" +", replace: "\"\\n\" +" },
];
