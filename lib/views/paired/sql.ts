// The paired view's SQL: what its runner (run.ts) asks each participant's database for.
import { sideCountsTail, pidOf } from "../../federation-views.ts";
import { clinicalValueFoldSql } from "../../event-names.ts";
import { sq } from "../../compiler.ts";
import { clinicalTable } from "../../custom-data.ts";

/**
 * Per gene, among patients with a sample on each side AND profiled for the gene on each side
 * (by that side's own panels — a gene one side never assayed says nothing about concordance):
 * altered on both sides, on side a only, on side b only. A patient with several samples on a
 * side is altered on that side if any of them is. Counts only.
 *
 * `genes` null scans: every gene with a counted alteration in a paired patient's sample, and only
 * the genes with at least one patient altered on some side come back (a gene altered nowhere
 * carries no information about concordance or direction).
 */
export function pairedCountsSql(cohortSql: string, study: string, db: string, genes: string[] | null, by: PairBy,
  pin: string | null, measure: "driver" | "any"): string {
  return pairedSidesCtes(cohortSql, study, db, by) + ",\n" + sideCountsTail(study, db, genes, pin, measure);
}

/** How many of the cohort's patients have a sample on each side, and how many samples each side holds. */
export function pairedPatientsSql(cohortSql: string, study: string, db: string, by: PairBy): string {
  return (
    pairedSidesCtes(cohortSql, study, db, by) + "\n" +
    "SELECT uniqExact(pid) AS patients, countIf(side = 'a') AS a_samples, countIf(side = 'b') AS b_samples FROM ps"
  );
}

// ---------------------------------------------------------------------------
// paired: one patient's two kinds of sample, gene by gene

export interface PairBy { attribute: string; a: string[]; b: string[] }

/**
 * The cohort's samples split into side 'a' and side 'b' by a SAMPLE-level attribute (folded on
 * case and whitespace in both the data and the values, the one fold every clinical predicate
 * uses), restricted to patients with at least one sample on each side.
 */
function pairedSidesCtes(cohortSql: string, study: string, db: string, by: PairBy): string {
  const fold = (x: string) => clinicalValueFoldSql(x);
  const lit = (vs: string[]) => vs.map((v) => fold(sq(v))).join(",");
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "sides AS (\n" +
    "  SELECT sample_unique_id AS suid, " + pidOf("patient_unique_id", study) + " AS pid,\n" +
    "         multiIf(" + fold("attribute_value") + " IN (" + lit(by.a) + "), 'a', " + fold("attribute_value") + " IN (" + lit(by.b) + "), 'b', '') AS side\n" +
    "  FROM " + clinicalTable(db, [by.attribute]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name = " + sq(by.attribute) + "\n" +
    "    AND " + pidOf("patient_unique_id", study) + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),\n" +
    "ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired))"
  );
}
