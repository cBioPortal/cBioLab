// The alterations view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { tableText } from "../text.ts";

export const alterationsKind: ViewKindDef<"alterations"> = {
  kind: "alterations",
  title: (v) => "Patient alterations" + (v.alterations?.patient ? " — " + v.alterations.patient.id : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const a = v.alterations, pt = a.patient;
    const head = `Patient alterations — patients to choose from: ${a.total < a.all ? `${a.total.toLocaleString()} of ${a.all.toLocaleString()} kept by the query` : `${a.total.toLocaleString()}`}; ` + tableText(a);
    if (!pt) out.push(head + "\n  no patient listed: the list is empty" + caveatOf(v) + noteOf(v));
    else {
      const names: Record<string, string> = { mutations: "Mutations", cna: "Copy Number Alterations", sv: "Structural Variants" };
      out.push(head + `\n${pt.id} (${pt.study}); samples: ${pt.samples.map((x) => x.id + (x.type ? " (" + x.type + ")" : "")).join(", ") || "none"}` +
        Object.entries(a.tables).map(([k, t]) => `\n${names[k] || k}: ${t!.total < t!.all ? `${t!.total.toLocaleString()} of ${t!.all.toLocaleString()} rows kept by the query` : `${t!.total.toLocaleString()} rows`}; ` + tableText(t!)).join("") +
        caveatOf(v) + noteOf(v));
    }
  },
  help: {
    title: "What is this?",
    text: "Lists one patient's genetic changes as cBioPortal's patient page does, in three tables: mutations (the gene, the protein change, whether OncoKB considers it cancer-causing, and how much of the tumour carries it), copy-number changes (genes amplified or deleted outright) and structural variants (fusions and rearrangements). A change found in several of the patient's samples is one row, with a numbered marker for each sample. Cohort % says how common the same kind of change in that gene is across the study. Each table can be searched, filtered, sorted and downloaded on its own. Step to the previous or next patient with the arrows at the top (or the ← and → keys), pick another cohort in the header, or open the patient list to search, sort and pick one."
  },
  need: "alterations",
};
