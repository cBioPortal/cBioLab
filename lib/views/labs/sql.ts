// The labs view's SQL: what its runner (run.ts) asks each participant's database for.
import type { IncidenceAnchor } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { foldedEqualsSql } from "../../event-names.ts";
import { finiteSql } from "../../sql-number.ts";

/**
 * The course: per time bin, the histogram of % change from baseline (each patient's mean within
 * the bin, so a patient tested weekly weighs no more than one tested monthly). The baseline
 * reading itself — 0% by definition — is not part of the course. Counts only.
 */
export function labCourseSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts): string {
  return (
    labCtes(cohortSql, study, db, lab, anchor, o) + "\n" +
    "SELECT tbin, pbin, count() AS n FROM (\n" +
    "  SELECT pid, toInt32(floor(rel / " + Math.max(1, Math.floor(o.binDays)) + ")) AS tbin, " + pctBin("avg(pc)") + " AS pbin\n" +
    "  FROM chg GROUP BY pid, tbin\n" +
    ") GROUP BY tbin, pbin ORDER BY tbin, pbin"
  );
}

/**
 * Best response: each patient's lowest % change after the anchor (within the window), binned;
 * how many fell by at least `responseDrop` percent, counted exactly rather than from the bins;
 * and the counts behind the denominators — patients anchored, with a baseline, with a positive
 * baseline, and with any value after the anchor.
 */
export function labBestSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts, responseDrop: number): string {
  const best = "(SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)";
  return (
    labCtes(cohortSql, study, db, lab, anchor, o) + "\n" +
    "SELECT 'best' AS what, " + pctBin("best") + " AS pbin, count() AS n FROM " + best + " GROUP BY pbin\n" +
    "UNION ALL SELECT 'responders' AS what, 0 AS pbin, countIf(best <= " + (-Math.abs(Number(responseDrop))) + ") AS n FROM " + best + "\n" +
    "UNION ALL SELECT 'anchored' AS what, 0 AS pbin, count() AS n FROM anch\n" +
    "UNION ALL SELECT 'baseline' AS what, 0 AS pbin, count() AS n FROM base\n" +
    "UNION ALL SELECT 'positive_baseline' AS what, 0 AS pbin, countIf(b > 0) AS n FROM base\n" +
    "UNION ALL SELECT 'after' AS what, 0 AS pbin, uniqExactIf(pid, rel > 0) AS n FROM chg"
  );
}

/**
 * Each patient's best % change, one row per patient and no identifier — the values behind a
 * waterfall. Patient-level: only PatientLevelResolver.viewRows runs it, the same entitlement
 * that lets a plot draw its points.
 */
export function labWaterfallSql(cohortSql: string, study: string, db: string, lab: LabSpec, anchor: IncidenceAnchor, o: LabOpts, cap: number): string {
  return (
    labCtes(cohortSql, study, db, lab, anchor, o) + "\n" +
    "SELECT round(best, 1) AS best FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)\n" +
    "ORDER BY best LIMIT " + Math.max(1, Math.floor(cap))
  );
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
    "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "lab AS (\n" +
    "  SELECT p.stable_id AS pid, ce.start_date AS day, " + finiteSql("r.value") + " AS v\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  JOIN " + db + ".clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("t.key", lab.testKey) + " AND " + foldedEqualsSql("t.value", lab.test) + "\n" +
    "  JOIN " + db + ".clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("r.key", lab.resultKey) + "\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", lab.eventType) + "\n" +
    "    AND p.stable_id IN (SELECT pid FROM anch) AND " + finiteSql("r.value") + " IS NOT NULL\n" +
    "),\n" +
    "base AS (\n" +
    // the baseline is the mean of the readings on the last day with any, so several readings that day
    // give one answer rather than whichever row came first
    "  SELECT lab.pid AS pid, max(lab.day) AS bday,\n" +
    "         arrayAvg(arrayMap((x) -> assumeNotNull(x.1), arrayFilter((x) -> x.2 = bday, groupArray((lab.v, lab.day))))) AS b\n" +
    "  FROM lab INNER JOIN anch ON anch.pid = lab.pid\n" +
    "  WHERE lab.day >= anch.day - " + Math.floor(o.baselineDays) + " AND lab.day <= anch.day GROUP BY lab.pid\n" +
    "),\n" +
    "chg AS (\n" +
    "  SELECT lab.pid AS pid, lab.day - anch.day AS rel, 100 * (lab.v - base.b) / base.b AS pc\n" +
    "  FROM lab INNER JOIN anch ON anch.pid = lab.pid INNER JOIN base ON base.pid = lab.pid\n" +
    "  WHERE base.b > 0 AND lab.day != base.bday\n" +
    "    AND lab.day - anch.day >= " + Math.floor(o.fromDays) + " AND lab.day - anch.day <= " + Math.floor(o.toDays) + "\n" +
    ")"
  );
}

export const pctBin = (x: string) =>
  "toInt32(floor((least(" + LAB_PCT_MAX + ", greatest(" + LAB_PCT_MIN + ", " + x + ")) - (" + LAB_PCT_MIN + ") + " + (LAB_PCT_BIN / 2) + ") / " + LAB_PCT_BIN + "))";
