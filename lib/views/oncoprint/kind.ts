// The oncoprint view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";

export const oncoprintKind: ViewKindDef<"oncoprint"> = {
  kind: "oncoprint",
  figure: (v) => v.svg || null,
  title: () => "Oncoprint",
  text: (v, { out, noteOf }) => {
    if (!v.svg && v.spec) {
      // the web page draws its oncoprints itself, so its results carry the spec, not the figure
      const sp = v.spec as { genes?: unknown[] };
      out.push(`Oncoprint of ${(sp.genes || []).length} gene track(s) across ${(v.cohorts || []).join(", ")} — drawn in the page from its spec; ` +
        `per-gene frequencies are in the figure's header, not in this summary.` + noteOf(v));
    } else if (v.svg) {
      out.push(`Oncoprint: ${v.nColumns!.toLocaleString()} patients — ` +
        v.genes!.map((g) => `${g.gene} ${g.driverPct}%/${g.anyPct}%`).join(", ") +
        ` — annotation ${v.annotation}.` + noteOf(v));
    } else return false;
  },
  help: {
    title: "What is this?",
    text: "A grid with one column per patient and one row per gene, color-coded to show what kind of genetic change (if any) each patient has in each gene. It's a fast way to see patterns across many patients and genes at once — for example, whether certain alterations tend to show up in the same patients, or never together."
  },
  need: "oncoprint",
};
