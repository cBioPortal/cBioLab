// The alterations view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function alterationsMethod(t: { cohorts: string[]; oncokbPin: string | null; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number;
  patient: { study: string; id: string } | null; tables: { name: string; total: number; all: number; queryText: string }[] }): MethodRecord {
  const steps = tableSteps({ label: "alterations", what: "patients", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every patient of each cohort, with their sample count and how many rows each of the three tables lists for them (a mutation, a gene's deep copy-number call, a structural variant — each counted once however many samples carry it).",
    order: t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + " with missing values last, then patient id" : "patients with any alteration first, then by patient id" });
  if (t.patient) steps.push({
    kind: "fetch" as const, title: "Read " + t.patient.id + "'s three tables",
    detail: "The alterations:mutations, alterations:cna and alterations:sv queries above, each paged, searched, filtered and sorted in the database like any table view. " +
      "Mutations: every called mutation of the patient's samples (uncalled calls left out), one row per variant with the samples carrying it, the highest allele frequency among them " +
      "(variant / (variant + reference) reads) with that sample's reads, and the gene's deep copy-number calls in the patient (Copy #). " +
      "Copy-number alterations: the deep calls (AMP, HOMDEL), one row per gene and call. Structural variants: one row per event (both genes and breakpoints, class, event info), the highest read counts among its samples. " +
      "Cohort % is the share of the study's samples profiled for the gene (by their gene panel) with any mutation in it, or with the same copy-number call" +
      (t.oncokbPin ? "; the annotation is the OncoKB " + t.oncokbPin + " call for the protein change, or for AMPLIFICATION / DELETION" : "") + ".",
    params: t.tables.map((x) => [x.name, (x.queryText ? x.total.toLocaleString("en-US") + " of " : "") + x.all.toLocaleString("en-US") + " rows" + (x.queryText ? " (kept: " + x.queryText + ")" : "")] as [string, string]),
  });
  return { steps, implementation: { functions: ["runAlterations", "alterationPatientRowSource", "patientMutationsSource", "patientCnaSource", "patientSvSource", "pageSql", "countsSql", "rankSql"],
    file: "lib/views/alterations/run.ts, lib/patient-alterations.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing: no statistic is computed, so there is no script — the queries are the numbers." };
}
