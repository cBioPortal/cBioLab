// The `labs` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const labsDoc: KindDoc = {
  summary: "a lab value's course and response from a treatment start, e.g. PSA50, with a waterfall",
  reference: `\`test, anchor:{eventType,key?,value?,occurrence?}, eventType?:"Lab_Test", testKey?:"TEST", resultKey?:"RESULT", baselineDays?:90, fromWeeks?:-12, toWeeks?:52, binWeeks?:4, responseDrop?:50, cohorts:[names] (≤4)\` | **a lab value's course from a treatment start**: each patient's \`test\` results (timeline events of \`eventType\` whose \`testKey\` names the test, value in \`resultKey\`) as % change from their own baseline — the last value in the \`baselineDays\` up to and including the anchor; a non-positive baseline is left out — per \`binWeeks\` bin from \`fromWeeks\` to \`toWeeks\`, drawn as median and interquartile band (from 2-point histograms, exact to within a point; a patient counts once per bin, at their mean; the baseline reading itself is not drawn). Best response is each patient's lowest value after the anchor; the share falling by at least \`responseDrop\`% is counted exactly (50 on PSA is PCWG3's PSA50), and two cohorts get a Fisher test on it. A **waterfall** of every patient's best change is drawn only from participants entitled to patient-level values (a method only PatientLevelResolver has, like a plot's points); an aggregate-only participant's patients stay in the histograms and the rate and are counted as withheld from the bars. With no evaluable patient, the refusal lists the tests the study records`,
  grammar: `{"kind":"labs","test":"PSA","anchor":{"eventType":"Treatment","key":"SUBTYPE","value":"Hormone"},
 "baselineDays":90,"fromWeeks":-12,"toWeeks":52,"binWeeks":4,"responseDrop":50,"cohorts":[names?(max 4)]}
  // % change from baseline over time (median/IQR), best response, responders (PSA50), waterfall`,
  examples: [
    {
      title: "PSA response to hormone therapy, by TP53 status",
      snapshot: "labs",
      demonstrates: "A `labs` view: a lab value's course from a treatment start, as % change from each patient's own baseline — median and interquartile band per 4-week bin, from histograms, so any site can contribute — with the best response, the share meeting a response threshold (here PCWG3's PSA50, counted exactly), and a waterfall of every patient's best change where the participant may disclose patient-level values.",
      tags: ["response", "waterfall", "timeline-events", "lab-values"],
      note: "Prostate cancer in MSK-CHORD, from the first hormone therapy. PSA falls by a median of more than 95% within three months in both groups, but 93.0% of TP53 wild-type patients reach PSA50 against 85.8% of TP53-mutant ones (Fisher p = 1.4e-6), and the mutant group's upper quartile turns back upward within a year.",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "Prostate, TP53 mutant": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Prostate Cancer"] },
            { kind: "oql", q: "TP53: MUT" }
          ] },
          "Prostate, TP53 wild-type": { all: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Prostate Cancer"] },
            { not: { kind: "oql", q: "TP53" } }
          ] }
        },
        views: [{ kind: "labs", cohorts: ["Prostate, TP53 mutant", "Prostate, TP53 wild-type"], test: "PSA", anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Hormone" } }]
      }
    }
  ],
};
