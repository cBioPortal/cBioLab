// Evolution figure: one patient's mutations across their samples — a line per mutation through its
// VAF in each sample (the portal's Genomic Evolution line chart), or a heatmap of mutation × sample.
// Colours of the heatmap's cells are the oncoprint's (lib/oncoprint-style.ts): its sequential ramp
// for VAF, its grey for profiled-but-unaltered, its white-with-a-bar for not profiled.
import type { DrawnResultOf } from "../../types.ts";
import { palette, frame, caption, label, textWidth, legend, linear, log, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, fmtInt, esc, FS, SW, r1, type SvgOpts, type Scale } from "../../svg-kit.ts";
import { STYLE, numericColor, encodeNumeric } from "../../oncoprint-style.ts";
import type { EvolutionCell, EvolutionMutation, EvolutionSample } from "./types.ts";

/** the table columns that identify a mutation: one key names its line or heatmap row and its table row alike */
export const EVOLUTION_KEY_COLUMNS = ["gene", "proteinChange", "chr", "start", "end", "ref", "var"];
/** A mutation's key from its values in EVOLUTION_KEY_COLUMNS, in that order. */
export const evolutionKey = (values: (string | number | null)[]) => values.map((x) => x == null ? "" : String(x)).join("|");

/** where a VAF of 0 sits on a log axis: the portal's floor */
export const LOG_FLOOR = 0.001;
const MARK_R = 7;

const vafText = (c: EvolutionCell) => c.vaf == null ? "" : c.vaf.toFixed(2) + (c.alt != null && c.ref != null ? " (" + fmtInt(c.alt) + " of " + fmtInt(c.alt + c.ref) + " reads)" : "");
/** a cell in words, as its tooltip and the results text say it */
export function cellText(c: EvolutionCell): string {
  switch (c.status) {
    case "called": return "VAF " + vafText(c);
    case "noVaf": return "called, no allele counts";
    case "uncalled": return "uncalled, VAF " + vafText(c);
    case "absent": return "not found" + (c.alt != null && c.ref != null ? " (0 of " + fmtInt(c.alt + c.ref) + " reads)" : "");
    default: return "not profiled";
  }
}
const mutationName = (m: EvolutionMutation) => m.gene + " " + m.proteinChange;
const mutationTip = (m: EvolutionMutation, samples: EvolutionSample[]) =>
  mutationName(m) + (m.mutationType ? " (" + m.mutationType.replace(/_/g, " ") + ")" : "") + " — " + m.cells.map((c, i) => samples[i].label + ": " + cellText(c)).join(" · ");

/** A sample's numbered marker, centred at (x, y). */
const marker = (x: number, y: number, s: EvolutionSample) =>
  `<g><title>${esc(s.label + ": " + s.id + (s.type ? " (" + s.type + ")" : "") + (s.day != null ? ", day " + s.day : ""))}</title>` +
  `<circle cx="${r1(x)}" cy="${r1(y)}" r="${MARK_R}" fill="${s.color}"/>` +
  `<text x="${r1(x)}" y="${r1(y + FS.small * 0.35)}" font-size="${FS.small}" text-anchor="middle" fill="#ffffff">${esc(s.label)}</text></g>`;

/** the samples' key: each marker's number and colour, its id and type */
function sampleKey(samples: EvolutionSample[], y: number, W: number, p: ReturnType<typeof palette>) {
  return legend(samples.map((s) => ({ label: s.label + " · " + s.id, color: s.color, kind: "dot" as const, detail: [s.type, s.day != null ? "day " + s.day : ""].filter(Boolean).join(", ") || undefined })),
    8, y, W - 16, p, { size: FS.small });
}

/** The y value a cell is drawn at, or null where it has none (not profiled, called without counts). */
const yOf = (c: EvolutionCell): number | null => c.status === "called" || c.status === "uncalled" ? c.vaf : c.status === "absent" ? 0 : null;
const real = (c: EvolutionCell) => (c.status === "called" || c.status === "uncalled") && c.vaf != null;

/** The cells a mutation's line runs through: from its first to its last sample with variant reads, as the portal trims it. */
export function lineCells(m: EvolutionMutation): { i: number; c: EvolutionCell }[] {
  const all = m.cells.map((c, i) => ({ i, c }));
  const a = all.findIndex((x) => real(x.c));
  if (a < 0) return [];
  let b = all.length - 1;
  while (!real(all[b].c)) b--;
  return all.slice(a, b + 1);
}

function lineChart(v: DrawnResultOf<"evolution">, W: number, p: ReturnType<typeof palette>): { svg: string; height: number } {
  const e = v.evolution, samples = e.patient!.samples, drawn = e.drawn!, d = e.display;
  const out: string[] = [];
  const ys = drawn.flatMap((m) => lineCells(m).map((x) => yOf(x.c)).filter((y): y is number => y != null));
  const top = 14, H = 220;
  let y: Scale;
  if (d.logScale) {
    const lo = d.dataRange ? Math.max(LOG_FLOOR, Math.min(...ys.map((t) => Math.max(t, LOG_FLOOR)))) : LOG_FLOOR;
    y = log(lo, d.dataRange ? Math.max(...ys, lo * 10) : 1, top + H, top);
  } else y = d.dataRange && ys.length ? linear(Math.min(...ys), Math.max(...ys), top + H, top) : linear(0, 1, top + H, top, { nice: false });
  const yv = (t: number) => y(d.logScale ? Math.max(t, LOG_FLOOR) : t);
  const yTitle = "Variant allele frequency";
  const left = leftAxisWidth(y, yTitle) + 8, right = W - 16;
  // the samples along x: evenly in order, or by the day each was collected
  const pad = 20;
  let xs: number[], bottom: number;
  if (e.x === "time") {
    const days = samples.map((s) => s.day!);
    const xsc = linear(Math.min(...days), Math.max(...days), left + pad, right - pad);
    xs = days.map((t) => xsc(t));
    out.push(axisLeft(y, left, p, { title: yTitle, gridTo: right }));
    const markTop = top + H + 12;
    // samples taken the same day stack their markers
    const seen = new Map<number, number>();
    const rows = xs.map((x) => { const k = Math.round(x); const n = seen.get(k) || 0; seen.set(k, n + 1); return n; });
    samples.forEach((s, i) => out.push(marker(xs[i], markTop + MARK_R + rows[i] * (2 * MARK_R + 2), s)));
    const axY = markTop + (Math.max(...rows) + 1) * (2 * MARK_R + 2) + 4;
    out.push(axisBottom(xsc, axY, p, { title: "Days from diagnosis, when each sample was collected", fmt: (t) => fmtInt(t), minX: 0, maxX: W, line: true }));
    bottom = axY + bottomAxisHeight("x");
  } else {
    xs = samples.map((_, i) => samples.length === 1 ? (left + right) / 2 : left + pad + i * (right - left - 2 * pad) / (samples.length - 1));
    out.push(axisLeft(y, left, p, { title: yTitle, gridTo: right }));
    samples.forEach((s, i) => out.push(marker(xs[i], top + H + 12 + MARK_R, s)));
    bottom = top + H + 12 + 2 * MARK_R + 6;
  }
  out.push(`<line x1="${left}" y1="${r1(top + H)}" x2="${right}" y2="${r1(top + H)}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
  for (const m of drawn) {
    const pts = lineCells(m);
    const g: string[] = [];
    let prev: { x: number; y: number } | null = null, gap = false;
    for (const { i, c } of pts) {
      const t = yOf(c);
      if (t == null) { gap = true; continue; }
      const pt = { x: xs[i], y: yv(t) };
      if (prev) g.push(`<line x1="${r1(prev.x)}" y1="${r1(prev.y)}" x2="${r1(pt.x)}" y2="${r1(pt.y)}" stroke="${p.ink}" stroke-width="${SW.line}" stroke-opacity="0.55"${gap ? ` stroke-dasharray="3 3"` : ""}/>`,
        `<line x1="${r1(prev.x)}" y1="${r1(prev.y)}" x2="${r1(pt.x)}" y2="${r1(pt.y)}" stroke="transparent" stroke-width="8"/>`);
      prev = pt; gap = false;
    }
    for (const { i, c } of pts) {
      const t = yOf(c);
      if (t == null) continue;
      const x = r1(xs[i]), yy = r1(yv(t));
      g.push(c.status === "called" ? `<circle data-s="${i}" cx="${x}" cy="${yy}" r="3" fill="${p.ink}"/>`
        : c.status === "uncalled" ? `<circle data-s="${i}" cx="${x}" cy="${yy}" r="3" fill="${p.bg}" stroke="${p.ink}" stroke-width="${SW.line}"/>`
        : `<rect data-s="${i}" x="${r1(xs[i] - 2.5)}" y="${r1(yv(t) - 2.5)}" width="5" height="5" fill="${p.bg}" stroke="${p.ink}" stroke-width="${SW.line}"/>`);
    }
    out.push(`<g class="evo-line"${m.key ? ` data-key="${esc(m.key)}"` : ""}><title>${esc(mutationTip(m, samples))}</title>${g.join("")}</g>`);
  }
  let h = bottom + 6;
  const key = keyRow([
    `<circle cx="5" cy="0" r="3" fill="${p.ink}"/>`, "called",
    `<circle cx="5" cy="0" r="3" fill="${p.bg}" stroke="${p.ink}" stroke-width="${SW.line}"/>`, "uncalled, variant reads found",
    `<rect x="2.5" y="-2.5" width="5" height="5" fill="${p.bg}" stroke="${p.ink}" stroke-width="${SW.line}"/>`, "not found (VAF 0)",
    `<line x1="0" y1="0" x2="12" y2="0" stroke="${p.ink}" stroke-dasharray="3 3"/>`, "across a not-profiled sample, or one without allele counts",
  ], 8, h, W - 16, p);
  out.push(key.svg); h += key.height;
  return { svg: out.join(""), height: h };
}

/** A row of drawn swatches and their labels, wrapping at the width: [swatch, label, swatch, label, …]. */
function keyRow(parts: string[], x0: number, y0: number, maxW: number, p: ReturnType<typeof palette>): { svg: string; height: number } {
  const out: string[] = [], rowH = Math.round(FS.small * 1.8);
  let x = x0, y = y0 + rowH / 2;
  for (let i = 0; i < parts.length; i += 2) {
    const w = 16 + textWidth(parts[i + 1], FS.small);
    if (x > x0 && x + w > x0 + maxW) { x = x0; y += rowH; }
    out.push(`<g transform="translate(${r1(x)},${r1(y)})">${parts[i]}</g>`, label(x + 16, y + FS.small * 0.35, parts[i + 1], { size: FS.small, fill: p.muted, maxW: maxW - 16 }));
    x += w + 20;
  }
  return { svg: out.join(""), height: y - y0 + rowH / 2 + 4 };
}

const heatFill = (vaf: number) => numericColor(encodeNumeric(Math.max(0, Math.min(1, vaf)), 0, 1), null, STYLE);

function heatmap(v: DrawnResultOf<"evolution">, W: number, p: ReturnType<typeof palette>): { svg: string; height: number } {
  const e = v.evolution, samples = e.patient!.samples, drawn = e.drawn!;
  const G = STYLE.glyph, out: string[] = [];
  const labelW = Math.min(W * 0.4, Math.max(60, ...drawn.map((m) => textWidth(mutationName(m), FS.small))) + 10);
  const colW = Math.max(14, Math.min(56, (W - 16 - labelW) / samples.length)), rowH = 14, gap = 1;
  const x0 = 8 + labelW, top = 4;
  samples.forEach((s, j) => out.push(marker(x0 + j * colW + colW / 2, top + MARK_R, s)));
  const y0 = top + 2 * MARK_R + 6;
  drawn.forEach((m, i) => {
    const y = y0 + i * rowH;
    out.push(`<g class="evo-row"${m.key ? ` data-key="${esc(m.key)}"` : ""}>`, `<rect x="8" y="${r1(y)}" width="${r1(x0 + samples.length * colW - 8)}" height="${rowH}" fill="transparent"/>`);
    out.push(label(x0 - 6, y + rowH / 2 + FS.small * 0.35, mutationName(m), { size: FS.small, fill: p.ink, anchor: "end", maxW: labelW - 6 }));
    const cells = m.cells.map((c, j) => {
      const x = x0 + j * colW, w = colW - gap, h = rowH - gap;
      const band = (b: readonly [number, number], color: string) => `<rect x="${r1(x)}" y="${r1(y + b[0] * h)}" width="${r1(w)}" height="${r1((b[1] - b[0]) * h)}" fill="${color}"/>`;
      let body: string;
      if (c.status === "called" || c.status === "uncalled") {
        body = band([0, 1], heatFill(c.vaf!)) + (c.status === "uncalled" ? `<circle cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" r="2" fill="${c.vaf! > 0.5 ? "#ffffff" : p.ink}"/>` : "");
      } else if (c.status === "absent") body = band([0, 1], STYLE.palette.unaltered);
      else if (c.status === "noVaf") body = band([0, 1], STYLE.palette.unaltered) + band(G.mutation.band, G.mutation.single.color);
      else body = band([0, 1], G.notProfiled.fill) + band(G.notProfiled.stripe.band, G.notProfiled.stripe.color);
      return `<g data-s="${j}"><title>${esc(mutationName(m) + " in " + samples[j].label + " (" + samples[j].id + "): " + cellText(c))}</title>${body}</g>`;
    });
    out.push(...cells, "</g>");
  });
  let h = y0 + drawn.length * rowH + 10;
  // the key: the VAF ramp, then the states without a VAF
  const rampW = 120, stops = [0, 0.25, 0.5, 0.75, 1];
  out.push(`<defs><linearGradient id="evo-ramp">${stops.map((t) => `<stop offset="${t}" stop-color="${heatFill(t)}"/>`).join("")}</linearGradient></defs>`);
  out.push(label(8, h + FS.small, "VAF", { size: FS.small, fill: p.muted }));
  const rx = 8 + textWidth("VAF", FS.small) + 6;
  out.push(`<rect x="${rx}" y="${h + 2}" width="${rampW}" height="10" fill="url(#evo-ramp)"/>`);
  out.push(label(rx, h + 24, "0", { size: FS.small, fill: p.muted }), label(rx + rampW, h + 24, "1", { size: FS.small, fill: p.muted, anchor: "end" }));
  const sq = (fill: string, extra = "") => `<rect x="0" y="-5" width="10" height="10" fill="${fill}"/>` + extra;
  const key = keyRow([
    sq(STYLE.palette.unaltered), "not found (sequenced, VAF 0)",
    sq(G.notProfiled.fill, `<rect x="0" y="-0.3" width="10" height="1" fill="${G.notProfiled.stripe.color}"/><rect x="0" y="-5" width="10" height="10" fill="none" stroke="${p.line}"/>`), G.notProfiled.label.toLowerCase(),
    sq(STYLE.palette.unaltered, `<rect x="0" y="-1.7" width="10" height="3.4" fill="${G.mutation.single.color}"/>`), "called, no allele counts",
    sq(heatFill(0.3), `<circle cx="5" cy="0" r="2" fill="${p.ink}"/>`), "uncalled, variant reads found",
  ], rx + rampW + 18, h - 2, W - rx - rampW - 26, p);
  out.push(key.svg);
  h += Math.max(30, key.height + 4);
  return { svg: out.join(""), height: h };
}

/** `o.caption: false` leaves the caveat out, for a page that prints it beside the figure. */
export function evolutionSvg(v: DrawnResultOf<"evolution">, o: SvgOpts & { caption?: boolean }): string | null {
  const e = v.evolution, pt = e.patient;
  if (!pt || !e.drawn || !e.drawn.length) return null;
  const p = palette(o.theme), W = Math.max(420, o.width || 760);
  const body = e.display.chart === "heatmap" ? heatmap(v, W, p) : lineChart(v, W, p);
  let y = body.height + 4;
  const key = sampleKey(pt.samples, y, W, p);
  y += key.height + 4;
  const cap = caption(o.caption === false ? "" : v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, body.svg + key.svg + cap.svg, p.bg, false,
    "Genomic evolution — " + pt.id + ": " + e.drawn.length + " mutations across " + pt.samples.length + " samples (" + (e.display.chart === "heatmap" ? "heatmap" : "VAF lines") + ")", { tip: false });
}
