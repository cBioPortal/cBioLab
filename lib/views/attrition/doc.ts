// The `attrition` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const attritionDoc: KindDoc = {
  summary: "CONSORT-style counts after each cohort clause",
  reference: `\`cohorts:[names] (≤6)\` | **cohort attrition**, CONSORT-style: for each cohort, the study base and then the patients left after each clause of its \`all\`, in the order written, with how many that clause alone removed. Each step is evaluated as its own cohort (the first k clauses ANDed), with the same compiler and the same per-study counts, so the last step is the cohort's own count by construction — a mismatch is reported, never smoothed over. The order of clauses changes the path, never the final count. Counts only, so every participant (aggregate-only and remote included) can answer; across studies the counts are summed and overlap is not deduplicated`,
  grammar: `{"kind":"attrition","cohorts":[names?(max 6)]}
  // the study base, then patients left after each clause of each cohort, in order (CONSORT-style)`,
  examples: [
    {
      title: "Cohort attrition: which criterion removed whom",
      snapshot: "attrition",
      demonstrates: "An `attrition` view: the CONSORT-style flow a clinicogenomic paper reports before any result — the study base, then the patients left after each clause of the cohort, in the order written, with how many that clause alone removed. Each step is the cohort a reader would get by stopping there, compiled and counted like any other cohort, so the last box is the cohort's own count by construction.",
      tags: ["consort"],
      note: "KRAS G12C lung adenocarcinoma treated with immunotherapy, with at least six months of follow-up, beside KRAS wild-type lung adenocarcinoma. The G12C arm loses most of its patients to the genotype, and a further 78 to the follow-up requirement — the kind of step a reader needs to see before trusting a survival curve drawn from what is left.",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "LUAD KRAS G12C, immunotherapy": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE_DETAILED", values: ["Lung Adenocarcinoma"] },
            { kind: "oql", q: "KRAS: G12C" },
            { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" } },
            { kind: "derived", metric: "followupMonths", range: { gte: 6 } }
          ] },
          "LUAD KRAS wild-type": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE_DETAILED", values: ["Lung Adenocarcinoma"] },
            { not: { kind: "oql", q: "KRAS" } }
          ] }
        },
        views: [{ kind: "attrition", cohorts: ["LUAD KRAS G12C, immunotherapy", "LUAD KRAS wild-type"] }]
      }
    }
  ],
};
