// Generic-assay data as every reader of it sees it: which values mean "not measured", how one
// entity's values become a case's value, and how a profile's entities are found by name. A
// generic-assay profile is many entities (signatures, chromosome arms, probes, phosphosites,
// compounds) per sample, stored as text in generic_assay_data_derived, whose sort key leads with
// (profile_type, entity_stable_id), so reading one entity of one profile is cheap and reading a
// whole profile is not. Browser-safe: it only builds SQL text.
import { sq } from "./compiler.ts";
import { finiteSql } from "./sql-number.ts";
import { aggregateSql, type AggregateSql } from "./sql-kinds.ts";

/** values a categorical assay uses for "not called": never a category, counted apart where a reader reports them */
export const ASSAY_MISSING_VALUES: readonly string[] = ["", "NA", "N/A", "NaN", "nan", "null", "NULL"];
/** a categorical datatype as cBioPortal declares it; every other generic-assay datatype holds numbers */
export const isCategoricalAssay = (datatype: string): boolean => /^(CATEGORICAL|BINARY)$/i.test(datatype);
/** an entity's stable id as a document may name it */
export const ENTITY_RE = /^[A-Za-z0-9_.:;()+\-/ ]{1,120}$/;

/**
 * One entity of one study's profile, a row per measurement: the sample (or, for a patient-level
 * profile, the patient, which the table stores in both id columns), the patient, and the value as
 * a finite number (`numeric`) or as its trimmed text with the "not called" values left out. A value
 * that is not a number (a limit like ">8", NA) has no row in the numeric form. Cohort-restricted
 * by `inCohort`, a condition on the row (assayInCohortSql is the cohort test).
 */
export function assayEntityRowsSql(o: { db: string; study: string; profileType: string; entity: string; numeric: boolean; inCohort: string }): string {
  const v = o.numeric ? finiteSql("value") : "trimBoth(value)";
  return "SELECT sample_unique_id, patient_unique_id, " + v + " AS av\n" +
    "  FROM " + o.db + ".generic_assay_data_derived\n" +
    "  WHERE profile_type = " + sq(o.profileType) + " AND entity_stable_id = " + sq(o.entity) +
    " AND profile_stable_id = " + sq(o.study + "_" + o.profileType) + "\n" +
    "    AND " + (o.numeric ? v + " IS NOT NULL" : v + " NOT IN (" + ASSAY_MISSING_VALUES.map(sq).join(", ") + ")") +
    " AND " + o.inCohort;
}

/**
 * Whether a generic_assay_data_derived row (column names unqualified, or prefixed by `alias`) is in
 * the cohort CTE `cte`: a sample-level row by its sample, a patient-level row (the patient in both
 * id columns) by its patient. The same test as cohort2.ts's inCohortSamples / inCohortPatients, which
 * this module cannot import and stay browser-safe.
 */
export function assayInCohortSql(study: string, cte = "cohort", alias = ""): string {
  const col = (c: string) => "replaceOne(" + alias + c + ", " + sq(study + "_") + ", '')";
  return "if(ifNull(" + alias + "patient_level, 0) = 1, " +
    col("patient_unique_id") + " IN (SELECT pid FROM " + cte + "), " +
    col("sample_unique_id") + " IN (SELECT sid FROM " + cte + "))";
}

/** at most this many entities come back from one search */
export const ENTITY_SEARCH_LIMIT = 50;

/**
 * A profile's entities matching `q` by stable id, display name (NAME, which for a methylation
 * probe is its genes, "TP53;WRAP53") or linked gene (GENE_SYMBOL), an exact gene first, with how
 * many match in all; an empty `q` lists the first of them. Metadata only: an entity is a
 * signature, an arm, a probe or a compound, never a patient.
 */
export function assayEntitySearchSql(study: string, db: string, profileType: string, q: string, limit = ENTITY_SEARCH_LIMIT): AggregateSql {
  const t = q.trim(), lit = sq(t), up = sq(t.toUpperCase());
  const match = t
    ? "WHERE positionCaseInsensitive(e.entity, " + lit + ") > 0 OR positionCaseInsensitive(pr.name, " + lit + ") > 0 OR upper(pr.gene) = " + up + "\n"
    : "";
  const exact = t ? "has(splitByChar(';', upper(pr.name)), " + up + ") OR upper(pr.gene) = " + up + " OR upper(e.entity) = " + up + " DESC, " : "";
  return aggregateSql(
    "WITH ents AS (SELECT entity_stable_id AS entity FROM " + db + ".generic_assay_profile_entity_derived\n" +
    "    WHERE profile_stable_id = " + sq(study + "_" + profileType) + "),\n" +
    "  props AS (SELECT ge.stable_id AS entity, anyIf(p.value, p.name = 'NAME') AS name, anyIf(p.value, p.name = 'GENE_SYMBOL') AS gene\n" +
    "    FROM " + db + ".generic_entity_properties p JOIN " + db + ".genetic_entity ge ON ge.id = p.genetic_entity_id\n" +
    "    WHERE ge.stable_id IN (SELECT entity FROM ents) AND p.name IN ('NAME', 'GENE_SYMBOL') GROUP BY entity)\n" +
    "SELECT e.entity AS entity, ifNull(pr.name, '') AS name, ifNull(pr.gene, '') AS gene, count() OVER () AS total\n" +
    "FROM ents e LEFT JOIN props pr ON pr.entity = e.entity\n" + match +
    "ORDER BY " + exact + "length(e.entity), e.entity LIMIT " + Math.max(1, Math.min(200, Math.floor(limit))));
}

/**
 * One entity's rows of the study's profile for the cohort, as a CTE pair (cohort, rows): a row per
 * in-cohort sample, or per in-cohort patient for a patient-level profile — `id` names that case.
 */
function cohortRowsCte(cohortSql: string, study: string, db: string, profileType: string, entity: string): string {
  return "WITH cohort AS (" + cohortSql + "),\n" +
    "rows AS (\n" +
    "  SELECT sample_unique_id AS id, value, datatype FROM " + db + ".generic_assay_data_derived\n" +
    "  WHERE profile_type = " + sq(profileType) + " AND profile_stable_id = " + sq(study + "_" + profileType) + "\n" +
    "    AND entity_stable_id = " + sq(entity) + "\n" +
    "    AND " + assayInCohortSql(study) + "\n" +
    ")\n";
}

/** The profile's datatype and, over the cohort's numeric values of one entity, their median and count. */
export function assayCohortMedianSql(cohortSql: string, study: string, db: string, profileType: string, entity: string): AggregateSql {
  return aggregateSql(cohortRowsCte(cohortSql, study, db, profileType, entity) +
    "SELECT any(datatype) AS dt, countIf(" + finiteSql("value") + " IS NOT NULL) AS n,\n" +
    "       quantileExactIf(0.5)(" + finiteSql("value") + ", " + finiteSql("value") + " IS NOT NULL) AS median FROM rows");
}

/** Each value of one categorical entity over the cohort, with how many of its cases (samples, or patients for a patient-level profile) take it; "not called" left out. */
export function assayCohortValuesSql(cohortSql: string, study: string, db: string, profileType: string, entity: string): AggregateSql {
  return aggregateSql(cohortRowsCte(cohortSql, study, db, profileType, entity) +
    "SELECT trimBoth(value) AS v, uniqExact(id) AS n FROM rows\n" +
    "WHERE trimBoth(value) NOT IN (" + ASSAY_MISSING_VALUES.map(sq).join(", ") + ")\nGROUP BY v");
}

/** How many entities the study's profile has. Metadata only. */
export function assayEntityCountSql(study: string, db: string, profileType: string): AggregateSql {
  return aggregateSql("SELECT count() AS n FROM " + db + ".generic_assay_profile_entity_derived WHERE profile_stable_id = " + sq(study + "_" + profileType));
}
