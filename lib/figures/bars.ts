// What the bar figures share — the views the page shows as tables (compare, co-occurrence,
// co-expression, clinical; each figure is lib/views/<kind>/figure.ts), drawn for MCP and
// `?figures=svg`: compare as grouped bars, the other three as one horizontal bar per row on a
// labelled value axis, signed about a zero line where the value has a direction.
import {
  esc, palette, frame, caption, linear, axisBottom, bottomAxisHeight, legend, label, textWidth,
  fmtInt, FS, SW, SERIES, type SvgOpts, type LegendItem, type Scale
} from "../svg-kit.ts";

type Pal = ReturnType<typeof palette>;

/** below this the plot column stops narrowing and the figure grows instead */
const MIN_PLOT = 160;
export const ROW = 22, PAD = 8, GUT = 12;

/** a direction's colour where the test is significant; the neutral grey where it is not */
export const UP = SERIES[0], DOWN = SERIES[1];

export interface HRow {
  label: string;
  /** null: nothing to draw (not tested, no value); ±Infinity: past the scale either way */
  v: number | null;
  fill: string;
  text: string;
  /** the row's own tooltip on its bar */
  tip?: string;
  muted?: boolean;
}

/** The figure's title line at the top; returns its drawing and the y below it. */
export function titleLine(text: string, W: number, p: Pal): { svg: string; y: number } {
  return { svg: label(PAD, 16, text, { size: FS.title, weight: 600, fill: p.ink, maxW: W - 2 * PAD }), y: 26 };
}

/** tick labels repeated along the top of a long plot, so a reader at the first row can read the scale */
function topTicks(s: Scale, fmt: (v: number) => string, y: number, p: Pal): string {
  return s.ticks.map((t) => label(s(t), y, fmt(t), { size: FS.small, fill: p.muted, anchor: "middle" })).join("");
}

/**
 * One horizontal bar per row: label column, plot, value column, each as wide as its widest entry
 * (the label column capped at a third of the figure, labels past it cut with their full text kept).
 * `signed` puts zero in the middle; values past `cap` (or infinite) end in an arrow at the edge.
 */
export function hbars(title: string, rows: HRow[], o: SvgOpts, a: {
  signed: boolean; axisTitle: string; cap?: number; ref?: { at: number; text: string };
  legend: LegendItem[]; note: string; fmtTick?: (v: number) => string;
}): string {
  const p = palette(o.theme);
  let W = Math.max(360, o.width || 720);
  const labW0 = Math.max(...rows.map((r) => textWidth(r.label, FS.body)), 0);
  const valW = Math.max(...rows.map((r) => textWidth(r.text, FS.small)), 0);
  const labW = () => Math.min(labW0, Math.max(80, W * 0.33));
  // a figure narrower than its columns grows (and scrolls) rather than squeezing the plot away
  const need = 2 * PAD + labW() + GUT + MIN_PLOT + GUT + valW;
  const grown = need > W;
  if (grown) W = Math.ceil(need);
  const L = PAD + labW() + GUT, R = W - PAD - valW - GUT;

  const finite = rows.map((r) => r.v).filter((v): v is number => v != null && Number.isFinite(v));
  const capped = (v: number) => a.cap != null ? Math.min(Math.abs(v), a.cap) : Math.abs(v);
  const m = Math.max(a.ref ? a.ref.at * 1.2 : 0, ...finite.map(capped), a.cap != null && rows.some((r) => r.v != null && (!Number.isFinite(r.v) || Math.abs(r.v) > a.cap!)) ? a.cap : 0, 1e-9);
  const xs = a.signed ? linear(-m, m, L, R) : linear(0, m, L, R);
  const [d0, d1] = xs.domain;
  const fmtTick = a.fmtTick || xs.fmt;

  const out: string[] = [];
  const t = titleLine(title, W, p);
  out.push(t.svg);
  let y = t.y;
  if (a.legend.length) {
    const lg = legend(a.legend, PAD, y, W - 2 * PAD, p, { size: FS.small });
    out.push(lg.svg);
    y += lg.height + 4;
  }
  const long = rows.length > 24;
  if (long) { out.push(topTicks(xs, fmtTick, y + FS.small, p)); y += FS.small + 6; }
  // a line of its own for the reference line's name, above the bars and clear of the legend
  if (a.ref) y += FS.small + 4;
  const top = y;
  const bottom = top + rows.length * ROW;
  // gridlines first, so bars and labels sit over them
  for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${bottom}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
  let past = 0;
  rows.forEach((r, i) => {
    const ry = top + i * ROW, cy = ry + ROW / 2, ty = cy + FS.body * 0.35;
    if (i % 2 === 0) out.push(`<rect x="${PAD / 2}" y="${ry}" width="${W - PAD}" height="${ROW}" fill="${p.line}" opacity="0.3"/>`);
    out.push(label(PAD, ty, r.label, { size: FS.body, fill: r.muted ? p.muted : p.ink, maxW: labW() }));
    if (r.v != null && r.v !== 0) {
      const off = !Number.isFinite(r.v) || (a.cap != null && Math.abs(r.v) > a.cap);
      const v = Math.max(d0, Math.min(d1, Number.isFinite(r.v) ? r.v : r.v > 0 ? d1 : d0));
      const x0 = xs(a.signed ? 0 : d0), x1 = xs(v);
      const x = Math.min(x0, x1), w = Math.max(1, Math.abs(x1 - x0));
      const h = 12;
      out.push(`<rect x="${r1(x)}" y="${r1(cy - h / 2)}" width="${r1(w)}" height="${h}" rx="1.5" fill="${r.fill}">` +
        (r.tip ? `<title>${esc(r.tip)}</title>` : "") + `</rect>`);
      if (off) {
        past++;
        const dir = v > 0 || (!a.signed) ? 1 : -1, at = x1;
        out.push(`<path d="M${r1(at + dir * 7)} ${r1(cy)} L${r1(at)} ${r1(cy - 7)} L${r1(at)} ${r1(cy + 7)} Z" fill="${r.fill}"/>`);
      }
    }
    out.push(label(W - PAD, cy + FS.small * 0.35, r.text, { size: FS.small, fill: r.muted ? p.muted : p.ink, anchor: "end" }));
  });
  if (a.signed) out.push(`<line x1="${r1(xs(0))}" y1="${top - 2}" x2="${r1(xs(0))}" y2="${bottom + 2}" stroke="${p.ink}" stroke-width="${SW.line}"/>`);
  if (a.ref && a.ref.at <= d1) {
    const rx = xs(a.ref.at);
    out.push(`<line x1="${r1(rx)}" y1="${top}" x2="${r1(rx)}" y2="${bottom}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
    out.push(label(rx + 3, top - 3, a.ref.text, { size: FS.small, fill: p.muted }));
  }
  out.push(axisBottom(xs, bottom, p, { title: a.axisTitle, minX: L - GUT, maxX: R + GUT, fmt: fmtTick }));
  y = bottom + bottomAxisHeight(a.axisTitle) + 8;
  const note = sentence(a.note) + (past ? " " + fmtInt(past) + " bar" + (past === 1 ? " runs" : "s run") + " past the axis and end" + (past === 1 ? "s" : "") +
    " in an arrow; the number beside " + (past === 1 ? "it" : "each") + " is exact." : "");
  const cap = caption(note, W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, grown, title);
}

/** a note ending in a full stop, so a sentence appended to it reads as one */
export const sentence = (s: string) => s.trim() && !/[.!?)]$/.test(s.trim()) ? s.trim() + "." : s.trim();
export const r1 = (n: number) => Math.round(n * 10) / 10;
