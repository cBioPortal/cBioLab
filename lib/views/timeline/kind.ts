// The timeline view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { TIMELINE_TEXT_EVENTS, tableText } from "../text.ts";

export const timelineKind: ViewKindDef<"timeline"> = {
  kind: "timeline",
  title: (v) => "Patient timeline" + (v.timeline?.patient ? " — " + v.timeline.patient.patient : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const t = v.timeline, pt = t.patient;
    const head = `Patient timeline — patients to choose from: ${t.total < t.all ? `${t.total.toLocaleString()} of ${t.all.toLocaleString()} kept by the query` : `${t.total.toLocaleString()}`}; ` + tableText(t);
    if (!pt) out.push(head + "\n  no patient drawn: the list is empty" + caveatOf(v) + noteOf(v));
    else {
      const shown = pt.events.slice(0, TIMELINE_TEXT_EVENTS);
      const line = (e: (typeof pt.events)[number]) => `  day ${e.start}${e.end != null && e.end > e.start ? `–${e.end}` : ""}: ${e.type}` +
        (e.attrs.length ? " — " + e.attrs.filter(([k]) => !/^STYLE_/i.test(k)).map(([k, x]) => `${k}=${x}`).join(", ") : "");
      out.push(head + `\n${pt.patient} (${pt.study}${pt.source.remote ? ", from " + pt.source.label + " over MCP" : ""}): ${pt.events.length} events, days from diagnosis; ` +
        `samples: ${pt.samples.map((x) => x.id + (x.type ? " (" + x.type + ")" : "")).join(", ") || "none"}\n` +
        shown.map(line).join("\n") +
        (pt.events.length > shown.length ? `\n  … ${pt.events.length - shown.length} later events not listed here (the figure draws all of them)` : "") +
        caveatOf(v) + noteOf(v));
    }
  },
  help: {
    title: "What is this?",
    text: "Shows one patient's medical history on a single line of time, as cBioPortal's patient page does: when samples were taken, operations, each treatment and how long it lasted, diagnoses, and lab results drawn as small charts. Time is counted from the day of diagnosis, and long stretches with nothing recorded are cut short (the dashed line). Step to the previous or next patient with the arrows at the top (or the ← and → keys), pick another cohort in the header, or open the patient list to search, sort and pick one. Studies that only share counts, never individual patients, are named rather than listed."
  },
  need: "timeline",
};
