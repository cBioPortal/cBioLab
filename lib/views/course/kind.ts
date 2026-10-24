// The course view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { courseSvg } from "./figure.ts";

export const courseKind: ViewKindDef<"course"> = {
  kind: "course",
  figure: (v, o) => v.course && v.course.length ? courseSvg(v, o) : null,
  title: (v) => "Clinical course" + (v.course && v.course.length ? " — " + [...new Set(v.course.map((z) => z.eventType))].join(", ") : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const axis = v.courseAxis;
    out.push(`Clinical course (${axis ? axis.binMonths + "-month bins, " + axis.from + " to +" + axis.to + "mo" : "binned"} ` +
      `relative to the anchor; DENOMINATOR IS THE PATIENTS STILL OBSERVABLE IN EACH BIN, not the cohort):\n` +
      (v.course || []).map((s2) => {
        const pts = s2.points.filter((q) => q.pct != null && q.atRisk > 0);
        const at = (t: number) => { const q = pts.find((z) => z.t === t); return q ? `${q.pct}% (n=${q.atRisk.toLocaleString()})` : "—"; };
        return `  ${s2.cohort} / ${s2.eventType} [${s2.isInterval ? "a state patients are IN" : "an event that HAPPENED"}]: ` +
          `0mo ${at(0)}, 12mo ${at(12)}, 24mo ${at(24)}, 60mo ${at(60)}`;
      }).join("\n") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows what share of patients were in each stage of their care — on treatment, in follow-up, and so on — at each point in time after diagnosis or another starting event. It's a picture of the typical patient's journey through care, not any one individual's."
  },
  isNew: true,
};
