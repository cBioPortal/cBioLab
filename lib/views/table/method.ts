// The table view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function tableMethod(t: { unit: "sample" | "patient"; cohorts: string[]; columns: number; query: unknown; queryText: string; sortName: string | null; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number }): MethodRecord {
  const desc = !!(t.query as { sort?: { desc?: boolean } })?.sort?.desc;
  const steps = tableSteps({ label: "table", what: t.unit + "s", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every " + t.unit + " of each cohort's patients" + (t.unit === "sample" ? " (from the study's sample list, so a sample with no sample attribute still has a row)" : "") +
      ", each with the value of each of the " + t.columns + " attributes as recorded — blank where none was.",
    order: (t.sortName ? "by " + t.sortName + (desc ? " descending" : "") + " with missing values last, then " : "by ") + "patient and sample id" });
  return { steps, implementation: { functions: ["clinicalRowSource", "pageSql", "countsSql"], file: "lib/clinical-table.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing: no statistic is computed, so there is no script — the queries are the numbers." };
}
