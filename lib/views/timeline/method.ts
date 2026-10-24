// The timeline view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function timelineMethod(t: { cohorts: string[]; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number;
  patient: { study: string; id: string; events: number; samples: number } | null }): MethodRecord {
  const steps = tableSteps({ label: "timeline", what: "patients", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every patient of each cohort, with their sample count and, from the study's timeline, the number of events, the first and last event day (a range counted to its stop) and the event types — a patient with no timeline is listed with none.",
    order: t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + " with missing values last, then patient id" : "patients with events first, then by patient id" });
  if (t.patient) steps.push({
    kind: "fetch" as const, title: "Read " + t.patient.id + "'s timeline",
    detail: "The timeline:events and timeline:samples queries above: every clinical event recorded for " + t.patient.id + " in " + t.patient.study +
      " with all its attributes, and the patient's samples with their SAMPLE_TYPE. Events are drawn as stored, in days from diagnosis; tracks group them by event type (case-folded) and nest them by attribute as cBioPortal's patient view does.",
    params: [["events", t.patient.events.toLocaleString("en-US")], ["samples", t.patient.samples.toLocaleString("en-US")]],
  });
  return { steps, implementation: { functions: ["runTimeline", "timelinePatientRowSource", "patientEventsSql", "buildTracks", "pageSql", "countsSql", "rankSql"], file: "lib/views/timeline/run.ts, lib/patient-timeline.ts, lib/timeline-tracks.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: "A listing and one patient's record: no statistic is computed, so there is no script — the queries are the numbers." };
}
