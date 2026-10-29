// The `alterations` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const alterationsDoc: KindDoc = {
  reference: `\`patient?:{study, id}, samples?:"patient"\|"cohort", columns?, search?, filters?, sort?:{column, desc?}, rows?:25, mutations?:{…}, cna?:{…}, sv?:{…}, cohorts:[1 name]\` | **one patient's genomic alterations**, cBioPortal's patient-view tables: three table views in one — **Mutations** (column ids \`samples\`, \`gene\`, \`proteinChange\`, \`annotation\`, \`mutationType\`, \`copy\` (Copy #: the gene's deep copy-number calls in the patient), \`freq\` (Cohort %), \`vaf\`, \`altCount\`, \`refCount\`, \`variantType\`, \`chr\`, \`start\`, \`end\`, \`ref\`, \`var\`, \`status\`), **Copy Number Alterations** (the deep calls, AMP and HOMDEL: \`samples\`, \`gene\`, \`cna\`, \`annotation\`, \`cytoband\`, \`freq\`) and **Structural Variants** (\`samples\`, \`gene1\`, \`gene2\`, \`class\`, \`eventInfo\`, \`breakpointType\`, \`connectionType\`, \`frame\`, \`site1\`, \`site2\`, \`pos1\`, \`pos2\`, \`length\`, \`tumorVariantCount\`, \`tumorReadCount\`, \`dnaSupport\`, \`rnaSupport\`, \`status\`, \`svAnnotation\`, \`comments\`) — for \`patient\` (default: the list's first). \`samples\` is which of the patient's samples the tables read: every one (\`"patient"\`, the default — the portal's patient view, whichever of them the cohort holds) or only the cohort's (\`"cohort"\` — the portal's sample view: over a cohort of one sample, that sample's alterations alone); the patient list's counts follow it. A variant, a gene's call or an event is one row however many of the patient's samples carry it (\`samples\` lists them; allele frequency and read counts are the highest among them). With no sort, a gene's rows sit together — genes with a driver first, then by name (structural variants: by the first gene) — and within a gene in the patient's sample order (the numbered markers), then by codon; \`samples\` lists the samples in that order. \`freq\` is the share of the study's samples profiled for the gene (by their panel) with a mutation in it, or with the same copy-number call, in percent; \`annotation\` is OncoKB at the pinned version (none for structural variants). Each table's query is under its own key — \`mutations\`, \`cna\`, \`sv\`, each \`{columns?, search?, filters?, sort?, rows?}\`, searched, filtered, sorted and paged as every table view is (see *Table views* below); the top-level query is the patient list's: column ids \`patient\`, \`samples\`, \`mutations\`, \`cna\`, \`sv\` (each table's row count), default order patients with any alteration first, then by id. The view reads ONE cohort; a named patient must be one of its patients; the result's \`position\` places the patient in the list's order as the timeline's does. Every table names a patient, so only a patient-level participant contributes; any other study is named. A listing: no statistic`,
  grammar: `{"kind":"alterations","patient":{"study":"<study>","id":"<patient id>"}?,"samples":"patient"|"cohort"?,"columns"|"search"|"filters"|"sort"|"rows" as for table (the patient list)?,
 "mutations"|"cna"|"sv":{"columns"|"search"|"filters"|"sort"|"rows" as for table}?}
  // one patient's Mutations, Copy Number Alterations and Structural Variants tables (cBioPortal's patient view), one cohort;
  // list columns patient, samples, mutations, cna, sv. mutations: samples, gene, proteinChange, annotation, mutationType, copy, freq (Cohort %), vaf,
  // altCount, refCount, variantType, chr, start, end, ref, var, status. cna: samples, gene, cna (AMP|HOMDEL), annotation, cytoband, freq.
  // sv: samples, gene1, gene2, class, eventInfo, breakpointType, connectionType, frame, site1, site2, pos1, pos2, length,
  // tumorVariantCount, tumorReadCount, dnaSupport, rnaSupport, status, svAnnotation, comments. Patient-level studies only`,
  examples: [
    {
      title: "A patient's mutations, copy-number alterations and structural variants",
      demonstrates: "An `alterations` view, the portal's patient-view genomic tables: three tables in one view — Mutations, Copy Number Alterations, Structural Variants — for the chosen patient, with the cohort's patients listed to choose from. Each table has its own query under its own key (`mutations`, `cna`, `sv`: columns, search, filters, sort, rows); the top-level query is the patient list's. A variant, call or event is one row however many of the patient's samples carry it. Only a study that may disclose patients takes part.",
      tags: ["data-table", "patient", "cna", "sv"],
      note: "MSK-CHORD prostate cancer patients, those with the most structural variants first; P-0024249's tables, mutations kept to OncoKB-oncogenic calls.",
      doc: {
        study: "msk_chord_2024",
        cohorts: { "Prostate": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Prostate Cancer"] }] } },
        views: [{ kind: "alterations", cohorts: ["Prostate"], patient: { study: "msk_chord_2024", id: "P-0024249" }, sort: { column: "sv", desc: true },
                 mutations: { filters: { annotation: { op: "contains", value: "Oncogenic" } } } }]
      }
    }
  ],
};
