// Planted bugs: the "# Samples per Patient" row on sample columns (ONC-MD-1)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-samples-row-patient-only",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-assemble.ts",
    effect: "Sample columns lose the \"# Samples per Patient\" row, which the portal keeps (msk_impact_2017: P-0004140's three samples each 3).",
    find: "  if (input.samples) {",
    replace: "  if (input.samples && unit === \"patient\") {" },
  { id: "onc-samples-row-per-sample",
    layer: "counts",
    guard: "oncoprint-values",
    file: "lib/oncoprint.ts",
    effect: "A sample column counts its own samples (always 1), not its patient's queried samples, so the row never appears in sample mode.",
    find: "(unit === \"sample\" ? \"any(pn.n)\" : \"uniqExact(sd.sample_unique_id)\")",
    replace: "\"uniqExact(sd.sample_unique_id)\"" },
  { id: "onc-samples-row-every-sample",
    layer: "counts",
    guard: "oncoprint-values",
    file: "lib/oncoprint.ts",
    effect: "A query naming samples counts every sample of each patient, not the queried ones (FX-P02-T2 alone shows 2).",
    find: "\"      WHERE cancer_study_identifier = \" + sq(study) + fromColumnSamples(\"sample_unique_id\", study, samples)",
    replace: "\"      WHERE cancer_study_identifier = \" + sq(study)" },
];
