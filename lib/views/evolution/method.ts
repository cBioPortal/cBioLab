// The evolution view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function evolutionMethod(t: { cohorts: string[]; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number;
  patient: { study: string; id: string }; samples: number; table: { total: number; all: number; queryText: string };
  /** mutations drawn, or null when the figure is not drawn (past its limit) */
  drawn: number | null; noVaf: number }): MethodRecord {
  const steps = tableSteps({ label: "evolution", what: "patients", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every patient of each cohort with two or more samples and at least one called mutation with allele counts (variant reads above zero, and reference reads), with their sample count, called mutations and those with allele counts.",
    order: t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + " with missing values last, then patient id" : "most samples first, then by patient id" });
  steps.push({
    kind: "fetch" as const, title: "Read " + t.patient.id + "'s samples and mutations",
    detail: "The patient's samples (evolution:samples, with the gene panel each was sequenced with for mutations) and timeline (for each sample's collection day), numbered in collection order; then evolution:mutations: " +
      "every mutation called in any of the patient's samples (fusions left out), merged across samples by gene, protein change and genomic position as the portal merges them, " +
      "with its state in every sample — called (VAF = variant reads ÷ (variant + reference reads)), called without allele counts, uncalled with variant reads (the study's uncalled-mutations profile; drawn with its VAF), " +
      "not found in a sample sequenced for the gene (VAF 0), or not profiled (the sample's panel omits the gene, or it was not sequenced for mutations: no VAF). " +
      "The figure draws every mutation the table's query keeps that has a VAF in some sample where it was called.",
    params: [["samples", String(t.samples)],
      ["mutations", (t.table.queryText ? t.table.total.toLocaleString("en-US") + " of " : "") + t.table.all.toLocaleString("en-US") + (t.table.queryText ? " (kept: " + t.table.queryText + ")" : "")],
      ["drawn", t.drawn == null ? "none: past the figure's limit" : t.drawn.toLocaleString("en-US") + (t.noVaf ? " (" + t.noVaf + " without allele counts listed only)" : "")]],
  });
  return { steps, implementation: { functions: ["runEvolution", "evolutionPatientsSource", "evolutionSamplesSource", "evolutionMutationsSource", "pageSql", "countsSql", "rankSql"],
    file: "lib/views/evolution/run.ts, lib/views/evolution/sql.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing of one patient's reads: each VAF is the ratio of two counts the query returns, with nothing else computed, so there is no script — the queries are the numbers." };
}
