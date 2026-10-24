// The clonality view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { clonalitySvg } from "./figure.ts";

export const clonalityKind: ViewKindDef<"clonality"> = {
  kind: "clonality",
  figure: (v, o) => v.clonality && v.clonality.panels.length ? clonalitySvg(v, o) : null,
  title: () => "Clonality (FACETS)",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const cr = v.clonality;
    out.push(`Clonality (FACETS; ${cr.measure === "driver" ? "driver mutation calls" : "all mutation calls"}${cr.qc ? ", QC-passing samples" : ""}):\n` +
      cr.panels.map((pn) => `  ${pn.cohort}: WGD ${pn.wgd.yes + pn.wgd.no ? (100 * pn.wgd.yes / (pn.wgd.yes + pn.wgd.no)).toFixed(1) + "%" : "—"} of ${(pn.wgd.yes + pn.wgd.no).toLocaleString()} samples\n` +
        pn.genes.map((g) => `    ${g.gene}: ${g.calls} calls, ${g.clonal + g.subclonal ? Math.round(100 * g.clonal / (g.clonal + g.subclonal)) + "% clonal" : "—"}` +
          ` (${g.clonal} clonal, ${g.subclonal} subclonal, ${g.indeterminate} indeterminate), LOH ${g.lohKnown ? Math.round(100 * g.loh / g.lohKnown) + "%" : "—"}` +
          (g.q != null ? `, q=${pFmt(g.q)}` : "")).join("\n")).join("\n") +
      (cr.wgdP != null ? `\n  WGD difference: Fisher p=${pFmt(cr.wgdP)}` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "A tumour is a population of cells, and a genetic change can be in all of them (present from early on) or only in some (arriving later). For each gene, this shows how often its changes are in all the tumour's cells, and how often the cell has also lost its backup copy of that gene. Beside it: how often tumours have doubled their entire set of chromosomes."
  },
  need: "local",
  isNew: true,
};
