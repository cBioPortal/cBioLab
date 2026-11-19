// One patient's clinical timeline as tracks — the model behind the `timeline` view, after
// cBioPortal's patient-view timeline (packages/cbioportal-clinical-timeline and
// src/pages/patientView/timeline/timeline_helpers.tsx in cbioportal-frontend): the same track
// order, the same attribute nesting (Treatment → type → subtype → agent, Lab test → test, …),
// the same collapse of a lone "Other" child into its parent, the same line charts for numeric
// lab results and the same numbered sample markers. Pure and dependency-free, so the browser
// card and the server figure (lib/timeline-svg.ts) build the identical tracks.
import { canonicalEventName, foldEventNames } from "./event-names.ts";
import type { PatientEvent, PatientSample } from "./types.ts";

export const OTHER = "Other";

/** Event types in this order first (folded), then the rest as they occur — the portal's sortOrder. */
export const TRACK_ORDER = [
  "Specimen", "Sample Acquisition", "Sequencing", "Surgery", "Med Onc", "Med Onc Assessment", "Status",
  "Diagnostics", "Diagnostic", "Imaging", "Imaging Assessment", "Treatment", "Diagnosis", "Lab_test", "Measurements",
];

/** Event type → the attribute keys its events nest by, outermost first — the portal's trackStructures. */
export const TRACK_STRUCTURES: Record<string, string[]> = {
  treatment: ["TREATMENT_TYPE", "SUBTYPE", "AGENT"],
  lab_test: ["TEST"],
  diagnosis: ["SUBTYPE"],
  pathology: ["SUBTYPE"],
  biobank: ["SPECIMEN_TYPE", "SITE", "SUBTYPE"],
};

/** Event types whose events are samples, drawn as the sample's numbered marker. */
export const SAMPLE_TRACK = /^(specimen|sample acquisition|sequencing)$/;

/** Attribute keys a study may use to style one event (honoured as the portal honours them). */
export const COLOR_KEY = "STYLE_COLOR", SHAPE_KEY = "STYLE_SHAPE";
export const POINT_COLOR = "rgb(31, 119, 180)";

/** The portal's sample colours, by normalized sample type. */
export const SAMPLE_COLORS: { re: RegExp; type: string; color: string }[] = [
  { re: /^primary/i, type: "Primary", color: "black" },
  { re: /recurr|progress/i, type: "Recurrence", color: "orange" },
  { re: /metasta/i, type: "Metastasis", color: "red" },
  { re: /^cfdna/i, type: "cfDNA", color: "blue" },
  { re: /xenograft/i, type: "Xenograft", color: "pink" },
  { re: /organoid/i, type: "Organoid", color: "palevioletred" },
  { re: /plasma/i, type: "Plasma", color: "gold" },
  { re: /^ctdna/i, type: "ctDNA", color: "lightblue" },
  { re: /urine/i, type: "Urine", color: "yellow" },
  { re: /exosome/i, type: "Exosome", color: "purple" },
  { re: /rna/i, type: "total RNA", color: "grey" },
];
export const SAMPLE_COLOR_UNKNOWN = "#333333";

export interface TlItem {
  /** index into the timeline's events */
  i: number;
  start: number;
  /** = start for a point event */
  end: number;
}
export interface TlTrack {
  /** stable path, e.g. "treatment.Chemo.CISPLATIN" — what `collapsed` names */
  uid: string;
  label: string;
  depth: number;
  items: TlItem[];
  children: TlTrack[];
  /** how its events are drawn */
  draw: "events" | "line" | "samples";
}

/** A sample's marker: its number (1-based, in collection order) and colour. */
export interface SampleMark { id: string; label: string; color: string; type: string }

export function attr(e: PatientEvent, key: string): string | undefined {
  const k = canonicalEventName(key);
  const hit = e.attrs.find(([a]) => canonicalEventName(a) === k);
  return hit ? hit[1] : undefined;
}

/**
 * A lab result as a number: a leading `<` or `>` is stripped, as the portal does, but the value
 * is marked censored so a figure can draw it as a bound rather than as a measurement.
 */
export function numericResult(e: PatientEvent): { v: number; censored: boolean } | null {
  const raw = attr(e, "RESULT") ?? attr(e, "VALUE");
  if (raw == null) return null;
  const s = String(raw).trim();
  const censored = /^[<>]/.test(s);
  const v = Number(s.replace(/^[<>]=?\s*/, ""));
  return s !== "" && Number.isFinite(v) ? { v, censored } : null;
}

const endOf = (e: PatientEvent) => (e.end != null && e.end > e.start ? e.end : e.start);
const itemOf = (e: PatientEvent, i: number): TlItem => ({ i, start: e.start, end: endOf(e) });


function nest(events: PatientEvent[], idx: number[], keys: string[], uid: string, label: string, depth: number): TlTrack {
  if (!keys.length) return { uid, label, depth, items: idx.map((i) => itemOf(events[i], i)), children: [], draw: "events" };
  const groups = new Map<string, number[]>();
  for (const i of idx) {
    const v = attr(events[i], keys[0]);
    const g = v == null || String(v).trim() === "" ? OTHER : String(v).trim();
    (groups.get(g) || groups.set(g, []).get(g)!).push(i);
  }
  const children = [...groups.entries()].map(([v, ix]) => nest(events, ix, keys.slice(1), uid + "." + v, v, depth + 1));
  return { uid, label, depth, items: [], children, draw: "events" };
}

/** A parent whose only child is "Other" absorbs it, until that is no longer so — the portal's collapseOTHERTracks. */
function absorbOther(t: TlTrack): TlTrack {
  while (t.children.length === 1 && t.children[0].label === OTHER) {
    const o = t.children[0];
    t.items = t.items.concat(o.items);
    t.children = o.children.map((c) => reroot(c, t.uid, t.depth + 1));
  }
  t.children.forEach(absorbOther);
  return t;
}
function reroot(t: TlTrack, parentUid: string, depth: number): TlTrack {
  const uid = parentUid + "." + t.label;
  return { ...t, uid, depth, children: t.children.map((c) => reroot(c, uid, depth + 1)) };
}

/**
 * A sub-track's place among its siblings, as the portal's sortNestedTracks takes it: the start of its
 * own first event, or 0 for a track whose events are all in its sub-tracks (the portal's parent
 * tracks hold none). Ties keep the order the values first occur in the patient's events.
 */
export const trackSortKey = (t: Pick<TlTrack, "items">): number => t.items.length ? t.items[0].start : 0;
function sortChildren(t: TlTrack): TlTrack {
  // a stable sort: equal keys stay in first-occurrence order
  t.children.sort((a, b) => trackSortKey(a) - trackSortKey(b));
  t.children.forEach(sortChildren);
  return t;
}

/** A lab-test leaf is a line chart when every one of its results is a number — the portal's rule. */
function markLines(t: TlTrack, events: PatientEvent[]): void {
  if (!t.children.length && t.items.length && t.items.every((it) => numericResult(events[it.i]) != null)) t.draw = "line";
  t.children.forEach((c) => markLines(c, events));
}

/**
 * The patient's tracks, in the portal's order: event types listed in TRACK_ORDER first, the rest
 * as they first occur. Event types are grouped by their case-folded name (lib/event-names.ts —
 * the label is the commonest spelling, upper-cased as the portal's) and nested by TRACK_STRUCTURES.
 */
export function buildTracks(events: PatientEvent[]): TlTrack[] {
  const folded = foldEventNames(events.map((e) => ({ name: e.type, n: 1 })));
  const label = new Map(folded.map((f) => [f.canonical, f.label]));
  const byType = new Map<string, number[]>();
  events.forEach((e, i) => {
    const k = canonicalEventName(e.type);
    if (k) (byType.get(k) || byType.set(k, []).get(k)!).push(i);
  });
  const order = [...new Set([...TRACK_ORDER.map(canonicalEventName), ...byType.keys()])].filter((k) => byType.has(k));
  return order.map((k) => {
    const idx = byType.get(k)!;
    // a root track is named by its event type upper-cased, as the portal names it (timeline_helpers: eventType.toUpperCase())
    const t = absorbOther(nest(events, idx, TRACK_STRUCTURES[k] || [], k, rootLabel(label.get(k) || k), 0));
    if (SAMPLE_TRACK.test(k)) t.draw = "samples";
    if (k === "lab_test" || k === "measurements") markLines(t, events);
    return sortChildren(t);
  });
}

/** A root track's label: its event type as spelled most often, upper-cased (PAT-TL-TR-1: "SPECIMEN", "LAB_TEST"). */
export const rootLabel = (type: string): string => type.toUpperCase();
/** A track's label as the figure shows it: underscores dropped, as the portal's TrackHeader getTrackLabel shows every track ("LABTEST"). */
export const trackLabel = (t: Pick<TlTrack, "label">): string => t.label.replace(/_/g, "");

/** Every item under a track, its own and its descendants' — what a collapsed track shows. */
export function allItems(t: TlTrack): TlItem[] {
  return t.items.concat(...t.children.map(allItems));
}

/** The items the timeline's axis spans: every drawn track's events (an event with no type is not drawn). */
export const timelineAxisItems = (events: PatientEvent[]): TlItem[] => buildTracks(events).flatMap(allItems);

/** The rows drawn: each track, then its children unless it is collapsed (which then carries all their items). */
export function flattenTracks(tracks: TlTrack[], collapsed: ReadonlySet<string>): { track: TlTrack; items: TlItem[]; collapsed: boolean }[] {
  const out: { track: TlTrack; items: TlItem[]; collapsed: boolean }[] = [];
  const walk = (t: TlTrack) => {
    const shut = t.children.length > 0 && collapsed.has(t.uid);
    out.push({ track: t, items: shut ? allItems(t) : t.items, collapsed: shut });
    if (!shut) t.children.forEach(walk);
  };
  tracks.forEach(walk);
  return out;
}

/** The day each sample was collected: the earliest sample event (specimen, acquisition, sequencing) naming it by SAMPLE_ID. */
export function sampleDays(events: PatientEvent[]): Map<string, number> {
  const day = new Map<string, number>();
  for (const e of events) {
    if (!SAMPLE_TRACK.test(canonicalEventName(e.type))) continue;
    const id = attr(e, "SAMPLE_ID");
    if (id && (!day.has(id) || e.start < day.get(id)!)) day.set(id, e.start);
  }
  return day;
}

/**
 * The patient's samples numbered in collection order (the day a sample event names it, then
 * primary before metastasis before cfDNA, then by id — the portal's sortSamples), coloured by
 * sample type.
 */
export function sampleMarks(samples: PatientSample[], events: PatientEvent[]): Map<string, SampleMark> {
  const day = sampleDays(events);
  const typeRank = (t: string) => { const i = ["primary", "metastasis", "cfdna"].indexOf(normalizeSampleType(t).toLowerCase()); return i < 0 ? 3 : i; };
  const ids = [...new Set([...samples.map((s) => s.id), ...day.keys()])];
  const typeOf = new Map(samples.map((s) => [s.id, s.type]));
  ids.sort((a, b) => (day.get(a) ?? Infinity) - (day.get(b) ?? Infinity) ||
    typeRank(typeOf.get(a) || "") - typeRank(typeOf.get(b) || "") || a.localeCompare(b, undefined, { numeric: true }));
  return new Map(ids.map((id, n) => {
    const raw = typeOf.get(id) || "";
    const hit = SAMPLE_COLORS.find((c) => c.re.test(raw.trim()));
    return [id, { id, label: String(n + 1), color: hit ? hit.color : SAMPLE_COLOR_UNKNOWN, type: hit ? hit.type : raw }];
  }));
}

export function normalizeSampleType(raw: string): string {
  const hit = SAMPLE_COLORS.find((c) => c.re.test(String(raw || "").trim()));
  return hit ? hit.type : String(raw || "");
}

/** "1 year, 2 months, 3 days" — the portal's formatDate for a day offset. */
export function formatDays(d: number): string {
  const neg = d < 0;
  let n = Math.abs(d);
  const y = Math.floor(n / 365); n -= y * 365;
  const m = Math.floor(n / 30); n -= m * 30;
  const parts: string[] = [];
  if (y > 0) parts.push(y + " year" + (y === 1 ? "" : "s"));
  if (m > 0) parts.push(m + " month" + (m === 1 ? "" : "s"));
  if (d === 0 || n > 0) parts.push(Math.floor(n) + " day" + (Math.floor(n) === 1 ? "" : "s"));
  return (neg ? "-" : "") + parts.join(", ");
}

// ---------------------------------------------------------------------------
// the time axis: one tick a year, with stretches of four or more empty years cut out

export const YEAR = 365;
const TRIM_MIN_EMPTY = 4;
const BUFFER_DAYS = 20;

export interface AxisTick {
  /** first and last day the tick covers */
  start: number; end: number;
  /** a cut: empty years drawn as one squiggle, covering start..realEnd */
  trim?: { realEnd: number; years: number };
}

/**
 * Year ticks from the first event to the last, padded as the portal pads them; with `trim`, every
 * run of at least four years holding no event (starts, ends or any part of a range) is cut to one
 * squiggle — keeping the run's first and last year as ordinary ticks, so no point appears to sit
 * inside a cut. Returns the ticks and the years cut, so a caption can say so.
 */
export function axisTicks(items: TlItem[], trim: boolean): { ticks: AxisTick[]; cutYears: number } {
  if (!items.length) return { ticks: [], cutYears: 0 };
  const lo = Math.min(...items.map((i) => i.start)), hi = Math.max(...items.map((i) => i.end));
  const full: { start: number; end: number; busy: boolean }[] = [];
  for (let p = Math.floor(lo / YEAR) * YEAR; p < Math.max(Math.ceil(hi / YEAR) * YEAR, Math.floor(lo / YEAR) * YEAR + 1); p += YEAR) {
    const s = p, e = p + YEAR - 1;
    full.push({ start: s, end: e, busy: items.some((i) => i.start <= e && i.end >= s) });
  }
  // the axis runs from BUFFER_DAYS before the first event to BUFFER_DAYS after the last
  if (lo - BUFFER_DAYS < full[0].start) full.unshift({ start: lo - BUFFER_DAYS, end: full[0].start - 1, busy: false });
  else full[0].start = lo - BUFFER_DAYS;
  full[full.length - 1].end = hi + BUFFER_DAYS;
  if (!trim) return { ticks: full.map(({ start, end }) => ({ start, end })), cutYears: 0 };
  const ticks: AxisTick[] = [];
  let cutYears = 0, run: typeof full = [];
  const flush = (closing: boolean) => {
    if (closing && run.length >= TRIM_MIN_EMPTY) {
      const mid = run.slice(1, -1);
      ticks.push({ start: run[0].start, end: run[0].end });
      ticks.push({ start: mid[0].start, end: mid[0].end, trim: { realEnd: mid[mid.length - 1].end, years: mid.length } });
      ticks.push({ start: run[run.length - 1].start, end: run[run.length - 1].end });
      cutYears += mid.length;
    } else ticks.push(...run.map(({ start, end }) => ({ start, end })));
    run = [];
  };
  for (const t of full) {
    if (t.busy) { flush(true); ticks.push({ start: t.start, end: t.end }); } else run.push(t);
  }
  flush(false);
  return { ticks, cutYears };
}

/** Width a cut is drawn at, in days of the uncut scale. */
export const TRIM_DAYS = 120;

/** Day → x in [0, width], skipping the cuts. Each ordinary tick is its own length; a cut is TRIM_DAYS. */
export function dayScale(ticks: AxisTick[], width: number): { x: (day: number) => number; span: number } {
  const len = (t: AxisTick) => (t.trim ? TRIM_DAYS : t.end - t.start + 1);
  const span = ticks.reduce((n, t) => n + len(t), 0) || 1;
  const k = width / span;
  const offs: number[] = [];
  let acc = 0;
  for (const t of ticks) { offs.push(acc); acc += len(t); }
  const x = (day: number) => {
    for (let j = 0; j < ticks.length; j++) {
      const t = ticks[j], end = t.trim ? t.trim.realEnd : t.end;
      if (day <= end || j === ticks.length - 1) {
        const into = t.trim ? TRIM_DAYS / 2 : Math.max(0, Math.min(day - t.start, t.end - t.start + 1));
        return (offs[j] + into) * k;
      }
    }
    return width;
  };
  return { x, span };
}

/** the portal's month on the axis (cbioportal-clinical-timeline TickIntervalEnum.MONTH) */
export const MONTH = 30.41666;

/**
 * The month ticks inside the year starting at `yearStart`, drawn when a year is wider than 150 px, as
 * the portal's axis draws them (TickAxis): one at each of the 11 months after the year's start, every
 * 4th labelled, every one past 700 px a year. A label counts months from the year's start — "4m" in
 * the first year, "2y 4m" later — and, before diagnosis, back from the next year: "-8m", "-1y 8m".
 */
export function monthTicks(yearStart: number, pxPerYear: number): { day: number; label: string | null }[] {
  if (!(pxPerYear > 150)) return [];
  const count = Math.round(yearStart / YEAR);
  const out: { day: number; label: string | null }[] = [];
  for (let i = 1; i < 12; i++) {
    const shown = i % 4 === 0 || pxPerYear > 700;
    let label: string | null = null;
    if (shown) {
      if (count < 0) {
        const m = 12 - i, major = count + 1 === 0 ? "" : (count + 1) + "y";
        label = count === -1 ? "-" + m + "m" : major + " " + m + "m";
      } else label = count === 0 ? i + "m" : count + "y " + i + "m";
    }
    out.push({ day: yearStart + MONTH * i, label });
  }
  return out;
}

/** A year tick's label as the portal writes it: "0", "2y", "-3y". */
export function yearLabel(startDay: number): string {
  const n = Math.round(startDay / YEAR);
  return n === 0 ? "0" : n + "y";
}

/** One mark of an axis over `ticks`, in drawing order: see {@link axisMarks}. */
export type AxisMark =
  /** a cut: where it sits and how many empty years it stands for */
  | { kind: "cut"; x: number; years: number }
  /** a year line; its label, centred at `label.x`, where it has room */
  | { kind: "year"; x: number; day: number; label?: { x: number; text: string } }
  /** a month tick inside a year wider than 150 px; its label where it has room */
  | { kind: "month"; x: number; label?: string };

export function axisMarks(ticks: AxisTick[], X: (day: number) => number, lo: number, hi: number, measure: (s: string) => number): AxisMark[] {
  const out: AxisMark[] = [];
  const cuts = ticks.filter((tk) => tk.trim).map((tk) => X(tk.start));
  let lastRight = -Infinity;
  for (const tk of ticks) {
    if (tk.trim) {
      const cx = X(tk.start);
      out.push({ kind: "cut", x: cx, years: tk.trim.years });
      lastRight = Math.max(lastRight, cx + 8);
      continue;
    }
    for (let d = Math.ceil(tk.start / YEAR) * YEAR; d <= tk.end; d += YEAR) {
      const x = X(d), text = yearLabel(d), w = measure(text);
      const cx = Math.min(Math.max(x, lo + w / 2), hi - w / 2);
      const clear = cx - w / 2 > lastRight + 6 && cuts.every((c) => Math.abs(c - cx) > w / 2 + 8);
      out.push({ kind: "year", x, day: d, ...(clear ? { label: { x: cx, text } } : {}) });
      if (clear) lastRight = cx + w / 2;
      for (const m of monthTicks(d, X(d + YEAR) - x)) {
        if (m.day > tk.end) break;
        const mx = X(m.day);
        let shown = false;
        if (m.label) {
          const mw = measure(m.label);
          shown = mx - mw / 2 > lastRight + 6 && mx + mw / 2 < hi && cuts.every((c) => Math.abs(c - mx) > mw / 2 + 8);
          if (shown) lastRight = mx + mw / 2;
        }
        out.push({ kind: "month", x: mx, ...(shown ? { label: m.label! } : {}) });
      }
    }
  }
  return out;
}

/**
 * A sample event's tooltip rows as the portal's (TimelineStore's sample tooltip, PAT-TL-TT-3): the
 * event's attributes merged with the sample's own clinical attributes (`own`), the event's first where
 * both name a key, keys upper-cased with spaces for "_", sorted by key; SAMPLE_ID (shown above them)
 * and the STYLE_* drawing hints left out.
 */
export function sampleTipRows(e: PatientEvent, own: [string, string][]): [string, string][] {
  const merged = new Map<string, string>();
  for (const [k, v] of [...e.attrs, ...own]) {
    if (/^STYLE_/i.test(k) || k.toUpperCase() === "SAMPLE_ID") continue;
    const key = k.toUpperCase().replace(/_/g, " ");
    if (!merged.has(key)) merged.set(key, v);
  }
  return [...merged].sort(([a], [b]) => a.localeCompare(b));
}
