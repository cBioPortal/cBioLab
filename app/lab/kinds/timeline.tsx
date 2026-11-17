"use client";
// The timeline view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindUi } from "./kind-ui.ts";
import { TimelineBody } from "../timeline-body";
import { useState } from "react";
import { Input } from "../../_ui/input";
import { eventTables, sortEventRows, type EventTable } from "../../../lib/timeline-tables.ts";
import type { PatientEvent } from "../../../lib/types.ts";

/** One event type's table: a header click sorts by that column (the days as numbers, the rest as text), the rows filtered by a box. */
function EventTypeTable({ t }: { t: EventTable }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const f = filter.trim().toLowerCase();
  let rows = f ? t.rows.filter((r) => r.join(" ").toLowerCase().includes(f)) : t.rows;
  if (sort) rows = sortEventRows(rows, t.columns, sort.col, sort.desc);
  return (
    <section data-tw className="flex flex-col gap-1.5" aria-label={t.title}>
      <div className="flex items-center gap-2">
        <h3 className="text-md font-semibold">{t.title}</h3>
        <Input className="h-7 w-48" placeholder="filter" aria-label={"filter " + t.title} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-sm text-muted-foreground">{rows.length === t.rows.length ? t.rows.length + " events" : rows.length + " of " + t.rows.length + " events"}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="dt-table [&_th]:text-left [&_td]:pr-4 [&_th]:pr-4">
          <thead><tr>{t.columns.map((c, i) => (
            <th key={c}><button type="button" className="font-semibold hover:underline" onClick={() => setSort(sort?.col === i ? { col: i, desc: !sort.desc } : { col: i, desc: false })}
              aria-label={"sort by " + c}>{c}{sort?.col === i ? (sort.desc ? " ↓" : " ↑") : ""}</button></th>))}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

/** The patient's events as the portal's Clinical Data tab lists them: "Timeline Data", a table per event type. */
function TimelineTables({ events }: { events: PatientEvent[] }) {
  const tables = eventTables(events);
  if (!tables.length) return <p className="note">No timeline events are recorded for this patient.</p>;
  return <div data-tw className="flex flex-col gap-4">{tables.map((t) => <EventTypeTable key={t.type} t={t} />)}</div>;
}

export const timelineUi: KindUi<"timeline"> = {
  kind: "timeline",
  label: "Patient timeline (one patient at a time)",
  category: "patient",
  title: "Patient timeline",
  maxCohorts: 1,
  cohortInHeader: true,
  why: (k) => k.events.length ? null : "this study records no timeline events",
  sub: (_spec, v) => {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{v.timeline ? v.timeline.total.toLocaleString() + " patients · " : ""}clinical events from diagnosis</>;
  },
  body: (c) => c.v.timeline && c.spec.tables ? (c.v.timeline.patient ? <TimelineTables events={c.v.timeline.patient.events} /> : <p className="note">No patient to list.</p>)
    : c.v.timeline ? <TimelineBody t={c.v.timeline} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} patch={c.patch} fixed={c.fixedPatient} /> : null,
  drawsOwnWaiting: true,
};
