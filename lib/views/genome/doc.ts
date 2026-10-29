// The `genome` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const genomeDoc: KindDoc = {
  reference: `\`binMb?:2, threshold?:0.2, includeX?:false, cohorts:[names] (≤4)\` | **genome-wide copy-number frequency** from the copy-number SEGMENTS: the share of each cohort's segmented samples gained (log2 segment mean ≥ \`threshold\`) or lost (≤ −\`threshold\`) in every \`binMb\`-megabase bin (1–50) along chromosomes 1–22 (and X with \`includeX\` — its log ratio mostly records sex, so it is off by default), drawn as gains up and losses down, one panel per cohort. Each bin's denominator is the samples whose segmentation covers it — a bin nothing covers is drawn as unmeasured, never as copy-neutral. A bin takes the value of the segment over its midpoint, so an event narrower than a bin can be missed; the caption says so. Unit is the SAMPLE, not the patient. Exactly two cohorts add a per-bin two-sided Fisher test (gains and losses separately, Benjamini–Hochberg across bins), drawn as a strip coloured by which cohort is higher. Studies on different reference genomes (hg19/hg38) are refused rather than drawn on one axis. Counts only; a remote peer cannot answer yet and is named as left out`,
  grammar: `{"kind":"genome","binMb":2,"threshold":0.2,"includeX":false,"cohorts":[names?(max 4)]}
  // % of segmented samples gained/lost per genomic bin, from copy-number segments; 2 cohorts add per-bin Fisher q`,
  examples: [
    {
      title: "Genome-wide copy number: colorectal against breast",
      demonstrates: "A `genome` view: the copy-number SEGMENTS (33M of them in this warehouse, unused by every other view) binned along the genome, as the share of each cohort's segmented samples gained or lost in each bin, with a per-bin Fisher test between exactly two cohorts. Each bin's denominator is the samples whose segmentation actually covers it, the same panel-aware rule every per-gene frequency follows.",
      tags: ["copy-number", "segments"],
      note: "Colorectal and breast cancers in MSK-IMPACT, 2 Mb bins. The textbook colorectal pattern is all there — 20q gained in 60%, 13q in 42%, 8q in 32%, 18q lost in 54% — beside breast cancer's 1q and 8q gains and 16q loss. The strip underneath marks every bin where the two differ at q < 0.05, coloured by which cohort is higher.",
      doc: {
        study: "msk_impact_50k_2026",
        cohorts: {
          "Colorectal": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }] },
          "Breast": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Breast Cancer"] }] }
        },
        views: [{ kind: "genome", cohorts: ["Colorectal", "Breast"], binMb: 2 }]
      }
    }
  ],
};
