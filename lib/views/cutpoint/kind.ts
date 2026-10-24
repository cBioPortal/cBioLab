// The cutpoint view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { cutpointSvg } from "./figure.ts";

export const cutpointKind: ViewKindDef<"cutpoint"> = {
  kind: "cutpoint",
  figure: (v, o) => v.cutpoint.candidates.length ? cutpointSvg(v, o) : null,
  title: (v) => "Cut-point" + (v.cutpoint ? " — " + v.cutpoint.attribute + " on " + v.cutpoint.endpoint : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const m = v.cutpoint;
    const side = (s: { n: number; events: number; median: number | null }) => `n=${s.n}, ${s.events} events, median ${s.median == null ? "not reached" : s.median.toFixed(1) + "mo"}`;
    out.push(`Cut-point of ${m.attribute} on ${m.endpoint} (maximally selected log-rank, ${m.candidates.length} candidate cuts between the 10th and 90th percentiles; ${m.n.toLocaleString()} patients, ${m.events.toLocaleString()} events):\n` +
      `  best cut ${m.attribute} > ${m.cut}: high ${side(m.high)}; low ${side(m.low)}` + (m.hr ? `; HR ${m.hr.hr.toFixed(2)} (95% CI ${m.hr.ciLow.toFixed(2)}-${m.hr.ciHigh.toFixed(2)})` : "") + "\n" +
      `  corrected p=${pFmt(m.permP)} (${m.permutations} permutations, seed ${m.seed}); naive log-rank p=${pFmt(m.naiveP)}, which ignores the search` +
      (m.strata ? "\n  per " + m.strata.attribute + ":\n" + m.strata.rows.map((s) => `    ${s.stratum}: n=${s.n}, cut ${s.cut}, high ${s.high.n}, ` +
        (s.hr ? `HR ${s.hr.hr.toFixed(2)}, ` : "") + `corrected p=${pFmt(s.permP)}, naive p=${pFmt(s.naiveP)}`).join("\n") : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Looks for the value of a measurement — such as tumour mutational burden — that best splits patients into a group that did better and a group that did worse. It tries every reasonable dividing line (from the lowest tenth of patients to the highest) and draws how strongly each one separates survival; the dot marks the best. Because trying many lines and keeping the best always finds something, the view also reshuffles the measurement among the patients a thousand times to see how good a 'best line' chance alone produces, and reports how surprising the real best line is once that search is accounted for. A line found this way needs checking in other patients before anyone relies on it."
  },
  need: "patients",
  preview: "no method record or golden test of the maximally selected log-rank scan against R maxstat yet",
  isNew: true,
};
