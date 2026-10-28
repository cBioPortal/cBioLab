// The cutpoint view's SQL: what its runner (run.ts) asks each participant's database for.
// cutpoint: a numeric marker against a survival endpoint, per patient
import { survivalMonthsSql, survivalEventSql } from "../../survival-sql.ts";
import { pidOf } from "../../federation-views.ts";
import { finiteSql } from "../../sql-number.ts";
import { sq } from "../../compiler.ts";
import { clinicalTable } from "../../custom-data.ts";
import { patientSql, type PatientSql } from "../../sql-kinds.ts";
import { inCohortSamples, inCohortPatients, bareSampleId } from "../../cohort2.ts";

/** A clinical row of the cohort: a sample row by its sample, a patient row by its patient. */
function inCohortClinical(study: string): string {
  return "(type = 'sample' AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) +
    " OR type = 'patient' AND " + inCohortPatients(pidOf("patient_unique_id", study)) + ")";
}

/**
 * One row per cohort patient with a survival time: months `m`, event `ev`, the marker `v` — the
 * patient's value, or for a sample attribute the value of the patient's first cohort sample by
 * sample id — and, with `stratum`, that attribute's value read the same way as `s`. Values only, in no
 * particular order: the patient id joins the CTEs and is never returned. Run only through
 * PatientLevelResolver.viewRows, since a permutation test needs each patient's pair.
 */
export function cutpointRowsSql(cohortSql: string, study: string, db: string,
  o: { attribute: string; months: string; status: string; stratum?: string | null; assay?: { profileType: string; entity: string } }): PatientSql {
  for (const a of [o.assay ? null : o.attribute, o.stratum, o.months, o.status]) if (a && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study);
  const attrs = [...(o.assay ? [] : [o.attribute]), ...(o.stratum ? [o.stratum] : [])];
  // a generic-assay marker: the patient's own value, or its first cohort sample with a numeric value, by sample id
  const assay = o.assay
    ? "ga AS (\n" +
      "  SELECT " + pid + " AS pid, argMin(" + finiteSql("value") + ", sample_unique_id) AS v\n" +
      "  FROM " + db + ".generic_assay_data_derived\n" +
      "  WHERE profile_type = " + sq(o.assay.profileType) + " AND profile_stable_id = " + sq(study + "_" + o.assay.profileType) +
      " AND entity_stable_id = " + sq(o.assay.entity) + "\n" +
      "    AND " + finiteSql("value") + " IS NOT NULL\n" +
      "    AND (patient_level = 1 AND " + inCohortPatients(pid) + " OR patient_level = 0 AND " + inCohortSamples(bareSampleId("sample_unique_id", study)) + ")\n" +
      "  GROUP BY pid\n" +
      ")" + (attrs.length ? "," : "") + "\n"
    : "";
  return patientSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + survivalMonthsSql("anyIf(attribute_value, attribute_name = " + sq(o.months) + ")", "anyIf(attribute_value, attribute_name = " + sq(o.status) + ")") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(o.status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [o.months, o.status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN (" + sq(o.months) + ", " + sq(o.status) + ")\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    assay +
    (attrs.length ? "val AS (\n" +
    "  SELECT " + pid + " AS pid" +
    (o.assay ? "" : ",\n         " + finiteSql("argMinIf(attribute_value, sample_unique_id, attribute_name = " + sq(o.attribute) + ")") + " AS v") +
    (o.stratum ? ",\n         argMinIf(trimBoth(attribute_value), sample_unique_id, attribute_name = " + sq(o.stratum) + ") AS s" : "") + "\n" +
    "  FROM " + clinicalTable(db, attrs) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + attrs.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
    "    AND " + inCohortClinical(study) + "\n" +
    "  GROUP BY pid\n" +
    ")\n" : "") +
    "SELECT os.months AS m, " + survivalEventSql("os.status") + " AS ev, " + (o.assay ? "ga.v" : "val.v") + " AS v" + (o.stratum ? ", val.s AS s" : "") + "\n" +
    "FROM os" + (o.assay ? " LEFT JOIN ga ON ga.pid = os.pid" : "") + (attrs.length ? " LEFT JOIN val ON val.pid = os.pid" : "") + "\n" +
    "WHERE os.months IS NOT NULL AND os.months >= 0"
  ));
}
