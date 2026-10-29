// The `correlates` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const correlatesDoc: KindDoc = {
  summary: "every gene's expression correlated with one gene's, the portal's Co-expression tab",
  reference: `\`gene:"<symbol>", profileType:"<continuous profile>", otherProfile?:"<profile or numeric generic assay>", show?:100, minN?:10, cohorts:[one name]\` | **genome-wide co-expression with one gene**, cBioPortal's Co-expression tab: \`gene\` on \`profileType\` against every gene on \`otherProfile\` (the same profile unless given — e.g. protein against mRNA; a numeric generic-assay profile reads its every entity instead — phosphosites, signatures, drug response — at most 25,000, a categorical one is refused), over one cohort's patients with both values (a patient's samples averaged). Each study's database returns six sums per gene on the values and six on their average ranks among those patients — nothing else — from which Pearson's r and Spearman's ρ follow exactly, each p from t on n − 2 df as scipy computes it. Ranked by ρ, as the portal ranks; q is Benjamini–Hochberg over ρ's p. Across studies r pools the sums; ρ, which does not add, is each study's combined by Fisher z. Lists the \`show\` most positive and most negative genes, with every tested gene's ρ as a histogram. Sums only`,
  grammar: `{"kind":"correlates","gene":"ESR1","profileType":"<continuous profile>","otherProfile":"<profile>"?,"show":100,"cohorts":[one name]}
  // every gene's expression against one gene's (Spearman + Pearson, BH), the portal's Co-expression tab`,
  examples: [
    {
      title: "Co-expression: the genes that rise and fall with ESR1",
      snapshot: "correlates",
      demonstrates: "A `correlates` view, the portal's Co-expression tab: one gene's mRNA against every gene's across a cohort, Spearman's ρ and Pearson's r computed from sums each database returns — n, Σx, Σy, Σxy, Σx², Σy² on the values and on their ranks — so no expression value leaves it, ranked by ρ with Benjamini–Hochberg across all genes.",
      tags: ["expression"],
      note: "TCGA PanCancer Atlas breast cancer. The oestrogen-receptor programme lines up behind ESR1 — CCDC170 (its neighbour on 6q25, often co-amplified), THSD4, FOXA1, TBC1D9 — and the genes of basal-like tumours fall away from it.",
      doc: {
        study: "brca_tcga_pan_can_atlas_2018",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "correlates", cohorts: ["all patients"], gene: "ESR1", profileType: "rna_seq_v2_mrna" }]
      }
    }
  ],
};
