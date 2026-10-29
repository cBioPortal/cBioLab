// The `txendpoints` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const txendpointsDoc: KindDoc = {
  summary: "real-world treatment endpoints from a treatment start — time to next treatment, time on treatment or real-world PFS — as Kaplan-Meier curves with log-rank",
  reference: `\`anchor:{eventType,key?,value?,occurrence?}, endpoint?:"ttnt"\|"tot"\|"rwpfs", lineGap?:90, lineClasses?:"systemic"\|"all"\|[classes], progression?:{eventType?:"Diagnosis", key?:"PROGRESSION", values?:["Y","Yes"], probabilityKey?, minProbability?}, ongoingDays?:30, cutoffMonths?, cohorts:[names] (≤6)\` | **real-world treatment endpoints** (MSK-CHORD, Nature 2024; GENIE BPC) — **preview**: the clock starts at the anchored treatment record's start (first, or \`occurrence:"LAST"\`), and runs to \`ttnt\` the start of the next treatment LINE after the anchor's (lines as the \`sequence\` view builds them — \`lineGap\`, \`lineClasses\`), \`tot\` the latest stop of the anchored records in that line (a living patient stopping within \`ongoingDays\` of last follow-up is censored as still on it; a record without a stop date is left out and counted), or \`rwpfs\` the first \`progression\` event after it (values folded; an optional probability floor) — or death, an event for every endpoint; censored at last follow-up, \`OS_MONTHS\` × 30.4375 days on the timeline clock (checked per study: a study whose timeline runs more than 31 days past OS_MONTHS for over 5% of anchored patients is refused). Left truncation as in \`survival\`. Kaplan–Meier per cohort with the number at risk, medians with 95% intervals (Greenwood, log scale), and a k-group log-rank (stratified by study). Sites send (entry, time, event) counts only. Treated status is not randomised: the caption says so`,
  grammar: `{"kind":"txendpoints","anchor":{"eventType":"Treatment","key":"SUBTYPE","value":"Immuno"},"endpoint":"ttnt|tot|rwpfs","lineGap":90,
 "progression":{"eventType":"Diagnosis","key":"PROGRESSION","values":["Y","Yes"]}?,"cohorts":[names?(max 6)]}
  // real-world endpoints from a treatment start: next line / end of treatment / progression, or death; KM + log-rank (preview)`,
  examples: [
    {
      title: "Real-world PFS on immunotherapy in lung cancer, by KRAS status",
      snapshot: "txendpoints",
      demonstrates: "A `txendpoints` view (preview): real-world progression-free survival from each patient's first immunotherapy record — to the first progression recorded after it, or death — as Kaplan–Meier curves with the number at risk, medians with 95% intervals and a log-rank test, from (entry, time, event) counts alone. `endpoint` switches it to time to next treatment (the next treatment line, as the sequence view builds lines) or time on treatment.",
      tags: ["real-world-endpoints", "timeline-events", "log-rank"],
      note: "MSK-CHORD non-small cell lung cancer, KRAS-mutant against KRAS wild-type (profiled for KRAS), from the first Immuno record. About a third of each cohort was treated. Median real-world PFS is about 2.6 months in both groups and the curves lie on top of each other (log-rank p ≈ 0.98): KRAS status alone does not mark who progresses on immunotherapy here. Progression is read from notes, so it is recorded densely; switching to time to next treatment gives medians near a year.",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "NSCLC, KRAS mutant": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
            { kind: "oql", q: "KRAS: MUT" }
          ] },
          "NSCLC, KRAS wild-type": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
            { not: { kind: "oql", q: "KRAS:" } }, { kind: "profiled", type: "MUTATION", gene: "KRAS" }
          ] }
        },
        views: [{ kind: "txendpoints", cohorts: ["NSCLC, KRAS mutant", "NSCLC, KRAS wild-type"], endpoint: "rwpfs", anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" } }]
      }
    }
  ],
};
