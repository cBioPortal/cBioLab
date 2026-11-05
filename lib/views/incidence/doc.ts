// The `incidence` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const incidenceDoc: KindDoc = {
  summary: "cumulative incidence of a timeline event with death as a competing risk, or of a recorded time and competing-risks status; Gray's test",
  reference: `\`event:{eventType, attrs?:[{key,value} ×≤3], label?}, anchor?:{eventType,key?,value?,occurrence?}, horizons?:[12,24,60], cohorts:[names] (≤6)\`, or instead of \`event\`/\`anchor\`: \`monthsAttribute, statusAttribute, label?\` | **cumulative incidence with a competing risk**: time from the anchor (default the study's day 0) to the FIRST \`event\` after it, with death (\`OS_STATUS\`) as the competing event and \`OS_MONTHS\` as follow-up — Aalen–Johansen, with 95% intervals from its delta-method standard error (checked against R's cmprsk: estimates identical to five decimals, SEs within 3%). Not 1 − Kaplan–Meier, which censors the dead as if still at risk and overstates incidence wherever death is common; the view reports both at each of \`horizons\`, so the difference is on the page. Left truncation as in \`survival\`: a patient anchored before day 0 enters the risk set at day 0. Patients who cannot be at risk are counted by reason, never read as event-free: already had the event at or before the anchor, had it before observation began, no follow-up, no anchor event. Two or more cohorts: Gray's test (weight 1) by permutation of cohort labels over the pooled records — exact under the null, seeded, and computable from the (entry, time, cause) tallies each site sends, which are counts. **From a recorded time and status** — \`monthsAttribute\`/\`statusAttribute\` (a study attribute, or an upload's \`custom:<dataset>/<COLUMN>\`, e.g. \`ICPFS_TIME\`/\`ICPFS_EVENTCR\`) in place of \`event\`: the time in months from each patient's own start, and the status's code (before any \`:\`) 0 censored, 1 the event, 2 a competing event; any other code is refused rather than read as censored, and \`anchor\` does not apply. A patient enters with both values; a sample-level upload is read per patient, and refused where a patient's samples disagree. \`label\` names the event, by default the status column`,
  grammar: `{"kind":"incidence","event":{"eventType":"Diagnosis","attrs":[{"key":"TUMOR_SITE","value":"CNS/Brain"}],"label":"brain metastasis"},
 "anchor":{"eventType":"Treatment","key":"SUBTYPE","value":"Chemo"}?,"horizons":[12,24,60],"cohorts":[names?(max 6)]}
  // cumulative incidence of the first event, death competing (Aalen-Johansen, not 1-KM); Gray's test
  // or, in place of event/anchor, a recorded time and a status coded 0 censored, 1 event, 2 competing:
  // "monthsAttribute":"custom:<dataset>/ICPFS_TIME","statusAttribute":"custom:<dataset>/ICPFS_EVENTCR","label":"intracranial progression"?`,
  examples: [
    {
      title: "Brain metastasis, with death as a competing risk",
      snapshot: "incidence",
      demonstrates: "An `incidence` view: the cumulative incidence of a timeline event (here the first radiology-reported brain metastasis) with death as a competing risk — Aalen–Johansen, not 1 − Kaplan–Meier, which treats the dead as still at risk and so overstates incidence exactly where death is common. The table sets the two side by side; Gray's test compares the cohorts by permutation of their (entry, time, cause) tallies, which are all a site sends.",
      tags: ["competing-risks", "timeline-events"],
      note: "MSK-CHORD, from each patient's day 0, among those without a brain metastasis by then. At five years 24.7% of NSCLC patients have one — where 1 − Kaplan–Meier would have said 30.4% — against 20.6% in breast and 10.8% in colorectal cancer (1 − KM: 14.4%, a third too high, because so many colorectal patients die first).",
      doc: {
        study: "msk_chord_2024",
        cohorts: {
          "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] },
          "Breast": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Breast Cancer"] }] },
          "Colorectal": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }] }
        },
        views: [{ kind: "incidence", cohorts: ["NSCLC", "Breast", "Colorectal"], event: { eventType: "Diagnosis", attrs: [{ key: "TUMOR_SITE", value: "CNS/Brain" }], label: "brain metastasis" } }]
      }
    }
  ],
};
