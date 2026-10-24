// The sequence view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { sequenceSvg } from "./figure.ts";

export const sequenceKind: ViewKindDef<"sequence"> = {
  kind: "sequence",
  figure: (v, o) => v.sequence && v.sequence.panels.some((z) => z.flows.length) ? sequenceSvg(v, o) : null,
  title: (v) => "Treatment sequence" + (v.sequence ? " by " + v.sequence.labelKey : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const sq2 = v.sequence;
    out.push(`Treatment sequence (lines of therapy by ${sq2 ? sq2.labelKey : "?"}, ` +
      `${sq2 ? sq2.lineGap : 90}-day line gap):\n` +
      (sq2?.panels || []).map((pn) => {
        const first = pn.nodes.filter((n) => n.column === 1 && n.kind === "regimen")
          .sort((a, b) => b.n - a.n).slice(0, 5)
          .map((n) => `${n.label} ${n.n.toLocaleString()}`).join(", ");
        const stopped = pn.nodes.filter((n) => n.kind === "stopped").reduce((t, n) => t + n.n, 0);
        const cens = pn.censored;
        return `  ${pn.cohort}: ${pn.started.toLocaleString()} with a first line — ${first}\n` +
          `    of all paths, ${stopped.toLocaleString()} were WATCHED and began no further line; ` +
          `${cens.toLocaleString()} (${pn.started ? Math.round(100 * cens / pn.started) : 0}%) end because the RECORD stops — nothing can be concluded about those`;
      }).join("\n") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows the order in which patients moved from one treatment to the next, drawn as flows between them. It answers a simple but useful question: after this treatment, what did doctors try next, and how often?"
  },
  isNew: true,
};
