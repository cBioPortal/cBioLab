// The `predictive` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const predictiveDoc: KindDoc = {
  summary: "gene x treatment interaction per gene: the gene's survival HR among the treated and the untreated and their interaction p, BH q; patient-level studies only",
  reference: `\`exposure:{eventType,key?,value?}, genes:[≤20], endpoint?:"OS", monthsAttribute?/statusAttribute?, measure?:"any"\|"driver", covariates?:["<attribute>" ×≤6], minMutated?:5, cohorts:[1–2 names]\` | **predictive biomarkers, gene × treatment** — **preview** (PMIDs 29122777, 32913971, 39499893): the cohorts' patients pooled (baseline hazard stratified by cohort and study when several), \`exposure\` = any timeline event of that type (and key = value), the rest unexposed. Per gene, a Cox model (Efron) of the endpoint on gene + exposed + gene×exposed (+ \`covariates\`, coded as the \`cox\` view codes clinical axes), over the patients whose panel covers the gene — a patient not profiled for it is left out of that fit, never wild-type. Reported per gene: the mutated-vs-wild-type HR among the exposed and among the unexposed (the same model's two contrasts: the interaction coded both ways) and the interaction HR with its Wald p and a Benjamini–Hochberg q over the genes fitted; a gene with fewer than \`minMutated\` mutated patients in either group is listed, not fitted. Drawn as a two-marker forest. Exposure is defined from the whole record (immortal-time bias) and was not randomised (confounding by indication) — the caveat says so. Patient-level studies only`,
  grammar: `{"kind":"predictive","exposure":{"eventType":"Treatment","key":"SUBTYPE","value":"Immuno"},"genes":[...(max 20)],"endpoint":"OS","covariates":["<attribute>"...(max 6)]?,"minMutated":5,"cohorts":[1-2 names]}
  // per gene: Cox on gene + exposed + gene x exposed; HR among exposed / unexposed, interaction p, BH q (patient-level; preview)`,
  examples: [
    {
      title: "Which mutations change survival on immunotherapy in lung cancer?",
      snapshot: "predictive",
      demonstrates: "A `predictive` view (preview): for each gene, a Cox model of overall survival on the gene, exposure to a treatment (any Immuno record) and their interaction — the gene's hazard ratio among the treated and among the untreated side by side, and whether they differ (interaction p, BH q). Each gene is fitted over the patients whose panel covers it.",
      tags: ["predictive-biomarker", "interaction", "timeline-events"],
      note: "MSK-CHORD non-small cell lung cancer, 7,809 patients, 2,666 with an immunotherapy record. STK11 and KEAP1 mutations are adverse among the treated (HR 1.48 and 1.41), as reported for checkpoint inhibitors; TP53 and SMARCA4 are strongly adverse only among the untreated (HR 1.72 and 1.88 against about 1.0 and 1.1 treated; interaction q < 1e-4) — in keeping with their link to tumour mutational burden, though immortal time and who gets treated can shape such contrasts too.",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] }
        },
        views: [{ kind: "predictive", cohorts: ["NSCLC"], exposure: { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" }, genes: ["STK11", "KEAP1", "KRAS", "TP53", "EGFR", "SMARCA4"] }]
      }
    }
  ],
};
