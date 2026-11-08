// The diffexpr view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { diffexprSvg } from "./figure.ts";

export const diffexprKind: ViewKindDef<"diffexpr"> = {
  kind: "diffexpr",
  figure: (v, o) => v.diffexpr && v.diffexpr.tested ? diffexprSvg(v, o) : null,
  title: (v) => "Differential expression" + (v.diffexpr ? " — " + v.diffexpr.profileType : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const d = v.diffexpr;
    const two = d.groups.length === 2;
    const eff = (g: { effect?: number }) => g.effect ?? 0;
    const top = (sign: 1 | -1) => d.points.filter((g) => g.q < 0.05 && Math.sign(eff(g)) === sign).slice(0, 12)
      .map((g) => `${g.gene} ${eff(g) > 0 ? "+" : ""}${eff(g).toFixed(2)} (q=${pFmt(g.q)})`).join(", ");
    const highest = (g: { mean: number[] }) => d.groups[g.mean.indexOf(Math.max(...g.mean))];
    const means = (g: { mean: number[] }) => g.mean.map((m, i) => d.groups[i] + " " + m.toFixed(2)).join(", ");
    out.push((two
      ? `Differential expression, ${d.groups[0]} vs ${d.groups[1]} on ${d.profileType}${d.log2 ? " (log2)" : ""}: ` +
        `${d.tested.toLocaleString()} genes tested, ${(d.up ?? 0).toLocaleString()} higher in ${d.groups[0]} and ${(d.down ?? 0).toLocaleString()} higher in ${d.groups[1]} at q<0.05 (${d.effectLabel}).\n` +
        `  most significant, higher in ${d.groups[0]}: ${top(1) || "none"}\n` +
        `  most significant, higher in ${d.groups[1]}: ${top(-1) || "none"}`
      : `Differential expression across ${d.groups.join(", ")} on ${d.profileType}${d.log2 ? " (log2)" : ""}, ${d.test}: ` +
        `${d.tested.toLocaleString()} genes tested, ${d.significant.toLocaleString()} at q<0.05.\n` +
        `  most significant (highest in; mean per cohort):\n` +
        d.points.slice(0, 12).map((g) => `    ${g.gene} F=${(g.f ?? 0).toFixed(2)}, q=${pFmt(g.q)} — highest in ${highest(g)}; ${means(g)}`).join("\n")) +
      (d.gene ? "\n  picked: " + ((g) => g ? (two ? `${g.gene} ${eff(g) > 0 ? "+" : ""}${eff(g).toFixed(2)} (p=${pFmt(g.p)}, q=${pFmt(g.q)})`
        : `${g.gene} (p=${pFmt(g.p)}, q=${pFmt(g.q)}; ${means(g)})`) : d.gene + " (not among the genes listed)")(d.points.find((g) => g.gene === d.gene)) : "") +
      (d.gsea ? `\n  GSEA (${d.gsea.ranking}; ${d.gsea.permutations} gene-set permutations):\n` +
        d.gsea.sets.slice(0, 12).map((x) => `    ${x.name}: NES ${x.nes.toFixed(2)}, q=${pFmt(x.q)}, ${x.size} genes, leading edge ${x.leadingEdge.slice(0, 8).join(" ")}${x.leadingEdge.length > 8 ? " …" : ""}`).join("\n") : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Compares how active every gene is between groups of patients. With two groups, each dot is a gene: further left or right means a bigger difference in activity between the groups, higher up means the difference is less likely to be chance, and the panel beside it asks whether whole families of related genes, such as those that drive cell division, lean towards one group. With three or more, the genes whose activity differs most across the groups are listed, with each group's average."
  },
  need: "local",
};
