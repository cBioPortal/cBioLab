// The Pathways tab's "Sample(s) … not profiled for …" alert (PatientViewPathwayMapper's
// SampleNotProfiledAlert, PTB-PW-1): for the patient a pathwaymap view names, which of their samples
// lie outside the study's mutation profile and outside its discrete copy-number profile, as the
// Patient tables read it (patientProfiledSource), each sample numbered as the page numbers it.
import { isPatientLevel, type PatientLevelCapable } from "../../federation.ts";
import { patientProfiledSource, patientSamplesSource } from "../../patient-alterations.ts";
import { sampleMarks, type SampleMark } from "../../timeline-tracks.ts";
import { TABLE_ROWS_MAX } from "../rows.ts";
import type { ViewRun } from "../run.ts";
import { patientSampleEvents } from "../shared.ts";

/** the profiles the portal's Pathways tab checks, in its order, and how its alert names each */
export const PATHWAY_ALERT_PROFILES = [["mutations", "mutations"], ["cna", "copy number alterations"]] as const;

export interface PathwayMapAlert { what: string; samples: string[] }
/** The alert's samples and lines, or why the view names no such patient (never shown as "every sample profiled"). */
export type PathwayMapNotProfiled = { samples: SampleMark[]; alerts: PathwayMapAlert[] } | { error: string };

/**
 * A line per profile the study holds with samples outside it: those samples in the page's order. A
 * profile the study does not hold (-1 on every row) has no line, as the portal leaves out a profile
 * the study lacks; nor does one holding every sample.
 */
export function pathwayAlerts(marks: SampleMark[], rows: Record<string, unknown>[]): PathwayMapAlert[] {
  const flag = new Map(rows.map((x) => [String(x.sid), x]));
  const out: PathwayMapAlert[] = [];
  for (const [col, what] of PATHWAY_ALERT_PROFILES) {
    if (!rows.length || rows.some((x) => Number(x[col]) === -1)) continue;
    const outside = marks.filter((m) => Number(flag.get(m.id)?.[col]) !== 1).map((m) => m.id);
    if (outside.length) out.push({ what, samples: outside });
  }
  return out;
}

/**
 * The alert for `pt`, one of the view's cohort's patients; null when no local participant may name
 * their samples. A query that fails throws (the analysis is cached; a failure must not be stored).
 */
export async function pathwayNotProfiled(ctx: ViewRun, pt: { study: string; id: string }): Promise<PathwayMapNotProfiled | null> {
  const res = ctx.resolvers[pt.study];
  if (!res || !isPatientLevel(res) || typeof (res as Partial<PatientLevelCapable>).rowsPage !== "function") return null;
  const cohort = ctx.vNames.find((n) => ctx.cohorts[n].studies.includes(pt.study))!;
  const part = { cohort, study: pt.study, cohortSql: res.cohortSql(ctx.doc.cohorts[cohort]) };
  const [inCohort, all, profiled, ev] = await Promise.all([
    res.rowsPage("pathwaymap:samples", (db) => patientSamplesSource(part, pt.id, db, "cohort"), {}, ["sid"], TABLE_ROWS_MAX, 0),
    res.rowsPage("pathwaymap:samples", (db) => patientSamplesSource(part, pt.id, db, "patient"), {}, ["sid"], TABLE_ROWS_MAX, 0),
    res.rowsPage("pathwaymap:profiled", (db) => patientProfiledSource(part, pt.id, db), {}, ["sid"], TABLE_ROWS_MAX, 0),
    patientSampleEvents(ctx, pt.study, pt.id),
  ]);
  if (!inCohort.rows.length) return { error: pt.id + " is not one of " + cohort + "'s patients" };
  const samples = all.rows.map((x) => ({ id: String(x.sid), type: String(x.type ?? "") }));
  const marks = [...sampleMarks(samples, ev.events).values()].filter((m) => samples.some((s) => s.id === m.id));
  return { samples: marks, alerts: pathwayAlerts(marks, profiled.rows) };
}
