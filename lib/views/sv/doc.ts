// The `sv` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const svDoc: KindDoc = {
  summary: "the queried genes' structural-variant table (cBioPortal's Results View Structural Variants tab): every call with either partner a queried gene, with sample, both genes, OncoKB annotation, connection, event info and class; patient-level studies only",
  reference: `\`genes:["<symbol>", …≤32], columns?, search?, filters?, sort?:{column, desc?}, rows?:25, cohorts:[≤6 names]\` | **the structural-variant table**, cBioPortal's Results View Structural Variants tab: every call in each cohort's samples (the study's structural-variant profile) whose gene 1 **or** gene 2 is one of \`genes\` — matched by Entrez id, as the portal fetches them, and listed once however many of the genes it involves — one row per call (a patient with several samples carrying an event has a row for each, as on the portal). Column ids: \`study\`, \`sample\`, \`cancerType\` (the sample's CANCER_TYPE_DETAILED), \`gene1\`, \`site1Entrez\`, \`site1Transcript\`, \`site1Chr\`, \`site1Pos\`, \`site1Desc\`, \`gene2\`, \`site2Entrez\`, \`site2Transcript\`, \`site2Chr\`, \`site2Pos\`, \`site2Desc\`, \`frame\` (effect on frame), \`annotation\`, \`status\` (MS), \`ncbiBuild\`, \`dnaSupport\`, \`rnaSupport\`, \`normalReadCount\`, \`tumorReadCount\`, \`normalVariantCount\`, \`tumorVariantCount\`, \`normalPairedEndReadCount\`, \`tumorPairedEndReadCount\`, \`normalSplitReadCount\`, \`tumorSplitReadCount\`, \`svDescription\` (the study's own annotation), \`breakpointType\`, \`connectionType\`, \`eventInfo\`, \`class\` (variant class), \`length\`, \`comments\`; shown by default the portal's: sample, cancerType, gene1, gene2, annotation, connectionType, eventInfo, class. Gene 1 and 2 are the study's site 1 and site 2, never reordered. \`annotation\` is OncoKB's gene-level fusion call at the pinned version for the stronger partner, where the store holds one (not the portal's per-pair call). Values are as stored (the portal's \`NA\` and \`-1\` included). Searched, filtered and sorted as every table view is (see *Table views* below; default order drivers first, then by gene 1, gene 2, sample). Panel-aware: \`profiled\` in the result and the caveat give, per gene, the cohort's samples, those whose structural-variant panel lists the gene (or is whole-exome) and those with a call — a sample not profiled has no row and is never read as having none. Its rows name samples, so only a patient-level participant contributes them; any other study is named. A listing: no statistic`,
  grammar: `{"kind":"sv","genes":["ALK","ROS1","RET"],"columns":["sample","gene1","gene2","eventInfo"]?,"search":"EML4"?,"filters":{"<column>":{"op":"contains","value":"Fusion"}|{"values":["DELETION"]}|{"min":10}}?,"sort":{"column":"tumorVariantCount","desc":true}?,"rows":25}
  // the structural-variant table: every call with gene 1 or gene 2 among genes (patient-level studies only)`,
  examples: [
    {
      title: "ALK, ROS1 and RET structural variants in MSK-IMPACT",
      snapshot: "sv",
      demonstrates: "The Results View's Structural Variants tab as a view: every structural variant with either partner a queried gene, one row per call with the portal's default columns, and per gene how many samples were profiled for it — a sample whose panel does not list a gene is not counted as without a fusion in it.",
      tags: ["data-table", "structural-variants"],
      note: "MSK-IMPACT 2017 (10,945 samples): every call involving ALK, ROS1 or RET as either partner, drivers first.",
      doc: {
        study: "msk_impact_2017",
        cohorts: { "MSK-IMPACT": { all: [] } },
        views: [{ kind: "sv", cohorts: ["MSK-IMPACT"], genes: ["ALK", "ROS1", "RET"] }]
      }
    }
  ],
};
