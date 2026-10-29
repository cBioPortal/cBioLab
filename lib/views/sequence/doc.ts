// The `sequence` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const sequenceDoc: KindDoc = {
  summary: "treatment-line flows",
  reference: `\`labelKey?:"SUBTYPE", eventType?:"treatment", lineClasses?:"systemic"|"all"|[classes], exclude?:[values], lineGap?:90, maxSteps?:3, topN?:8, cohorts:[names]\` | **what follows what**: therapy transitions as lines, drawn as a Sankey. Records are first grouped into LINES \u2014 therapies less than \`lineGap\` days apart are one line, labelled by their whole combination (sorted, so \`A + B\` and \`B + A\` are one regimen). That grouping is the point: a patient has a median of 6 treatment records and 4 distinct agents, and combination therapy is several records describing ONE decision. Paths that end flow into TWO explicit terminals, never one: **no further line** (the study watched for at least one \`lineGap\` and saw no further therapy) and **record ends here** (it did not, so nothing can be concluded). Measured on MSK-CHORD, 68% of patients have under three months of observation after their last therapy and the median is 15 days \u2014 so collapsing the two would turn record-keeping into an apparent clinical decision. Flows out of a node sum to it, so nobody vanishes. Up to two cohorts are drawn as panels sharing one scale and one colour per regimen. Lines are the shared definition (see "Treatment line (derived)" above): systemic-therapy records by default, \`lineClasses\` \`"all"\` for every treatment record or a list of class names for your own; \`labelKey\` only names a line\u2019s therapies (e.g. AGENT), it never decides which records form lines. \`exclude\` drops records by label value, matched ignoring case. More than two cohorts is refused`,
  grammar: `{"kind":"sequence","labelKey":"SUBTYPE","eventType":"treatment","exclude":[values?],
 "lineClasses":"systemic|all"|[classes]?,"lineGap":90,"maxSteps":3,"topN":8,"cohorts":[names?]}
  // lines: systemic-therapy records (SUBTYPE, else TREATMENT_TYPE) by a lineGap-day gap —
  // the same definition as "Treatment line (derived)" and the "lines" derived metric`,
};
