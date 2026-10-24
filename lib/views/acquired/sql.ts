// The acquired view's SQL: what its runner (run.ts) asks each participant's database for.
import { sideCountsTail } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { foldedEqualsSql, foldedInSql } from "../../event-names.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/** Per gene, among patients with a sample before and after the anchor, both profiled for it: as pairedCountsSql (a = before, b = after). */
export function acquiredCountsSql(cohortSql: string, study: string, db: string, genes: string[] | null, o: AcquiredSides,
  pin: string | null, measure: "driver" | "any"): AggregateSql {
  return aggregateSql(acquiredSidesCtes(cohortSql, study, db, o) + ",\n" + sideCountsTail(study, db, genes, pin, measure));
}

/** The funnel from cohort to pairs: anchored, with a dated sample, with one before, one after, both; and the pairs' spacing in days. */
export function acquiredFunnelSql(cohortSql: string, study: string, db: string, o: AcquiredSides): AggregateSql {
  const both = "n_pre > 0 AND n_post > 0";
  return aggregateSql((
    acquiredSidesCtes(cohortSql, study, db, o) + "\n" +
    "SELECT (SELECT count() FROM anch) AS anchored, (SELECT uniqExact(pid) FROM tl) AS with_events, count() AS dated,\n" +
    "       countIf(n_pre > 0) AS with_pre, countIf(n_post > 0) AS with_post, countIf(" + both + ") AS paired,\n" +
    "       quantileExactIf(0.5)(-pre_rel, " + both + ") AS pre_median, quantileExactIf(0.5)(post_rel, " + both + ") AS post_median,\n" +
    "       quantileExactIf(0.25)(post_rel - pre_rel, " + both + ") AS gap_q1, quantileExactIf(0.5)(post_rel - pre_rel, " + both + ") AS gap_median,\n" +
    "       quantileExactIf(0.75)(post_rel - pre_rel, " + both + ") AS gap_q3\n" +
    "FROM pick"
  ));
}

// ---------------------------------------------------------------------------
// acquired: each patient's last sample before a treatment start and first sample after it

export interface AcquiredSides {
  /** the treatment start: its FIRST event of this type (with key = value, when given) */
  anchor: { eventType: string; key?: string; value?: string };
  /** the timeline event types that date a sample, and the attribute naming the sample */
  sampleEvents: string[]; sampleKey: string;
  /** pre: the last dated sample on or before the anchor day, at most this many days before it (null: any) */
  preWindowDays: number | null;
  /** post: the first dated sample at least this many days after the anchor */
  minGapDays: number;
}

/**
 * The cohort's patients with a dated sample on each side of a treatment start, as a `ps` CTE (one
 * sample per side: 'a' the last on or before the anchor, 'b' the first at least minGapDays after;
 * ties on a day broken by sample id, so the pick is deterministic). A sample's day is the first
 * timeline event of the given types naming it, matched to the study's samples by stable id.
 */
function acquiredSidesCtes(cohortSql: string, study: string, db: string, o: AcquiredSides): string {
  const a = o.anchor;
  const preCond = "rel <= 0" + (o.preWindowDays != null ? " AND rel >= " + (-Math.floor(o.preWindowDays)) : "");
  const postCond = "rel >= " + Math.floor(o.minGapDays);
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "anch AS (\n" +
    "  SELECT p.stable_id AS pid, min(ce.start_date) AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", a.eventType) + "\n" +
    (a.key ? "    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM " + db + ".clinical_event_data WHERE " +
      foldedEqualsSql("key", a.key) + " AND " + foldedEqualsSql("value", String(a.value ?? "")) + ")\n" : "") +
    "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "tl AS (\n" +
    "  SELECT p.stable_id AS pid, d.value AS sample, min(ce.start_date) AS day\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id AND " + foldedEqualsSql("d.key", o.sampleKey) + "\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedInSql("ce.event_type", o.sampleEvents) + "\n" +
    "    AND p.stable_id IN (SELECT pid FROM anch)\n" +
    "  GROUP BY pid, sample\n" +
    "),\n" +
    "dated AS (\n" +
    "  SELECT tl.pid AS pid, sd.sample_unique_id AS suid, tl.day - anch.day AS rel\n" +
    "  FROM tl INNER JOIN anch ON anch.pid = tl.pid\n" +
    "  INNER JOIN " + db + ".sample_derived sd ON sd.cancer_study_identifier = " + sq(study) + " AND sd.sample_stable_id = tl.sample AND sd.patient_stable_id = tl.pid\n" +
    "),\n" +
    "pick AS (\n" +
    "  SELECT pid, countIf(" + preCond + ") AS n_pre, countIf(" + postCond + ") AS n_post,\n" +
    "         argMaxIf(suid, (rel, suid), " + preCond + ") AS pre, argMinIf(suid, (rel, suid), " + postCond + ") AS post,\n" +
    "         maxIf(rel, " + preCond + ") AS pre_rel, minIf(rel, " + postCond + ") AS post_rel\n" +
    "  FROM dated GROUP BY pid\n" +
    "),\n" +
    "ps AS (\n" +
    "  SELECT pre AS suid, pid, 'a' AS side FROM pick WHERE n_pre > 0 AND n_post > 0\n" +
    "  UNION ALL SELECT post AS suid, pid, 'b' AS side FROM pick WHERE n_pre > 0 AND n_post > 0\n" +
    ")"
  );
}
