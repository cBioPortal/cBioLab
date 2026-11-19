// Planted bugs: the clinical comparison view's attributes stored per patient in one study and per sample in another. How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-levels-pooled", layer: "statistics", guard: "unit", file: "lib/views/clinical/run.ts",
    effect: "The clinical comparison pools an attribute one study stores per patient and another per sample, so a cell adds patients to samples and its test runs on the mix (nsclc_tracerx_2017 + luad_cas_2020 HISTOLOGY, EGFR-mutant: 15 patients + 51 samples read as 66 patients).",
    find: "    if (vStudies.length > 1 && atPatient.length && atSample.length) {", replace: "    if (false) {" },
  { id: "clinical-levels-empty-answer-counts", layer: "statistics", guard: "unit", file: "lib/views/clinical/run.ts",
    effect: "A study whose cohort holds no value of a sample-level attribute is read at the empty answer's default level, so an attribute every study stores per sample is refused as stored at different levels.",
    find: "x.per === lvl && (x.kind === \"cat\" ? !!x.values?.length : !!x.n)", replace: "x.per === lvl" },
];
