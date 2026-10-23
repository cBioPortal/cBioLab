// The hotspots view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { lollipopSummaryText } from "../../lollipop-svg.ts";
import { hotspotsSvg } from "./figure.ts";

export const hotspotsKind: ViewKindDef<"hotspots"> = {
  kind: "hotspots",
  figure: (v, o) => v.hotspots && v.hotspots.length ? hotspotsSvg(v, o) : null,
  title: () => "Recurrent protein changes",
  text: (v, { out, caveatOf, noteOf }) => {
    out.push("Mutations by protein position (commonest changes; share of patients mutated in THAT gene):\n" +
      (v.hotspots || []).map((g) =>
        `  ${g.gene}: ${g.mutated.toLocaleString()} mutated, ${g.mutations.toLocaleString()} mutations on ${g.positions.length.toLocaleString()} codons — ` +
        (g.topChanges.slice(0, 6).map((x) => `${x.change} ${x.n.toLocaleString()} (${x.pct}%)`).join(", ") || "no change above the floor") +
        (g.unpositioned ? `  [${g.unpositioned.toLocaleString()} with no protein position, not drawn]` : "") +
        (g.withheld ? `  [${g.withheld.toLocaleString()} below the suppression floor]` : "")).join("\n") +
      "\n  " + lollipopSummaryText(v.hotspots || [], v.hide || []) +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows exactly where along a gene's protein its mutations land, drawn as a lollipop chart — a taller stem means more patients had a mutation at that exact spot. Mutations clustering tightly at one or two spots, rather than scattering evenly, usually points to a location that matters for how the protein works."
  },
};
