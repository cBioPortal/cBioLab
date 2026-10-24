// The assays view's SQL: what its runner (run.ts) asks each participant's database for.
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/** Per entity, over the cohort's samples (or patients, for a patient-level assay): n, Σv and Σv² of
 *  the values that read as numbers, and how many did not (a limit value like ">10", or NA). */
export function assayMomentsSql(cohortSql: string, study: string, db: string, profileType: string): AggregateSql {
  return aggregateSql((
    assayRowsCte(cohortSql, study, db, profileType) + "\n" +
    "SELECT entity, countIf(isFinite(toFloat64OrNull(value))) AS n,\n" +
    "       sumIf(toFloat64OrNull(value), isFinite(toFloat64OrNull(value))) AS sx,\n" +
    "       sumIf(pow(toFloat64OrNull(value), 2), isFinite(toFloat64OrNull(value))) AS sxx,\n" +
    "       countIf(NOT isFinite(ifNull(toFloat64OrNull(value), nan))) AS other\n" +
    "FROM rows GROUP BY entity"
  ));
}

/** Per entity and value: how many of the cohort's samples (or patients) take it. Counts only. */
export function assayValueCountsSql(cohortSql: string, study: string, db: string, profileType: string): AggregateSql {
  return aggregateSql(assayRowsCte(cohortSql, study, db, profileType) + "\nSELECT entity, value, count() AS n FROM rows GROUP BY entity, value");
}

/** The cohort's rows of one generic-assay profile. The profile type is the table's leading sort
 *  key, so only that profile's rows are read; the study's own profile id then picks its slice. */
function assayRowsCte(cohortSql: string, study: string, db: string, profileType: string): string {
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "rows AS (\n" +
    "  SELECT entity_stable_id AS entity, value FROM " + db + ".generic_assay_data_derived\n" +
    "  WHERE profile_type = " + sq(profileType) + "\n" +
    "    AND profile_stable_id = " + sq(study + "_" + profileType) + "\n" +
    "    AND patient_unique_id IN (SELECT concat(" + sq(study + "_") + ", pid) FROM cohort)\n" +
    ")"
  );
}
