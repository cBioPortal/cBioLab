// The `mutations` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const mutationsDoc: KindDoc = {
  reference: `\`gene:"<symbol>", columns?, search?, filters?, sort?:{column, desc?}, rows?:25, cohorts:[≤6 names]\` | **one gene's mutation table**, the table under cBioPortal's Mutations-tab lollipop: every called mutation of \`gene\` in each cohort's samples (uncalled calls left out), one row per call — sample, detailed cancer type, protein change, the OncoKB annotation at the pinned version, mutation and variant type, allele frequency (variant / variant + reference reads) with both read counts, the study's MUTATION_COUNT, chromosome, positions, alleles, mutation status. Column ids: \`sample\`, \`cancerType\`, \`proteinChange\`, \`annotation\`, \`mutationType\`, \`variantType\`, \`vaf\`, \`altCount\`, \`refCount\`, \`mutCount\`, \`chr\`, \`start\`, \`end\`, \`ref\`, \`var\`, \`status\`; shown by default: sample, cancerType, proteinChange, annotation, mutationType, mutCount (the portal's own). Searched, filtered and sorted as every table view is (see *Table views* below; default order drivers first, then by codon; \`proteinChange\` sorts by codon, \`annotation\` drivers first). Its rows name samples, so only a patient-level participant contributes them; any other study is named`,
  grammar: `{"kind":"mutations","gene":"KRAS","columns":["sample","proteinChange","vaf"]?,"search":"G12"?,"filters":{"<column>":{"op":"contains","value":"Missense"}|{"values":["G12D","G12V"]}|{"min":0.1,"max":1}}?,"sort":{"column":"vaf","desc":true}?,"rows":25}
  // one gene's mutation table: every call with sample, protein change, OncoKB, allele frequency (patient-level studies only)`,
  examples: [
    {
      title: "KRAS codon 12/13 mutations in colorectal cancer, clonal-looking calls first",
      demonstrates: "A table view's query: `columns` picks what is shown, `filters` keeps rows — a regular expression on protein change, a range on allele frequency — and `sort` orders them, all in the database across the whole table. The caveat says how many rows the query kept of how many; the download holds every kept row with every column. The same fields work on the `table` view.",
      tags: ["data-table", "filter"],
      note: "MSK-CHORD patients with a colorectal cancer sample: their KRAS G12/G13 calls at an allele frequency of 0.2 or more, highest first.",
      doc: {
        study: "msk_chord_2024",
        cohorts: { "Colorectal": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }] } },
        views: [{ kind: "mutations", cohorts: ["Colorectal"], gene: "KRAS", columns: ["sample", "proteinChange", "annotation", "vaf", "mutCount"],
          filters: { proteinChange: { op: "regex", value: "^G1[23]" }, vaf: { min: 0.2 } }, sort: { column: "vaf", desc: true } }]
      }
    }
  ],
};
