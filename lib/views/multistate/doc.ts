// The `multistate` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const multistateDoc: KindDoc = {
  reference: `\`progression?:{eventType?:"Diagnosis", key?:"PROGRESSION", values?:["Y","Yes"], probabilityKey?, minProbability?}, prevalent?:"include"\|"exclude", horizons?:[12,24,60], cutoffMonths?, cohorts:[names] (≤4)\` | **a multistate (illness–death) model** (Rueda et al., Nature 2019, PMID 30867590) — **preview**: states start (the timeline's day 0 — first sequencing in MSK-CHORD; the view checks how many patients have a Sequencing event on day 0 and says what day 0 is), progression (the first \`progression\` event after day 0, as \`txendpoints\` reads it: values folded, an optional probability floor) and death (OS_STATUS / OS_MONTHS on the timeline's clock, with \`txendpoints\`' clock check). A patient with a progression on or before day 0 starts in the progression state (\`prevalent:"exclude"\` leaves them out); a progression on or after the end of follow-up is not counted. Markov (clock-forward): every hazard runs on time since day 0, progression → death with delayed entry at the progression. Per cohort: each transition's events, person-months and rate per 100 person-months (Poisson 95% interval), Nelson–Aalen cumulative hazards, Aalen–Johansen state occupation drawn as stacked areas (to where 10 patients remain followed) and tabled at \`horizons\`; per transition a Cox model (Efron; delayed entry for progression → death; a baseline per study) of each cohort against the first, no ratio for a cohort with under 5 events. Sites send (prevalent, progression time, end time, dead) counts only. Progression from radiology NLP is probabilistic and unseen in patients never imaged — the caption counts them`,
  grammar: `{"kind":"multistate","progression":{"eventType":"Diagnosis","key":"PROGRESSION","values":["Y","Yes"]}?,"prevalent":"include|exclude"?,"horizons":[12,24,60]?,"cohorts":[names?(max 4)]}
  // illness-death model from day 0: state occupation (Aalen-Johansen), cumulative hazards, rates and a Cox HR per transition (preview)`,
  examples: [
    {
      title: "From progression to death in colorectal cancer, by stage",
      demonstrates: "A `multistate` view (preview): the illness–death model (Rueda et al., Nature 2019) — alive without progression, alive after it, dead — from each patient's first sequencing (the timeline's day 0 in MSK-CHORD). Per cohort the share in each state month by month (Aalen–Johansen, stacked), the cumulative hazard of each transition (Nelson–Aalen), each transition's rate per 100 person-months, and a Cox hazard ratio per transition against the first cohort, from id-free (progression time, end time, dead) counts.",
      tags: ["timeline-events", "progression", "hazard-ratio"],
      note: "MSK-CHORD colorectal cancer, highest recorded stage 1–3 against stage 4. Stage 4 patients progress over four times as fast (HR ≈ 4.4) and, once progressed, die about 1.7 times as fast; death without a recorded progression is rare in both. So the stage-4 survival gap comes mostly through faster progression, and partly through worse survival after it. About a third of each cohort had a progression recorded before their first sequencing and starts in the progression state; set prevalent to exclude to follow only patients not yet progressed.",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "Colorectal, stage 1-3": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] },
            { kind: "clinical", attribute: "STAGE_HIGHEST_RECORDED", values: ["Stage 1-3"] }
          ] },
          "Colorectal, stage 4": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] },
            { kind: "clinical", attribute: "STAGE_HIGHEST_RECORDED", values: ["Stage 4"] }
          ] }
        },
        views: [{ kind: "multistate", cohorts: ["Colorectal, stage 1-3", "Colorectal, stage 4"] }]
      }
    }
  ],
};
