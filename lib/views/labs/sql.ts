// The labs view's SQL: what its runner (run.ts) asks each participant's database for.
import type { IncidenceAnchor } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { foldedEqualsSql } from "../../event-names.ts";
import { finiteSql } from "../../sql-number.ts";
import { inCohortPatients } from "../../cohort2.ts";
import { aggregateSql, type AggregateSql, patientSql, type PatientSql } from "../../sql-kinds.ts";

/**
 * The course: per time bin, the histogram of % change from baseline (each patient's mean within
 * the bin, so a patient tested weekly weighs no more than one tested monthly). The baseline
 * reading itself — 0% by definition — is not part of the course. Counts only.
 */
export function labCourseSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts): AggregateSql {
  return aggregateSql((
    labCtes(cohortSql, study, db, lab, anchor, o) + "\n" +
    "SELECT tbin, pbin, count() AS n FROM (\n" +
    "  SELECT pid, toInt32(floor(rel / " + Math.max(1, Math.floor(o.binDays)) + ")) AS tbin, " + pctBin("avg(pc)") + " AS pbin\n" +
    "  FROM chg GROUP BY pid, tbin\n" +
    ") GROUP BY tbin, pbin ORDER BY tbin, pbin"
  ));
}

/**
 * Best response: each patient's lowest % change after the anchor (within the window), binned;
 * how many fell by at least `responseDrop` percent, counted exactly rather than from the bins;
 * and the counts behind the denominators — patients anchored, with a baseline, with a positive
 * baseline, and with any value after the anchor.
 */
export function labBestSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts, responseDrop: number): AggregateSql {
  // every count from one pass over the anchored patients (pb), not one pass per count
  return aggregateSql((
    labCtes(cohortSql, study, db, lab, anchor, o) + ",\n" +
    "pbest AS (\n" +
    "  SELECT has_base, b, has_base AND b > 0 AND notEmpty(after) AS ok, arrayMin(after) AS best\n" +
    "  FROM (SELECT has_base, b, arrayMap((x) -> 100 * (x.2 - b) / b, arrayFilter((x) -> x.1 > 0 AND " + inWindow("x.1", o) + ", xs)) AS after FROM pb)\n" +
    "),\n" +
    "tot AS (\n" +
    "  SELECT count() AS anchored, countIf(has_base) AS baseline, countIf(has_base AND b > 0) AS positive_baseline,\n" +
    "         countIf(ok) AS after, countIf(ok AND best <= " + (-Math.abs(Number(responseDrop))) + ") AS responders,\n" +
    "         sumMapIf([" + pctBin("if(ok, best, 0)") + "], [toUInt64(1)], ok) AS hist\n" +
    "  FROM pbest\n" +
    ")\n" +
    "SELECT r.1 AS what, r.2 AS pbin, r.3 AS n FROM tot\n" +
    "ARRAY JOIN arrayConcat(arrayMap((k, v) -> ('best', k, v), hist.1, hist.2),\n" +
    "  [('responders', toInt32(0), responders), ('anchored', toInt32(0), anchored), ('baseline', toInt32(0), baseline),\n" +
    "   ('positive_baseline', toInt32(0), positive_baseline), ('after', toInt32(0), after)]) AS r"
  ));
}

/**
 * Each patient's best % change, one row per patient and no identifier — the values behind a
 * waterfall. Patient-level: only PatientLevelResolver.viewRows runs it, the same entitlement
 * that lets a plot draw its points.
 */
export function labWaterfallSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts, cap: number): PatientSql {
  return patientSql((
    labCtes(cohortSql, study, db, lab, anchor, o) + "\n" +
    "SELECT round(best, 1) AS best FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)\n" +
    "ORDER BY best LIMIT " + Math.max(1, Math.floor(cap))
  ));
}

// ---------------------------------------------------------------------------
// labs: a lab value's course from treatment start, as % change from baseline

export interface LabSpec {
  /** the event type holding lab results, and the key/value naming this test (e.g. TEST = PSA) */
  eventType: string; testKey: string; test: string;
  /** the attribute holding the numeric result */
  resultKey: string;
}
export interface LabOpts {
  /** baseline: the last value within this many days before (or on) the anchor */
  baselineDays: number;
  /** window around the anchor, and bin width, in days */
  fromDays: number; toDays: number; binDays: number;
}
/**
 * % change is binned in 2-point steps CENTRED on −100, −98, … +300 (so an unchanged value sits
 * exactly at 0, not at a bin's edge); values above +300 share the top bin.
 */
export const LAB_PCT_BIN = 2, LAB_PCT_MIN = -100, LAB_PCT_MAX = 300;
export const LAB_PCT_BINS = (LAB_PCT_MAX - LAB_PCT_MIN) / LAB_PCT_BIN + 1;


function labCtes(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts): string {
  const pick = anchor.occurrence === "LAST" ? "max" : "min";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "anch AS (\n" +
    "  SELECT p.stable_id AS pid, " + pick + "(ce.start_date) AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", anchor.eventType) + "\n" +
    (anchor.key ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
      foldedEqualsSql("key", anchor.key) + " AND " + foldedEqualsSql("value", String(anchor.value ?? "")) + ")\n" : "") +
    "    AND " + inCohortPatients("p.stable_id") + "\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    // the study's readings of the test: joined to the anchored patients once, below
    "lab AS (\n" +
    "  SELECT p.stable_id AS pid, ce.start_date AS day, " + finiteSql("r.value") + " AS v\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  JOIN " + db + ".clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("t.key", lab.testKey) + " AND " + foldedEqualsSql("t.value", lab.test) + "\n" +
    "  JOIN " + db + ".clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("r.key", lab.resultKey) + "\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", lab.eventType) + "\n" +
    "    AND " + finiteSql("r.value") + " IS NOT NULL\n" +
    "),\n" +
    // One row per anchored patient, its readings as (days from the anchor, value). Everything
    // below reads this row, so each statement evaluates lab and anch once: a CTE named twice is
    // evaluated twice.
    "per AS (\n" +
    "  SELECT anch.pid AS pid, groupArrayIf((lab.day - anch.day, assumeNotNull(lab.v)), lab.pid != '') AS xs\n" +
    "  FROM anch LEFT JOIN lab ON lab.pid = anch.pid\n" +
    "  GROUP BY anch.pid\n" +
    "),\n" +
    // the baseline is the mean of the readings on the last day with any, so several readings that day
    // give one answer rather than whichever row came first
    "pb AS (\n" +
    "  SELECT pid, xs, arrayFilter((x) -> x.1 >= -" + Math.floor(o.baselineDays) + " AND x.1 <= 0, xs) AS pre, notEmpty(pre) AS has_base,\n" +
    "         arrayMax(arrayMap((x) -> x.1, pre)) AS brel,\n" +
    "         arrayAvg(arrayMap((x) -> x.2, arrayFilter((x) -> x.1 = brel, pre))) AS b\n" +
    "  FROM per\n" +
    "),\n" +
    "chg AS (\n" +
    "  SELECT pid, x.1 AS rel, 100 * (x.2 - b) / b AS pc\n" +
    "  FROM pb ARRAY JOIN xs AS x\n" +
    "  WHERE has_base AND b > 0 AND " + inWindow("x.1", o) + "\n" +
    ")"
  );
}

/** a reading `rel` days from the anchor that counts as a change: in the window, and not on the baseline's day */
const inWindow = (rel: string, o: LabOpts): string =>
  rel + " != brel AND " + rel + " >= " + Math.floor(o.fromDays) + " AND " + rel + " <= " + Math.floor(o.toDays);

export const pctBin = (x: string) =>
  "toInt32(floor((least(" + LAB_PCT_MAX + ", greatest(" + LAB_PCT_MIN + ", " + x + ")) - (" + LAB_PCT_MIN + ") + " + (LAB_PCT_BIN / 2) + ") / " + LAB_PCT_BIN + "))";
