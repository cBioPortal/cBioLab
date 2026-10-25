// The correlates view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { correlatesSvg } from "./figure.ts";
import type { CorrelatesGene } from "./types.ts";

export const correlatesKind: ViewKindDef<"correlates"> = {
  kind: "correlates",
  figure: (v, o) => v.correlates && v.correlates.tested > 0 ? correlatesSvg(v, o) : null,
  title: (v) => "Co-expression" + (v.correlates ? " — " + v.correlates.gene + " against every " + (v.correlates.otherIsAssay ? "entity of " + v.correlates.otherProfile : "gene") : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const co = v.correlates;
    const line = (g: CorrelatesGene) => `  ${g.gene}${g.name ? " (" + g.name + ")" : ""}: ρ ${g.rho} (q=${pFmt(g.q)}), r ${g.r}, n=${g.n}`;
    out.push(`${co.otherIsAssay ? "Entities of the generic assay " + co.otherProfile + " correlated" : "Genes co-expressed"} with ${co.gene} (${co.profileType}${co.otherProfile !== co.profileType ? " against " + co.otherProfile : ""}) in ${co.cohort}; ` +
      `Spearman ρ${co.rhoFrom === "meta" ? " combined across studies by Fisher z" : ""}, BH q over ${co.tested.toLocaleString()} ${co.otherIsAssay ? "entities" : "genes"}; ${co.significant.toLocaleString()} at q<0.05:\n` +
      ` most positively correlated:\n` + co.positive.map(line).join("\n") +
      `\n most negatively correlated:\n` + co.negative.map(line).join("\n") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Takes one gene and checks every other gene for whether its activity rises and falls along with it across these patients. The genes at the top go up when it goes up; those at the bottom go down when it goes up. The chart on the left shows how all genes fall: most barely move with it, and the ones far out on either side are the ones listed. Moving together is a clue, not proof that one gene controls the other."
  },
  need: "local",
};
