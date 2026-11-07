// The datafiles view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, type MethodStep, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";
import type { LineFrequency } from "./types.ts";

export function datafilesMethod(t: { lines: { line: string; gene: string }[]; cohort: string; studies: string[]; oncokbPin: string | null;
  counts: { samples: number; altered: number; unaltered: number; unprofiled: number }; frequency: LineFrequency[];
  queryText: string; sortName: string | null; desc: boolean; shown: number; lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number }): MethodRecord {
  const steps: MethodStep[] = [{
    kind: "fetch", title: "Count the cohort's samples against each line of the query",
    detail: "The datafiles:counts query above, per study: each sample of the cohort is altered by a line when it has an event the line's OQL matches " +
      "(the cohort OQL clause's conditions, read sample by sample" + (t.oncokbPin ? "; DRIVER is OncoKB " + t.oncokbPin : "") + "), and profiled for it when its gene panel covers " +
      "the line's gene in any data type the line reads (mutation, copy number, structural variant — those the study holds). Unaltered: altered by no line and profiled " +
      "for every line's gene in every data type it reads. Counts only.",
    params: [["samples", t.counts.samples.toLocaleString("en-US")], ["altered", t.counts.altered.toLocaleString("en-US")], ["unaltered", t.counts.unaltered.toLocaleString("en-US")],
      ["neither", t.counts.unprofiled.toLocaleString("en-US")]],
  }, {
    kind: "transform", title: "Each line's frequency",
    detail: "Altered and profiled samples added across " + (t.studies.length > 1 ? "the " + t.studies.length + " studies" : "the study") +
      "; frequency = altered and profiled ÷ profiled × 100, rounded to one decimal.",
    params: t.frequency.map((f) => [f.line, f.altered.toLocaleString("en-US") + " / " + f.profiled.toLocaleString("en-US") + (f.percent == null ? "" : " = " + f.percent + "%")] as [string, string]),
  }, ...tableSteps({ label: "datafiles:cases", what: "samples", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every sample of the cohort with its status against the query and, per line, the events it matched — or no alteration, or not profiled.",
    order: t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + " with missing values last, then sample id" : "altered samples first, then by sample id" })];
  return { steps, implementation: { functions: ["datafilesCountsSql", "statusRowSource", "matrixRowSource", "oqlEventsSql", "pageSql", "countsSql"],
    file: "lib/views/datafiles/run.ts, lib/views/datafiles/sql.ts, lib/views/datafiles/tables.ts, lib/oql.ts", commit: BUILD_COMMIT },
    verification: "Counts and a listing: the frequencies are the queries' counts divided, so there is no script — the queries are the numbers." };
}
