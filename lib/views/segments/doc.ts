// The `segments` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const segmentsDoc: KindDoc = {
  summary: "per-sample copy-number segment tracks over the genome, a chromosome or a gene, as on cBioPortal's CN Segments tab; patient-level studies only",
  reference: `\`gene?, region?, rows?:300, sort?:"order"\\|"gained"\\|"lost", cohorts:[1 name]\` | **copy-number segment tracks**, cBioPortal's CN Segments tab (and the patient view's genomic overview): one row per SAMPLE of the cohort that has segments, each segment drawn from its start to its end and coloured by its mean log2 ratio on IGV's segment scale — white within ±0.1, deepening to red at +1.5 and blue at −1.5; grey where no segment of the sample reaches (not measured, never copy-neutral). Over the whole genome (chromosomes 1–22, X, Y) by default; \`gene\` zooms to the gene's span in IGV's refGene annotation, 1 kb either side (as the portal's IGV zooms to a symbol; the warehouse holds no gene coordinates), and \`region\` to a chromosome (\`"17"\`) or a stretch of one (\`"chr17:37,000,000-38,000,000"\`) — not both. Rows: the study's own sample order (the portal's), for one patient their samples in collection order with their numbers; \`sort: "gained"\`/\`"lost"\` orders by the sample's mean over the region (bases-weighted), highest/lowest first. At most \`rows\` rows (1–2000): the rest are counted and named as left out, above the rows and in the caption; past 250,000 segments the view is refused. Studies on different reference genomes are refused. One cohort; the rows name samples, so only a patient-level participant draws them. No statistic: the stored segments are drawn as they are`,
  grammar: `{"kind":"segments","gene":"<symbol>"?,"region":"<chrom>[:<start>-<end>]"?,"rows":300?,"sort":"order"|"gained"|"lost"?,"cohorts":[name]}
  // per-sample copy-number segment heat strips (log2 segment mean, IGV's colours), whole genome or zoomed to a gene/region; one cohort, patient-level studies only`,
  examples: [
    {
      title: "One patient's copy-number segments, sample by sample",
      snapshot: "segments",
      demonstrates: "A `segments` view over one patient: each of their samples' copy-number segments along the genome, numbered in collection order as the patient page numbers them — the portal's genomic overview track.",
      tags: ["copy-number", "copy-number segments", "patient"],
      note: "IM-GBM-28's four glioma samples: the segments each sample's copy-number profile was cut into, red where gained, blue where lost.",
      doc: {
        study: "glioma_msk_2018",
        cohorts: { "IM-GBM-28": { all: [{ kind: "patientList", ids: ["glioma_msk_2018:IM-GBM-28"] }] } },
        views: [{ kind: "segments", cohorts: ["IM-GBM-28"] }]
      }
    },
    {
      title: "ERBB2 copy number across breast tumours, most gained first",
      demonstrates: "A `segments` view zoomed to a gene, the portal's CN Segments tab for a query: every sample's segments across ERBB2 and 1 kb either side, ordered by the sample's mean over that span, so the amplified tumours come first; the row limit says how many samples it leaves out.",
      tags: ["copy-number", "copy-number segments"],
      note: "TCGA PanCancer breast cancer, zoomed to ERBB2 and sorted by its copy number: the HER2-amplified tumours form the red block at the top.",
      doc: {
        study: "brca_tcga_pan_can_atlas_2018",
        cohorts: { "Breast": { all: [] } },
        views: [{ kind: "segments", cohorts: ["Breast"], gene: "ERBB2", sort: "gained", rows: 200 }]
      }
    }
  ],
};
