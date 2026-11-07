// The signatures view's tables: the cohort's patients with mutational-signature values, and one
// patient's values in every signature profile of their study. Every row names a patient, so these
// are row sources (lib/table-query.ts), run only through PatientLevelResolver's rows* methods — a
// participant that may not disclose a patient has no such method.
import { sq } from "../../compiler.ts";
import { inCohortPatients, inCohortSamples } from "../../cohort2.ts";
import { finiteSql } from "../../sql-number.ts";
import type { QueryColumn, RowSource } from "../../table-query.ts";
import type { TablePart } from "../../mutation-table.ts";

const str = (x: string) => "ifNull(toString(" + x + "), '')";
const num = (x: string) => "CAST(" + x + " AS Nullable(Float64))";
const number = (id: string, name: string): QueryColumn => ({ id, name, numeric: true, text: str(id), num: num(id) });

/** The patient list's columns. */
export const SIGNATURE_PATIENT_COLUMNS: QueryColumn[] = [
  { id: "patient", name: "Patient ID", numeric: false, text: "patient" },
  number("samples", "Samples"), number("profiled", "Samples with signatures"),
  { id: "types", name: "Signature types", numeric: false, text: "types" },
];
export const SIGNATURE_PATIENT_DEFAULT_COLUMNS = ["patient", "samples", "profiled", "types"];

/** One (cohort, study) part of the list, with the study's contribution profiles the list counts. */
export type SignaturePart = TablePart & { profiles: string[] };

/** a profile-type list for `IN (…)`; never empty, so a study holding none matches nothing */
const inList = (xs: string[]) => "(" + (xs.length ? xs.map(sq).join(", ") : "''") + ")";
/** a sample's or a patient's id without the study prefix */
const bare = (col: string, study: string) => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";
/** the part's samples the view reads: every sample of the cohort's patients, or only the cohort's own */
const scopeOf = (study: string, cte: string, samples: "patient" | "cohort") => samples === "cohort"
  ? inCohortSamples(bare("sample_unique_id", study), cte) : inCohortPatients(bare("patient_unique_id", study), cte);

/**
 * Every (cohort, study) part's patients, one row each: how many samples they have (as the view reads
 * them), how many of those have a value in one of the part's contribution profiles, and which
 * signature types they have values in. With `drawable`, only patients with a value — the portal shows
 * its Mutational Signatures tab only then; without, every patient (what says why one is left out).
 * Most samples with signatures first, then by patient id.
 */
export function signaturePatientsSource(parts: SignaturePart[], db: string, samples: "patient" | "cohort" = "patient", drawable = true): RowSource {
  if (!parts.length) throw new Error("signaturePatientsSource needs at least one part");
  const ctes: string[] = [], rows: string[] = [];
  parts.forEach((p, i) => {
    const st = sq(p.study);
    ctes.push(
      "c" + i + " AS (" + p.cohortSql + "),\n" +
      "sm" + i + " AS (\n" +
      "  SELECT " + bare("patient_unique_id", p.study) + " AS pid, uniqExact(sample_unique_id) AS n FROM " + db + ".sample_derived\n" +
      "  WHERE cancer_study_identifier = " + st + " AND " + scopeOf(p.study, "c" + i, samples) + "\n" +
      "  GROUP BY pid\n" +
      "),\n" +
      "sg" + i + " AS (\n" +
      "  SELECT " + bare("patient_unique_id", p.study) + " AS pid, uniqExact(sample_unique_id) AS n,\n" +
      "         arrayStringConcat(arraySort(groupUniqArray(replaceRegexpOne(profile_type, '^.*_', ''))), ', ') AS types\n" +
      "  FROM " + db + ".generic_assay_data_derived\n" +
      "  WHERE profile_type IN " + inList(p.profiles) + " AND profile_stable_id IN " + inList(p.profiles.map((x) => p.study + "_" + x)) + "\n" +
      "    AND " + finiteSql("value") + " IS NOT NULL AND " + scopeOf(p.study, "c" + i, samples) + "\n" +
      "  GROUP BY pid\n" +
      "),\n");
    rows.push(
      "  SELECT * FROM (SELECT " + sq(p.cohort) + " AS cohort, " + st + " AS study, " + i + " AS ord, c.pid AS patient, '' AS sample,\n" +
      "         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(sg.n, 0)) AS profiled, ifNull(sg.types, '') AS types\n" +
      "  FROM (SELECT DISTINCT pid FROM c" + i + ") AS c\n" +
      "  LEFT JOIN sm" + i + " AS sm ON sm.pid = c.pid LEFT JOIN sg" + i + " AS sg ON sg.pid = c.pid)" +
      (drawable ? " WHERE profiled > 0" : "") + "\n");
  });
  return {
    with: "WITH " + ctes.join("") + "rows AS (\n" + rows.join("  UNION ALL\n") + ")\n",
    columns: SIGNATURE_PATIENT_COLUMNS,
    select: "cohort, study, patient, sample, samples, profiled, types",
    defaultOrder: "profiled DESC, patient",
    tiebreak: "patient, ord",
  };
}

/**
 * One patient's values in `profiles` (signature profile types of the part's study), one row per
 * profile and entity: the entity's NAME, DESCRIPTION and URL (generic_entity_properties), and its
 * value in each of the patient's samples that has a row — `vals`, (sample, value) pairs, the value
 * NULL where it is not a number (NA). With `samples: "cohort"`, only the cohort's samples.
 */
export function signatureValuesSource(p: TablePart, patient: string, db: string, profiles: string[], samples: "patient" | "cohort" = "patient"): RowSource {
  const st = sq(p.study);
  return {
    with: "WITH " + (samples === "cohort" ? "ck AS (" + p.cohortSql + "),\n" : "") +
      "v AS (SELECT profile_type AS pt, entity_stable_id AS entity, " + bare("sample_unique_id", p.study) + " AS sid, " + finiteSql("value") + " AS x\n" +
      "  FROM " + db + ".generic_assay_data_derived\n" +
      "  WHERE profile_type IN " + inList(profiles) + " AND profile_stable_id IN " + inList(profiles.map((x) => p.study + "_" + x)) + "\n" +
      "    AND patient_unique_id = " + sq(p.study + "_" + patient) + (samples === "cohort" ? " AND " + inCohortSamples(bare("sample_unique_id", p.study), "ck") : "") + "),\n" +
      "props AS (SELECT ge.stable_id AS entity, anyIf(pr.value, pr.name = 'NAME') AS name, anyIf(pr.value, pr.name = 'DESCRIPTION') AS description,\n" +
      "         anyIf(pr.value, pr.name = 'URL') AS url\n" +
      "  FROM " + db + ".generic_entity_properties pr JOIN " + db + ".genetic_entity ge ON ge.id = pr.genetic_entity_id\n" +
      "  WHERE ge.stable_id IN (SELECT entity FROM v) AND pr.name IN ('NAME', 'DESCRIPTION', 'URL') GROUP BY entity),\n" +
      "a AS (SELECT pt, entity, arraySort(x -> x.1, groupArray(tuple(sid, x))) AS vals FROM v GROUP BY pt, entity),\n" +
      "rows AS (SELECT " + sq(p.cohort) + " AS cohort, " + st + " AS study, 0 AS ord, " + sq(patient) + " AS patient,\n" +
      "         a.pt AS profile, a.entity AS entity, ifNull(props.name, '') AS name, ifNull(props.description, '') AS description, ifNull(props.url, '') AS url, a.vals AS vals\n" +
      "  FROM a LEFT JOIN props ON props.entity = a.entity)\n",
    columns: [{ id: "profile", name: "Profile", numeric: false, text: "profile" }, { id: "entity", name: "Entity", numeric: false, text: "entity" }],
    select: "*",
    defaultOrder: "profile, entity",
    tiebreak: "profile, entity",
  };
}
