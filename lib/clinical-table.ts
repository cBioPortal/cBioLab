// The clinical data table: one row per sample (or patient) with every clinical attribute the study
// records — cBioPortal's Clinical Data tab. Its rows ARE patients, so the row query lives here,
// outside lib/federation*.ts's aggregate builders, and runs only through
// PatientLevelResolver.rowsPage: a participant that may not disclose a patient has no such method.
import { sq } from "./compiler.ts";
import type { QueryColumn, RowSource } from "./table-query.ts";
import { clinicalTable, clinicalMetaTable } from "./custom-data.ts";

export interface TableColumn {
  id: string; name: string;
  /** recorded once per patient, or per sample */
  per: "patient" | "sample";
  numeric: boolean;
}

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

/** The table's own columns, before the attributes: who each row is. */
export function idColumns(unit: "sample" | "patient"): QueryColumn[] {
  return [
    { id: "patient", name: "Patient ID", numeric: false, text: "patient" },
    unit === "sample"
      ? { id: "sample", name: "Sample ID", numeric: false, text: "sample" }
      : { id: "samples", name: "Samples", numeric: true, text: "toString(samples)", num: "toFloat64(samples)" },
  ];
}

/**
 * The clinical table's rows across every (cohort, study) part it spans: patient and sample ids with
 * every requested attribute's value as a map — a sample row carries its patient's attributes too,
 * as the portal's table does — for lib/table-query.ts to search, filter, sort and page in the
 * database, so the order is global and any page is one query however deep. With no sort, rows go
 * by patient and sample id, then document order. All parts must live in the database this runs in.
 */
export function clinicalRowSource(parts: TablePart[], db: string, unit: "sample" | "patient", columns: TableColumn[]): RowSource {
  if (!parts.length) throw new Error("clinicalRowSource needs at least one part");
  const attr = (c: TableColumn): QueryColumn => {
    const v = "m[" + sq(c.id) + "]";
    return { id: c.id, name: c.name, numeric: c.numeric, text: v, ...(c.numeric ? { num: "toFloat64OrNull(" + v + ")" } : {}) };
  };
  return {
    with: allRows(parts, db, unit, columns),
    columns: [...idColumns(unit), ...columns.map(attr)],
    select: "cohort, study, patient, sample, samples, m",
    defaultOrder: "patient, sample",
    tiebreak: "patient, sample, ord",
  };
}
