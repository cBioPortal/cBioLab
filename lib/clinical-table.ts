// The clinical data table: one row per sample (or patient) with every clinical attribute the study
// records — cBioPortal's Clinical Data tab. Its rows ARE patients, so the row query lives here,
// outside lib/federation*.ts's aggregate builders, and runs only through
// PatientLevelResolver.tableRows: a participant that may not disclose a patient has no such method.
import { sq } from "./compiler.ts";

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
    "FROM " + db + ".clinical_attribute_meta m\n" +
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

/**
 * One cohort's rows in one study: patient id, sample id (empty per patient), every requested
 * attribute's value as a map, and the total row count. A sample row carries its patient's
 * attributes too, as the portal's table does. Sorted by `sort`, then patient and sample, so a
 * download paged by `offset` is the same order the preview showed.
 */
export function tableRowsSql(cohortSql: string, study: string, db: string, unit: "sample" | "patient",
  columns: TableColumn[], sort: TableSort | null, limit: number, offset: number): string {
  const pre = sq(study + "_");
  const inCohort = (col: string) => "replaceOne(" + col + ", " + pre + ", '') IN (SELECT pid FROM cohort)";
  const attrsOf = (per: "patient" | "sample") => columns.filter((c) => c.per === per).map((c) => sq(c.id));
  const pAttrs = attrsOf("patient"), sAttrs = unit === "sample" ? attrsOf("sample") : [];
  const values = (per: "patient" | "sample", attrs: string[]) =>
    "  SELECT " + (per === "patient" ? "patient_unique_id" : "sample_unique_id") + " AS k,\n" +
    "         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m\n" +
    "  FROM " + db + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = " + sq(per) +
    (attrs.length ? " AND attribute_name IN (" + attrs.join(",") + ")" : " AND 0") + "\n" +
    "    AND attribute_value != '' AND " + inCohort("patient_unique_id") + "\n" +
    "  GROUP BY k\n";
  const units = unit === "sample"
    ? "  SELECT patient_unique_id AS puid, sample_unique_id AS suid, 1 AS samples FROM " + db + ".sample_derived\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohort("patient_unique_id") + "\n"
    : "  SELECT patient_unique_id AS puid, '' AS suid, uniqExact(sample_unique_id) AS samples FROM " + db + ".sample_derived\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND " + inCohort("patient_unique_id") + "\n" +
      "  GROUP BY puid\n";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "u AS (\n" + units + "),\n" +
    "pv AS (\n" + values("patient", pAttrs) + "),\n" +
    "sv AS (\n" + values("sample", sAttrs) + "),\n" +
    "rows AS (\n" +
    "  SELECT replaceOne(u.puid, " + pre + ", '') AS patient, replaceOne(u.suid, " + pre + ", '') AS sample, u.samples AS samples,\n" +
    "         mapUpdate(pv.m, sv.m) AS m\n" +
    "  FROM u LEFT JOIN pv ON pv.k = u.puid LEFT JOIN sv ON sv.k = u.suid\n" +
    ")\n" +
    "SELECT patient, sample, samples, m, count() OVER () AS total FROM rows\n" +
    "ORDER BY " + sortExpr(sort, columns) + "patient, sample\n" +
    "LIMIT " + Math.max(0, Math.floor(limit)) + " OFFSET " + Math.max(0, Math.floor(offset))
  );
}

/** Orders two rows the way tableRowsSql's ORDER BY does — for merging per-study pages into one. */
export function compareRows(sort: TableSort | null, columns: TableColumn[],
  a: { patient: string; sample: string; values: Record<string, string> }, b: { patient: string; sample: string; values: Record<string, string> }): number {
  const col = sort ? columns.find((c) => c.id === sort.attribute) : undefined;
  if (sort && col) {
    const va = a.values[col.id] ?? "", vb = b.values[col.id] ?? "";
    if (col.numeric) {
      const x = va === "" ? NaN : Number(va), y = vb === "" ? NaN : Number(vb);
      const nx = Number.isFinite(x), ny = Number.isFinite(y);
      if (nx !== ny) return nx ? -1 : 1;
      if (nx && x !== y) return sort.desc ? y - x : x - y;
    } else {
      if ((va === "") !== (vb === "")) return va === "" ? 1 : -1;
      if (va !== vb) return (va < vb ? -1 : 1) * (sort.desc ? -1 : 1);
    }
  }
  return a.patient < b.patient ? -1 : a.patient > b.patient ? 1 : a.sample < b.sample ? -1 : a.sample > b.sample ? 1 : 0;
}
