// The sv view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";
import type { SvProfiled } from "./types.ts";

export function svMethod(t: { genes: string[]; oncokbPin: string | null; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number; profiled: SvProfiled[] }): MethodRecord {
  const genes = t.genes.join(", ");
  const steps = [
    ...tableSteps({ label: "sv", what: "structural variants of " + genes, queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
      source: "every call in the study's structural-variant profile, in each cohort's samples, whose gene 1 or gene 2 is " + (t.genes.length > 1 ? "one of " : "") + genes +
        " (matched by Entrez id, as the portal asks), once however many of them it involves, with the sample's CANCER_TYPE_DETAILED where recorded" +
        (t.oncokbPin ? " and the stronger of the two partners' OncoKB " + t.oncokbPin + " fusion calls" : "") + ".",
      order: (t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + ", missing last" : (t.oncokbPin ? "drivers first, then " : "") + "by gene 1, then gene 2") + ", then sample" }),
    {
      kind: "fetch" as const, title: "Count the samples profiled for each gene's structural variants",
      detail: "The sv:profiled query above, per cohort and study: the cohort's samples; those whose structural-variant panel lists the gene (or is whole-exome); " +
        "those with a call involving it; and of those, the profiled. A sample not profiled contributes no row and is not read as having none.",
      params: t.profiled.map((p) => [p.cohort + " · " + p.study + " · " + p.gene, p.altered + " with a call · " + p.profiled + " profiled · " + p.samples + " samples"] as [string, string]),
    },
  ];
  return { steps, implementation: { functions: ["svRowSource", "svProfiledSql", "pageSql", "countsSql"], file: "lib/sv-table.ts, lib/views/sv/sql.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing and the counts its caveat names: no statistic is computed, so there is no script — the queries are the numbers." };
}
