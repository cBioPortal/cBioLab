// The `cutpoint` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const cutpointDoc: KindDoc = {
  reference: `\`attribute?:"TMB_NONSYNONYMOUS" \\| assay?:{profileType, entity}, endpoint?:"OS", monthsAttribute?/statusAttribute?, permutations?:1000 (100–5000), seed?:1, stratifyBy?:"<attribute>", minStratum?:100, cohorts:[one name]\` | **a biomarker's best survival cut-point, corrected for the search** — **preview** (Samstein 2019, PMID 30643254; PMID 38949888): a numeric marker (the patient's value, or a sample attribute's on the patient's first sample by sample id; or with \`assay\` one entity of a numeric generic-assay profile — a signature, an immune score — on the patient's first sample with a value) against the endpoint. Candidate cuts are the marker's distinct values leaving 10–90% of patients at or below them (at most 100, evenly spaced); at each, the maximally selected standardized log-rank statistic (Lausen & Schumacher; R maxstat's LogRank). The best cut is reported with its permutation-corrected p (\`permutations\` seeded shuffles of the marker; the share whose own best cut does as well) beside the naive log-rank p, the high-vs-low Cox HR, the statistic-against-cut curve (with the permutation 95% line) and Kaplan–Meier curves at the cut. \`stratifyBy\`: a scan per value of a categorical attribute (the largest 8 with ≥ \`minStratum\` patients; the rest counted), as a table. The cut is chosen in-sample and needs validation — the caveat says so. Patient-level studies only`,
  grammar: `{"kind":"cutpoint","cohorts":[one name],"attribute":"TMB_NONSYNONYMOUS","endpoint":"OS","permutations":1000,"seed":1,"stratifyBy":"CANCER_TYPE"?,"minStratum":100}
  // best cut of a numeric marker for survival (max log-rank between p10 and p90), permutation-corrected p, KM at the cut (patient-level; preview)`,
  examples: [
    {
      title: "A tumour mutational burden cut-point for survival on immunotherapy",
      demonstrates: "A `cutpoint` view (preview): the value of a numeric marker (here TMB) that best splits overall survival, found by scanning every candidate cut between the 10th and 90th percentiles with the maximally selected log-rank statistic, its p corrected for that search by 1,000 seeded permutations of the marker and set beside the naive one — then the same per cancer type (`stratifyBy`).",
      tags: ["biomarker-threshold", "permutation-test", "log-rank"],
      note: "Samstein et al. 2019's 1,661 patients treated with checkpoint inhibitors (tmb_mskcc_2018). The best overall cut is TMB > 14.4 mutations/Mb: the top 19% survive markedly longer (HR 0.45, median 47 against 15 months), corrected p ≈ 0.001 against a naive 9.5e-15 that ignores the search. Per cancer type the best cut moves — 18.6 in NSCLC, 9.8 in melanoma, 11.1 in colorectal — and in renal cell carcinoma, oesophagogastric cancer and glioma no cut survives the correction, the paper's point that one threshold does not fit every histology. Every cut here is optimistic and would need validation in another cohort.",
      doc: {
        study: "tmb_mskcc_2018",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "cutpoint", cohorts: ["all patients"], attribute: "TMB_NONSYNONYMOUS", stratifyBy: "CANCER_TYPE" }]
      }
    }
  ],
};
