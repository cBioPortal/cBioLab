// The server half of the Cell Explorer links (lib/cell-explorer.ts): a cohort's patients as the
// dataset's donor ids, and donor ids back to patients.
//
// Both directions name patients, so both run only against a patient-level instance of the study
// (patientLevelConn, cohortMembership) — the entitlement the clinical table and the timeline use.
// The donor ids a link carries are the dataset's own public ids (its CELLxGENE metadata).
import { chQueryRows, registerChExternal, withChContext } from "./ch.ts";
import { sq } from "./compiler.ts";
import { clinicalTable, tsvField } from "./custom-data.ts";
import { patientLevelConn } from "./federation.ts";
import { cohortMembership } from "./custom-data-server.ts";
import { resolveDocCohorts } from "./analysis.ts";
import { CELL_EXPLORER_DATASETS, CELL_EXPLORER_MAX_DONORS, cellExplorerFor, cellExplorerUrl, donorsFromInput, type CellExplorerDataset } from "./cell-explorer.ts";
import type { CohortDef } from "./types.ts";

function datasetFor(study: string): CellExplorerDataset {
  const d = cellExplorerFor(study);
  if (!d) throw new Error(study + " has no single-cell dataset in Cell Explorer; the studies that do: " +
    CELL_EXPLORER_DATASETS.map((x) => x.study).join(", "));
  return d;
}

/** (patient, donor) for the study's patients whose `by` side is in `ids` */
async function donorPairs(d: CellExplorerDataset, by: "patient" | "donor", ids: string[]): Promise<{ patient: string; donor: string }[]> {
  const conn = await patientLevelConn(d.study, "a Cell Explorer link names patients");
  if (!ids.length) return [];
  const patientCol = "replaceOne(patient_unique_id, " + sq(d.study + "_") + ", '')";
  if (!d.patientAttribute) {
    // the donor id is the patient id: keep the ids the study has
    const r = await withChContext({}, async () => {
      registerChExternal({ name: "_ids", structure: "id String", data: ids.map(tsvField).join("\n") + "\n" });
      return chQueryRows("SELECT DISTINCT patient_stable_id FROM " + conn.db + ".sample_derived\n" +
        "WHERE cancer_study_identifier = " + sq(d.study) + " AND patient_stable_id IN (SELECT id FROM _ids)", conn);
    });
    return (r.rows as string[][]).map(([p]) => ({ patient: p, donor: p }));
  }
  const r = await withChContext({}, async () => {
    registerChExternal({ name: "_ids", structure: "id String", data: ids.map(tsvField).join("\n") + "\n" });
    return chQueryRows("SELECT DISTINCT " + patientCol + " AS patient, attribute_value AS donor\n" +
      "FROM " + clinicalTable(conn.db, [d.patientAttribute!]) + "\n" +
      "WHERE cancer_study_identifier = " + sq(d.study) + " AND attribute_name = " + sq(d.patientAttribute!) + " AND type = 'patient'\n" +
      "  AND " + (by === "patient" ? patientCol : "attribute_value") + " IN (SELECT id FROM _ids)", conn);
  });
  return (r.rows as string[][]).map(([patient, donor]) => ({ patient, donor }));
}

export interface CellsLink {
  url: string; dataset: string; label: string; study: string;
  /** the cohort's patients in the study, and how many of them are donors in the dataset */
  patients: number; donors: number;
}

/** A link opening the cells of one of a document's cohorts in Cell Explorer. */
export async function cohortCellsLink(input: { doc: unknown; cohort: string }): Promise<CellsLink> {
  const { doc, docStudy } = await resolveDocCohorts(input.doc);
  const def = doc.cohorts?.[input.cohort] as (CohortDef & { study?: string }) | undefined;
  if (!def) throw new Error("no cohort “" + input.cohort + "”; have " + Object.keys(doc.cohorts || {}).join(", "));
  const study = def.study || docStudy;
  const d = datasetFor(study);
  const [m] = await cohortMembership(def, [study]);
  if (!m.members.length) throw new Error("“" + input.cohort + "” has no patients in " + study);
  const pairs = await donorPairs(d, "patient", m.members);
  if (!pairs.length) throw new Error("none of the " + m.members.length + " patients of “" + input.cohort + "” is a donor in " + d.label);
  const donors = [...new Set(pairs.map((x) => x.donor))].sort();
  if (donors.length > CELL_EXPLORER_MAX_DONORS)
    throw new Error("“" + input.cohort + "” has " + donors.length + " donors in " + d.label + "; a Cell Explorer link names at most " + CELL_EXPLORER_MAX_DONORS);
  return { url: cellExplorerUrl(d, donors), dataset: d.dataset, label: d.label, study, patients: m.members.length, donors: donors.length };
}

export interface CellsCohort {
  /** the cohort: the matched patients as an explicit list */
  def: CohortDef;
  study: string; from: "link" | "list";
  donors: number; patients: number;
  /** donor ids pasted that are not a patient of the study */
  unmatched: string[];
}

/** A cohort from Cell Explorer: the patients behind a link's (or a list's) donor ids. */
export async function cohortFromCells(input: { study: string; text: string }): Promise<CellsCohort> {
  const d = datasetFor(String(input.study || ""));
  const { donors, from } = donorsFromInput(d, input.text);
  if (donors.length > CELL_EXPLORER_MAX_DONORS)
    throw new Error("that names " + donors.length + " donors; a cohort from Cell Explorer takes at most " + CELL_EXPLORER_MAX_DONORS);
  const pairs = await donorPairs(d, "donor", donors);
  const found = new Set(pairs.map((x) => x.donor));
  const unmatched = donors.filter((x) => !found.has(x));
  const patients = [...new Set(pairs.map((x) => x.patient))].sort();
  if (!patients.length) throw new Error("none of the " + donors.length + " ids is a donor of " + d.study + (unmatched.length ? " (e.g. " + unmatched.slice(0, 3).join(", ") + ")" : ""));
  return {
    def: { all: [{ kind: "patientList", ids: patients.map((p) => d.study + ":" + p) }] },
    study: d.study, from, donors: donors.length, patients: patients.length, unmatched
  };
}
