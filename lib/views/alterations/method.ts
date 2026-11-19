// The alterations view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function alterationsMethod(t: { cohorts: string[]; oncokbPin: string | null; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number;
  patient: { study: string; id: string } | null; tables: { name: string; total: number; all: number; queryText: string }[];
  /** which of the patient's samples the tables (and the list's counts) read */
  samples: "patient" | "cohort";
  /** the Mutations and CNA tables' rows: every one, or only genes profiled in every sample in view */
  genesProfiled?: "any" | "all"; mrnaProfile?: string | null }): MethodRecord {
  const which = t.samples === "cohort" ? "the patient's samples that are in the cohort (the other samples are left out)" : "the patient's samples";
  const steps = tableSteps({ label: "alterations", what: "patients", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every patient of each cohort, with the count of " + which + " and how many rows each of the three tables lists for them over those samples (a mutation, a gene's deep copy-number call, a structural variant — each counted once however many samples carry it).",
    order: t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + " with missing values last, then patient id" : "patients with any alteration first, then by patient id" });
  if (t.patient) steps.push({
    kind: "fetch" as const, title: "Read " + t.patient.id + "'s three tables",
    detail: "The alterations:mutations, alterations:cna and alterations:sv queries above, each paged, searched, filtered and sorted in the database like any table view. " +
      "Each table reads " + which + ". Mutations: every called mutation of those samples (uncalled calls left out), one row per variant with the samples carrying it, each sample's reads and allele frequency " +
      "(variant / (variant + reference) reads; Allele Freq is the highest of them, and sorts by the samples' frequencies in sample order, one by one, a missing one last), and the gene's deep copy-number calls in those samples (Copy #). " +
      "Copy-number alterations: the deep calls (AMP, HOMDEL), one row per gene and call. Structural variants: one row per event as the portal keys it (both genes, positions and chromosomes and the class, sorted, so A–B and B–A are one row), its fields the first record's, the highest read counts among its samples; the patient list counts them the same way. " +
      (t.genesProfiled === "all" ? "The Mutations and CNA tables keep only rows whose gene every sample in view was profiled for (a panel of the sample's for that data holds the gene, or it is whole-exome/genome); rows off a sample's panel are left out. " : "") +
      (t.mrnaProfile ? "mRNA Expr. (one sample in view): the gene's percentile in that sample within the study's " + t.mrnaProfile + " profile, the first of its profiles matching rna_seq…_zscores as the portal picks it — " +
        "the sample's z-score ranked among every sample's numeric value of the gene there, ties at the highest rank (the values at or below it), as rank ÷ n × 100 to 2 places, half up; the cell writes it rounded to a whole percent. " : "") +
      "Cohort % is the share of the study's samples profiled for the gene (by their gene panel) with any mutation in it, or with the same copy-number call" +
      (t.oncokbPin ? "; the annotation is the OncoKB " + t.oncokbPin + " call for the protein change, or for AMPLIFICATION / DELETION" : "") + ".",
    params: t.tables.map((x) => [x.name, (x.queryText ? x.total.toLocaleString("en-US") + " of " : "") + x.all.toLocaleString("en-US") + " rows" + (x.queryText ? " (kept: " + x.queryText + ")" : "")] as [string, string]),
  });
  return { steps, implementation: { functions: ["runAlterations", "alterationPatientRowSource", "patientMutationsSource", "patientCnaSource", "patientSvSource", "pageSql", "countsSql", "rankSql"],
    file: "lib/views/alterations/run.ts, lib/patient-alterations.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing: no statistic is computed, so there is no script — the queries are the numbers." };
}
