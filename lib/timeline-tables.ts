// A patient's clinical events as the portal's Clinical Data tab lists them under "Timeline Data"
// (timeline/ClinicalEventsTables.tsx, timelineDataUtils.ts; PTB-CD-4): one table per event type, its
// columns START_DATE, STOP_DATE, EVENT_TYPE and then every attribute key in the order first seen,
// PATIENT_ID and the STYLE_* drawing hints left out; dates are days from diagnosis as recorded, a
// missing value blank. Pure.
import type { PatientEvent } from "./types.ts";

export interface EventTable { type: string; title: string; columns: string[]; rows: string[][] }

const DROP = (k: string) => k === "PATIENT_ID" || /^STYLE_/i.test(k);
/** the portal's heading for an event type: its first letter capitalised, the rest lower case (lodash capitalize) */
const capitalise = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

/** One table per event type, in the order the types first appear. */
export function eventTables(events: PatientEvent[]): EventTable[] {
  const byType = new Map<string, PatientEvent[]>();
  for (const e of events) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e);
  }
  return [...byType].map(([type, evs]) => {
    const keys: string[] = [];
    for (const e of evs) for (const [k] of e.attrs) if (!DROP(k) && !keys.includes(k)) keys.push(k);
    const columns = ["START_DATE", "STOP_DATE", "EVENT_TYPE", ...keys];
    const rows = evs.map((e) => {
      const a = new Map(e.attrs);
      return [String(e.start), e.end == null ? "" : String(e.end), e.type, ...keys.map((k) => a.get(k) ?? "")];
    });
    return { type, title: capitalise(type), columns, rows };
  });
}

/** A table's rows sorted by one column: the days (START_DATE, STOP_DATE) as numbers, a missing day last either way; the rest as text. */
export function sortEventRows(rows: string[][], columns: string[], col: number, desc: boolean): string[][] {
  const days = columns[col] === "START_DATE" || columns[col] === "STOP_DATE";
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[col], y = b[col];
    if (!days) return dir * x.localeCompare(y);
    if (x === "" || y === "") return (x === "" ? 1 : 0) - (y === "" ? 1 : 0);
    return dir * (Number(x) - Number(y));
  });
}

/**
 * The timeline's "Data (ZIP)" files as the portal writes them (timelineDataUtils.downloadZippedTracks):
 * a file per event type, in the order the types first appear, named data_timeline_<type, lower
 * case>.txt; a header PATIENT_ID, START_DATE, STOP_DATE, EVENT_TYPE and then every attribute key of
 * that type's events in the order first seen (the STYLE_* hints kept, as the portal keeps them), a
 * line per event; tab-separated, each line ended by "\n". The portal saves them as timeline.zip.
 */
export function timelineDataFiles(patient: string, events: PatientEvent[]): { name: string; text: string }[] {
  const byType = new Map<string, PatientEvent[]>();
  for (const e of events) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e);
  }
  return [...byType].map(([type, evs]) => {
    const keys: string[] = [];
    for (const e of evs) for (const [k] of e.attrs) if (k !== "PATIENT_ID" && !keys.includes(k)) keys.push(k);
    const lines = [["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", ...keys], ...evs.map((e) => {
      const a = new Map(e.attrs);
      return [patient, String(e.start), e.end == null ? "" : String(e.end), e.type, ...keys.map((k) => a.get(k) ?? "")];
    })];
    return { name: "data_timeline_" + type.toLowerCase() + ".txt", text: lines.map((l) => l.join("\t")).join("\n") + "\n" };
  });
}

/** the file the portal saves the timeline's data as */
export const TIMELINE_ZIP = "timeline.zip";
