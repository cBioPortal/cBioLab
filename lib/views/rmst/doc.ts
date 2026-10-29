// The `rmst` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const rmstDoc: KindDoc = {
  summary: "restricted mean survival time to tau per cohort with differences and ratios, for non-proportional hazards; landmark analysis from given months",
  reference: `\`endpoint?:"OS", monthsAttribute?/statusAttribute?, anchor?:{eventType,key?,value?,occurrence?}, tau?:months, landmarkMonths?:[months ×≤4] (default [0]), cohorts:[names] (≤6)\` | **restricted mean survival time and landmark analysis** — **preview**, for when hazards are not proportional (immunotherapy): per cohort the area under the Kaplan–Meier curve from 0 to \`tau\` (the mean months lived — or event-free — within the first τ) with the Greenwood-type standard error of that area (Klein & Moeschberger; R survRM2's rmst1) and a 95% interval; against the first cohort the RMST difference and ratio (log scale), each with a Wald 95% interval and two-sided p. \`tau\` defaults to the largest time at which every cohort still has 10 at risk (stated); a \`tau\` past a cohort's last follow-up is refused. \`landmarkMonths\`: for each landmark L the patients alive and uncensored at L, the clock reset there, KM and RMST from it (τ counted from L), drawn as small multiples. The endpoint is \`OS\` (or \`<endpoint>_MONTHS/_STATUS\`, or \`monthsAttribute\`/\`statusAttribute\`) from day 0; \`anchor\` instead measures OS from a treatment start exactly as \`txendpoints\` anchors (first record, or LAST; OS_MONTHS on the timeline clock, the same clock check; left truncation for an anchor before day 0). KM drawn with the RMST area shaded to τ, and a table. Sites send (entry, time, event) counts only`,
  grammar: `{"kind":"rmst","endpoint":"OS"?,"anchor":{"eventType":"Treatment","key":"SUBTYPE","value":"Immuno"}?,"tau":24?,"landmarkMonths":[0,6,12]?,"cohorts":[names?(max 6)]}
  // restricted mean survival time to tau per cohort, difference and ratio vs the first; landmark small multiples (preview)`,
  examples: [
    {
      title: "Months of life gained on immunotherapy with a high tumour mutational burden, with landmarks",
      snapshot: "rmst",
      demonstrates: "An `rmst` view (preview): the restricted mean survival time — the area under each Kaplan–Meier curve up to τ = 24 months, the mean months lived in the first two years — with its standard error, and between the cohorts the difference and ratio of those means with 95% intervals. It needs no proportional hazards, the usual worry with immunotherapy curves. `landmarkMonths` repeats it among the patients alive and followed at 6 and 12 months, each panel's clock restarted there.",
      tags: ["immunotherapy", "landmark", "non-proportional-hazards"],
      note: "Samstein et al.'s immunotherapy cohort (every patient treated with immune checkpoint inhibitors; OS from the first treatment), TMB under 10 against 10 or more mutations per megabase. In the first 24 months TMB-high patients lived about 3.3 months longer on average (17.7 against 14.5 months, ratio 1.23), and the gain holds at about 3.2–3.6 months among those still alive at 6 and at 12 months — the benefit is not only early.",
      doc: {
        study: "tmb_mskcc_2018",
        cohorts: {
          "TMB < 10": { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", range: { lt: 10 } }] },
          "TMB ≥ 10": { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", range: { gte: 10 } }] }
        },
        views: [{ kind: "rmst", cohorts: ["TMB < 10", "TMB ≥ 10"], tau: 24, landmarkMonths: [0, 6, 12] }]
      }
    }
  ],
};
