// The prompt behind the patient page's "Summarize" button. The button sends it into the chat
// sidebar like typed text (app/_agent/ask.ts), so the reader sees what was asked and which tools
// ran; the rules the project holds a summary to are written here, in one place, and tested.
// Pure and browser-safe.

export interface PatientRef { kind: "patient" | "sample"; study: string; id: string }

/** The sections a summary is written in, in order. */
export const SUMMARY_SECTIONS = ["Who", "Course", "Genomics", "Not available"] as const;

export function patientSummaryPrompt(p: PatientRef): string {
  const subject = p.kind === "sample" ? `sample ${p.id}` : `patient ${p.id}`;
  return [
    `Summarize ${subject} of study ${p.study} from this page. Use only this page's tools: portal_get_page_text for the header, and portal_get_tab_results for the Summary and Clinical Data tabs. Do not use anything else.`,
    "",
    `Write a short recap under these headings, in this order: ${SUMMARY_SECTIONS.map((s) => "**" + s + "**").join(", ")}.`,
    "- **Who**: age at diagnosis, sex, diagnosis, vital status and survival time.",
    "- **Course**: the clinical timeline's highlights (samples taken, operations, each treatment and when, diagnoses, notable lab results), in order of time from diagnosis.",
    "- **Genomics**: the key alterations (gene, change, and whether OncoKB considers it cancer-causing), copy-number changes and structural variants.",
    "- **Not available**: anything the page does not show or could not be read.",
    "",
    "Rules:",
    "- End each line with the tab or view it came from, in brackets, for example [Summary › Clinical timeline].",
    "- A gene outside the panel a sample was sequenced on is \"not profiled\", never wild-type. An empty timeline is \"no events recorded\", never \"none occurred\".",
    "- The timeline text lists a limited number of events and says how many it left out. If it left some out, say so.",
    "- Repeat the engine's caveats that matter to a reader. State only what the tools returned, and say \"not shown\" for the rest.",
    "- Give no prognosis, no treatment advice and no comparison with other patients."
  ].join("\n");
}
