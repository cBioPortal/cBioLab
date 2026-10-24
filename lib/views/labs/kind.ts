// The labs view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { labsSvg } from "./figure.ts";

export const labsKind: ViewKindDef<"labs"> = {
  kind: "labs",
  figure: (v, o) => v.labs && v.labs.panels.some((pn) => pn.evaluable) ? labsSvg(v, o) : null,
  title: (v) => "Lab course" + (v.labs ? " — " + v.labs.test + " from " + v.labs.anchoredTo : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const lb = v.labs;
    out.push(`Lab course: ${lb.test} % change from baseline, weeks from ${lb.anchoredTo}:\n` +
      lb.panels.map((pn) => `  ${pn.cohort}: ${pn.anchored.toLocaleString()} started, ${pn.baseline.toLocaleString()} with a baseline, ${pn.evaluable.toLocaleString()} measured after; ` +
        `${pn.evaluable ? (100 * pn.responders / pn.evaluable).toFixed(1) : "—"}% fell ≥${lb.responseDrop}% (${pn.responders}/${pn.evaluable})\n` +
        `    median [IQR] by week: ` + pn.course.filter((c) => c.n >= 5).map((c) => `${c.week}w ${c.median}% [${c.q1}, ${c.q3}]`).join(", ")).join("\n") +
      (lb.responseP != null ? `\n  response rates differ: Fisher p=${pFmt(lb.responseP)}` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Follows a blood test — such as PSA in prostate cancer — from the moment a treatment started, as the change from each patient's own starting level. The line shows the typical patient, the shaded band the middle half of patients, and the bars on the right each patient's best result: how far their level fell, or rose, after treatment began."
  },
  need: "local",
  isNew: true,
};
