// The `cancertypes` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const cancertypesDoc: KindDoc = {
  summary: "a gene list's alteration frequency per cancer type, the portal's Cancer Types Summary",
  reference: `\`genes:[≤30], groupBy?:"CANCER_TYPE"\|"CANCER_TYPE_DETAILED"\|<sample attribute>\|"study", measure?:"any"\|"driver", minSamples?:10, minAltered?:0, sort?:"alphabetical", show?:"frequency"\|"count", alterationTypes?:false, unit?:"patient"\|"sample", oql?:["<line>", …], drivers?, exp?, prot?, ifHeld?, cohorts:[names] (≤2)\` | With \`oql\` (one OQL line per entry, one gene each, as the Results page's query) what counts as altered is what the lines match, each under its gene, with mRNA and protein high / low as kinds of their own; \`drivers\` is how a line's DRIVER reads (the page's settings) and \`exp\` / \`prot\` / \`ifHeld\` the profiles its EXP / PROT read, as an oql clause's; \`measure:"driver"\` is refused beside it. **Cancer Types Summary**, cBioPortal's results-view tab: per group of the cohort's PATIENTS (the portal's default; \`unit:"sample"\` counts samples — a patient counts in each group one of their samples is in) — a sample attribute's value (folded on case and whitespace like every clinical predicate; samples with no value form their own group, except that a sample with no CANCER_TYPE takes its study's type of cancer and one with no CANCER_TYPE_DETAILED its cancer type, as the portal's) or the study, labelled by its name. Without \`groupBy\`, the portal's default: the study when the cohorts span several studies, else CANCER_TYPE_DETAILED when every sample has one cancer type, else CANCER_TYPE — the share altered in at least one of \`genes\`, split by kind: only mutations, only amplifications, only deep deletions, only structural variants, or more than one kind. A group's denominator is its patients (or samples) profiled for at least one of the genes (the union of their panels, as an oncoprint's merged row counts it); its total sample count is shown beside it. \`measure:"driver"\` counts OncoKB drivers only. As the portal's filters: a group is drawn only with at least \`minSamples\` profiled patients (or samples) — by default 10, or 0 when no group has more than 10 — and at least \`minAltered\` (a percentage when frequencies are drawn, a count when counts are); the figure then says "N of M categories are shown based on filtering". Bars are highest first, or \`sort:"alphabetical"\` by group; \`alterationTypes:false\` draws each bar whole, without its kinds or a legend (the portal's Show Genomic Alteration Types unticked). Counts only, so every local participant can answer; a remote peer cannot yet and is named`,
  grammar: `{"kind":"cancertypes","genes":[...(max 30)],"groupBy":"CANCER_TYPE|CANCER_TYPE_DETAILED|<sample attribute>|study","measure":"any|driver","minSamples":10,"minAltered":0,"sort":"alphabetical","show":"frequency|count","alterationTypes":false,"unit":"patient|sample","oql":["KRAS: MUT=G12D", ...]}
  // the portal's Cancer Types Summary: % of patients (unit:"sample": samples) altered per cancer type, split by mutation/amp/deep del/SV/multiple`,
  examples: [
    {
      title: "Cancer types summary: RAS genes across 50,000 tumours",
      snapshot: "cancertypes",
      demonstrates: "A `cancertypes` view, cBioPortal's Cancer Types Summary: the share of patients altered in at least one of a gene list per cancer type, each bar split by mutation, amplification, deep deletion, structural variant or several at once, over the patients profiled for at least one of the genes (with `unit: sample`, the samples). Cancer types with fewer profiled patients than \`minSamples\` are left out, and the figure says how many.",
      tags: ["frequency", "pan-cancer"],
      note: "KRAS, NRAS and HRAS across MSK-IMPACT 50K. Pancreatic cancer leads at 82%, appendiceal and colorectal follow, and the bars show where RAS is amplified rather than mutated — germ cell tumours and esophagogastric cancer.",
      doc: {
        study: "msk_impact_50k_2026",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "cancertypes", cohorts: ["all patients"], genes: ["KRAS", "NRAS", "HRAS"], minSamples: 200 }]
      }
    }
  ],
};
