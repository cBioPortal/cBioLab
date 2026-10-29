// The `clonality` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const clonalityDoc: KindDoc = {
  summary: "FACETS clonal/subclonal calls, LOH, genome doubling, purity, ploidy",
  reference: `\`genes:[≤12], measure?:"driver"\|"any", qc?:true, cohorts:[names] (≤3)\` | **clonality from FACETS allele-specific copy number** (only studies that carry it — the refusal names them): per gene, the cohort's mutation CALLS (one mutation in one sample; OncoKB drivers by default) that FACETS called clonal, subclonal or indeterminate, LOH at the locus (minor copy number 0, of calls where it was estimated) and the cancer-cell fraction in ten bins; per cohort, FACETS's own whole-genome-doubling, purity and ploidy calls. \`qc\` (default true) uses only samples whose \`FACETS_QC\` is Pass, with the pass/fail counts reported. Only the study's current mutation profile is read (the table also holds rows orphaned by superseded loads). Two cohorts add Fisher tests on clonal vs subclonal per gene (BH across genes) and on WGD. Counts only; a remote peer cannot answer yet and is named`,
  grammar: `{"kind":"clonality","genes":[...(max 12)],"measure":"driver|any","qc":true,"cohorts":[names?(max 3)]}
  // FACETS: % clonal / subclonal, LOH at the locus per gene; WGD, purity, ploidy per cohort`,
  examples: [
    {
      title: "Clonality, LOH and genome doubling from FACETS",
      snapshot: "clonality",
      demonstrates: "A `clonality` view: the FACETS allele-specific copy number this warehouse holds for MSK-IMPACT (1.9M mutation calls no other view reads) — per gene, how often a cohort's driver mutations are clonal or subclonal and whether the mutated locus lost its other allele, beside each cohort's whole-genome doubling rate and purity and ploidy distributions, from FACETS-QC-passing samples.",
      tags: ["facets", "loh", "wgd"],
      note: "Colorectal against breast cancer. Tumour suppressors show the classic second hit — TP53 is ~88% clonal with its other allele lost 77–89% of the time, CDH1 in breast 95% — while the oncogene KRAS rarely loses its partner. PIK3CA is markedly more often subclonal in colorectal cancer (68% clonal) than in breast (84%), in keeping with a later event there. Around a third of both cohorts' tumours have doubled their genome.",
      doc: {
        study: "msk_impact_50k_2026",
        cohorts: {
          "Colorectal": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }] },
          "Breast": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Breast Cancer"] }] }
        },
        views: [{ kind: "clonality", cohorts: ["Colorectal", "Breast"], genes: ["TP53", "KRAS", "APC", "PIK3CA", "SMAD4", "CDH1", "GATA3"] }]
      }
    }
  ],
};
