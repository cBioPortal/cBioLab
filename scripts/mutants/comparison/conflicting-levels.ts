// Planted bugs: an attribute one study stores per patient and another per sample, in the clinical comparison view and splitBy. How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "clinical-levels-pooled", layer: "statistics", guard: "unit", file: "lib/federation.ts",
    effect: "The clinical comparison pools an attribute one study stores per patient and another per sample, so a cell adds patients to samples and its test runs on the mix (nsclc_tracerx_2017 + luad_cas_2020 HISTOLOGY, EGFR-mutant: 15 patients + 51 samples read as 66 patients).",
    find: "  if (!patient.length || !sample.length) return { level, conflict: null };", replace: "  return { level, conflict: null };" },
  { id: "clinical-levels-empty-answer-counts", layer: "statistics", guard: "unit", file: "lib/federation.ts",
    effect: "An answer holding no values votes on the attribute's level, so a remote peer's empty answer at the default level refuses an attribute every study stores per sample.",
    find: "const held = answers.filter((a): a is { study: string; stat: AttrStats } => holdsValues(a.stat));",
    replace: "const held = answers.filter((a): a is { study: string; stat: AttrStats } => !!a.stat);" },
  { id: "splitby-levels-pooled", layer: "cohorts", guard: "unit", file: "lib/analysis.ts",
    effect: "splitBy sizes its arms from an attribute's counts pooled across a study storing it per patient and one storing it per sample, adding patients to samples.",
    find: "  if (levels.conflict) return { kind: \"cat\"", replace: "  if (false) return { kind: \"cat\"" },
  { id: "attribute-stats-empty-default-level", layer: "statistics", guard: "unit", file: "lib/federation.ts",
    effect: "A study whose cohort holds no value of an attribute answers at the default patient level, not the level it declares, so the row's level can be wrong.",
    find: "per: declared.get(a) ?? \"patient\", kind: \"cat\", values: []", replace: "per: \"patient\", kind: \"cat\", values: []" },
];
