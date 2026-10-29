// The `timeline` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const timelineDoc: KindDoc = {
  reference: `\`patient?:{study, id}, collapsed?:[track ids], expandGaps?:false, columns?, search?, filters?, sort?:{column, desc?}, rows?:25, cohorts:[1 name]\` | **one patient's clinical timeline**, cBioPortal's patient-view Timeline: every clinical event the study records for \`patient\` (default: the first patient of the list), in days from diagnosis, as tracks — one per event type (case-folded), in the portal's order (sample acquisition, sequencing, surgery, … treatment, diagnosis, lab tests), nested by attribute as the portal nests them (Treatment by TREATMENT_TYPE → SUBTYPE → AGENT, Lab_Test by TEST, Diagnosis and Pathology by SUBTYPE; a lone "Other" level is folded into its parent). Points are events, bars are events with a stop date, same-day events stack with their count; samples are numbered markers (collection order) coloured by SAMPLE_TYPE; a lab test whose every RESULT is a number is a line chart (a result recorded as \`<x\`/\`>x\` is drawn hollow at x); STYLE_COLOR / STYLE_SHAPE attributes are honoured. Runs of four or more years with no event are cut to one dashed mark unless \`expandGaps\`. \`collapsed\` names tracks drawn folded, by id: the event type in lower case, then each nesting value, dot-joined (\`treatment\`, \`treatment.Chemo\`, \`lab_test\`). The cohort's patients to choose from — in the lab card, a dialog its navigator opens — are a table view (see *Table views* below) with column ids \`patient\`, \`samples\`, \`events\`, \`first\`, \`last\` (event days), \`span\` (days), \`types\` (event types recorded); default order patients with a timeline first, then by id. A named patient must be one of the cohort's patients. The view reads ONE cohort (name it in \`cohorts\` when the document has several). The result gives the drawn patient's \`position\` in the list's order (its search, filters and sort) — \`index\` from 0, and the \`prev\` and \`next\` patients as \`{study, id}\`, what the card's ‹ prev / next › step to by setting \`patient\`; null when the query leaves the patient out. Both the list and the timeline name a patient, so only a patient-level participant contributes; any other study is named. A listing: no statistic`,
  grammar: `{"kind":"timeline","patient":{"study":"<study>","id":"<patient id>"}?,"collapsed":["treatment.Chemo", ...]?,"expandGaps":false?,"columns"|"search"|"filters"|"sort"|"rows" as for table?}
  // one patient's clinical timeline (cBioPortal's patient view): tracks per event type, nested by attribute, samples numbered, numeric labs as line charts;
  // with the cohorts' patients listed to choose from (columns patient, samples, events, first, last, span, types). Patient-level studies only`,
  examples: [
    {
      title: "A patient's timeline: treatments, diagnoses, samples and lab values from diagnosis",
      demonstrates: "A `timeline` view, the portal's patient-view Timeline: the chosen patient's clinical events as tracks — treatment nested by subtype and agent, lab tests as line charts, samples as numbered markers — with the list of the cohort's patients to choose from (a table: searchable, sortable, downloadable). `patient` names who is drawn; `collapsed` folds a track's sub-tracks into one row. Beside it, an `alterations` view of the same patient: their mutations, copy-number alterations and structural variants, as the portal's patient page lists them under the timeline. Both name a patient, so only a study that may disclose patients takes part.",
      tags: ["data-table", "patient"],
      note: "MSK-CHORD breast cancer patients with the most timeline events first; P-0000012 drawn, with chemotherapy folded into one row, and P-0000012's alterations beside it.",
      doc: {
        study: "msk_chord_2024",
        cohorts: { "Breast": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Breast Cancer"] }] } },
        views: [{ kind: "timeline", cohorts: ["Breast"], patient: { study: "msk_chord_2024", id: "P-0000012" }, collapsed: ["treatment.Chemo"], sort: { column: "events", desc: true } },
                 { kind: "alterations", cohorts: ["Breast"], patient: { study: "msk_chord_2024", id: "P-0000012" } }]
      }
    }
  ],
};
