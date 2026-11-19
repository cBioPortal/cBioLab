// Planted bugs: the Patient tables' Cohort cell, the portal's FrequencyBar and tooltip (PAT-STM-2, PAT-STM-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cohort-keyword-count-any-mutation", layer: "counts", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "The Cohort bar's keyword share counts every mutation of the study, where the portal counts the samples with the row's keyword (APC truncating 376 of 534, not every APC sample).",
    find: "\"kc AS (SELECT keyword AS kw, uniqExact(sampleId) AS n FROM \"",
    replace: "\"kc AS (SELECT keyword AS kw, uniqExact(sampleId) * 0 + 1 AS n FROM \"" },
  { id: "cohort-detail-keyword-count-is-gene-count", layer: "counts", guard: "unit", file: "lib/views/alterations/run.ts",
    effect: "The Cohort cell's keyword count is the gene's count, so the tooltip says all 387 APC samples have APC truncating mutations (the portal: 376).",
    find: "keywordN: Number(x.cohortKwN ?? 0)",
    replace: "keywordN: Number(x.cohortN ?? 0)" },
  { id: "cohort-bar-cna-colours-swapped", layer: "counts", guard: "unit", file: "lib/views/alterations/cohort-cell.ts",
    effect: "The CNA Cohort bar is blue for an amplification and red for a deletion, the portal's colours swapped.",
    find: "[cna === \"AMP\" ? b.amp : b.del]",
    replace: "[cna === \"AMP\" ? b.del : b.amp]" },
];
