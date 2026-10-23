// The rmst view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { rmstDiffText, rmstRatioText, rmstSvg, rmstText } from "./figure.ts";

export const rmstKind: ViewKindDef<"rmst"> = {
  kind: "rmst",
  figure: (v, o) => v.rmst.panels.some((pn) => pn.curves.some((c) => c.n)) ? rmstSvg(v, o) : null,
  title: (v) => "Restricted mean survival time" + (v.rmst ? " — " + v.rmst.endpointLabel : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const r = v.rmst;
    out.push(`Restricted mean survival time, ${r.endpointLabel}:\n` +
      r.panels.map((pn) => `  ${pn.landmark ? `from the ${pn.landmark}-month landmark` : "from the start"}, tau=${pn.tau} months${pn.tauSet ? "" : " (default: every cohort >= 10 at risk)"}:\n` +
        pn.curves.map((c) => `    ${c.cohort}: n=${c.n.toLocaleString()}, RMST ${rmstText(c)}` +
          ((x) => x ? `; vs ${x.vs} difference ${rmstDiffText(x)}, ratio ${rmstRatioText(x)}` : "")(pn.comparisons.find((x) => x.cohort === c.cohort))).join("\n")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Answers “how many months, on average, did patients in each group live within the first τ months?” — the shaded area under each survival curve up to τ. The difference between two groups is the months gained or lost in that window, which reads plainly even when the curves cross or only separate late (as with immunotherapy), where a single hazard ratio can mislead. τ is where every group still has at least ten patients followed, unless it is set. Landmark panels ask the same question again among the patients still alive and followed at 6 or 12 months, restarting the clock there. The groups were not randomised, so a difference is a clue, not proof."
  },
  need: "local",
  preview: "no method record or golden test of the restricted means, their variances and the landmark sets against R survRM2 yet",
  isNew: true,
};
