// The Columns menu's Freq for the mutation table's clinical columns (MUT-STM-15): how many of the queried
// samples have a value of each attribute, as the portal counts them (ResultsViewPageStore
// clinicalAttributeIdToAvailableSampleCount, the clinical-attributes/counts endpoint): a sample attribute by
// the sample, a patient attribute by every sample of a patient that has one (cbioportal.org, lgg_ucsf_2014:
// SEX, a patient attribute, 61 of 61 samples over 23 patients). An aggregate: counts only.
import { sq } from "./compiler.ts";
import { clinicalTable } from "./custom-data.ts";
import { aggregateSql, type AggregateSql } from "./sql-kinds.ts";

/**
 * per attribute (`a`), the cohort's samples with a value (`n`), and the cohort's samples (`total`) in a row of its own
 * with `a` ''. Each attribute is looked for at both levels: a study records it as a sample or a patient attribute, and
 * two studies may differ, so each counts at its own (the portal's counts endpoint asks each study about its own).
 */
export function clinicalFreqSql(cohortSql: string, study: string, db: string, ids: string[]): AggregateSql {
  const pre = sq(study + "_");
  const list = ids.length ? " AND attribute_name IN (" + ids.map(sq).join(", ") + ")" : " AND 0";
  const from = (per: "patient" | "sample") =>
    "SELECT replaceOne(" + (per === "sample" ? "sample_unique_id" : "patient_unique_id") + ", " + pre + ", '') AS k, attribute_name AS a\n" +
    "    FROM " + clinicalTable(db, ids) + "\n" +
    "    WHERE cancer_study_identifier = " + sq(study) + " AND type = " + sq(per) + " AND attribute_value != ''" + list + "\n";
  return aggregateSql(
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT '' AS a, uniqExact(sid) AS n FROM cohort\n" +
    "UNION ALL\n" +
    "SELECT a, uniqExact(sid) AS n FROM (\n" +
    "  SELECT v.a AS a, c.sid AS sid FROM cohort AS c JOIN (" + from("sample") + "  ) AS v ON v.k = c.sid\n" +
    "  UNION ALL\n" +
    "  SELECT v.a AS a, c.sid AS sid FROM cohort AS c JOIN (" + from("patient") + "  ) AS v ON v.k = c.pid\n" +
    ") GROUP BY a\n");
}

/**
 * The menu's Freq, in percent, from each study's counts summed over the queried samples (the portal's
 * 100 × count ÷ samples); an attribute no study counted is 0.
 */
export function clinicalFreq(perStudy: Record<string, unknown>[][], ids: string[]): Record<string, number> {
  let total = 0;
  const n = new Map<string, number>();
  for (const rows of perStudy) for (const r of rows) {
    const a = String(r.a ?? ""), k = Number(r.n) || 0;
    if (a === "") total += k; else n.set(a, (n.get(a) || 0) + k);
  }
  return Object.fromEntries(ids.map((id) => [id, total ? (100 * (n.get(id) || 0)) / total : 0]));
}
