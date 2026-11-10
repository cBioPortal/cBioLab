// The `mutcompare` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const mutcompareDoc: KindDoc = {
  summary: "one gene's mutations in two cohorts: a lollipop above and below the protein, and every protein change tested",
  reference: `\`gene?, axis?:"percent"|"count", hide?:[cells], positions?:[codons], cohorts:[2 names]\` | **cBioPortal's group-comparison Mutations tab**: one gene's lollipop in each of exactly two cohorts, the first drawn above the protein and the second below it (codon axis on top, Pfam domains in the middle, the drawing rules of the \`hotspots\` view), each half's height a share of that cohort's patients profiled for the gene (\`axis:"percent"\`, the default) or a count of patients (\`"count"\`), both halves on one scale. Then a row per protein change: the patients carrying it in each cohort and their share of the profiled patients, log2 of the first share over the second, a two-sided Fisher's exact test of carriers against the rest of the profiled patients, Benjamini–Hochberg q across the changes, and the cohort it is enriched in. \`gene\` defaults to the gene with the highest share of mutated samples (over samples profiled for it) in either cohort, the portal's ranking, and the result lists the first 200 genes of that ranking for a picker. \`hide\` leaves Driver/VUS × alteration class cells out of both plots (as the \`hotspots\` view's), \`positions\` selects stems by codon (clicking one in the web app; the table is filtered to them); neither re-runs anything. Other than two cohorts is refused with the portal's message`,
  grammar: `{"kind":"mutcompare","cohorts":[2 names],"gene":"TP53"?,"axis":"percent"|"count"?,"hide":["missense.vus"]?,"positions":[175,248]?}`,
  examples: [
    {
      title: "TP53 mutations in basal-like against luminal A breast cancer",
      snapshot: "mutcompare",
      demonstrates: "A `mutcompare` view: one gene's lollipop in each of two cohorts, mirrored about the protein, and every protein change tested between them with Fisher's exact test and Benjamini–Hochberg — cBioPortal's group-comparison Mutations tab.",
      tags: ["lollipop", "comparison"],
      note: "TCGA PanCancer Atlas breast cancer, PAM50 basal-like against luminal A. TP53 is mutated in 153 of 171 basal-like patients and 53 of 499 luminal A; R175H and R273H are found in both, R342* and Y220C in basal-like only.",
      doc: {
        study: "brca_tcga_pan_can_atlas_2018",
        cohorts: {
          "Basal-like": { all: [{ kind: "clinical", attribute: "SUBTYPE", values: ["BRCA_Basal"] }] },
          "Luminal A": { all: [{ kind: "clinical", attribute: "SUBTYPE", values: ["BRCA_LumA"] }] }
        },
        views: [{ kind: "mutcompare", cohorts: ["Basal-like", "Luminal A"], gene: "TP53" }]
      }
    }
  ],
};
