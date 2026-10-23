// The table view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { tableText } from "../text.ts";

export const tableKind: ViewKindDef<"table"> = {
  kind: "table",
  text: (v, { out, caveatOf, noteOf }) => {
    const t = v.table;
    const title = `Clinical data table (one row per ${v.table.unit})`;
    out.push(`${title}: ${t.total < t.all ? `${t.total.toLocaleString()} of ${t.all.toLocaleString()} rows kept by the query` : `${t.total.toLocaleString()} rows`}; ` +
      tableText(t) + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Lists every sample (or every patient) in your groups with everything the study recorded about them — cancer type, age, stage, survival and the rest — one row each. Click a column's name to sort by it; the download button saves every row as a file a spreadsheet can open. Studies that only share counts, never individual patients, are named rather than listed."
  },
  need: "patients",
};
