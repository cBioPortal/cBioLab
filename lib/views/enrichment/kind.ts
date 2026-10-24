// The enrichment view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { enrichmentSvg } from "./figure.ts";

export const enrichmentKind: ViewKindDef<"enrichment"> = {
  kind: "enrichment",
  figure: (v, o) => v.enrichment && v.enrichment.tested > 0 ? enrichmentSvg(v, o) : null,
  title: (v) => "Alteration enrichment" + (v.enrichment ? " — " + v.enrichment.alteration : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const en = v.enrichment;
    out.push(`Alteration enrichment (${en.alteration}${en.measure === "driver" ? ", drivers only" : ""}; ${en.test}, BH q over ${en.tested.toLocaleString()} genes; ${en.significant} at q<0.05):\n` +
      en.rows.slice(0, 40).map((g) => `  ${g.gene}: ` + g.cells.map((c) => `${c.cohort} ${c.pct == null ? "—" : c.pct + "%"} (${c.altered}/${c.profiled})`).join(" | ") +
        (g.log2Ratio != null && g.log2Ratio !== undefined ? `, log2 ratio ${g.log2Ratio.toFixed(2)}` : "") + `, q=${pFmt(g.q)}, enriched in ${g.enrichedIn}`).join("\n") +
      (en.rows.length > 40 ? `\n  … ${en.tested - 40} more genes tested` : "") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Checks every gene at once for whether it is changed more often in one group of patients than another — mutated, gained, deleted or rearranged, whichever you choose. The genes at the top of the list, and furthest out on the chart, differ most clearly between the groups; the share in each group is beside every gene, so a difference that is clear but small is visible as small."
  },
  need: "local",
};
