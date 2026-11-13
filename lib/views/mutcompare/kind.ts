// The mutcompare view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { mutcompareSvg, mutcompareCaption, ordinalName } from "./figure.ts";
import { fmtPct } from "../../chart/format.ts";

export const mutcompareKind: ViewKindDef<"mutcompare"> = {
  kind: "mutcompare",
  figure: (v, o) => v.mutcompare && !v.mutcompare.empty ? mutcompareSvg(v, o) : null,
  title: (v) => v.mutcompare ? v.mutcompare.gene + " mutations: " + v.mutcompare.groups.map((g, i) => ordinalName(i, g.name)).join(" vs ") : "Mutations compared",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const m = v.mutcompare;
    const [A, B] = m.groups;
    const sig = m.rows.filter((r) => r.q < 0.05);
    out.push(`${mutcompareCaption(v)}\n` +
      (m.empty ? `  ${m.empty}\n` : `  ${m.rows.length.toLocaleString()} protein changes; ${sig.length.toLocaleString()} at q<0.05. Most significant:\n` +
        m.rows.slice(0, 10).map((r) => `    ${r.change}: ${A.name} ${r.n[0]} (${fmtPct(r.pct[0], 2)}), ${B.name} ${r.n[1]} (${fmtPct(r.pct[1], 2)}), p=${pFmt(r.p)}, q=${pFmt(r.q)}, enriched in ${r.enrichedIn}`).join("\n") + "\n") +
      `  genes by highest mutated share: ${m.ranking.slice(0, 10).map((g) => `${g.gene} ${fmtPct(g.pct)}`).join(", ")}` +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Compares where one gene's mutations fall in two groups of patients. The first group's mutations are drawn above the protein and the second group's below it, so a spot mutated much more often in one group stands out. The table lists every protein change with how many patients in each group carry it, and whether the difference between the groups is more than chance."
  },
  e2ePending: "new in the Comparison page's Mutations tab; its browser check comes with the tab's first review",
};
