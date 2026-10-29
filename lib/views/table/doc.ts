// The `table` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const tableDoc: KindDoc = {
  reference: `\`unit?:"sample"\|"patient", patient?:{study, id}, columns?, search?, filters?, sort?:{column, desc?}, rows?:25, cohorts:[≤6 names]\` | **the clinical data table**, cBioPortal's Clinical Data tab: one row per sample of each cohort's patients — carrying its patient's attributes too — or per patient (patient attributes only), with every clinical attribute the study records (highest priority first; at most 200 — past that, name the ones you want in \`columns\`), values as recorded. Column ids: \`patient\`, \`sample\` (or \`samples\`, the count, per patient), and the attribute ids; every one is shown by default. Searched, filtered and sorted as every table view is (see *Table views* below; an attribute the study declares NUMBER is numeric; default order patient and sample id). \`attributes\` and \`sort.attribute\` are older spellings of \`columns\` and \`sort.column\`. Its rows are patients, so only a patient-level participant contributes them; an aggregate-only or remote study is named with how many of each cohort's patients it holds. A patient in two cohorts is listed under each. With \`unit:"patient"\`, \`patient\` places that patient in the list's order: the result's \`position\` is its \`index\` from 0 and the \`prev\` and \`next\` patients as \`{study, id}\`, null when the query leaves it out — how the Patient page steps through a cohort. A listing: no statistic`,
  grammar: `{"kind":"table","unit":"sample|patient","columns":["patient","<attribute>", ...]?,"search":"<text>"?,"filters":{"<column>":<filter>}?,"sort":{"column":"<column>","desc":true}?,"rows":25}
  // the clinical data table: every sample/patient with its attributes (patient-level studies only); searchable, filterable, downloadable as CSV`,
  examples: [
    {
      title: "Clinical data: every pancreatic cancer sample, oldest patients first",
      demonstrates: "A `table` view, the portal's Clinical Data tab: one row per sample of the cohort's patients with every clinical attribute the study records, sorted by one of them, the first rows on screen and every row as a download. Its rows are patients, so only a study that may disclose patients lists them; any other is named with how many it holds.",
      tags: ["data-table", "download"],
      note: "Pancreatic cancer in MSK-CHORD, sorted by age, highest first.",
      doc: {
        study: "msk_chord_2024",
        cohorts: { "Pancreatic": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"] }] } },
        views: [{ kind: "table", cohorts: ["Pancreatic"], sort: { column: "CURRENT_AGE_DEID", desc: true }, rows: 25 }]
      }
    }
  ],
};
