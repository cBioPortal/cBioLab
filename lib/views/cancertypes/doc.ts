// The `cancertypes` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const cancertypesDoc: KindDoc = {
  reference: `\`genes:[≤30], groupBy?:"CANCER_TYPE"\|<sample attribute>\|"study", measure?:"any"\|"driver", minSamples?:10, show?:"frequency"\|"count", unit?:"patient"\|"sample", cohorts:[names] (≤2)\` | **Cancer Types Summary**, cBioPortal's results-view tab: per group of the cohort's PATIENTS (the portal's default; \`unit:"sample"\` counts samples — a patient counts in each group one of their samples is in) — a sample attribute's value (folded on case and whitespace like every clinical predicate; samples with no value form their own group) or the study — the share altered in at least one of \`genes\`, split by kind: only mutations, only amplifications, only deep deletions, only structural variants, or more than one kind. A group's denominator is its samples profiled for at least one of the genes (the union of their panels, as an oncoprint's merged row counts it); its total sample count is shown beside it. \`measure:"driver"\` counts OncoKB drivers only. Groups with fewer than \`minSamples\` profiled samples are pooled into one bar, named and counted, never dropped. Counts only, so every local participant can answer; a remote peer cannot yet and is named`,
  grammar: `{"kind":"cancertypes","genes":[...(max 30)],"groupBy":"CANCER_TYPE|<sample attribute>|study","measure":"any|driver","minSamples":10,"show":"frequency|count","unit":"patient|sample"}
  // the portal's Cancer Types Summary: % of samples altered per cancer type, split by mutation/amp/deep del/SV/multiple`,
  examples: [
    {
      title: "Cancer types summary: RAS genes across 50,000 tumours",
      demonstrates: "A `cancertypes` view, cBioPortal's Cancer Types Summary: the share of samples altered in at least one of a gene list per cancer type, each bar split by mutation, amplification, deep deletion, structural variant or several at once, over the samples profiled for at least one of the genes. Small cancer types are pooled into one named bar, not dropped.",
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
