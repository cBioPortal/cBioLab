// The mutations view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { tableText } from "../text.ts";

export const mutationsKind: ViewKindDef<"mutations"> = {
  kind: "mutations",
  text: (v, { out, caveatOf, noteOf }) => {
    const t = v.mutations;
    const title = `${v.mutations.gene} mutations`;
    out.push(`${title}: ${t.total < t.all ? `${t.total.toLocaleString()} of ${t.all.toLocaleString()} rows kept by the query` : `${t.total.toLocaleString()} rows`}; ` +
      tableText(t) + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Lists every mutation found in one gene in your groups, one row per mutation: which sample it was in, the exact protein change, whether OncoKB considers it cancer-causing, what kind of change it is, and how much of the tumour carries it. Click a column to sort by it; the download saves every row. It sits under the lollipop chart, which shows the same mutations as positions along the protein."
  },
  need: "patients",
};
