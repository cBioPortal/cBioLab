// The `adjusted` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const adjustedDoc: KindDoc = {
  reference: `\`covariates?:["<attribute>" ×≤6], measure?:"any"\|"driver", minShare?:0.05, minAltered?:10, label?:12, cohorts:[2 names]\` | **covariate-adjusted alteration enrichment between two cohorts**: every gene mutated (called mutations; OncoKB drivers with \`measure:"driver"\`) in at least \`minShare\` of the patients profiled for it and in at least \`minAltered\`, both cohorts together — at most 200 genes, refused past that with the count — gets a logistic regression of mutated on cohort (the first = 1) and the \`covariates\` (clinical attributes: a number as recorded, a category against its commonest value, as \`cox\`/\`logistic\` code them; a sample attribute is the patient's first sample's; patients lacking one are left out, counted). Reported: the cohort term's adjusted odds ratio, Wald 95% CI and p, Benjamini–Hochberg q over the genes fit, beside the raw odds ratio and two-sided Fisher p on the same patients. Per patient and per gene, panel-aware: a patient is in a gene's model only when a mutation panel of theirs covers it (or whole-exome). A covariate category in which no patient (or every patient) is mutated is merged into its reference for that gene; a gene whose fit still separates or does not converge is listed, never dropped. Volcano of adjusted log2 OR against −log₁₀ q, and the top genes' table. Patient-level participants only.`,
  grammar: `{"kind":"adjusted","covariates":["MSI_TYPE","TMB_NONSYNONYMOUS"]?,"measure":"any|driver","minShare":0.05,"minAltered":10,"cohorts":[2 names]}
  // every gene mutated in ≥minShare: logistic mutated ~ cohort + covariates, adjusted OR beside raw OR/Fisher, BH q (patient-level)
  // outcome is a BINARY axis: a categorical one (clinical or alteration) needs outcomeEvent naming
  // which observed value is the event; a numeric one must already be 0/1 and must NOT set outcomeEvent.
  // Covariates use the exact same dummy-coding/reference rules as cox above.`,
};
