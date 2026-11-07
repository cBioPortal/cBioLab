// The pathwaymap view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { pathwayMapSvg } from "./figure.ts";
import { fmtNum } from "../../svg-kit.ts";
import { pathwayNamed } from "./library.ts";

const pathwayGenes = (name: string): string[] => pathwayNamed(name)?.genes || [];

export const pathwaymapKind: ViewKindDef<"pathwaymap"> = {
  kind: "pathwaymap",
  figure: (v, o) => v.pathwaymap ? pathwayMapSvg(v, o) : null,
  title: (v) => (v.pathwaymap ? v.pathwaymap.pathway + ": " : "") + "pathway diagram",
  text: (v, { out, caveatOf, noteOf }) => {
    const pm = v.pathwaymap;
    const byGene = new Map(pm.genes.map((g) => [g.gene, g.cells]));
    const pct = (g: string) => (byGene.get(g) || []).map((c) => c.cohort + " " + (c.pct == null ? "N/P" : c.pct + "%")).join(" / ");
    out.push(`PathwayMapper pathway ${pm.pathway} (${pm.defaulted ? "best-ranked" : "chosen"}; ranked by ${pm.settings.rank}${pm.settings.byFrequency ? " weighted by altered %" : ""}` +
      `${pm.settings.pancanOnly ? ", TCGA PanCanAtlas pathways" : ", all " + pm.ranked.length + " pathways"}; query ${pm.queryFrom === "genes" ? pm.query.join(" ") : pm.query.length + " altered genes"}):\n` +
      `  ranking: ` + pm.ranked.slice(0, 10).map((r) => `${r.name} ${fmtNum(r.score)}${r.matched.length ? " (" + r.matched.join(",") + ")" : ""}`).join("; ") + "\n" +
      `  gene nodes: ` + pathwayGenes(pm.pathway).map((g) => g + " " + (byGene.has(g) ? pct(g) : "(a group, no frequency)")).join("; ") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Draws one signalling pathway as a diagram — genes as boxes, arrows for which gene switches which on or off — and shows in each gene's box how often it is altered in the patients' tumours. Beside it, every pathway in the library is ranked by how many of your genes it contains, so you can pick the one that best explains them.",
  },
};
