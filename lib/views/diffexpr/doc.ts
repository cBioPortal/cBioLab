// The `diffexpr` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const diffexprDoc: KindDoc = {
  summary: "two-cohort differential expression volcano plus preranked GSEA",
  reference: `\`profileType, log2?, geneSets?:[≤12 MSigDB names], label?:12, cohorts:[2 names]\` | **differential expression between exactly two cohorts** on one molecular profile (mRNA z-scores, RNA-seq, protein, methylation — refused, listing what the study has, if absent): per gene, Welch's t-test from each cohort's n, Σv and Σv² — additive, so the pooled test is exact across sites and no value is ever sent — with each patient contributing the mean of their samples. \`log2\` compares log2(v+1) and defaults to true for a non-z-score RNA-seq profile; the effect is the difference of means (first cohort minus second) on the compared scale, a log2 fold change under log2. q is Benjamini–Hochberg across every gene tested; genes with fewer than 3 patients in a cohort or no variance are left out and counted. Drawn as a volcano — the 1,500 most significant genes as points, the rest as density, \`label\` genes named, split between the two directions. Then **preranked GSEA** (Subramanian 2005, weight 1) of the unrounded t ranking against \`geneSets\` (default: the 50 MSigDB Hallmark sets; \`[]\` skips it): NES, a permutation p from 1,000 random same-size sets seeded by the set's name (so a shared link reproduces it), BH q across the sets, the leading edge, and the running sum for the strongest set each way. Gene-set permutation ignores gene–gene correlation (anti-conservative next to phenotype permutation, which would need patient-level values) — the caption says so. A remote peer cannot answer yet and is named`,
  grammar: `{"kind":"diffexpr","profileType":"<profile>","log2":true?,"geneSets":["HALLMARK_E2F_TARGETS", ...(max 12)]?,"label":12,
 "cohorts":[exactly 2 names]}
  // every gene's Welch t (first minus second) as a volcano, then preranked GSEA (default: 50 Hallmark sets)`,
  examples: [
    {
      title: "Differential expression and enrichment: basal-like against luminal A breast cancer",
      snapshot: "diffexpr",
      demonstrates: "A `diffexpr` view: every gene's Welch t-test between two cohorts on one molecular profile, from three running totals per gene and cohort (n, Σv, Σv²) — additive, so exact across sites and never a single value sent — drawn as a volcano, then preranked GSEA of the same t ranking against the 50 MSigDB Hallmark sets, significance by seeded gene-set permutation so a shared link reproduces it.",
      tags: ["volcano", "gsea", "expression"],
      note: "TCGA PanCancer Atlas breast cancer, PAM50 basal-like against luminal A, on mRNA z-scores. The luminal genes (ESR1, PGR, FOXA1, GATA3) and the basal ones (FOXC1, and proliferation — MKI67, CDC20, AURKB) come out as expected, and so does the enrichment: E2F targets, the G2M checkpoint and MYC targets in basal-like tumours, early estrogen response in luminal A.",
      doc: {
        study: "brca_tcga_pan_can_atlas_2018",
        cohorts: {
          "Basal-like": { all: [{ kind: "clinical", attribute: "SUBTYPE", values: ["BRCA_Basal"] }] },
          "Luminal A": { all: [{ kind: "clinical", attribute: "SUBTYPE", values: ["BRCA_LumA"] }] }
        },
        views: [{ kind: "diffexpr", cohorts: ["Basal-like", "Luminal A"], profileType: "rna_seq_v2_mrna_median_all_sample_Zscores" }]
      }
    }
  ],
};
