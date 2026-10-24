// The multistate view's SQL: what its runner (run.ts) asks each participant's database for.
// multistate: the illness–death model (start → progression → death) from the timeline's day 0
import { type ProgressionEvent, osCte, lastDayCte, progressionCte, cohortEventsFrom, eventHasKv, CLOCK_SLACK_DAYS } from "../../federation-views.ts";
import { foldedEqualsSql } from "../../event-names.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";
import { DAYS_PER_MONTH } from "../../time-units.ts";

/** the event type whose day-0 record says the timeline's clock starts at sequencing */
export const SEQUENCING_EVENT = "Sequencing";

/**
 * Per cohort, counts of patient paths through the illness–death model on the timeline's clock, in
 * months from day 0: `prevalent` (a progression event on or before day 0, so the patient starts in
 * the progression state), `tp` the first progression after day 0 strictly before the end of
 * follow-up (0 when none), `te` the end of follow-up — OS_MONTHS, the timeline's last follow-up
 * day being OS_MONTHS × DAYS_PER_MONTH — and `dead` (OS_STATUS 1:…). Flags beside them, for the
 * caveat: `afterend` a progression recorded only on or after the end of follow-up (not counted),
 * `assessed` any record of the progression key at all (a patient never imaged cannot show
 * progression), `seq0` a Sequencing event on day 0 (what day 0 is), and `late` a timeline event
 * more than CLOCK_SLACK_DAYS past the end of follow-up (the clock check). 'nofollowup' patients
 * (no OS, or OS_MONTHS ≤ 0) are counted apart. Every cohort patient is in exactly one row's n.
 */
export function multistateCountsSql(cohortSql: string, study: string, db: string, pr: ProgressionEvent): AggregateSql {
  return aggregateSql("WITH cohort AS (" + cohortSql + "),\n" + [
    osCte(study, db),
    lastDayCte(study, db),
    progressionCte(study, db, pr),
    "pp AS (SELECT pid, countIf(day <= 0) AS n_pre, countIf(day > 0) AS n_after, minIf(day, day > 0) AS first_after FROM prog GROUP BY pid)",
    "assessed AS (\n" +
    "  SELECT DISTINCT p.stable_id AS pid\n" + cohortEventsFrom(db, study, "ce") +
    "    AND " + foldedEqualsSql("ce.event_type", pr.eventType) + "\n" +
    eventHasKv(db, "ce", pr.key, "1") +
    ")",
    "seq0 AS (\n" +
    "  SELECT DISTINCT p.stable_id AS pid\n" + cohortEventsFrom(db, study, "ce") +
    "    AND " + foldedEqualsSql("ce.event_type", SEQUENCING_EVENT) + " AND ce.start_date = 0\n" +
    ")",
    "per AS (\n" +
    "  SELECT os.months AS months, os.months IS NOT NULL AS has_os, os.dead AS dead,\n" +
    "         pp.pid != '' AND pp.n_pre > 0 AS prevalent, pp.pid != '' AND pp.n_after > 0 AS has_after, toFloat64(pp.first_after) AS fa,\n" +
    "         a.pid != '' AS assessed, s.pid != '' AS seq0, lastday.d AS ld\n" +
    "  FROM (SELECT DISTINCT pid FROM cohort) c\n" +
    "  LEFT JOIN os ON os.pid = c.pid\n" +
    "  LEFT JOIN pp ON pp.pid = c.pid\n" +
    "  LEFT JOIN assessed a ON a.pid = c.pid\n" +
    "  LEFT JOIN seq0 s ON s.pid = c.pid\n" +
    "  LEFT JOIN lastday ON lastday.pid = c.pid\n" +
    ")",
    "cls AS (\n" +
    "  SELECT multiIf(NOT has_os OR months <= 0, 'nofollowup', 'record') AS kind,\n" +
    "         NOT prevalent AND has_after AND fa < months * " + DAYS_PER_MONTH + " AS hit,\n" +
    "         NOT prevalent AND has_after AND fa >= months * " + DAYS_PER_MONTH + " AS afterend,\n" +
    "         if(hit, fa / " + DAYS_PER_MONTH + ", 0) AS tp, months AS te,\n" +
    "         prevalent, dead, assessed, seq0, ld > months * " + DAYS_PER_MONTH + " + " + CLOCK_SLACK_DAYS + " AS late\n" +
    "  FROM per\n" +
    ")",
  ].join(",\n") + "\n" +
    "SELECT kind, if(kind = 'record', toUInt8(prevalent), 0) AS prevalent, if(kind = 'record', round(tp, 4), 0) AS tp,\n" +
    "       if(kind = 'record', round(te, 4), 0) AS te, if(kind = 'record', toUInt8(dead), 0) AS dead,\n" +
    "       toUInt8(afterend) AS afterend, toUInt8(assessed) AS assessed, toUInt8(seq0) AS seq0, toUInt8(late) AS late, count() AS n\n" +
    "FROM cls GROUP BY kind, prevalent, tp, te, dead, afterend, assessed, seq0, late ORDER BY te");
}
