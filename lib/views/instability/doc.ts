// The `instability` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const instabilityDoc: KindDoc = {
  reference: `\`threshold?:0.05-2, armShare?:0.25-0.9, includeX?:bool, cohorts:[names] (≤6)\` | **genomic instability from copy-number segments** (preview; hg19 only — a study on another build is refused, naming which is which): per sample, inside the database, FGA = the share of its segmented length (autosomes; X with \`includeX\`) with \|segment mean\| ≥ \`threshold\` (default 0.2); each arm (p/q split at hg19's centromeres from UCSC cytoBand, the acrocentric p arms of 13, 14, 15, 21, 22 left out: 39 arms) gained or lost when more than \`armShare\` (default 0.5) of its length is past ±threshold, measured when segments cover that share; the aneuploidy score is the number of arms gained or lost (Taylor et al. 2018 style). Only histograms (FGA in 1-point bins × score) and per-arm counts leave the database. Per cohort the quartiles and 5th/95th percentiles of both, Mann–Whitney (2 cohorts) or Kruskal–Wallis (3+) from the histograms, and each arm's gain and loss share of the samples measuring it. Every sample of each patient counts; panel segments are noisy and purity is not corrected — the caption says so. Counts only; a remote peer cannot answer yet.`,
  grammar: `{"kind":"instability","threshold":0.2,"armShare":0.5,"includeX":false,"cohorts":[names?(max 6)]}
  // (preview) per sample from hg19 segments: FGA, arm gains/losses, aneuploidy score; boxes + rank test, arm x cohort heatmap`,
  examples: [
    {
      title: "Genomic instability by cancer type: aneuploidy score, FGA and arm-level changes",
      demonstrates: "An `instability` view (preview): from each sample's copy-number segments, computed per sample inside the database, the fraction of the genome altered and arm-level gains and losses (an arm called when more than half its length is past ±0.2) — their count is the aneuploidy score, after Taylor et al. 2018 — drawn per cohort as boxes from histograms with a Kruskal–Wallis test, and each arm's gain and loss frequency as a heatmap. Only histograms and per-arm counts leave the database.",
      tags: ["copy-number", "aneuploidy", "segments", "preview"],
      note: "MSK-IMPACT 50k: colorectal, breast and pancreatic cancer. Colorectal shows its textbook arms — 20q gained in 60%, 13q in 42%, 18q lost in 53% — and breast 1q and 8q gains with 16q loss. Pancreatic tumours look the most stable (median 2 arms, against 7 and 8), which is mostly purity: their low tumour content pulls every log ratio toward 0, the bias the caption names.",
      doc: {
        study: "msk_impact_50k_2026",
        cohorts: {
          "Colorectal": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }] },
          "Breast": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Breast Cancer"] }] },
          "Pancreatic": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"] }] }
        },
        views: [{ kind: "instability", cohorts: ["Colorectal", "Breast", "Pancreatic"] }]
      }
    }
  ],
};
