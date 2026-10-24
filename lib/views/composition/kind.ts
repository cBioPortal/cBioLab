// The composition view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { compositionSvg } from "./figure.ts";

export const compositionKind: ViewKindDef<"composition"> = {
  kind: "composition",
  figure: (v, o) => v.composition && v.composition.groups.some((g) => g.n > 0) ? compositionSvg(v, o) : null,
  title: (v) => "Composition" + (v.composition ? " — " + v.composition.sourceName : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const cm = v.composition;
    const fmt = (x: number) => cm.normalize ? (100 * x).toFixed(1) + "%" : x.toPrecision(3);
    out.push(`Composition of ${cm.sourceName} (${cm.parts.length} parts${cm.normalize ? ", shares of each " + cm.unit.replace(/s$/, "") + "'s total" : ""}; ` +
      `each cohort against the others by Welch's t, BH q over ${cm.tested} comparisons; ${cm.significant} at q<0.05):\n` +
      cm.groups.map((g) => `  ${g.cohort} (n=${g.n}${g.entropy ? ", entropy " + g.entropy.mean.toFixed(2) : ""}): ` +
        cm.parts.map((pt) => { const c = cm.cells.find((x) => x.cohort === g.cohort && x.part === pt.id)!;
          return `${pt.name} ${fmt(c.mean)}` + (c.q != null ? ` (log2 ${c.log2!.toFixed(2)}, q=${pFmt(c.q)})` : ""); }).join(", ")).join("\n") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows what each patient's (or sample's) tumour is made of — the share of each cell type, cell state or signature — as one stacked bar per case, sorted by the part you choose, with each group's average beside it. Under the bars, every group is set against the others part by part: the colour says whether a part is higher (red) or lower (blue) there, its size how sure that is. Parts of a whole move together, so one part rising means others fall."
  },
  need: "local",
  isNew: true,
};
