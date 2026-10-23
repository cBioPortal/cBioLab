// The cancertypes view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { cancertypesSvg } from "./figure.ts";

export const cancertypesKind: ViewKindDef<"cancertypes"> = {
  kind: "cancertypes",
  figure: (v, o) => v.cancertypes && v.cancertypes.panels.some((pn) => pn.profiled) ? cancertypesSvg(v, o) : null,
  title: (v) => "Cancer types summary" + (v.cancertypes ? " — " + v.cancertypes.genes.join(", ") + " by " + v.cancertypes.groupBy : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const ct = v.cancertypes;
    const line = (g: { label: string; altered: number; profiled: number; mutation: number; amp: number; homdel: number; sv: number; multiple: number }) =>
      `    ${g.label}: ${(100 * g.altered / (g.profiled || 1)).toFixed(1)}% (${g.altered}/${g.profiled}; mutation ${g.mutation}, amp ${g.amp}, deep del ${g.homdel}, SV ${g.sv}, multiple ${g.multiple})`;
    out.push(`Cancer types summary: ${ct.genes.join(", ")} by ${ct.groupBy} (${ct.measure === "driver" ? "drivers" : "any alteration"}; samples profiled for at least one gene):\n` +
      ct.panels.map((pn) => `  ${pn.cohort}: ${pn.altered.toLocaleString()} of ${pn.profiled.toLocaleString()} profiled samples altered\n` +
        [...pn.groups, ...(pn.pooled ? [pn.pooled] : [])].map(line).join("\n")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "For a list of genes, shows what share of samples in each cancer type carry a change in at least one of them — mutated, gained in many copies, deleted, or rearranged — with each bar split by which kind of change it was. It answers which cancers these genes matter most in, the way cBioPortal's Cancer Types Summary does."
  },
  need: "local",
};
