// Planted bugs: the Patient header's TMB-H / MSI-H badges and their OncoKB sync (PAT-STM-9). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "tmb-h-threshold-exclusive", layer: "counts", guard: "oncokb-tumor-type", file: "packages/annotation-sync/src/sources/oncokb-tumor-type.ts",
    effect: "The sync takes TMB-H as a score above 10, where the portal's threshold is inclusive: a sample at exactly 10 (fixture B2) is never asked about.",
    find: "\" >= 10) > 0, 'TMB-H', '')])\"",
    replace: "\" > 10) > 0, 'TMB-H', '')])\"" },
  { id: "tmb-h-last-detailed-type", layer: "counts", guard: "oncokb-tumor-type", file: "packages/annotation-sync/src/sources/oncokb-tumor-type.ts",
    effect: "The patient view's tumour type is the last sample's detailed type, not the first's: FX-P43's TMB-H is asked at Lung Squamous Cell Carcinoma only, and the header's Lung Adenocarcinoma call is never stored.",
    find: "argMinIf(v, s, a = 'CANCER_TYPE_DETAILED')",
    replace: "argMaxIf(v, s, a = 'CANCER_TYPE_DETAILED')" },
  { id: "msi-h-without-score", layer: "counts", guard: "unit", file: "lib/biomarkers.ts",
    effect: "A sample whose MSI_TYPE is Instable shows MSI-H without an MSI_SCORE, where the portal shows the badge only with one.",
    find: "attrs.MSI_TYPE === \"Instable\" && present(attrs.MSI_SCORE)",
    replace: "attrs.MSI_TYPE === \"Instable\"" },
  { id: "biomarker-call-any-tumour-type", layer: "counts", guard: "oncokb-tumor-type", file: "lib/biomarkers.ts",
    effect: "The header reads a biomarker's call at any tumour type, so a sample shows another cancer's level (fixture R3).",
    find: "\" AND tumor_type = \" + sq(tumorType) +",
    replace: "\" AND \" + sq(tumorType) + \" = \" + sq(tumorType) +" },
  { id: "biomarker-asked-by-entrez", layer: "counts", guard: "unit", file: "packages/annotation-sync/src/sources/oncokb-tumor-type.ts",
    effect: "The sync asks OncoKB about a biomarker as a gene's protein change (no Hugo symbol), which OncoKB does not answer as TMB-H / MSI-H.",
    find: "ask.map((k) => isBiomarker(k) ? biomarkerQuery(k) : proteinChangeQuery(k))",
    replace: "ask.map((k) => proteinChangeQuery(k))" },
];
