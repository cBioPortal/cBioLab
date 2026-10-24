// The pathways view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { pathwaysSvg } from "./figure.ts";

export const pathwaysKind: ViewKindDef<"pathways"> = {
  kind: "pathways",
  figure: (v, o) => v.pathways && v.pathways.rows.length ? pathwaysSvg(v, o) : null,
  title: () => "Oncogenic signalling pathways",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const pw = v.pathways;
    out.push(`Oncogenic signalling pathways (% of patients with ≥1 member ${pw.measure === "driver" ? "driver" : "altered"}; union-of-panels denominator):\n` +
      pw.rows.map((r) => `  ${r.name} (${r.profiledGenes}/${r.genes} genes profiled): ` +
        r.cells.map((c) => `${c.cohort} ${c.pct == null ? "not profiled" : c.pct + "%"}`).join(" | ") +
        (r.q != null ? ` q=${pFmt(r.q)}` : "") +
        (r.top.length ? `; top: ` + r.top.map((t) => `${t.gene} ${t.cells.map((c) => c.pct == null ? "–" : c.pct + "%").join("/")}`).join(", ") : "") +
        (r.otherAltered ? `, +${r.otherAltered} more altered` : "")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Groups genes into ten well-known signalling pathways — chains of genes that together tell a cell when to grow, divide or die — and shows what share of each group of patients has a harmful change in at least one gene of each pathway. Two cancers can reach the same broken pathway through different genes, and this view makes that visible."
  },
  need: "local",
};
