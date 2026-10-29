// The `acquired` view in the DSL reference: its row of the Views table, its entry in the agent grammar and its gallery examples.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const acquiredDoc: KindDoc = {
  summary: "alterations acquired under therapy: each patient's sample before a treatment start against their sample after it, per gene acquired vs lost with McNemar q; omit genes to scan",
  reference: `\`anchor?:{eventType, key?, value?}, genes?:[≤30], minPost?:1-1000, top?:1-40, preWindowDays?, minGapDays?:0-3650, sampleEvents?:[types], sampleKey?, measure?:"any"\|"driver", cohorts:[names] (≤3)\` | **alterations acquired under therapy** (preview): patients with a sample dated on or before their FIRST \`anchor\` event (default \`Treatment\`, any; \`key\`/\`value\` such as SUBTYPE = Hormone or AGENT = …, folded like every timeline match) and another at least \`minGapDays\` (default 30) after it. A sample's date is its first timeline event of \`sampleEvents\` (default Sample acquisition / Sequencing / Specimen) naming it in \`sampleKey\` (default SAMPLE_ID); the before-side is the last sample on or before the anchor day (within \`preWindowDays\` when given), the after-side the first past the gap — one sample each. Per gene, counted only where BOTH samples' panels cover it: altered after only (acquired), before only (lost), on both (shared), neither; exact McNemar on acquired vs lost, BH q per cohort. \`measure:"driver"\` counts only OncoKB oncogenic alterations (pinned). Without \`genes\` it scans every gene altered after treatment in at least \`minPost\` (default 3) patients and draws the \`top\` (default 20) smallest p. The result carries the funnel (anchored → a sample before → after → both) and the pairs' spacing in days. Second biopsies are clinically indicated (often at progression), so acquired means seen after and not before, not caused by the treatment — the caption says so. Counts only; a remote peer cannot answer yet and is named.`,
  grammar: `{"kind":"acquired","anchor":{"eventType":"Treatment","key":"SUBTYPE","value":"Hormone"}?,"genes":[...(max 30)]?,"minPost":3,"top":20,
 "preWindowDays":365?,"minGapDays":30,"measure":"any|driver","cohorts":[names?(max 3)]}
  // (preview) last sample before the first anchor vs first sample >= minGapDays after: per gene acquired / lost / shared; McNemar`,
  examples: [
    {
      title: "Acquired under therapy: the sample before a treatment against the sample after it",
      snapshot: "acquired",
      demonstrates: "An `acquired` view (preview): patients with a sample dated on or before their first systemic therapy and another at least 30 days after it, read off the timeline's sample events — per gene, an oncogenic alteration only after (acquired) or only before (lost), counted only where both samples' panels cover the gene, with an exact McNemar test; with no `genes` it scans every gene acquired in at least 3 patients and draws the most one-sided.",
      tags: ["treatment", "resistance", "scan", "preview"],
      note: "MSK thoracic PDX: 142 patients with a systemic therapy start, 33 with a dated sample on each side of it (a median 301 days apart). Acquired calls outnumber lost ones: CDKN2B (8 acquired against 1 lost), MYC, KEAP1 — none survives correction at 33 patients, and many after-samples are PDX models, whose higher purity calls more than the tissue before them.",
      doc: {
        study: "lung_msk_pdx",
        cohorts: { "all patients": { all: [] } },
        views: [{ kind: "acquired", cohorts: ["all patients"], anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Systemic therapy" }, measure: "driver", top: 12 }]
      }
    }
  ],
};
