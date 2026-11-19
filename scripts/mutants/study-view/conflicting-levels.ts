// Planted bugs: an attribute patient-level in one study and sample-level in another, charted once per sample (STS-MD-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "conflicting-levels": ["node", "--env-file=.env.local", "scripts/check-conflicting-levels.ts"],
};

export const mutants: Mutant[] = [
  { id: "conflicting-level-filtered-by-patient", layer: "counts", guard: "conflicting-levels", file: "lib/explore.ts",
    effect: "A patient's value of an attribute read per sample is counted for every sample of a selected patient, not only the selected samples, so the chart holds more samples than the selection and its NA shrinks by as many (nsclc_tracerx_2017 CRUK0030-R1 + luad_cas_2020 LUAD_01 HISTOLOGY: Invasive adenocarcinoma 4 where 1 is selected).",
    history: "cBioPortal's study view counts this way (cBioPortal/cbioportal#12509); cBioLab never shipped it.",
    find: "  ? \"\\n  AND if(type = 'sample', sample_unique_id IN \" + set.samples + \", patient_unique_id IN \" + set.patients + \")\"",
    replace: "  ? \"\\n  AND patient_unique_id IN \" + set.patients" },
  { id: "conflicting-level-not-found", layer: "counts", guard: "unit", file: "lib/explore.ts",
    effect: "An attribute patient-level in one selected study and sample-level in another is drawn as two charts, one in patients (blca_tcga + ampca_bcm_2016 GRADE: High Grade 388 patients), where the portal draws one in samples (389).",
    find: "return [...levels].filter(([, l]) => l.size > 1)", replace: "return [...levels].filter(([, l]) => l.size > 2)" },
  { id: "lifted-attribute-counted-twice", layer: "counts", guard: "unit", file: "lib/custom-data.ts",
    effect: "A patient-level value read per sample is also kept as its patient row, so the attribute is charted at both levels again.",
    find: "\" AND NOT (type = 'patient' AND attribute_name IN (\" + names + \"))\\n\" +", replace: "\"\\n\" +" },
];
