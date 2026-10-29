// The `composition` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";
import { HTA11_SC_DEMO } from "../../hta11-sc-demo.ts";
import { SPECTRUM_SC_DEMO } from "../../spectrum-sc-demo.ts";

export const compositionDoc: KindDoc = {
  reference: `\`profileType:"<generic-assay profile>", entities?:[ids] | attributes:["<numeric attribute>", …2–16], unit?:"patient"|"sample", normalize?:true, sort?:"<part>", cohorts:[1–8 names]\` | **what each case is made of, as parts of a whole, compared between cohorts** — the stacked-bar panels of single-cell studies (cell types, cell states) and of signature studies. The parts are a generic-assay profile's entities (per sample, or per patient for a patient-level profile; at most 16 — choose them with \`entities\`) or 2–16 numeric clinical attributes, \`custom:\` uploads included (per patient unless \`unit:\"sample\"\`). A case with every part, none below zero and a sum above zero is kept, its parts divided by their sum unless \`normalize:false\`; the rest are counted as left out. Inside the database, per cohort: n, Σp and Σp² per part and Σ, Σ² of each case's Shannon entropy. Each cohort against the view's other cohorts pooled, part by part: log2 of the ratio of means (each + 0.001) and Welch's t, Benjamini–Hochberg across the comparisons (with two cohorts, once per part). The figure draws each cohort's cases as stacked bars ordered by \`sort\` (default the first part), beside the cohort's mean, and a cohort × part matrix; the bars come only from participants that may show cases, and past 2,000 cases a cohort is drawn as its mean alone, saying so. Sums only, apart from those bars, which carry no ids`,
  grammar: `{"kind":"composition","profileType":"<generic-assay profile>"|"attributes":["<numeric attribute>",…2-16],"sort":"<part>"?,"normalize":true?,"cohorts":[1-8 names]}
  // parts of a whole per case (cell types, cell states, signatures) as stacked bars; each cohort vs the rest per part (Welch t, BH)`,
  examples: [
    {
      title: "Composition: T and NK cell states by mutational signature (MSK SPECTRUM)",
      demonstrates: "A `composition` view, the stacked-bar panels of single-cell papers: each patient's T/NK cells split into ten states (custom data, one attribute per state), ordered by the dysfunctional CXCL13+ CD8 share, each signature's mean beside its patients, and a matrix of every state in each signature against the other two. A second view does the same per sample from the study's own generic-assay cell-type fractions.",
      tags: ["single-cell"],
      note: "The 36 SPECTRUM patients with a consensus signature other than Undetermined, split as the paper splits them. Dysfunctional CXCL13+ CD8 T cells are a mean 7.0% of T/NK cells in the 16 HRD-Dup patients against 4.9% in HRD-Del and 4.4% in FBI, and naive CD4 cells the reverse (15.2% against 19.6% and 20.1%) — the direction of the paper's Fig. 4b. The clearest single difference is cycling T/NK cells, higher in HRD-Dup (8.6% against 5.7%; Welch p = 0.003, q = 0.08 across the 30 comparisons); none reaches q < 0.05 at this size, which the matrix shows as no outlined dot. Per sample, from the study's cell-type fractions, T cells are 24% of HRD-Dup samples' cells against 32% of FBI's. The paper fits a binomial model on cell counts with site and sort as covariates; this view compares shares between groups and says so.",
      customData: SPECTRUM_SC_DEMO,
      doc: {
        study: "msk_spectrum_tme_2022",
        cohorts: {
          "HRD-Dup": { all: [{ kind: "clinical", attribute: "CONSENSUS_SIGNATURE", values: ["HRD-Dup"] }] },
          "HRD-Del": { all: [{ kind: "clinical", attribute: "CONSENSUS_SIGNATURE", values: ["HRD-Del"] }] },
          "FBI": { all: [{ kind: "clinical", attribute: "CONSENSUS_SIGNATURE", values: ["FBI"] }] }
        },
        views: [
          { kind: "composition", cohorts: ["HRD-Dup", "HRD-Del", "FBI"],
            attributes: [
              "custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13",
              "custom:spectrum-sc-tnk/TNK_CD4_T_naive",
              "custom:spectrum-sc-tnk/TNK_CD4_T_reg",
              "custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13",
              "custom:spectrum-sc-tnk/TNK_CD8_T_ISG",
              "custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic",
              "custom:spectrum-sc-tnk/TNK_Cycling_T_NK",
              "custom:spectrum-sc-tnk/TNK_ILC",
              "custom:spectrum-sc-tnk/TNK_NK_CD56",
              "custom:spectrum-sc-tnk/TNK_NK_cytotoxic"
            ],
            sort: "custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13" },
          { kind: "composition", cohorts: ["HRD-Dup", "HRD-Del", "FBI"], profileType: "cell_type_relative_counts", sort: "T_cell" }
        ]
      }
    },
    {
      title: "Composition: adenomas and serrated polyps, from a generic single-cell summary (HTAN Vanderbilt)",
      demonstrates: "Single-cell data brought in without a study-specific script: scripts/gen-singlecell-summary.py proposed the mapping from a Cell Explorer dataset to this study (donor_id is the patient, the HTAN Specimen ID the sample) and summarised the cell labels per sample. The first view draws those custom data; the second the study's own generic-assay cell-type fractions, for comparison.",
      tags: ["single-cell"],
      note: "crc_hta11_htan_2021 is 52 patients with colorectal polyps (Chen et al., Cell 2021). The summary covers 55 of its 61 samples; its counts equal the study's own absolute_counts profile for all 670 sample and cell-type pairs it reports. Per sample, adenoma-specific cells (ASC) are 32.1% of the epithelium in the 30 conventional adenomas against 4.1% in the 20 serrated polyps (q = 2e-5), and serrated-specific cells (SSC) 1.5% against 19.7% (q = 0.003): the two paths to malignancy the paper describes. Stem cells (STM) differ little here (3.1% against 2.5%). The study's own fractions, over every cell type, give the same picture (ASC 29.9% against 3.7%). Cohorts are patients, so a patient with polyps of both types counts in both; 5 of the 52 have both.",
      customData: HTA11_SC_DEMO,
      doc: {
        study: "crc_hta11_htan_2021",
        cohorts: {
          "Conventional adenoma": { all: [{ kind: "clinical", attribute: "POLYP_TYPE", values: ["AD"] }] },
          "Serrated polyp": { all: [{ kind: "clinical", attribute: "POLYP_TYPE", values: ["SER"] }] }
        },
        views: [
          { kind: "composition", cohorts: ["Conventional adenoma", "Serrated polyp"], unit: "sample",
            attributes: ["custom:hta11-sc-s/EPI_Cell_Type_ABS", "custom:hta11-sc-s/EPI_Cell_Type_ASC", "custom:hta11-sc-s/EPI_Cell_Type_CT", "custom:hta11-sc-s/EPI_Cell_Type_EE", "custom:hta11-sc-s/EPI_Cell_Type_GOB", "custom:hta11-sc-s/EPI_Cell_Type_SSC", "custom:hta11-sc-s/EPI_Cell_Type_STM", "custom:hta11-sc-s/EPI_Cell_Type_TAC", "custom:hta11-sc-s/EPI_Cell_Type_TUF"],
            sort: "custom:hta11-sc-s/EPI_Cell_Type_ASC" },
          { kind: "composition", cohorts: ["Conventional adenoma", "Serrated polyp"], profileType: "relative_counts", sort: "ASC" }
        ]
      }
    }
  ],
};
