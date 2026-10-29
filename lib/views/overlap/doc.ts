// The `overlap` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const overlapDoc: KindDoc = {
  reference: `\`cohorts:[names] (2–6)\` | **how cohorts' patients intersect**, cBioPortal's group-comparison Overlap tab: for every combination of the cohorts, the patients — and their samples — in exactly those cohorts and none of the others, with each cohort's own size. Two or three cohorts are drawn as the portal draws them, area-proportional diagrams of samples and of patients side by side; more as an UpSet plot. A cohort is a set of patients, so a patient's samples go wherever the patient does. Each study's database answers with one count per combination (a bitmask of membership) — counts only — and a cohort's size here must equal its own count, or the view says the definition gave two answers. Ids are study-qualified, so patients only ever overlap within a study`,
  grammar: `{"kind":"overlap","cohorts":[names?(2-6)]}
  // UpSet plot: patients in exactly each combination of cohorts`,
  examples: [
    {
      title: "Cohort overlap: how four groups share their patients",
      demonstrates: "An `overlap` view, the portal's Overlap tab drawn as an UpSet plot: for every combination of cohorts, the patients in exactly those cohorts and no other. Each study answers with one count per combination, and every cohort's size here equals its own count.",
      tags: ["upset"],
      note: "TP53-mutant, KRAS-mutant, immunotherapy-treated and NSCLC patients in MSK-CHORD. 5,314 TP53-mutant patients belong to none of the other three groups; 435 are in all four.",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "TP53 mutant": { all: [{ kind: "oql", q: "TP53: MUT" }] },
          "KRAS mutant": { all: [{ kind: "oql", q: "KRAS: MUT" }] },
          "Immunotherapy": { all: [{ kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" } }] },
          "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] }
        },
        views: [{ kind: "overlap", cohorts: ["TP53 mutant", "KRAS mutant", "Immunotherapy", "NSCLC"] }]
      }
    }
  ],
};
