// The datafiles view as every page and agent sees it: its title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { tableText } from "../text.ts";

export const datafilesKind: ViewKindDef<"datafiles"> = {
  kind: "datafiles",
  title: (v) => "Downloadable data files" + (v.datafiles ? " for " + v.datafiles.lines.map((l) => l.line).join(", ") : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const d = v.datafiles;
    out.push("Data files for " + d.lines.map((l) => l.line).join("; ") + ": " + d.files.map((f) => f.name + " (" + f.rows.toLocaleString() + " rows)").join(", ") + ". " +
      "Gene alteration frequency: " + d.frequency.map((f) => f.line + " " + f.altered.toLocaleString() + " of " + f.profiled.toLocaleString() + " profiled" + (f.percent == null ? "" : " (" + f.percent + "%)")).join(", ") + ". " +
      "Case table: " + tableText(d) + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "The files you can take away for the genes you asked about: each gene's mutations, structural variants and values in every kind of measurement the study holds, one row per sample, and the lists of samples the query does and does not find altered. Below them, how often each gene is altered among the samples tested for it, and a table of every sample with what was found in each gene. The lists can be opened as a cohort in the lab."
  },
  need: "patients",
};
