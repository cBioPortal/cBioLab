// The sv view as every page and agent sees it: its title, results text, help and need.
import type { ViewKindDef } from "../kind-def.ts";
import { tableText } from "../text.ts";

export const svKind: ViewKindDef<"sv"> = {
  kind: "sv",
  title: (v) => "Structural variants" + (v.sv ? " of " + v.sv.genes.join(", ") : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const t = v.sv;
    out.push("Structural variants of " + t.genes.join(", ") + ": " + (t.total < t.all ? t.total.toLocaleString() + " of " + t.all.toLocaleString() + " rows kept by the query" : t.total.toLocaleString() + " rows") + "; " +
      tableText(t) + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Lists every structural variant — a fusion, deletion, duplication, inversion or translocation — that involves one of your genes, in the samples of your groups, one row per variant: which sample it was in, the two genes joined, how they are joined, and the study's own description of the event. Click a column to sort by it; the download saves every row. The note under the table says how many samples were tested for each gene's structural variants.",
  },
  need: "patients",
};
