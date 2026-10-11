// The timeline figure: one patient's tracks drawn as cBioPortal's patient-view timeline draws
// them — a year axis with empty stretches cut, a header column of nested track labels, events as
// 4px points and 5px bars, same-day events stacked with their count, samples as numbered markers,
// numeric lab results as line charts. Browser-safe (the lab card draws with it) and used by
// lib/view-svg.ts for the MCP figure, so both are the same drawing.
import { esc, frame, caption, palette, type SvgOpts } from "./svg-kit.ts";
import {
  buildTracks, flattenTracks, axisTicks, dayScale, sampleMarks, numericResult, attr, yearLabel, formatDays,
  COLOR_KEY, SHAPE_KEY, POINT_COLOR, YEAR, type TlItem, type TlTrack, type SampleMark,
} from "./timeline-tracks.ts";
import type { PatientEvent, PatientTimeline } from "./types.ts";

export const TL_HEADER_W = 200;
const AXIS_H = 26, TRACK_H = 20, LINE_H = 50, PAD_R = 14, INDENT = 14, R = 4;

export interface TimelineSvgOpts extends SvgOpts {
  collapsed?: readonly string[];
  expandGaps?: boolean;
  /** mark events and headers with data- attributes, for the card's tooltips and toggles */
  interactive?: boolean;
}

function colorOf(e: PatientEvent): string {
  const c = attr(e, COLOR_KEY);
  return c && /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([0-9., ]+\))$/i.test(c.trim()) ? c.trim() : POINT_COLOR;
}

function shape(e: PatientEvent, y: number, fill: string): string {
  if (/^status$/i.test(e.type.trim()) && e.attrs.some(([k, v]) => /^status$/i.test(k) && /^deceased$/i.test(v)))
    return `<rect x="-3.5" y="${y - 3.5}" width="7" height="7" fill="black" transform="rotate(45 0 ${y})"/>`;
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

/** Same-day events as the portal stacks them: two or three offset sheets, and the count above. */
function stack(fills: string[], y: number, n: number): string {
  const w = 9, ry = 0.52 * w / 2;
  const sheet = (dy: number, f: string, mask: boolean) =>
    `<ellipse cx="0" cy="${y + dy}" rx="${w / 2}" ry="${ry}" fill="${f}" stroke="black" stroke-width="0.2"/>` +
    (mask ? `<ellipse cx="0" cy="${y + dy - 1}" rx="${w / 2}" ry="${ry}" fill="#fff"/>` : "");
  const f = fills.length === 2 ? fills : [0, 1, 2].map((i) => fills[i % fills.length]);
  const body = f.length === 2
    ? sheet(w / 8, f[1], true) + sheet(-w / 8, f[0], false)
    : sheet(w / 4, f[2], true) + sheet(0, f[1], true) + sheet(-w / 4, f[0], false);
  return body + `<text x="4" y="${y - 6}" font-size="7" fill="#666">${n}</text>`;
}

function sampleMarker(marks: SampleMark[], y: number): string {
  if (marks.length === 1) {
    const m = marks[0];
    return `<circle cx="0" cy="${y}" r="7" fill="${esc(m.color)}"/>` +
      `<text x="0" y="${y}" dy=".33em" text-anchor="middle" font-size="10" fill="white" font-family="Arial">${esc(m.label)}</text>`;
  }
  const nums = marks.map((m) => Number(m.label)).sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < nums.length;) {
    let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    ranges.push(i === j ? String(nums[i]) : nums[i] + "-" + nums[j]); i = j + 1;
  }
  const label = ranges.join(", "), w = label.length * 6 + 8, h = 14;
  const colors = [...new Set(marks.sort((a, b) => Number(a.label) - Number(b.label)).map((m) => m.color))];
  const seg = w / colors.length;
  const id = "tlclip" + Math.round(y) + "_" + label.replace(/[^0-9]/g, "_");
  return `<clipPath id="${id}"><rect x="${-w / 2}" y="${y - h / 2}" rx="${h / 2}" width="${w}" height="${h}"/></clipPath>` +
    `<g clip-path="url(#${id})">` + colors.map((c, i) => `<rect x="${-w / 2 + i * seg}" y="${y - h / 2}" width="${seg + 0.5}" height="${h}" fill="${esc(c)}"/>`).join("") + `</g>` +
    `<text x="0" y="${y}" dy=".33em" text-anchor="middle" font-size="10" fill="white" font-family="Arial">${esc(label)}</text>`;
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
}

/**
 * The figure, and what a caption must say about it. `interactive` adds the data- attributes the
 * card reads: `data-ev` (event indices) on each mark, `data-uid` on each header that collapses.
 */
export function timelineSvg(t: PatientTimeline, o: TimelineSvgOpts = {}, captionText = ""): { svg: string; layout: TimelineLayout } {
  const W = Math.max(480, o.width ?? 900);
  const pal = palette(o.theme);
  const ev = t.events;
  const tracks = buildTracks(ev);
  const flat = flattenTracks(tracks, new Set(o.collapsed || []));
  const all = flat.flatMap((r) => r.items);
  const { ticks, cutYears } = axisTicks(all, !o.expandGaps);
  const PW = W - TL_HEADER_W - PAD_R;
  const { x: dx } = dayScale(ticks, PW);
  const X = (d: number) => TL_HEADER_W + dx(d);
  const marks = sampleMarks(t.samples, ev);
  let y = AXIS_H, censored = 0;
  const rows = flat.map((r) => {
    const h = r.track.draw === "line" && !r.collapsed ? LINE_H : TRACK_H;
    const row = { ...r, y, h };
    y += h;
    return row;
  });
  const H = y + 6;
  const parts: string[] = [];

  // the axis: a year line and label at each year start; a cut as a squiggle
  parts.push(`<rect x="${TL_HEADER_W}" y="${AXIS_H - 1}" width="${PW}" height="1" fill="#ccc"/>`);
  const cuts = ticks.filter((tk) => tk.trim).map((tk) => X(tk.start));
  for (const tk of ticks) {
    if (tk.trim) {
      const cx = X(tk.start);
      parts.push(`<g transform="translate(${cx.toFixed(1)} 0)"><title>${tk.trim.years} years with no events, cut</title>` +
        `<path d="M-6 ${AXIS_H - 9} q3 -6 6 0 t6 0" fill="none" stroke="#999" stroke-width="1.2"/>` +
        `<line x1="0" x2="0" y1="${AXIS_H}" y2="${H - 4}" stroke="#bbb" stroke-dasharray="2 3"/></g>`);
      continue;
    }
    for (let d = Math.ceil(tk.start / YEAR) * YEAR; d <= tk.end; d += YEAR) {
      const xx = X(d).toFixed(1), clear = cuts.every((c) => Math.abs(c - X(d)) > 18);
      parts.push(`<line x1="${xx}" x2="${xx}" y1="${AXIS_H - 6}" y2="${H - 4}" stroke="${d === 0 ? "#bbb" : "#eee"}"/>` +
        (clear ? `<text x="${xx}" y="${AXIS_H - 10}" text-anchor="middle" font-size="10" fill="#333">${yearLabel(d)}</text>` : ""));
    }
  }

  for (const r of rows) {
    const tr = r.track, cy = r.y + TRACK_H / 2;
    // header
    const hasKids = tr.children.length > 0;
    const lab = (hasKids ? (r.collapsed ? "▸ " : "▾ ") : "") + tr.label;
    const fit = lab.length > 30 - tr.depth * 2 ? lab.slice(0, 29 - tr.depth * 2) + "…" : lab;
    parts.push(`<g${o.interactive && hasKids ? ` class="tl-h" data-uid="${esc(tr.uid)}" style="cursor:pointer"` : ""}>` +
      `<title>${esc(tr.label)}</title><text x="${5 + tr.depth * INDENT}" y="${cy}" dy=".33em" font-size="11" fill="${pal.ink}"` +
      `${tr.depth === 0 ? ` font-weight="600"` : ""}>${esc(fit)}</text></g>`);
    parts.push(`<line x1="0" x2="${W}" y1="${r.y + r.h - 0.5}" y2="${r.y + r.h - 0.5}" stroke="#f1f1f1"/>`);
    const tag = (ix: number[]) => (o.interactive ? ` class="tl-m" data-ev="${ix.join(",")}"` : "");

    if (tr.draw === "line" && !r.collapsed) {
      const pts = r.items.map((it) => ({ it, v: numericResult(ev[it.i])! })).sort((a, b) => a.it.start - b.it.start);
      let lo = Math.min(...pts.map((p) => p.v.v)), hi = Math.max(...pts.map((p) => p.v.v));
      if (lo === hi) { lo -= 1; hi += 1; }
      const yy = (v: number) => r.y + r.h - 7 - (v - lo) / (hi - lo) * (r.h - 14);
      const tickLab = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100).toString();
      parts.push(`<text x="${TL_HEADER_W - 8}" y="${yy(hi)}" dy=".33em" text-anchor="end" font-size="9" fill="#aaa">${tickLab(hi)}</text>` +
        `<text x="${TL_HEADER_W - 8}" y="${yy(lo)}" dy=".33em" text-anchor="end" font-size="9" fill="#aaa">${tickLab(lo)}</text>` +
        `<line x1="${TL_HEADER_W - 5}" x2="${TL_HEADER_W}" y1="${yy(hi)}" y2="${yy(hi)}" stroke="#aaa"/><line x1="${TL_HEADER_W - 5}" x2="${TL_HEADER_W}" y1="${yy(lo)}" y2="${yy(lo)}" stroke="#aaa"/>`);
      parts.push(`<polyline fill="none" stroke="#555" stroke-width="1" points="${pts.map((p) => X(p.it.start).toFixed(1) + "," + yy(p.v.v).toFixed(1)).join(" ")}"/>`);
      for (const p of pts) {
        const c = colorOf(ev[p.it.i]);
        if (p.v.censored) censored++;
        parts.push(`<g${tag([p.it.i])} transform="translate(${X(p.it.start).toFixed(1)} 0)">` +
          (p.v.censored ? `<circle cx="0" cy="${yy(p.v.v)}" r="3" fill="#fff" stroke="${c}" stroke-width="1.5"/>` : `<circle cx="0" cy="${yy(p.v.v)}" r="3" fill="${c}"/>`) + `</g>`);
      }
      continue;
    }

    if (tr.draw === "samples") {
      for (const g of groupBy(r.items, (it) => String(it.start))) {
        const ms = [...new Set(g.map((it) => attr(ev[it.i], "SAMPLE_ID")).filter(Boolean) as string[])].map((id) => marks.get(id)).filter(Boolean) as SampleMark[];
        parts.push(`<g${tag(g.map((it) => it.i))} transform="translate(${X(g[0].start).toFixed(1)} 0)">` +
          (ms.length ? sampleMarker(ms, cy) : `<circle cx="0" cy="${cy}" r="${R}" fill="${POINT_COLOR}"/>`) + `</g>`);
      }
      continue;
    }

    for (const g of groupBy(r.items, (it) => it.start + "-" + it.end)) {
      const e0 = ev[g[0].i];
      const x0 = X(g[0].start);
      if (g[0].end > g[0].start) {
        const w = Math.max(X(g[0].end) - x0, 2 * R);
        parts.push(`<g${tag(g.map((it) => it.i))} transform="translate(${x0.toFixed(1)} 0)"><rect x="0" y="${cy - 2.5}" width="${w.toFixed(1)}" height="5" rx="2" ry="2" fill="${colorOf(e0)}"/>` +
          (g.length > 1 ? `<text x="${(w + 2).toFixed(1)}" y="${cy - 3}" font-size="7" fill="#666">${g.length}</text>` : "") + `</g>`);
      } else {
        parts.push(`<g${tag(g.map((it) => it.i))} transform="translate(${x0.toFixed(1)} 0)">` +
          (g.length > 1 ? stack(g.map((it) => colorOf(ev[it.i])), cy, g.length) : shape(e0, cy, colorOf(e0))) + `</g>`);
      }
    }
  }

  let total = H;
  if (captionText) {
    const cap = caption(captionText, W, H, pal.muted, Math.floor(W / 6.2));
    parts.push(cap.svg);
    total += cap.height;
  }
  return {
    svg: frame(W, total, parts.join(""), pal.bg),
    layout: { tracks, rows, cutYears, censored, width: W, height: total },
  };
}

/** What the figure shows, in words — its caption, and the card's foot. */
export function timelineSummary(t: PatientTimeline, layout: Pick<TimelineLayout, "tracks" | "cutYears" | "censored">, expandGaps = false): string {
  const n = t.events.length;
  if (!n) return t.patient + " (" + t.study + ") has no timeline events recorded" + (t.samples.length ? "; " + t.samples.length + " sample" + (t.samples.length === 1 ? "" : "s") : "") + ".";
  const lo = Math.min(...t.events.map((e) => e.start)), hi = Math.max(...t.events.map((e) => e.end != null && e.end > e.start ? e.end : e.start));
  const marks = [...sampleMarks(t.samples, t.events).values()];
  return t.patient + " (" + t.study + (t.source.remote ? ", from " + t.source.label + " over MCP" : "") + "): " +
    n.toLocaleString("en-US") + " events in " + layout.tracks.length + " event type" + (layout.tracks.length === 1 ? "" : "s") +
    ", from " + formatDays(lo) + " to " + formatDays(hi) + " relative to diagnosis (day 0). " +
    (marks.length ? "Samples, numbered in collection order: " + marks.map((m) => m.label + " " + m.id + (m.type ? " (" + m.type + ")" : "")).join(", ") + ". " : "") +
    (layout.censored ? layout.censored + " lab value" + (layout.censored === 1 ? " is" : "s are") + " recorded as a bound (< or >) and drawn hollow at that bound. " : "") +
    (layout.cutYears && !expandGaps ? layout.cutYears + " year" + (layout.cutYears === 1 ? "" : "s") + " with no events " + (layout.cutYears === 1 ? "is" : "are") + " cut from the axis (dashed line); expandGaps draws every year. " : "") +
    "Events of one type nest by attribute as on cBioPortal (treatment by subtype and agent, lab tests by test); vocabularies are the study's own.";
}
