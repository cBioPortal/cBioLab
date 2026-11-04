// The `mutexpr` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const mutexprDoc: KindDoc = {
  summary: "one gene's expression by another gene's protein changes or codons",
  reference: `\`gene, expressionGene?, profileType, scale?:"linear"|"log2"|"zscore", resolution?:"protein"|"codon", stratify?:["cancerType","fusion"], fusionGene?, minCount?:5, cohorts:[1 name]\` | **expression of \`expressionGene\` (default: \`gene\` itself) against \`gene\`'s mutations**, one group per protein change (\`resolution:"protein"\`, the default) or codon (\`"codon"\`: reference residue and first position as written, so R175H and R175C are R175). Each sample of the cohort with a value is one observation. A sample with two changes is "Several"; **"Not mutated" (its panel covers the gene for mutations, whole exome included, and it has no call) and "Not profiled" (its panel does not) are separate groups** — a sample never profiled is never wild type. \`scale\`: \`"zscore"\` reads a z-score profile as stored (and is the only scale for one), \`"log2"\` is log2(v+1) of a continuous profile (TPM, RSEM, FPKM; the default for one; a negative value is left out and counted), \`"linear"\` the profile as stored; anything else is refused. \`stratify\` splits the samples first by CANCER_TYPE (folded; none recorded is its own stratum) and/or by a structural variant of \`fusionGene\` (default \`gene\`; present / absent / not profiled), crossed, at most 24 strata. **\`minCount\` (default 5)**: changes with fewer samples are pooled into "Other", as are those past the 30 largest; any group or stratum still smaller is withheld — its size shown as "< minCount", no statistic reported. Per group: n, exact mean and SD, and quartiles and 5th–95th percentiles read off 60 bins over the cohort's middle 99% (each within one bin of the smallest value with that share at or below it); each group, "All mutated" included, against "Not mutated" in its stratum by Welch's t from per-group sums (exact across sites), BH q across the view. A method record re-computes every number. A remote peer cannot answer yet and is named`,
  grammar: `{"kind":"mutexpr","gene":"<gene>","expressionGene":"<gene>"?,"profileType":"<expression profile>","scale":"linear"|"log2"|"zscore"?,
 "resolution":"protein"|"codon"?,"stratify":["cancerType","fusion"]?,"fusionGene":"<gene>"?,"minCount":5?,"cohorts":[1 name]}
  // expression per protein change / codon of gene; "Not mutated" and "Not profiled" apart; small groups withheld`,
  examples: [
    {
      title: "TP53 expression by TP53 protein change in breast cancer",
      snapshot: "mutexpr",
      demonstrates: "A `mutexpr` view: one gene's expression per protein change of a gene — here TP53's own mRNA by its mutations — with \"Not mutated\" and \"Not profiled\" kept apart, changes seen in fewer than minCount samples pooled or withheld, and each group tested against \"Not mutated\" by Welch's t from per-group sums.",
      tags: ["expression", "protein-changes"],
      note: "TCGA PanCancer Atlas breast cancer, RSEM as log2(v + 1). Truncating TP53 changes (R196*, R213*, R342*) lower TP53's own mRNA, by nonsense-mediated decay, while hotspot missense changes such as R175H and R273H do not — the reason a missense and a truncating TP53 tumour should not be pooled when expression is the readout.",
      doc: {
        study: "brca_tcga_pan_can_atlas_2018",
        cohorts: { "All samples": { all: [] } },
        views: [{ kind: "mutexpr", cohorts: ["All samples"], gene: "TP53", profileType: "rna_seq_v2_mrna", minCount: 3 }]
      }
    },
    {
      title: "DUSP6 expression by KRAS codon, within cancer type",
      demonstrates: "A `mutexpr` view at codon resolution, stratified by cancer type over a cohort spanning three studies: the MAPK output gene DUSP6 against KRAS codons, each codon compared with KRAS-unmutated tumours of the same cancer type.",
      tags: ["expression", "protein-changes", "stratified", "pan-cancer"],
      note: "TCGA PanCancer Atlas pancreatic, colorectal and lung adenocarcinoma, on mRNA z-scores relative to all samples. KRAS G12 tumours carry higher DUSP6 than KRAS-unmutated tumours of the same cancer type; the codon groups seen in fewer than five samples of a cancer type are pooled or withheld rather than drawn from a handful of points.",
      doc: {
        study: "paad_tcga_pan_can_atlas_2018",
        cohorts: { "PAAD + COADREAD + LUAD": { studies: ["paad_tcga_pan_can_atlas_2018", "coadread_tcga_pan_can_atlas_2018", "luad_tcga_pan_can_atlas_2018"], all: [] } },
        views: [{ kind: "mutexpr", cohorts: ["PAAD + COADREAD + LUAD"], gene: "KRAS", expressionGene: "DUSP6", profileType: "rna_seq_v2_mrna_median_all_sample_Zscores",
          resolution: "codon", stratify: ["cancerType"] }]
      }
    }
  ],
};
