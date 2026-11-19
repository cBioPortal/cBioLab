// The timeline figure: one patient's tracks drawn as cBioPortal's patient-view timeline draws
// them — a year axis with empty stretches cut, a header column of nested track labels, events as
// 4px points and 5px bars, same-day events stacked with their count, samples as numbered markers,
// numeric lab results as line charts. Browser-safe (the lab card draws with it) and used by
// lib/view-svg.ts for the MCP figure, so both are the same drawing.
import { esc, frame, caption, palette, label, textWidth, textOn, fmtNum, r1, FS, SW, type SvgOpts } from "./svg-kit.ts";
import {
  buildTracks, flattenTracks, axisTicks, dayScale, sampleMarks, numericResult, attr, formatDays, axisMarks,
  COLOR_KEY, SHAPE_KEY, POINT_COLOR, type TlItem, type TlTrack, type SampleMark,
} from "./timeline-tracks.ts";
import type { PatientEvent, PatientTimeline } from "./types.ts";

const AXIS_H = 26, TRACK_H = 20, LINE_H = 50, PAD_R = 14, INDENT = 14, R = 4;
/** the header column's bounds: wide enough for most labels, never more than this share of the figure */
const HEADER_MIN = 120, HEADER_SHARE = 0.3;

type Pal = ReturnType<typeof palette>;

export interface TimelineSvgOpts extends SvgOpts {
  collapsed?: readonly string[];
  expandGaps?: boolean;
  /** mark events and headers with data- attributes, for the card's tooltips and toggles */
  interactive?: boolean;
  /**
   * the stretch of the plot to draw across its whole width, as fractions [from, to] of the unzoomed
   * plot (the portal's drag to zoom, PAT-TL-ZM-3); marks outside it are clipped
   */
  zoom?: readonly [number, number];
}

function colorOf(e: PatientEvent): string {
  const c = attr(e, COLOR_KEY);
  return c && /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([0-9., ]+\))$/i.test(c.trim()) ? c.trim() : POINT_COLOR;
}

function shape(e: PatientEvent, y: number, fill: string, pal: Pal): string {
  if (/^status$/i.test(e.type.trim()) && e.attrs.some(([k, v]) => /^status$/i.test(k) && /^deceased$/i.test(v)))
    return `<rect x="-3.5" y="${y - 3.5}" width="7" height="7" fill="${pal.ink}" transform="rotate(45 0 ${y})"/>`;
  const s = (attr(e, SHAPE_KEY) || "circle").toLowerCase().trim();
  const k = 0.8 * R, t = 1.3 * R;
  if (s === "square") return `<rect x="${-k}" y="${y - k}" width="${2 * k}" height="${2 * k}" fill="${fill}"/>`;
  if (s === "diamond") return `<rect x="${-k}" y="${y - k}" width="${2 * k}" height="${2 * k}" fill="${fill}" transform="rotate(45 0 ${y})"/>`;
  if (s === "triangle") return `<polygon points="0,${y - t} ${t * Math.sin(Math.PI / 3)},${y + t / 2} ${-t * Math.sin(Math.PI / 3)},${y + t / 2}" fill="${fill}"/>`;
  if (s === "star") {
    const pts = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? t / 2 : t, a = i * Math.PI / 5; return `${(r * Math.sin(a)).toFixed(2)},${(y - r * Math.cos(a)).toFixed(2)}`; });
    return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
  }
  return `<circle cx="0" cy="${y}" r="${R}" fill="${fill}"/>`;
}

/** Same-day events as the portal stacks them: two or three offset sheets, and the count beside them when it has room. */
function stack(fills: string[], y: number, n: number, pal: Pal, count: boolean): string {
  const w = 9, ry = 0.52 * w / 2;
  const sheet = (dy: number, f: string, mask: boolean) =>
    `<ellipse cx="0" cy="${y + dy}" rx="${w / 2}" ry="${ry}" fill="${f}" stroke="${pal.ink}" stroke-width="0.2"/>` +
    (mask ? `<ellipse cx="0" cy="${y + dy - 1}" rx="${w / 2}" ry="${ry}" fill="${pal.bg}"/>` : "");
  const f = fills.length === 2 ? fills : [0, 1, 2].map((i) => fills[i % fills.length]);
  const body = f.length === 2
    ? sheet(w / 8, f[1], true) + sheet(-w / 8, f[0], false)
    : sheet(w / 4, f[2], true) + sheet(0, f[1], true) + sheet(-w / 4, f[0], false);
  return body + (count ? label(w / 2 + 2, y + FS.small * 0.35, n, { size: FS.small, fill: pal.muted }) : "");
}

function sampleMarker(marks: SampleMark[], y: number, pal: Pal): string {
  if (marks.length === 1) {
    const m = marks[0];
    // a thin ring in the theme's grey, so a black (primary) marker still shows on a dark page
    return `<circle cx="0" cy="${y}" r="7" fill="${esc(m.color)}" stroke="${pal.muted}" stroke-width="${SW.hair}"/>` +
      label(0, y + FS.small * 0.35, m.label, { size: FS.small, fill: textOn(m.color), anchor: "middle" });
  }
  const nums = marks.map((m) => Number(m.label)).sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < nums.length;) {
    let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    ranges.push(i === j ? String(nums[i]) : nums[i] + "-" + nums[j]); i = j + 1;
  }
  const text = ranges.join(", "), w = textWidth(text, FS.small) + 10, h = 14;
  const colors = [...new Set(marks.sort((a, b) => Number(a.label) - Number(b.label)).map((m) => m.color))];
  const seg = w / colors.length;
  const id = "tlclip" + Math.round(y) + "_" + text.replace(/[^0-9]/g, "_");
  return `<clipPath id="${id}"><rect x="${-w / 2}" y="${y - h / 2}" rx="${h / 2}" width="${w}" height="${h}"/></clipPath>` +
    `<g clip-path="url(#${id})">` + colors.map((c, i) => `<rect x="${-w / 2 + i * seg}" y="${y - h / 2}" width="${seg + 0.5}" height="${h}" fill="${esc(c)}"/>`).join("") + `</g>` +
    label(0, y + FS.small * 0.35, text, { size: FS.small, fill: textOn(colors[0]), anchor: "middle" });
}

const groupBy = <T,>(xs: T[], key: (x: T) => string): T[][] => {
  const m = new Map<string, T[]>();
  for (const x of xs) (m.get(key(x)) || m.set(key(x), []).get(key(x))!).push(x);
  return [...m.values()];
};

export interface TimelineLayout {
  tracks: TlTrack[];
  rows: { track: TlTrack; items: TlItem[]; collapsed: boolean; y: number; h: number }[];
  cutYears: number;
  censored: number;
  width: number; height: number;
  /** the plot's left edge and width in the figure: where a drag to zoom is read */
  plot: { x: number; width: number };
}

/**
 * The figure, and what a caption must say about it. `interactive` adds the data- attributes the
 * card reads: `data-ev` (event indices) on each mark, `data-uid` on each header that collapses.
 */
/** The timeline: `svg` whole, `body` its marks without the frame (for a figure that draws it inside its own), and its layout. */
export function timelineSvg(t: PatientTimeline, o: TimelineSvgOpts = {}, captionText = ""): { svg: string; body: string; layout: TimelineLayout } {
  const W = Math.max(480, o.width ?? 900);
  const pal = palette(o.theme);
  const ev = t.events;
  const tracks = buildTracks(ev);
  const flat = flattenTracks(tracks, new Set(o.collapsed || []));
  const all = flat.flatMap((r) => r.items);
  const { ticks, cutYears } = axisTicks(all, !o.expandGaps);
  const marks = sampleMarks(t.samples, ev);

  // the header column: as wide as its labels (and a line chart's value ticks) need, within bounds
  const headText = (r: (typeof flat)[number]) => (r.track.children.length ? (r.collapsed ? "▸ " : "▾ ") : "") + r.track.label;
  const lineRange = (items: TlItem[]) => {
    const vals = items.map((it) => numericResult(ev[it.i])!.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    return { lo, hi };
  };
  const tickRoom = Math.max(0, ...flat.filter((r) => r.track.draw === "line" && !r.collapsed).map((r) => {
    const { lo, hi } = lineRange(r.items);
    return Math.max(textWidth(fmtNum(lo), FS.small), textWidth(fmtNum(hi), FS.small)) + 12;
  }));
  const labelsW = Math.max(0, ...flat.map((r) => 5 + r.track.depth * INDENT + textWidth(headText(r), FS.body, r.track.depth === 0 ? 600 : 400)));
  const HW = Math.round(Math.min(W * HEADER_SHARE, Math.max(HEADER_MIN, labelsW + tickRoom + 8)));
  const PW = W - HW - PAD_R;
  const { x: dx } = dayScale(ticks, PW);
  const z = o.zoom && o.zoom[1] > o.zoom[0] ? o.zoom : null;
  const X = z ? (d: number) => HW + (dx(d) / PW - z[0]) / (z[1] - z[0]) * PW : (d: number) => HW + dx(d);
  let y = AXIS_H, censored = 0;
  const rows = flat.map((r) => {
    const h = r.track.draw === "line" && !r.collapsed ? LINE_H : TRACK_H;
    const row = { ...r, y, h };
    y += h;
    return row;
  });
  const H = y + 6;
  const parts: string[] = [];
  // the axis marks and the events: clipped to the plot when zoomed, so the header column stays clear
  const plot: string[] = z ? [] : parts;

  parts.push(`<line x1="${HW}" y1="${AXIS_H - 0.5}" x2="${HW + PW}" y2="${AXIS_H - 0.5}" stroke="${pal.muted}" stroke-width="${SW.line}"/>`);
  // the axis: a year line and label at each year start; a cut as a squiggle with a guide down the
  // plot; the months inside a wide year as short ticks, some labelled (axisMarks, shared)
  for (const m of axisMarks(ticks, X, HW, W - 2, (t) => textWidth(t, FS.small))) {
    // zoomed, a mark outside the stretch shown is left out (its label would be held at the plot's edge)
    if (z && (m.x < HW - 0.5 || m.x > HW + PW + 0.5)) continue;
    if (m.kind === "cut")
      plot.push(`<g transform="translate(${m.x.toFixed(1)} 0)"><title>${m.years} years with no events, cut</title>` +
        `<path d="M-6 ${AXIS_H - 9} q3 -6 6 0 t6 0" fill="none" stroke="${pal.muted}" stroke-width="1.2"/>` +
        `<line x1="0" x2="0" y1="${AXIS_H}" y2="${H - 4}" stroke="${pal.muted}" stroke-width="${SW.hair}" stroke-dasharray="2 3"/></g>`);
    else if (m.kind === "year") {
      const xx = m.x.toFixed(1);
      plot.push(`<line x1="${xx}" x2="${xx}" y1="${AXIS_H - 4}" y2="${H - 4}" stroke="${m.day === 0 ? pal.muted : pal.line}" stroke-width="${SW.hair}"/>`);
      if (m.label) plot.push(label(m.label.x, AXIS_H - 8, m.label.text, { size: FS.small, fill: pal.muted, anchor: "middle" }));
    } else {
      plot.push(`<line x1="${r1(m.x)}" x2="${r1(m.x)}" y1="${AXIS_H - 3}" y2="${AXIS_H}" stroke="${pal.muted}" stroke-width="${SW.hair}"/>`);
      if (m.label) plot.push(label(m.x, AXIS_H - 8, m.label, { size: FS.small, fill: pal.muted, anchor: "middle" }));
    }
  }

  for (const r of rows) {
    const tr = r.track, cy = r.y + TRACK_H / 2;
    // header
    const hasKids = tr.children.length > 0;
    const x0 = 5 + tr.depth * INDENT;
    const room = HW - x0 - (tr.draw === "line" && !r.collapsed ? tickRoom : 0) - 6;
    parts.push(`<g${o.interactive && hasKids ? ` class="tl-h" data-uid="${esc(tr.uid)}" style="cursor:pointer"` : ""}>` +
      `<title>${esc(tr.label)}</title>` +
      label(x0, cy + FS.body * 0.35, headText(r), { size: FS.body, fill: pal.ink, weight: tr.depth === 0 ? 600 : 400, maxW: room })
        .replace(/<title>.*?<\/title>/, "") + `</g>`);
    parts.push(`<line x1="0" x2="${W}" y1="${r.y + r.h - 0.5}" y2="${r.y + r.h - 0.5}" stroke="${pal.line}" stroke-width="${SW.hair}" opacity="0.6"/>`);
    const tag = (ix: number[]) => (o.interactive ? ` class="tl-m" data-ev="${ix.join(",")}"` : "");

    if (tr.draw === "line" && !r.collapsed) {
      const pts = r.items.map((it) => ({ it, v: numericResult(ev[it.i])! })).sort((a, b) => a.it.start - b.it.start);
      const { lo, hi } = lineRange(r.items);
      const yy = (v: number) => r.y + r.h - 7 - (v - lo) / (hi - lo) * (r.h - 14);
      for (const v of [hi, lo]) {
        parts.push(label(HW - 8, yy(v) + FS.small * 0.35, fmtNum(v), { size: FS.small, fill: pal.muted, anchor: "end" }) +
          `<line x1="${HW - 5}" x2="${HW}" y1="${yy(v)}" y2="${yy(v)}" stroke="${pal.muted}" stroke-width="${SW.line}"/>`);
      }
      plot.push(`<polyline fill="none" stroke="${pal.muted}" stroke-width="${SW.line}" points="${pts.map((p) => X(p.it.start).toFixed(1) + "," + yy(p.v.v).toFixed(1)).join(" ")}"/>`);
      for (const p of pts) {
        const c = colorOf(ev[p.it.i]);
        if (p.v.censored) censored++;
        plot.push(`<g${tag([p.it.i])} transform="translate(${X(p.it.start).toFixed(1)} 0)">` +
          (p.v.censored ? `<circle cx="0" cy="${yy(p.v.v)}" r="3" fill="${pal.bg}" stroke="${c}" stroke-width="1.5"/>` : `<circle cx="0" cy="${yy(p.v.v)}" r="3" fill="${c}"/>`) + `</g>`);
      }
      continue;
    }

    if (tr.draw === "samples") {
      for (const g of groupBy(r.items, (it) => String(it.start))) {
        const ms = [...new Set(g.map((it) => attr(ev[it.i], "SAMPLE_ID")).filter(Boolean) as string[])].map((id) => marks.get(id)).filter(Boolean) as SampleMark[];
        plot.push(`<g${tag(g.map((it) => it.i))} transform="translate(${X(g[0].start).toFixed(1)} 0)">` +
          (ms.length ? sampleMarker(ms, cy, pal) : `<circle cx="0" cy="${cy}" r="${R}" fill="${POINT_COLOR}"/>`) + `</g>`);
      }
      continue;
    }

    // a group's count is written to its right only where the next mark leaves room; the stack still
    // shows there are several, and the card's tooltip lists them
    const groups = groupBy(r.items, (it) => it.start + "-" + it.end).sort((a, b) => a[0].start - b[0].start);
    const starts = groups.map((g) => X(g[0].start));
    groups.forEach((g, gi) => {
      const e0 = ev[g[0].i];
      const x0 = starts[gi], next = gi + 1 < starts.length ? starts[gi + 1] - R : W;
      const fits = (from: number) => x0 + from + 2 + textWidth(String(g.length), FS.small) + 2 <= next;
      if (g[0].end > g[0].start) {
        const w = Math.max(X(g[0].end) - x0, 2 * R);
        plot.push(`<g${tag(g.map((it) => it.i))} transform="translate(${x0.toFixed(1)} 0)"><rect x="0" y="${cy - 2.5}" width="${w.toFixed(1)}" height="5" rx="2" ry="2" fill="${colorOf(e0)}"/>` +
          (g.length > 1 && fits(w) ? label(w + 2, cy + FS.small * 0.35, g.length, { size: FS.small, fill: pal.muted }) : "") + `</g>`);
      } else {
        plot.push(`<g${tag(g.map((it) => it.i))} transform="translate(${x0.toFixed(1)} 0)">` +
          (g.length > 1 ? stack(g.map((it) => colorOf(ev[it.i])), cy, g.length, pal, fits(4.5)) : shape(e0, cy, colorOf(e0), pal)) + `</g>`);
      }
    });
  }

  if (z) parts.push(`<defs><clipPath id="tl-zoom-clip"><rect x="${HW}" y="0" width="${PW + PAD_R}" height="${H}"/></clipPath></defs>` +
    `<g clip-path="url(#tl-zoom-clip)">${plot.join("")}</g>`);
  let total = H;
  if (captionText) {
    const cap = caption(captionText, W, H, pal.muted);
    parts.push(cap.svg);
    total += cap.height;
  }
  const body = parts.join("");
  return {
    svg: frame(W, total, body, pal.bg, false, o.interactive ? undefined : "Timeline of " + t.patient), body,
    layout: { tracks, rows, cutYears, censored, width: W, height: total, plot: { x: HW, width: PW } },
  };
}

/** the least drag that zooms, in px (the portal's TimelineStore: more than 10) */
export const ZOOM_MIN_DRAG = 10;

/**
 * The zoom a drag from x0 to x1 (px in the figure) makes over a plot at `plot`, already zoomed to
 * `current` (fractions of the unzoomed plot, or null): the dragged stretch as fractions of the
 * unzoomed plot, within it; null for a drag of 10 px or less, which is a click (PAT-TL-ZM-3).
 */
export function zoomFromDrag(x0: number, x1: number, plot: { x: number; width: number }, current: readonly [number, number] | null): [number, number] | null {
  if (Math.abs(x1 - x0) <= ZOOM_MIN_DRAG || plot.width <= 0) return null;
  const [a, b] = current || [0, 1];
  const at = (x: number) => a + Math.min(1, Math.max(0, (x - plot.x) / plot.width)) * (b - a);
  const lo = at(Math.min(x0, x1)), hi = at(Math.max(x0, x1));
  return hi > lo ? [lo, hi] : null;
}

/** What the figure shows, in words — its caption, and the card's foot. */
export function timelineSummary(t: PatientTimeline, layout: Pick<TimelineLayout, "tracks" | "cutYears" | "censored">, expandGaps = false): string {
  const n = t.events.length;
  if (!n) return t.patient + " (" + t.study + ") has no timeline events recorded" + (t.samples.length ? "; " + t.samples.length + " sample" + (t.samples.length === 1 ? "" : "s") : "") + ".";
  const lo = Math.min(...t.events.map((e) => e.start)), hi = Math.max(...t.events.map((e) => e.end != null && e.end > e.start ? e.end : e.start));
  const marks = [...sampleMarks(t.samples, t.events).values()];
  return t.patient + " (" + t.study + (t.source.remote ? ", from " + t.source.label + " via federation" : "") + "): " +
    n.toLocaleString("en-US") + " events in " + layout.tracks.length + " event type" + (layout.tracks.length === 1 ? "" : "s") +
    ", from " + formatDays(lo) + " to " + formatDays(hi) + " relative to diagnosis (day 0). " +
    (marks.length ? "Samples, numbered in collection order: " + marks.map((m) => m.label + " " + m.id + (m.type ? " (" + m.type + ")" : "")).join(", ") + ". " : "") +
    (layout.censored ? layout.censored + " lab value" + (layout.censored === 1 ? " is" : "s are") + " recorded as a bound (< or >) and drawn hollow at that bound. " : "") +
    (layout.cutYears && !expandGaps ? layout.cutYears + " year" + (layout.cutYears === 1 ? "" : "s") + " with no events " + (layout.cutYears === 1 ? "is" : "are") + " cut from the axis (dashed line); expandGaps draws every year. " : "") +
    "Events of one type nest by attribute as on cBioPortal (treatment by subtype and agent, lab tests by test); vocabularies are the study's own.";
}
