// The `datafiles` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const datafilesDoc: KindDoc = {
  summary: "cBioPortal's Results-page Download tab: one cohort's data files for a gene query (each gene's mutations, structural variants and molecular-profile values per sample; the altered and unaltered sample lists; the sample matrix), the gene alteration frequencies and a table of each sample's alterations; patient-level studies only",
  reference: `\`oql:["<line>", …], exp?, prot?, ifHeld?, columns?, search?, filters?, sort?:{column, desc?}, rows?:25, cohorts:[1 name]\` | **the Download tab**: for ONE cohort and a gene query (\`oql\`, one OQL entry per line, one gene each, at most 32 — what a Results page queries; \`exp\` / \`prot\` name the profile its EXP / PROT alterations read, and \`ifHeld\` lets a study without that profile through with none of them, as an \`oql\` clause's), the files a reader takes away, each a table of the view downloaded whole as CSV (\`POST /api/table\` with \`table\`: the file's id): \`mutations\` and \`sv\` (per sample and gene: the gene's mutations' protein changes, WT when profiled with none; its structural variants' event info, NA when none — the query's OQL is not in effect, as on the portal), \`profile:<profile>\` for every molecular profile the studies hold (values per sample and gene, NA when none is stored), \`altered\` and \`unaltered\` (the sample lists) and \`matrix\` (the sample matrix: 1 / 0 per line, NP where the sample is not profiled). NP marks a sample whose gene panel did not cover the gene in that data type (mutations, structural variants, discrete copy number). A sample is **altered** when a line's OQL matches one of its events, **unaltered** when no line does AND it was profiled for every line's gene in every data type the line reads — otherwise neither (not known to be unaltered). Each line's **frequency** is the samples it alters ÷ those profiled for its gene in any data type the line reads (panel-aware; counts added across studies). The top-level query is the case table's — the portal's "Type of Genetic Alterations Across All Samples": column ids \`sample\`, \`patient\`, \`altered\` (altered, unaltered, not profiled) and one per line (its gene, or gene_<line number> for a gene on several lines) holding the events the line matched, "no alteration" or "not profiled"; default order altered samples first. Every file names samples, so only a patient-level participant contributes; any other study is named`,
  grammar: `{"kind":"datafiles","oql":["TP53","PIK3CA: MUT","GATA3"],"columns"|"search"|"filters"|"sort"|"rows" as for table (the case table)?}
  // the Download tab for ONE cohort: data files (mutations, sv, profile:<profile>, altered, unaltered, matrix), each line's frequency
  // (altered ÷ profiled for its gene), and the case table (columns sample, patient, altered, one per line). Patient-level studies only`,
  examples: [
    {
      title: "Download tab: TP53, PIK3CA and GATA3 in TCGA breast cancer",
      snapshot: "datafiles",
      demonstrates: "A `datafiles` view, the Results page's Download tab: the gene-by-sample files for the query's genes and every molecular profile the study holds, the altered and unaltered sample lists and the sample matrix, each downloadable whole; each line's alteration frequency among the samples profiled for it; and the table of every sample's alterations, searchable and sortable like any table view.",
      tags: ["data-table", "download"],
      note: "TCGA PanCancer Atlas breast cancer, the samples with mutation and copy-number data (the portal's cnaseq case set): the portal finds 704 of 996 (70.7%) altered in TP53, PIK3CA or GATA3.",
      doc: {
        study: "brca_tcga_pan_can_atlas_2018",
        cohorts: { "Queried": { all: [{ kind: "caseList", id: "cnaseq" }] } },
        views: [{ kind: "datafiles", cohorts: ["Queried"], oql: ["TP53", "PIK3CA", "GATA3"] }]
      }
    }
  ],
};
