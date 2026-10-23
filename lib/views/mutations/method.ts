// The mutations view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function mutationsMethod(t: { gene: string; cohorts: string[]; oncokbPin: string | null; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number }): MethodRecord {
  const steps = tableSteps({ label: "mutations", what: t.gene + " mutation calls", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every called " + t.gene + " mutation in each cohort's samples (uncalled calls left out), with the sample's CANCER_TYPE_DETAILED and MUTATION_COUNT where recorded" +
      (t.oncokbPin ? " and the OncoKB " + t.oncokbPin + " call for its protein change" : "") + "; allele frequency = variant / (variant + reference) reads.",
    order: (t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + ", missing last" : "drivers first, then by codon") + ", then sample" });
  return { steps, implementation: { functions: ["mutationRowSource", "pageSql", "countsSql"], file: "lib/mutation-table.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing: no statistic is computed, so there is no script — the queries are the numbers." };
}
