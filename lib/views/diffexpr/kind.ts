// The diffexpr view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { diffexprSvg } from "./figure.ts";

export const diffexprKind: ViewKindDef<"diffexpr"> = {
  kind: "diffexpr",
  figure: (v, o) => v.diffexpr && v.diffexpr.tested ? diffexprSvg(v, o) : null,
  title: (v) => "Differential expression" + (v.diffexpr ? " — " + v.diffexpr.profileType : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const d = v.diffexpr;
    const top = (sign: 1 | -1) => d.points.filter((g) => g.q < 0.05 && Math.sign(g.effect) === sign).slice(0, 12)
      .map((g) => `${g.gene} ${g.effect > 0 ? "+" : ""}${g.effect.toFixed(2)} (q=${pFmt(g.q)})`).join(", ");
    out.push(`Differential expression, ${d.groups[0]} vs ${d.groups[1]} on ${d.profileType}${d.log2 ? " (log2)" : ""}: ` +
      `${d.tested.toLocaleString()} genes tested, ${d.up.toLocaleString()} higher in ${d.groups[0]} and ${d.down.toLocaleString()} higher in ${d.groups[1]} at q<0.05 (${d.effectLabel}).\n` +
      `  most significant, higher in ${d.groups[0]}: ${top(1) || "none"}\n` +
      `  most significant, higher in ${d.groups[1]}: ${top(-1) || "none"}` +
      (d.gsea ? `\n  GSEA (${d.gsea.ranking}; ${d.gsea.permutations} gene-set permutations):\n` +
        d.gsea.sets.slice(0, 12).map((x) => `    ${x.name}: NES ${x.nes.toFixed(2)}, q=${pFmt(x.q)}, ${x.size} genes, leading edge ${x.leadingEdge.slice(0, 8).join(" ")}${x.leadingEdge.length > 8 ? " …" : ""}`).join("\n") : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Compares how active every gene is between two groups of patients. Each dot is a gene: further left or right means a bigger difference in activity between the groups, higher up means the difference is less likely to be chance. The panel beside it asks whether whole families of related genes, such as those that drive cell division, lean towards one group."
  },
  need: "local",
};
