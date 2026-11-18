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

/**
 * The events grouped by type, in the order the types first appear, each with its attribute keys in
 * the order first seen (those `drop` names left out) and each event's values for them: a key's first
 * value on the event, as the portal's getValueFromAttribute finds it, "" where it has none.
 */
function byType(events: PatientEvent[], drop: (k: string) => boolean): { type: string; keys: string[]; events: { e: PatientEvent; values: string[] }[] }[] {
  const groups = new Map<string, PatientEvent[]>();
  for (const e of events) {
    if (!groups.has(e.type)) groups.set(e.type, []);
    groups.get(e.type)!.push(e);
  }
  return [...groups].map(([type, evs]) => {
    const keys: string[] = [];
    for (const e of evs) for (const [k] of e.attrs) if (!drop(k) && !keys.includes(k)) keys.push(k);
    return { type, keys, events: evs.map((e) => ({ e, values: keys.map((k) => e.attrs.find(([x]) => x === k)?.[1] ?? "") })) };
  });
}

const days = (e: PatientEvent) => [String(e.start), e.end == null ? "" : String(e.end)];

/** One table per event type, in the order the types first appear. */
export function eventTables(events: PatientEvent[]): EventTable[] {
  return byType(events, DROP).map(({ type, keys, events: evs }) => ({
    type, title: capitalise(type), columns: ["START_DATE", "STOP_DATE", "EVENT_TYPE", ...keys],
    rows: evs.map(({ e, values }) => [...days(e), e.type, ...values]),
  }));
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
 * A PATIENT_ID attribute is not repeated as a second column: the portal's events never carry one
 * (the patient is a field of the event there), and the patient id is the first column.
 */
export function timelineDataFiles(patient: string, events: PatientEvent[]): { name: string; text: string }[] {
  const used = new Set<string>();
  return byType(events, (k) => k === "PATIENT_ID").map(({ type, keys, events: evs }) => {
    const lines = [["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", ...keys], ...evs.map(({ e, values }) => [patient, ...days(e), e.type, ...values])];
    return { name: entryName(type, used), text: lines.map((l) => l.join("\t")).join("\n") + "\n" };
  });
}

/**
 * A type's file name, data_timeline_<type, lower case>.txt, kept to one plain file name: any
 * character outside a-z, 0-9, "_", "-" becomes "_" (so no "/", "\\" or ".." can make a path); a name
 * already used (two types that differ only in case) takes "_2", "_3", … rather than replacing it,
 * where the portal's archive would keep only one of the two.
 */
function entryName(type: string, used: Set<string>): string {
  const base = "data_timeline_" + type.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  let name = base + ".txt";
  for (let n = 2; used.has(name); n++) name = base + "_" + n + ".txt";
  used.add(name);
  return name;
}

/** the file the portal saves the timeline's data as */
export const TIMELINE_ZIP = "timeline.zip";
