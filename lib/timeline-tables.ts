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
