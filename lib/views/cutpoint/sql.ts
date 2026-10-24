// The cutpoint view's SQL: what its runner (run.ts) asks each participant's database for.
// cutpoint: a numeric marker against a survival endpoint, per patient
import { pidOf } from "../../federation-views.ts";
import { finiteSql } from "../../sql-number.ts";
import { sq } from "../../compiler.ts";
import { clinicalTable } from "../../custom-data.ts";

/**
 * One row per cohort patient with a survival time: months `m`, event `ev`, the marker `v` — the
 * patient's value, or for a sample attribute the value of the patient's first sample by sample id
 * — and, with `stratum`, that attribute's value read the same way as `s`. Values only, in no
 * particular order: the patient id joins the CTEs and is never returned. Run only through
 * PatientLevelResolver.viewRows, since a permutation test needs each patient's pair.
 */
export function cutpointRowsSql(cohortSql: string, study: string, db: string,
  o: { attribute: string; months: string; status: string; stratum?: string | null }): string {
  for (const a of [o.attribute, o.stratum, o.months, o.status]) if (a && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study);
  const attrs = [o.attribute, ...(o.stratum ? [o.stratum] : [])];
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + finiteSql("anyIf(attribute_value, attribute_name = " + sq(o.months) + ")") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(o.status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [o.months, o.status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN (" + sq(o.months) + ", " + sq(o.status) + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "val AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + finiteSql("argMinIf(attribute_value, sample_unique_id, attribute_name = " + sq(o.attribute) + ")") + " AS v" +
    (o.stratum ? ",\n         argMinIf(trimBoth(attribute_value), sample_unique_id, attribute_name = " + sq(o.stratum) + ") AS s" : "") + "\n" +
    "  FROM " + clinicalTable(db, attrs) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + attrs.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT os.months AS m, if(os.status LIKE '1%', 1, 0) AS ev, val.v AS v" + (o.stratum ? ", val.s AS s" : "") + "\n" +
    "FROM os LEFT JOIN val ON val.pid = os.pid\n" +
    "WHERE os.months IS NOT NULL AND os.months >= 0"
  );
}
