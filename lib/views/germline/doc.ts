// The `germline` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const germlineDoc: KindDoc = {
  summary: "germline carriers per gene among patients sequenced, and how often their tumour has a somatic second hit in the same gene — a mutation or deep deletion — against non-carriers, with optional overall survival by carrier status",
  reference: `\`genes?:[≤60] (default every gene with ≥ minCarriers carriers), minCarriers?:3, survival?:{gene}, cohorts:[≤4 names]\` | **germline carriers and their somatic second hits**, per patient: carriers are patients with a mutation the study marks GERMLINE in the gene, among the patients sequenced for it (a tumour mutation panel listing it, or whole-exome; a carrier whose panel omits the gene is counted apart — a gene not on a patient's panel never makes them a non-carrier). The carrier share is of patients sequenced, not germline-tested, since the warehouse cannot tell a negative germline test from none. Among carriers, a somatic second hit in the same gene: another called mutation not marked germline, or a deep deletion (−2, among patients profiled for copy number); loss of heterozygosity is not assessed (no allele-specific copy number is read; the result says when the study has FACETS), so the rate is a floor. Compared with the same somatic rate in non-carriers: Fisher per gene, Benjamini–Hochberg over the cohort's genes. With \`survival\`, overall survival of that gene's carriers against non-carriers (Kaplan–Meier, log-rank). Counts only.`,
  grammar: `{"kind":"germline","genes":[≤60]?,"minCarriers":3,"survival":{"gene":"<symbol>"}?,"cohorts":[≤4 names]}
  // germline carriers per gene among patients sequenced, carriers' somatic second hit (mutation or deep deletion) vs non-carriers (Fisher, BH); OS by carrier status`,
};
