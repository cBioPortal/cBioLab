// The `pathwaymap` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const pathwaymapDoc: KindDoc = {
  summary: "a PathwayMapper pathway diagram with each gene's altered %, beside the pathways ranked for the query genes",
  reference: `\`genes?:[symbols ≤100], pathway?, rank?:"count"\|"percent", byFrequency?:false, pancanOnly?:true, cohorts:[names] (≤4)\` | **a pathway diagram, as cBioPortal's Pathways tab draws it**: one of the 55 pathways of PathwayMapper's library (the ten TCGA PanCanAtlas pathways and 45 from TCGA marker papers), drawn from the library's own layout — genes, families, complexes and processes as nodes, activation, inhibition, induction, repression and binding as edges — with each gene node showing its altered % in each cohort (mutation, amplification, deep deletion or structural variant, over the samples profiled for THAT gene; a gene no sample was profiled for reads N/P, never 0%). Beside it, the library's pathways ranked as PathwayMapper ranks them: by how many \`genes\` each holds (\`rank:"count"\`, default) or that as a % of its gene nodes (\`"percent"\`), optionally weighting each matched gene by its altered % (\`byFrequency\`), over the PanCanAtlas ten unless \`pancanOnly:false\`; ties break by the matched genes' summed % and then by name. \`pathway\` picks the one drawn (default: the first of the ranking); it, \`rank\`, \`byFrequency\` and \`pancanOnly\` are applied in the browser from the one result, which carries every library gene's counts. Without \`genes\`, the library genes altered in the cohort are the query (a single patient's, say). Counts only, so every participant answers, a remote peer included`,
  grammar: `{"kind":"pathwaymap","genes":["TP53","PIK3CA",...(max 100)]?,"pathway":"<name>"?,"rank":"count|percent","byFrequency":false,"pancanOnly":true,
 "cohorts":[names?(max 4)]}
  // PathwayMapper diagram, each gene node's altered % (panel-aware), pathways ranked by how many query genes they hold`,
  examples: [
    {
      title: "Pathway diagram: TCGA breast cancer and its most-altered genes",
      snapshot: "pathwaymap",
      demonstrates: "A `pathwaymap` view: the PathwayMapper pathway that holds most of the query genes, drawn from the library's own layout, each gene node carrying its altered % over the samples profiled for that gene, beside the ten TCGA PanCanAtlas pathways ranked by how many query genes each holds — the portal's Pathways tab.",
      tags: ["gene-sets", "diagram"],
      note: "TCGA PanCancer Atlas breast cancer with the genes a breast query usually starts from. PI3K holds three of the seven — PIK3CA (34%), PTEN (11%) and AKT1 (4%) — so it ranks first of the ten PanCanAtlas pathways and is drawn; TP53 and Cell Cycle hold TP53 alone. Every % is over the 1,084 samples profiled, as on cbioportal.org.",
      doc: {
        study: "brca_tcga_pan_can_atlas_2018",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "pathwaymap", genes: ["TP53", "PIK3CA", "CDH1", "GATA3", "MAP3K1", "PTEN", "AKT1"], cohorts: ["all patients"] }]
      }
    }
  ],
};
