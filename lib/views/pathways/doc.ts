// The `pathways` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const pathwaysDoc: KindDoc = {
  reference: `\`pathways?:[names], sets?:[{name, genes:[≤40]} ×≤4], measure?:"driver"\|"any", topGenes?:6, cohorts:[names] (≤4)\` | **oncogenic signalling pathways**: the ten canonical pathways of Sanchez-Vega et al. (Cell 2018, Table S3: RTK-RAS, PI3K, TP53, Cell cycle, MYC, WNT, NOTCH, Hippo, TGF-β, NRF2 — 334 genes), and/or the document's own \`sets\`, each as the share of the cohort with at least one member altered. \`measure\` defaults to \`"driver"\` (OncoKB-annotated drivers, as the paper counted curated oncogenic events; refused without an annotation pin) or \`"any"\`. A pathway's denominator is the patients profiled for at least ONE member (the union of the members' panels, the oncoprint's merged-row rule, computed in the database with the same event table, CNA rule and driver join as \`compare\`, so a one-gene set equals that gene's own count); each member's % is over the patients profiled for THAT gene. The \`topGenes\` most-altered members are drawn per pathway; the rest are pooled as "+N more altered", and members on no participating panel are listed as never profiled. Two cohorts add Fisher tests with BH q across pathways, and separately across member genes. Counts only; a remote peer cannot answer yet and is named`,
  grammar: `{"kind":"pathways","pathways":["RTK-RAS","PI3K",...]?,"sets":[{"name":"<set>","genes":[...(max 40)]}]?,
 "measure":"driver|any","topGenes":6,"cohorts":[names?(max 4)]}
  // Sanchez-Vega 2018's ten pathways: % of patients with >=1 member altered (union of panels), plus top members`,
  examples: [
    {
      title: "Oncogenic signalling pathways: colorectal against pancreatic",
      demonstrates: "A `pathways` view: the ten canonical pathways of Sanchez-Vega et al. (Cell 2018) as the share of each cohort with an OncoKB driver in at least one member gene — over the UNION of the members' panels, the oncoprint's merged-row rule — beside each pathway's most-altered members, each with its own panel-aware denominator. A member gene no panel covered is listed as never profiled, not counted as unaltered.",
      tags: ["gene-sets"],
      note: "Colorectal and pancreatic cancer in MSK-CHORD. WNT separates them almost completely (82% against 8%, nearly all APC); RTK-RAS is higher in pancreatic cancer (84%, KRAS 81%), and so is the cell cycle (39%, CDKN2A 33%); PI3K and NOTCH (FBXW7) are colorectal. The canonical pathways also show how much a targeted panel misses: 56 of WNT's 68 genes are on no panel here.",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "Colorectal": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }] },
          "Pancreatic": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"] }] }
        },
        views: [{ kind: "pathways", cohorts: ["Colorectal", "Pancreatic"] }]
      }
    }
  ],
};
