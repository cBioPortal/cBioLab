// The clinical data table: one row per sample (or patient) with every clinical attribute the study
// records — cBioPortal's Clinical Data tab. Its rows ARE patients, so the row query lives here,
// outside lib/federation*.ts's aggregate builders, and runs only through
// PatientLevelResolver.tableRows: a participant that may not disclose a patient has no such method.
import { sq } from "./compiler.ts";
import { clinicalTable, clinicalMetaTable } from "./custom-data.ts";

export interface TableColumn {
  id: string; name: string;
  /** recorded once per patient, or per sample */
  per: "patient" | "sample";
  numeric: boolean;
}

export interface TableSort { attribute: string; desc?: boolean }

/** At most this many attribute columns; the widest study in the warehouse has 170. */
export const TABLE_COLUMNS_MAX = 200;
/** Rows a download fetches per query. */
export const TABLE_CHUNK = 10000;

/** The study's clinical attributes, highest priority first (the portal's column order). Metadata only. */
export function tableAttributesSql(study: string, db: string): string {
  return "SELECT m.attr_id AS id, m.display_name AS name, m.datatype AS datatype, m.patient_attribute AS patient, toInt32OrZero(m.priority) AS priority\n" +
    "FROM " + clinicalMetaTable(db) + " m\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = m.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "ORDER BY priority DESC, name";
}

/** How one row's value of the sort attribute orders: numbers as numbers, missing last either way. */
function sortExpr(sort: TableSort | null, columns: TableColumn[]): string {
  if (!sort) return "";
  const col = columns.find((c) => c.id === sort.attribute);
  if (!col) return "";
  const v = "m[" + sq(col.id) + "]";
  return col.numeric
    ? "toFloat64OrNull(" + v + ") " + (sort.desc ? "DESC" : "ASC") + " NULLS LAST, "
    : "(" + v + " = '') ASC, " + v + " " + (sort.desc ? "DESC" : "ASC") + ", ";
}

/** One (cohort, study) part of a table: the cohort's SQL as that study's resolver compiles it. */
export interface TablePart { cohort: string; study: string; cohortSql: string }

/** Every part's rows — patient, sample, unit count and the attribute map — labelled and combined. */
function allRows(parts: TablePart[], db: string, unit: "sample" | "patient", columns: TableColumn[]): string {
  const attrsOf = (per: "patient" | "sample") => columns.filter((c) => c.per === per).map((c) => sq(c.id));
  const pAttrs = attrsOf("patient"), sAttrs = unit === "sample" ? attrsOf("sample") : [];
  const ctes: string[] = [], rows: string[] = [];
  parts.forEach((p, i) => {
    const pre = sq(p.study + "_");
    const inCohort = (col: string) => "replaceOne(" + col + ", " + pre + ", '') IN (SELECT pid FROM c" + i + ")";
    const values = (per: "patient" | "sample", attrs: string[]) =>
      "  SELECT " + (per === "patient" ? "patient_unique_id" : "sample_unique_id") + " AS k,\n" +
      "         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m\n" +
      "  FROM " + clinicalTable(db, columns.map((c) => c.id)) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(p.study) + " AND type = " + sq(per) +
      (attrs.length ? " AND attribute_name IN (" + attrs.join(",") + ")" : " AND 0") + "\n" +
      "    AND attribute_value != '' AND " + inCohort("patient_unique_id") + "\n" +
      "  GROUP BY k\n";
    const units = unit === "sample"
      ? "  SELECT patient_unique_id AS puid, sample_unique_id AS suid, 1 AS samples FROM " + db + ".sample_derived\n" +
        "  WHERE cancer_study_identifier = " + sq(p.study) + " AND " + inCohort("patient_unique_id") + "\n"
      : "  SELECT patient_unique_id AS puid, '' AS suid, uniqExact(sample_unique_id) AS samples FROM " + db + ".sample_derived\n" +
        "  WHERE cancer_study_identifier = " + sq(p.study) + " AND " + inCohort("patient_unique_id") + "\n" +
        "  GROUP BY puid\n";
    ctes.push("c" + i + " AS (" + p.cohortSql + "),\nu" + i + " AS (\n" + units + "),\npv" + i + " AS (\n" + values("patient", pAttrs) + "),\nsv" + i + " AS (\n" + values("sample", sAttrs) + "),\n");
    rows.push("  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord,\n" +
      "         replaceOne(u.puid, " + pre + ", '') AS patient, replaceOne(u.suid, " + pre + ", '') AS sample, u.samples AS samples, mapUpdate(pv.m, sv.m) AS m\n" +
      "  FROM u" + i + " AS u LEFT JOIN pv" + i + " AS pv ON pv.k = u.puid LEFT JOIN sv" + i + " AS sv ON sv.k = u.suid\n");
  });
  return "WITH " + ctes.join("") + "rows AS (\n" + rows.join("  UNION ALL\n") + ")\n";
}

/**
 * One page of the clinical table across every (cohort, study) part it spans: patient and sample
 * ids with every requested attribute's value as a map — a sample row carries its patient's
 * attributes too, as the portal's table does — combined and sorted together in the database, so the
 * order is global and any page is one query however deep. Sorted by `sort`, then patient, sample
 * and document order, so the download pages the same order. All parts must live in the database
 * this runs in.
 */
export function tableRowsSql(parts: TablePart[], db: string, unit: "sample" | "patient",
  columns: TableColumn[], sort: TableSort | null, limit: number, offset: number): string {
  if (!parts.length) throw new Error("tableRowsSql needs at least one part");
  return allRows(parts, db, unit, columns) +
    "SELECT cohort, study, patient, sample, samples, m, count() OVER () AS total FROM rows\n" +
    "ORDER BY " + sortExpr(sort, columns) + "patient, sample, ord\n" +
    "LIMIT " + Math.max(0, Math.floor(limit)) + " OFFSET " + Math.max(0, Math.floor(offset));
}

/** How many rows each part holds — the table's per-cohort, per-study totals. Counts only. */
export function tableCountsSql(parts: TablePart[], db: string, unit: "sample" | "patient"): string {
  return allRows(parts, db, unit, []) + "SELECT cohort, study, count() AS n FROM rows GROUP BY cohort, study";
}
