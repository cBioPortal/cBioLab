// The `ctdna` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const ctdnaDoc: KindDoc = {
  summary: "plasma cfDNA against tissue within patients: per gene both / tissue-only / plasma-only with positive percent agreement, the share with ctDNA detected, and overall survival by ctDNA detected",
  reference: `\`genes?:[≤30], top?:1-30, attribute?, plasma?:[values], tissue?:[values], plasmaPanels?:[panels], withinDays?:0-3650, sampleEvents?, sampleKey?, measure?:"any"\|"driver", chFilter?:true\|{genes?, normal?, normalMinAlt?:2, normalMinRatio?:0.3}, cohorts:[names] (≤3)\` | **ctDNA against tissue** (preview): samples are plasma when the sample attribute \`attribute\` (default SAMPLE_CLASS) is one of \`plasma\` (default cfDNA, ctDNA) or the sample is on one of \`plasmaPanels\` (e.g. ACCESS129), tissue when it is one of \`tissue\` (default Tumor). Among patients with both, per gene covered by BOTH kinds' panels: altered in both, tissue only, plasma only, neither (several samples of a kind: altered if any is); positive percent agreement = both ÷ altered in tissue with a 95% Wilson interval, and overall concordance (both + neither) ÷ pairs. Without \`genes\`, the \`top\` (default 15) most altered genes. ctDNA detected = any alteration (with \`measure:"driver"\`, any OncoKB oncogenic one) called in a plasma sample, as a share of the plasma patients with a Wilson interval; overall survival (OS_MONTHS/OS_STATUS as the study records them) by detected vs not, Kaplan–Meier with a log-rank test stratified by study, drawn when each group has at least 5 patients. \`withinDays\` keeps only samples the timeline dates (as the acquired view does) within that many days of a sample of the other kind, and the result says how many were dated. The caption names clonal haematopoiesis behind plasma-only calls and possible immortal time when OS starts before the draw. **\`chFilter\`** leaves out plasma mutation calls likely from clonal haematopoiesis (Razavi et al. 2019) before anything is counted: calls in \`genes\` (default DNMT3A, TET2, ASXL1, PPM1D, JAK2, SF3B1, SRSF2, U2AF1, CBL, GNB1, GNAS, IDH2 — TP53, ATM and CHEK2 are left off because they are tumour drivers as often as CH genes; \`[]\` for none), and (\`normal\`, default on) calls whose matched white-cell sample carries at least \`normalMinAlt\` alternate reads at an allele fraction at least \`normalMinRatio\` × the plasma's, where the study loads normal read counts (tumour DNA that reaches the white-cell sample sits far below that ratio and is kept). Copy-number and structural calls and tissue are never filtered. The result says, per cohort, how many plasma calls and patients each rule removed and in which genes, recomputes agreement, ctDNA detected and survival with the filter, and gives the unfiltered detected share, plasma-only counts and log-rank p beside them. Counts only; a remote peer cannot answer yet.`,
  grammar: `{"kind":"ctdna","genes":[...(max 30)]?,"top":15,"attribute":"SAMPLE_CLASS","plasma":["cfDNA","ctDNA"],"tissue":["Tumor"],"plasmaPanels":["ACCESS129"]?,
 "withinDays":90?,"measure":"any|driver","chFilter":true?,"cohorts":[names?(max 3)]}
  // (preview) plasma vs tissue per gene (both / tissue-only / plasma-only, PPA + Wilson CI); % ctDNA detected; OS KM by detected
  // chFilter: drop plasma mutation calls in CH genes or seen in the matched white-cell sample, with before/after`,
  examples: [
    {
      title: "ctDNA against tissue: what a blood test sees of the tumour, and what detecting it says",
      snapshot: "ctdna",
      demonstrates: "A `ctdna` view (preview): patients with a plasma (cfDNA) sample and a tissue sample, per gene covered by both panels, altered in both, tissue only or plasma only — plasma's positive percent agreement with tissue as the reference, with Wilson intervals — then the share of plasma patients with any alteration detected, and overall survival by ctDNA detected against not, with a log-rank test.",
      tags: ["liquid biopsy", "prognosis", "preview"],
      note: "MSK lung cancer ctDx (1,127 patients; 682 with plasma and tissue). Plasma catches about two thirds of tissue's EGFR, KRAS and TP53 calls but only a third of STK11, KEAP1 and MET; ctDNA is detected in 68% of plasma patients, and they live about half as long (median 21.8 against 41.5 months, log-rank p≈2e-12) — the prognostic signal the paper reports.",
      doc: {
        study: "nsclc_ctdx_msk_2022",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "ctdna", cohorts: ["all patients"], genes: ["EGFR", "KRAS", "TP53", "STK11", "KEAP1", "PIK3CA", "BRAF", "MET", "ERBB2", "ALK"] }]
      }
    },
    {
      title: "ctDNA with clonal haematopoiesis filtered out: MSK-ACCESS plasma against tissue",
      snapshot: "ctdna-chfilter",
      demonstrates: "A `ctdna` view (preview) with `chFilter`: plasma mutation calls likely from clonal haematopoiesis — in the canonical CH genes, or seen in the patient's matched white-cell sample at a comparable allele fraction — are left out before agreement with tissue, ctDNA detected and survival are counted, and the result says what each rule removed, gene by gene, beside the unfiltered numbers.",
      tags: ["liquid biopsy", "clonal hematopoiesis", "prognosis", "preview"],
      note: "MSK-ACCESS (617 patients; 449 with plasma and tissue). MSK-ACCESS already subtracts the white-cell sample in its own calling, so the filter takes out little: 83 of 2,024 plasma mutation calls in 51 patients, mostly SF3B1, DNMT3A, GNAS and IDH2 by gene and a few TP53 calls seen in the normal. What it removes is plasma-only — AR, RB1 and ATM lose plasma-only calls while every concordant call stays — and ctDNA detected moves from 74% to 73%, with survival by detection unchanged (log-rank p 3.4e-4).",
      doc: {
        study: "msk_access_2021",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "ctdna", cohorts: ["all patients"], plasmaPanels: ["ACCESS129"], chFilter: true }]
      }
    }
  ],
};
