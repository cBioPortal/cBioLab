// The `evolution` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const evolutionDoc: KindDoc = {
  summary: "one patient's mutations followed across their samples — each mutation's variant allele frequency per sample as lines or a heatmap, with the mutations as a table — as on cBioPortal's Genomic Evolution tab; patient-level studies only",
  reference: `\`patient?:{study, id}, chart?:"line"\|"heatmap", sequential?:false, logScale?:false, dataRange?:false, mutations?:{columns?, search?, filters?, sort?, rows?}, columns?, search?, filters?, sort?:{column, desc?}, rows?:25, cohorts:[1 name]\` | **one patient's genomic evolution**, cBioPortal's patient-view Genomic Evolution tab: every mutation called in any of \`patient\`'s samples (default: the list's first; fusions left out), merged across samples by gene, protein change and position, with its state in EVERY sample of the patient — called (VAF = variant ÷ (variant + reference) reads), called without allele counts, uncalled with variant reads (the study's uncalled-mutations profile, drawn with its VAF), not found in a sample sequenced for the gene (VAF 0), or NOT PROFILED (the sample's mutation panel omits the gene, or it was not sequenced for mutations — never drawn as 0). \`chart\` \`"line"\` (default) draws a line per mutation through the samples, from the first to the last sample with variant reads (as the portal trims it), dashed across a not-profiled sample; \`"heatmap"\` a row per mutation, a column per sample, VAF on the oncoprint's sequential ramp. Samples are numbered markers in collection order (collection day from the study's timeline, then primary before metastasis, then id) and placed by collection day, or evenly with \`sequential\` — forced, and said, when a sample has no recorded day. \`logScale\` puts the line chart's y axis on a log scale (VAF 0 at its floor, 0.001); \`dataRange\` fits it to the VAFs drawn rather than 0–1. The mutations are a table view under \`mutations\` (column ids \`samples\` (called in), \`gene\`, \`proteinChange\`, \`mutationType\`, \`vafs\` (each sample's state by number), \`maxVaf\`, \`called\` (samples called in), \`variantType\`, \`chr\`, \`start\`, \`end\`, \`ref\`, \`var\`; default order: first sample called in, then highest VAF); the figure draws every mutation that query keeps with a VAF in some sample (at most 1000 — past that it is refused, the table still listed). The top-level query is the patient list's: only the cohort's patients with two or more samples and a called mutation with allele counts (the portal shows the tab only then), column ids \`patient\`, \`samples\`, \`mutations\`, \`withVaf\`; default order most samples first. A named patient with one sample or no allele counts is refused, saying which. ONE cohort; the result's \`position\` places the patient in the list's order as the timeline's does. Everything names a patient, so only a patient-level participant contributes. A listing: no statistic`,
  grammar: `{"kind":"evolution","patient":{"study":"<study>","id":"<patient id>"}?,"chart":"line"|"heatmap"?,"sequential":false?,"logScale":false?,"dataRange":false?,
 "mutations":{"columns"|"search"|"filters"|"sort"|"rows" as for table}?,"columns"|"search"|"filters"|"sort"|"rows" as for table (the patient list)?}
  // one patient's mutations across their samples (cBioPortal's Genomic Evolution tab): VAF per sample as lines or a heatmap, NOT PROFILED where a panel omits the gene;
  // mutations table columns samples, gene, proteinChange, mutationType, vafs, maxVaf, called, variantType, chr, start, end, ref, var;
  // list columns patient, samples, mutations, withVaf (patients with ≥2 samples and allele counts only). One cohort; patient-level studies only`,
  examples: [
    {
      title: "A glioma's mutations across four samples over three and a half years",
      snapshot: "evolution",
      demonstrates: "An `evolution` view, the portal's Genomic Evolution tab: each mutation's variant allele frequency in each of the patient's samples, the samples placed by the day each was collected. Mutations found in one sample are followed into the others — not found there (VAF 0) where the sample was sequenced for the gene, NOT PROFILED where its panel does not cover it — so the lines show clones rising and falling. The cohort's patients with two or more samples and allele counts are listed to choose from.",
      tags: ["patient", "vaf", "tumor evolution"],
      note: "MSK glioma (2018): IM-GBM-28's eight mutations in two tumour resections, a recurrence and cerebrospinal fluid — TP53 Q136E and STAG2 N141I in the first tumours, replaced by TP53 R282G later; TERT promoter throughout.",
      doc: {
        study: "glioma_msk_2018",
        cohorts: { "Glioma": { all: [] } },
        views: [{ kind: "evolution", cohorts: ["Glioma"], patient: { study: "glioma_msk_2018", id: "IM-GBM-28" } }]
      }
    }
  ],
};
