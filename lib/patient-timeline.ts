// The timeline view's queries: the cohorts' patients with the shape of their timelines (a table,
// for lib/table-query.ts to page), and one patient's events and samples. Both name patients, so —
// like lib/clinical-table.ts — they live outside lib/federation*.ts's aggregate builders and run
// only through PatientLevelResolver (rowsPage, patientTimeline): a participant that may not
// disclose a patient has neither method.
import { sq } from "./compiler.ts";
import type { QueryColumn, RowSource } from "./table-query.ts";
import type { TablePart } from "./clinical-table.ts";
import type { PatientEvent, PatientSample } from "./types.ts";
import { clinicalTable } from "./custom-data.ts";
import { patientSql, type PatientSql } from "./sql-kinds.ts";
import { inCohortPatients } from "./cohort2.ts";

/** A study's patient id as stored (no study prefix): what a cohort's `pid` holds. */
export const PATIENT_ID = /^[A-Za-z0-9._-]{1,80}$/;

export const TIMELINE_COLUMNS: QueryColumn[] = [
  { id: "patient", name: "Patient ID", numeric: false, text: "patient" },
  { id: "source", name: "Source", numeric: false, text: "source" },
  { id: "samples", name: "Samples", numeric: true, text: "toString(samples)", num: "toFloat64(samples)" },
  { id: "events", name: "Events", numeric: true, text: "toString(events)", num: "toFloat64(events)" },
  { id: "first", name: "First event (day)", numeric: true, text: "ifNull(toString(first), '')", num: "toFloat64(first)" },
  { id: "last", name: "Last event (day)", numeric: true, text: "ifNull(toString(last), '')", num: "toFloat64(last)" },
  { id: "span", name: "Span (days)", numeric: true, text: "ifNull(toString(last - first), '')", num: "toFloat64(last - first)" },
  { id: "types", name: "Event types", numeric: false, text: "types" },
];
export const TIMELINE_DEFAULT_COLUMNS = ["patient", "source", "samples", "events", "span", "types"];

/** One (cohort, study) part of the list, and the instance that holds it — the Source column. */
export type TimelinePart = TablePart & { source: string };

/**
 * Every (cohort, study) part's patients, one row each: how many samples and timeline events they
 * have, the first and last event day (days from diagnosis, a range counted to its stop) and the
 * event types recorded. A patient with no timeline is listed, with no events — the list is the
 * cohort's patients (the owners of its samples), not the patients who happen to have a timeline;
 * `samples` counts all of a patient's samples, as the patient's own timeline draws them. All parts
 * must live in this database.
 */
export function timelinePatientRowSource(parts: TimelinePart[], db: string): RowSource {
  if (!parts.length) throw new Error("timelinePatientRowSource needs at least one part");
  const ctes: string[] = [], rows: string[] = [];
  parts.forEach((p, i) => {
    const pre = sq(p.study + "_");
    ctes.push(
      "c" + i + " AS (" + p.cohortSql + "),\n" +
      "pt" + i + " AS (\n" +
      "  SELECT p.internal_id AS iid, p.stable_id AS pid FROM " + db + ".patient p\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + sq(p.study) + " AND " + inCohortPatients("p.stable_id", "c" + i) + "\n" +
      "),\n" +
      "ev" + i + " AS (\n" +
      "  SELECT ce.patient_id AS iid, count() AS events, min(ce.start_date) AS first,\n" +
      "         max(greatest(ce.start_date, ifNull(ce.stop_date, ce.start_date))) AS last,\n" +
      "         arrayStringConcat(arraySort(groupUniqArray(trimBoth(ce.event_type))), ', ') AS types\n" +
      "  FROM " + db + ".clinical_event ce WHERE ce.patient_id IN (SELECT iid FROM pt" + i + ")\n" +
      "  GROUP BY iid\n" +
      "),\n" +
      "sm" + i + " AS (\n" +
      "  SELECT replaceOne(patient_unique_id, " + pre + ", '') AS pid, uniqExact(sample_unique_id) AS samples FROM " + db + ".sample_derived\n" +
      "  WHERE cancer_study_identifier = " + sq(p.study) + " AND " + inCohortPatients("replaceOne(patient_unique_id, " + pre + ", '')", "c" + i) + "\n" +
      "  GROUP BY pid\n" +
      "),\n");
    rows.push(
      "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord, pt.pid AS patient, '' AS sample, " + sq(p.source) + " AS source,\n" +
      "         toUInt64(ifNull(sm.samples, 0)) AS samples, toUInt64(ifNull(ev.events, 0)) AS events,\n" +
      "         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.first)), NULL) AS first,\n" +
      "         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.last)), NULL) AS last,\n" +
      "         ifNull(ev.types, '') AS types\n" +
      "  FROM pt" + i + " AS pt LEFT JOIN ev" + i + " AS ev ON ev.iid = pt.iid LEFT JOIN sm" + i + " AS sm ON sm.pid = pt.pid\n");
  });
  return {
    with: "WITH " + ctes.join("") + "rows AS (\n" + rows.join("  UNION ALL\n") + ")\n",
    columns: TIMELINE_COLUMNS,
    select: "cohort, study, patient, sample, source, samples, events, first, last, types",
    defaultOrder: "events = 0, patient",
    tiebreak: "patient, ord",
  };
}

/** One patient's events with their attributes, in time order. The id is checked by the caller. */
export function patientEventsSql(study: string, patient: string, db: string): PatientSql {
  // filter both event tables to the patient before joining: the attribute table is the large one
  return patientSql("WITH pt AS (\n" +
    "  SELECT p.internal_id FROM " + db + ".patient p JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND p.stable_id = " + sq(patient) + "\n" +
    "), ev AS (\n" +
    "  SELECT clinical_event_id, event_type, start_date, stop_date FROM " + db + ".clinical_event WHERE patient_id IN (SELECT internal_id FROM pt)\n" +
    ")\n" +
    "SELECT ev.clinical_event_id AS id, ev.event_type AS type, ev.start_date AS start, ev.stop_date AS stop,\n" +
    "       groupArrayIf((d.key, d.value), d.key != '') AS attrs\n" +
    "FROM ev LEFT JOIN (\n" +
    "  SELECT clinical_event_id, key, value FROM " + db + ".clinical_event_data WHERE clinical_event_id IN (SELECT clinical_event_id FROM ev)\n" +
    ") d ON d.clinical_event_id = ev.clinical_event_id\n" +
    "GROUP BY id, type, start, stop\n" +
    "ORDER BY start, id");
}

/** One patient's samples and their SAMPLE_TYPE (what colours a sample's marker). */
export function patientSamplesSql(study: string, patient: string, db: string): PatientSql {
  const pre = sq(study + "_");
  return patientSql("SELECT replaceOne(s.sample_unique_id, " + pre + ", '') AS id, any(c.attribute_value) AS type\n" +
    "FROM " + db + ".sample_derived s\n" +
    "LEFT JOIN " + clinicalTable(db, ["SAMPLE_TYPE"]) + " c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'\n" +
    "  AND c.cancer_study_identifier = " + sq(study) + " AND c.attribute_name = 'SAMPLE_TYPE'\n" +
    "WHERE s.cancer_study_identifier = " + sq(study) + " AND s.patient_unique_id = " + sq(study + "_" + patient) + "\n" +
    "GROUP BY id ORDER BY id");
}

/** Rows as the two queries return them → the timeline's events and samples. */
export function toEvents(rows: Record<string, unknown>[]): PatientEvent[] {
  return rows.map((r) => {
    const attrs = (Array.isArray(r.attrs) ? r.attrs : []) as unknown[];
    return {
      type: String(r.type ?? "").trim(),
      start: Number(r.start),
      end: r.stop == null ? null : Number(r.stop),
      attrs: attrs
        .map((a) => (Array.isArray(a) ? [String(a[0] ?? ""), String(a[1] ?? "")] : [String((a as Record<string, unknown>)?.[1] ?? ""), String((a as Record<string, unknown>)?.[2] ?? "")]) as [string, string])
        .filter(([k]) => k !== ""),
    };
  });
}
export function toSamples(rows: Record<string, unknown>[]): PatientSample[] {
  return rows.map((r) => ({ id: String(r.id), type: String(r.type ?? "") }));
}
