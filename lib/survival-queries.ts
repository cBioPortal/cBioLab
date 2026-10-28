// The survival queries: who enters a survival analysis and with what time and event, by the one rule
// of lib/survival-sql.ts, plus the patients that rule leaves out and the endpoints a study declares.
// Aggregates every participant answers (counts), and the per-patient rows only a patient-level one
// runs (coxRowsSql). Swept by test/boundary.test.ts.
import { DB } from "./ch.ts";
import { sq } from "./compiler.ts";
import { foldedEqualsSql } from "./event-names.ts";
import { clinicalTable, clinicalMetaTable } from "./custom-data.ts";
import { inCohortPatients } from "./cohort2.ts";
import { aggregateSql, type AggregateSql, patientSql, type PatientSql } from "./sql-kinds.ts";
import { DAYS_PER_MONTH } from "./time-units.ts";
import { survivalMonthsSql, survivalEventSql, survivalPresentSql, survivalTimeUsableSql } from "./survival-sql.ts";
import type { EndpointColumns } from "./federation.ts";

/** Endpoint prefix -> the (<X>_MONTHS, <X>_STATUS) attribute pair cBioPortal stores. */
const ENDPOINT_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

/**
 * (months, event, n) triples for one cohort in one study. Aggregate — pools
 * exactly with other instances' triples to give a correct pooled KM curve.
 *
 * `endpoint` names the pair: "OS" reads OS_MONTHS/OS_STATUS, "PFS" reads
 * PFS_MONTHS/PFS_STATUS, and so on. Studies carry wildly different sets (this
 * database has 27 distinct pairs across 519 studies), so the caller must be
 * told when a study has nothing for the endpoint asked for rather than seeing
 * its patients quietly vanish from a curve.
 */
export function survivalCountsSql(cohortSql: string, study: string, db: string = DB, endpoint = "OS", columns?: EndpointColumns): AggregateSql {
  if (!ENDPOINT_RE.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const months = columns?.months || (endpoint + "_MONTHS"), status = columns?.status || (endpoint + "_STATUS");
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(months) + ") AS months,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [months, status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type='patient'\n" +
    "    AND attribute_name IN (" + sq(months) + "," + sq(status) + ")\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT " + survivalMonthsSql("months", "status") + " AS m, " + survivalEventSql("status") + " AS ev, count() AS n\n" +
    "FROM os WHERE m IS NOT NULL\n" +
    "GROUP BY m, ev ORDER BY m"
  ));
}

/**
 * Of the cohort's patients, how many a survival curve leaves out for want of half an endpoint: a
 * usable time but no status (no_status), and a status but no usable time (no_time) — the rule of
 * lib/survival-sql.ts. Patients with neither are not counted here. Counts only.
 */
export function survivalLeftOutSql(cohortSql: string, study: string, db: string, months: string, status: string): AggregateSql {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(months) + ") AS months,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [months, status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient'\n" +
    "    AND attribute_name IN (" + sq(months) + ", " + sq(status) + ")\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT countIf(" + survivalTimeUsableSql("months") + " AND NOT " + survivalPresentSql("status") + ") AS no_status,\n" +
    "       countIf(" + survivalPresentSql("status") + " AND NOT (" + survivalTimeUsableSql("months") + ")) AS no_time\n" +
    "FROM os"
  ));
}

/**
 * Survival re-anchored to a timeline event, with the delayed entry that implies.
 *
 * The study's <X>_MONTHS is measured from the timeline's day 0 (in MSK-CHORD
 * that is first sequencing). Anchoring at an earlier event — initial diagnosis,
 * first treatment — moves the clock back by `-anchorDay` and makes the patient
 * UNOBSERVABLE until day 0. Reporting that without also reporting the entry time
 * would manufacture immortal time: every patient would appear to survive from
 * the anchor to their sequencing, which is exactly what got them into the study.
 *
 * So this returns (entry, months, event, n): entry is the anchor-to-day-0 gap,
 * months is anchor-to-outcome. Still four numbers and a count — no identifiers,
 * still additive across sites.
 */
export function anchoredSurvivalSql(
  cohortSql: string, study: string, db: string, endpoint: string,
  anchor: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" },
  columns?: EndpointColumns
): AggregateSql {
  if (!ENDPOINT_RE.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const months = columns?.months || (endpoint + "_MONTHS"), status = columns?.status || (endpoint + "_STATUS");
  const pick = anchor.occurrence === "LAST" ? "max" : "min";
  const attrCond = anchor.key
    ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data\n" +
      "        WHERE " + foldedEqualsSql("key", anchor.key) + " AND " + foldedEqualsSql("value", String(anchor.value ?? "")) + ")\n"
    : "";
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + survivalMonthsSql("anyIf(attribute_value, attribute_name=" + sq(months) + ")", "anyIf(attribute_value, attribute_name=" + sq(status) + ")") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [months, status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type='patient'\n" +
    "    AND attribute_name IN (" + sq(months) + "," + sq(status) + ")\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "anch AS (\n" +
    "  SELECT p.stable_id AS pid, " + pick + "(ce.start_date) AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND " + foldedEqualsSql("ce.event_type", anchor.eventType) + "\n" + attrCond +
    "    AND " + inCohortPatients("p.stable_id") + "\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    // offset = months from anchor to day 0; only anchors at or before day 0 make
    // sense as a start of follow-up, so later ones are dropped and counted.
    "SELECT round(-anch.day / " + DAYS_PER_MONTH + ", 4) AS entry,\n" +
    "       round(os.months - anch.day / " + DAYS_PER_MONTH + ", 4) AS m,\n" +
    "       " + survivalEventSql("os.status") + " AS ev, count() AS n\n" +
    "FROM os INNER JOIN anch USING (pid)\n" +
    "WHERE os.months IS NOT NULL AND anch.day <= 0\n" +
    "GROUP BY entry, m, ev ORDER BY m"
  ));
}

/**
 * Per-patient rows for a Cox fit: one row per patient with a valid endpoint measurement AND
 * every requested covariate defined (a patient missing any covariate is left out entirely, the
 * usual listwise-deletion rule for a multivariate fit). No patient identifier is SELECTed —
 * `os.pid` only joins the CTEs together — so this can only ever leave the resolver as fitted
 * coefficients, never as a roster; that is also why, unlike survivalCountsSql, this is
 * patient-level only (see PatientLevelResolver.coxRows) rather than something every
 * participant can answer.
 */
export function coxRowsSql(
  cohortSql: string, study: string, db: string, endpoint: string, covariates: { label: string; sel: string }[],
  columns?: EndpointColumns
): PatientSql {
  if (!ENDPOINT_RE.test(endpoint)) throw new Error("bad survival endpoint '" + String(endpoint).slice(0, 40) + "'");
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  const months = columns?.months || (endpoint + "_MONTHS"), status = columns?.status || (endpoint + "_STATUS");
  const covCtes = covariates.map((c) => c.label + " AS (\n" + c.sel + "\n)").join(",\n");
  const joins = covariates.map((c) => "INNER JOIN " + c.label + " ON " + c.label + ".id = os.pid").join("\n  ");
  const select = covariates.map((c) => c.label + ".v AS " + c.label).join(", ");
  return patientSql((
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + survivalMonthsSql("anyIf(attribute_value, attribute_name=" + sq(months) + ")", "anyIf(attribute_value, attribute_name=" + sq(status) + ")") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name=" + sq(status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [months, status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type='patient'\n" +
    "    AND attribute_name IN (" + sq(months) + "," + sq(status) + ")\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    ")" + (covCtes ? ",\n" + covCtes : "") + "\n" +
    "SELECT os.months AS m, " + survivalEventSql("os.status") + " AS ev" + (select ? ", " + select : "") + "\n" +
    "FROM os\n" + (joins ? "  " + joins + "\n" : "") +
    "WHERE os.months IS NOT NULL"
  ));
}

/** Which (<X>_MONTHS, <X>_STATUS) pairs a study actually declares. Metadata only. */
export function survivalEndpointsSql(study: string, db: string = DB): AggregateSql {
  return aggregateSql((
    "SELECT replaceOne(cam.attr_id, '_MONTHS', '') AS endpoint\n" +
    "FROM " + clinicalMetaTable(db) + " cam\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND cam.attr_id LIKE '%\\_MONTHS'\n" +
    "  AND replaceOne(cam.attr_id, '_MONTHS', '_STATUS') IN (\n" +
    "    SELECT cam2.attr_id FROM " + clinicalMetaTable(db) + " cam2\n" +
    "    JOIN " + db + ".cancer_study cs2 ON cs2.cancer_study_id = cam2.cancer_study_id\n" +
    "    WHERE cs2.cancer_study_identifier = " + sq(study) + ")\n" +
    "ORDER BY endpoint"
  ));
}

/** `os`: each cohort patient's OS_MONTHS (months) and whether OS_STATUS says deceased (dead) */
export function osCte(study: string, db: string): string {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + survivalMonthsSql("anyIf(attribute_value, attribute_name = 'OS_MONTHS')", "anyIf(attribute_value, attribute_name = 'OS_STATUS')") + " AS months,\n" +
    "         " + survivalEventSql("anyIf(attribute_value, attribute_name = 'OS_STATUS')") + " AS dead\n" +
    "  FROM " + clinicalTable(db, ["OS_MONTHS", "OS_STATUS"]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')\n" +
    "    AND " + inCohortPatients(pid) + "\n" +
    "  GROUP BY pid\n" +
    ")";
}
