// The `assays` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const assaysDoc: KindDoc = {
  reference: `\`profileType:"<generic-assay profile>", minN?:3, label?:12, cohorts:[2–6 names]\` | **every entity of one generic-assay profile compared between cohorts**, cBioPortal's group-comparison tabs for generic assays (mutational signatures, arm-level copy number, treatment response, …): one value per sample (every sample of each cohort's patients) or per patient for a patient-level profile. A numeric profile: each entity's n, Σv and Σv² per cohort — values that are not numbers, such as a limit \`">8"\` or NA, are counted and left out — then Welch's t for two cohorts (drawn as a volcano of the difference in means) or Welch's ANOVA for more. A categorical one: each entity's count per value per cohort — NA and blank are not called and are counted apart — then a chi-squared test on cohort × value. q is Benjamini–Hochberg across every entity tested; an entity with fewer than \`minN\` values in a cohort, or with no spread, is counted as not tested. Per-probe methylation is refused (hundreds of thousands of probes), as is any profile past 20,000 entities. Counts and moments only`,
  grammar: `{"kind":"assays","profileType":"<generic-assay profile>","minN":3,"cohorts":[2-6 names]}
  // every entity of a generic-assay profile (signatures, arm-level CNA, …) between cohorts (Welch t/ANOVA or chi-squared, BH)`,
  examples: [
    {
      title: "Mutational signatures: what UV light and tobacco leave behind",
      demonstrates: "An `assays` view, the portal's generic-assay comparison tabs: every entity of one generic-assay profile — here the 30 COSMIC v2 mutational signatures — compared between two cohorts with Welch's t on each cohort's n, mean and variance, Benjamini–Hochberg across the signatures, drawn as a volcano of the difference in mean contribution beside a table. A categorical profile such as arm-level copy number is compared the same way with a chi-squared test.",
      tags: ["signatures", "volcano"],
      note: "Melanoma against non-small cell lung cancer in MSK-IMPACT 50K. The UV signature (7) makes up about half of a melanoma's mutations and almost none of a lung cancer's; the smoking signature (4) is the reverse.",
      doc: {
        study: "msk_impact_50k_2026",
        cohorts: {
          "Melanoma": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Melanoma"] }] },
          "Non-small cell lung": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] }
        },
        views: [{ kind: "assays", cohorts: ["Melanoma", "Non-small cell lung"], profileType: "mutational_signatures_contribution_v2" }]
      }
    }
  ],
};
