// The `course` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";

export const courseDoc: KindDoc = {
  reference: `\`eventTypes:[\u22646], anchor?:{eventType,key?,value?,occurrence?}, binMonths?:3, fromMonths?:-12, toMonths?:60, cohorts:[names]\` | the **clinical course**: per time bin, the share of the cohort in each event state. Two things it refuses to fake. (1) The denominator is the patients still under observation in that bin \u2014 first recorded event to last contact (the later of their last event and their OS follow-up) \u2014 never the whole cohort, which would make a curve fall merely because follow-up ran out. (2) \`anchor\` is optional for one study but **required across studies**: day 0 is birth in some studies and first sequencing in others, and nothing in the schema records which, so raw day 0 compares incomparable clocks. Event types that carry real durations are drawn as a state the patient is IN; the rest as an event that HAPPENED \u2014 read from the data, not from the name. Bins are half-open [t, t+w). Event-name spellings differing only in case are folded (\`Treatment\`/\`TREATMENT\`) and the fold is named in the caveat; nothing else is merged`,
  grammar: `{"kind":"course","eventTypes":[...(max 6)],"anchor":{"eventType":"Treatment","occurrence":"FIRST"},
 "binMonths":3,"fromMonths":-12,"toMonths":60,"cohorts":[names?]}`,
};
