// The `oncoprint` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const oncoprintDoc: KindDoc = {
  reference: `\`genes:[≤12 rows], clinical?:[≤8], heatmap?:[≤4], sort?:[≤4], unit?:"patient"\\|"sample", display?:{…}, overlays?:[≤2], derivedCohorts?:[≤3], cohorts:[names]\` | render-contract oncoprint: columns are patients grouped by cohort (first matching cohort wins); NOT_PROFILED is a first-class cell state`,
  grammar: `{"kind":"oncoprint","genes":[...(max 12)],"clinical":["<attribute>", ...(max 8)]?,
 "heatmap":[{"profileType":"<profile>","genes":[...]?|"entities":[...]?}, ...(max 4)]?,
 "sort":["<track>"|"-<track>"|"genomic", ...(max 4)]?,"cohorts":[names?]}`,
  grammarNotes: `Oncoprint clinical tracks: any clinical attribute name works (patient- or sample-level; sample-level
falls back to one sample's value per patient). Numeric attributes (age, TMB, ...) render as a
continuous heat track with a min→max key; unknown attributes render a labeled "(no data)" track.
Oncoprint heatmap: continuous molecular-profile rows per gene (genes default to the gene tracks);
profile must exist in the study (get_catalog lists them; e.g. rna_seq_v2_mrna_median_Zscores in TCGA studies);
z-scores render on a fixed diverging ±3 ramp; the synthetic profile "VAF" renders mutation variant
allele fraction (needs loaded allele counts); track label = "GENE <short>" (e.g. "ERBB2 mRNA-z",
"TP53 VAF") and is a valid sort key. A numeric generic-assay profile takes "entities" (≤12) in place
of genes, labelled e.g. "SBS4 sig".
Oncoprint sort: ordered track keys — "genomic" (default staircase), a clinical track label (must also
be in clinical), or "-label" descending; missing values sort last; staircase + patient id are the
final tiebreakers. Example: "sort":["CANCER_TYPE","-CURRENT_AGE_DEID"].`,
};
