// Timeline view: the cohort's patients, and one patient's clinical timeline (cBioPortal's patient-view
// Timeline) — drawn by lib/timeline-svg.ts, on the track model of lib/timeline-tracks.ts.
import type { ViewResult, TimelineResult, PatientTimeline } from "../../types.ts";
import { hasPatientTimeline, peerRowsFor, type PatientLevelCapable, type PatientTimelineCapable, type Resolver } from "../../federation.ts";
import type { TablePart } from "../../mutation-table.ts";
import { checkQuery, describeQuery, shownColumns, type TableQuery } from "../../table-query.ts";
import { timelineSvg, timelineSummary } from "../../timeline-svg.ts";
import { timelinePatientRowSource, TIMELINE_COLUMNS, TIMELINE_DEFAULT_COLUMNS, PATIENT_ID } from "../../patient-timeline.ts";
import type { ViewRun } from "../run.ts";
import { TABLE_ROWS_MAX, listPosition, rowHolders, runRows, tableTail, viewQuery, type Rows } from "../rows.ts";
import { refuse } from "../shared.ts";
import type { TimelineView } from "./types.ts";
import { timelineMethod } from "./method.ts";

export async function runTimeline(view: TimelineView, ctx: ViewRun): Promise<ViewResult> {
  const { vNames } = ctx;
  if (vNames.length !== 1) return refuse("timeline", ctx, "a timeline view steps through one cohort's patients; this one draws " + vNames.length + " — name one in cohorts");
  const show = view.rows == null ? 25 : Math.floor(Number(view.rows));
  if (!(show >= 1 && show <= TABLE_ROWS_MAX)) return refuse("timeline", ctx, "rows (the page size of the patient list) is 1 to " + TABLE_ROWS_MAX);
  if (view.patient != null && (typeof view.patient !== "object" || typeof view.patient.study !== "string" || typeof view.patient.id !== "string" || !PATIENT_ID.test(view.patient.id)))
    return refuse("timeline", ctx, "patient is {study, id}: a study of the view's cohorts and a patient id in it, e.g. {\"study\": \"msk_chord_2024\", \"id\": \"P-0000012\"}");
  if (view.collapsed != null && (!Array.isArray(view.collapsed) || view.collapsed.some((u) => typeof u !== "string" || u.length > 300)))
    return refuse("timeline", ctx, "collapsed is a list of track ids, e.g. [\"treatment.Chemo\"]");
  const q = viewQuery(view);
  const bad = checkQuery(q, TIMELINE_COLUMNS);
  if (bad) return refuse("timeline", ctx, bad);

  // who may answer: a local patient-level participant, or a peer whose rules allow timelines
  const { holders, excluded, viaPeer } = rowHolders(ctx, "timeline");
  const remote = { of: (r: Resolver) => peerRowsFor(r, "timeline"), table: "timeline" as const };
  if (!holders.length) return refuse("timeline", ctx, "no study here may disclose a patient's timeline (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  if (view.patient && !ctx.vStudies.includes(view.patient.study))
    return refuse("timeline", ctx, "patient " + view.patient.id + " is named in " + view.patient.study + ", which none of this view's cohorts span (" + ctx.vStudies.join(", ") + ")");
  if (view.patient && !holders.includes(view.patient.study))
    return refuse("timeline", ctx, view.patient.study + " is " + excluded.find((e) => e.study === view.patient!.study)!.reason + ", so its patients' timelines cannot be shown");

  const defaults = TIMELINE_DEFAULT_COLUMNS;
  // the Source column: this portal's own database, or the peer's label (set where the peer pages its rows)
  const sourced = (parts: TablePart[]) => parts.map((p) => ({ ...p, source: "this portal (" + ctx.resolvers[p.study].instance.label + ")" }));
  let r: Rows;
  try {
    r = await runRows(ctx, "timeline", holders, q, defaults, shownColumns(q, TIMELINE_COLUMNS, defaults), show,
      (parts) => (db) => timelinePatientRowSource(sourced(parts), db),
      ctx.values ? { column: ctx.values, numeric: !!TIMELINE_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined, remote,
      view.patient && !ctx.page && !ctx.values ? { study: view.patient.study, patient: view.patient.id } : undefined);
  } catch (e) { return refuse("timeline", ctx, (e as Error).message); }
  const columns = TIMELINE_COLUMNS.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }));
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const rows = r.rows.map((x) => {
    const first = n(x.first), last = n(x.last);
    const vals: Record<string, string | number | null> = {
      patient: String(x.patient ?? ""), source: String(x.source ?? ""), samples: n(x.samples), events: n(x.events), first, last,
      span: first == null || last == null ? null : last - first, types: String(x.types ?? ""),
    };
    return { cohort: String(x.cohort), study: String(x.study), patient: String(x.patient ?? ""), sample: "", values: columns.map((c) => vals[c.id] ?? null) };
  });
  const list = { columns, shown: shownColumns(q, columns, defaults), defaults, query: q, rows, offset: r.offset, pageSize: show, lists: r.lists, total: r.total, all: r.all,
    ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) };
  if (ctx.page || ctx.values) return { kind: "timeline", cohorts: vNames, timeline: { ...list, patient: null }, participation: ctx.participationFor(ctx.vStudies, true) };

  // the drawn patient: the one the view names (checked to be one of its cohorts' patients), else the list's first
  const want = view.patient ? { study: view.patient.study, id: view.patient.id } : rows[0] ? { study: rows[0].study, id: rows[0].patient } : null;
  let patient: PatientTimeline | null = null;
  if (want) {
    const res = ctx.resolvers[want.study];
    try {
      // a patient the list places is one of the cohort's; one its query leaves out is asked about
      if (view.patient && !r.position) {
        // the named patient must be one of the view's cohorts' patients — asked of whoever holds them
        const inCohorts = vNames.filter((cn) => ctx.cohorts[cn].studies.includes(want.study));
        const member: TableQuery = { filters: { patient: { op: "equals", value: want.id } } };
        const rem = peerRowsFor(res, "timeline");
        const counts = rem
          ? (await rem.patientRows({ table: "timeline", parts: inCohorts.map((cn) => ({ cohort: cn, def: ctx.doc.cohorts[cn] })), query: member, defaults, mode: "counts" })).counts || []
          : await (res as unknown as PatientLevelCapable).rowsCounts("timeline:member", (db) => timelinePatientRowSource(
            sourced(inCohorts.map((cn) => ({ cohort: cn, study: want.study, cohortSql: res.cohortSql(ctx.doc.cohorts[cn]) }))), db), member, defaults);
        if (!counts.some((c) => c.n > 0)) return refuse("timeline", ctx, want.id + " is not a patient of " + (vNames.length > 1 ? "these cohorts" : "this cohort") + " in " + want.study);
      }
      if (!hasPatientTimeline(res)) return refuse("timeline", ctx, want.study + " cannot disclose a patient's timeline");
      patient = await (res as Resolver & PatientTimelineCapable).patientTimeline(want.id);
    } catch (e) { return refuse("timeline", ctx, (e as Error).message); }
  }

  const position: TimelineResult["position"] = patient ? await listPosition(r, !!view.patient, (first) =>
    runRows(ctx, "timeline", holders, q, defaults, shownColumns(q, TIMELINE_COLUMNS, defaults), 1,
      (parts) => (db) => timelinePatientRowSource(sourced(parts), db), undefined, remote, first)) : null;

  const sortName = q.sort ? columns.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null;
  // the figure that travels alone (MCP, exports): the patient's timeline with the view's own track and gap settings
  let svg: string | undefined;
  if (patient) {
    const o = { width: 1000, collapsed: view.collapsed || [], expandGaps: !!view.expandGaps };
    svg = timelineSvg(patient, o, timelineSummary(patient, timelineSvg(patient, o).layout, !!view.expandGaps)).svg;
  }
  return {
    kind: "timeline", cohorts: vNames, ...(svg ? { svg } : {}),
    timeline: { ...list, patient, position },
    method: timelineMethod({ cohorts: vNames, queryText: describeQuery(q, columns), sortName, desc: !!q.sort?.desc, shown: rows.length, lists: r.lists, excluded, instances: r.groups,
      patient: patient ? { study: patient.study, id: patient.patient, events: patient.events.length, samples: patient.samples.length } : null }),
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: (patient ? "" : "No patient to draw: the list is empty. ") +
      "The list is one row per patient of each cohort; event counts and days come from the study's timeline, in days from diagnosis as the study records them. " +
      (viaPeer.length ? "Patients of " + viaPeer.join(", ") + " come from " + [...new Set(viaPeer.map((st) => ctx.resolvers[st].instance.label))].join(", ") +
        " over MCP: a peer whose rules and this instance's both allow patient timelines (its Source column says so); every view their rules do not name treats it as aggregate-only. " : "") +
      tableTail(r, q, columns, "patient", "with patients who have a timeline first, then by patient id", excluded, vNames.length > 1),
  };
}

