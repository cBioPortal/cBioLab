// The `enrichment` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const enrichmentDoc: KindDoc = {
  summary: "every gene's alteration frequency compared between cohorts, the portal's Genomic Alterations tab",
  reference: `\`alteration?:"mutation"\|"cna"\|"amp"\|"homdel"\|"sv"\|"any", events?:["missense"\|"inframe"\|"inframe_ins"\|"inframe_del"\|"truncating"\|"nonsense"\|"frameshift"\|"frameshift_ins"\|"frameshift_del"\|"nonstart"\|"nonstop"\|"splice"\|"other"\|"amp"\|"homdel"\|"sv"], measure?:"any"\|"driver", minAltered?:5, label?:12, allRows?:false, cohorts:[2–6 names]\` | **genomic-alteration enrichment across every gene**, cBioPortal's group-comparison Genomic Alterations tab: each gene's frequency of one alteration type per cohort, counted in SAMPLES over the samples profiled for that gene — samples on a panel listing it (counted per panel, then joined to its genes, Explore's own construction) plus whole-exome samples; an off-panel call is left out, as on the portal's study view. Uncalled mutations are excluded as the portal excludes them; copy number is high-level only. Two cohorts: a two-sided Fisher test and the log2 ratio of the altered shares, drawn as a volcano beside the table; three or more: a chi-squared test. q is Benjamini–Hochberg across every gene tested, which is every altered gene profiled in each cohort, as the portal tests them; one unprofiled in a cohort is counted as not tested. Genes altered in fewer than \`minAltered\` samples are tested and counted in q but not listed (\`hidden\`). \`rows\` holds the 300 most significant listed genes; with \`allRows:true\` (the portal pages set it), \`all\` holds every listed gene as columns (gene, cytoband, altered and profiled per cohort, p, q), which the page's table, volcano and frequency scatter draw, as the portal's. \`topFrequency\` is the portal's "Genes with highest frequency in any group": the ten tested genes with the highest altered share in any cohort, over every tested gene. The caption warns that hypermutated tumours enrich almost every gene. \`alteration:"any"\` is the portal's tab as it opens: ONE table over every alteration type in \`events\` (default all), the portal's checkbox tree of types — a sample is altered in a gene when it has any selected type there, and profiled when any of its panels for the selected types' profiles lists the gene (or it is whole-exome), the portal's union; the mutation units filter mutation_type as the portal's backend does (every unit: no filter; Other selected: every type but the unselected units'; else only the selected units'), and a type with no unit selected leaves its profile out of profiled too. Counts only`,
  grammar: `{"kind":"enrichment","alteration":"mutation|cna|amp|homdel|sv|any","events":["missense","nonsense","amp",...]?,"measure":"any|driver","minAltered":5,"cohorts":[2-6 names]}
  // every gene's alteration frequency compared between cohorts (Fisher/chi-squared, BH), volcano + table`,
  examples: [
    {
      title: "Alteration enrichment: what separates colorectal from pancreatic tumours",
      snapshot: "enrichment",
      demonstrates: "An `enrichment` view, the portal's Genomic Alterations tab: every gene's mutation frequency in two cohorts, counted in samples over the samples profiled for that gene, with a Fisher test per gene and Benjamini–Hochberg across all of them, drawn as a volcano beside a table. MSI-high tumours are excluded from both cohorts, because hypermutated tumours enrich almost every gene at once.",
      tags: ["volcano"],
      note: "Microsatellite-stable colorectal against pancreatic cancer in MSK-CHORD. APC, TCF7L2, PIK3CA, FBXW7 and SOX9 mark colorectal cancer; KRAS and CDKN2A mark pancreatic cancer.",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "Colorectal, MSS": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] },
            { not: { kind: "clinical", attribute: "MSI_TYPE", values: ["Instable"] } }] },
          "Pancreatic, MSS": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"] },
            { not: { kind: "clinical", attribute: "MSI_TYPE", values: ["Instable"] } }] }
        },
        views: [{ kind: "enrichment", cohorts: ["Colorectal, MSS", "Pancreatic, MSS"] }]
      }
    }
  ],
};
