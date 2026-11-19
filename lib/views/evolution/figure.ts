// Evolution figure: one patient's mutations across their samples — a line per mutation through its
// VAF in each sample (the portal's Genomic Evolution line chart), or its heatmap: a row per sample
// (or, transposed, per mutation), clustered as the portal clusters it. Colours come from
// lib/oncoprint-style.ts: the portal's VAF ramp, its grey for profiled-but-unaltered, its
// white-with-a-bar for not profiled.
import type { DrawnResultOf } from "../../types.ts";
import { palette, frame, caption, label, textWidth, legend, linear, log, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, fmtInt, esc, FS, SW, r1, type SvgOpts, type Scale } from "../../svg-kit.ts";
import { portalEvolutionVaf } from "../../chart/format.ts";
import { STYLE, rampColor } from "../../oncoprint-style.ts";
import { heatmapOrder, mutationName } from "./order.ts";
import { axisMarks, dayScale, type AxisTick } from "../../timeline-tracks.ts";
import type { EvolutionCell, EvolutionMutation, EvolutionSample } from "./types.ts";
import { timelineSvg } from "../../timeline-svg.ts";

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
/**
 * A cell's state as the portal's Genomic Evolution tooltip says it (PatientViewMutationsTabUtils
 * mutationTooltip): "VAF: 0.38 (46 reads of 121 total)", "Mutated, but we don't have VAF data.",
 * "Mutation uncalled (VAF: …)", "Mutation not detected" (with its VAF when reads were counted),
 * "<sample> is not sequenced for <gene> mutations."
 */
export function portalCellTip(c: EvolutionCell, sampleId: string, gene: string): string {
  const total = c.alt != null && c.ref != null ? c.alt + c.ref : null;
  const vaf = c.vaf ?? (total ? c.alt! / total : null);
  const reads = vaf != null && total != null ? "VAF: " + portalEvolutionVaf(vaf) + " (" + c.alt + " reads of " + total + " total)" : null;
  switch (c.status) {
    case "called": return reads ?? "Mutated, but we don't have VAF data.";
    case "noVaf": return "Mutated, but we don't have VAF data.";
    case "uncalled": return reads ? "Mutation uncalled (" + reads + ")" : "Mutation uncalled";
    case "absent": return reads ? "Mutation not detected (" + reads + ")" : "Mutation not detected";
    default: return sampleId + " is not sequenced for " + gene + " mutations.";
  }
}
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

/**
 * The cells a mutation's line runs through: from its first to its last sample with variant reads, as
 * the portal trims it; with `only`, through those samples alone (a group's, in order).
 */
export function lineCells(m: EvolutionMutation, only?: number[]): { i: number; c: EvolutionCell }[] {
  const all = (only ?? m.cells.map((_, i) => i)).map((i) => ({ i, c: m.cells[i] }));
  const a = all.findIndex((x) => real(x.c));
  if (a < 0) return [];
  let b = all.length - 1;
  while (!real(all[b].c)) b--;
  return all.slice(a, b + 1);
}

/**
 * The line chart's x axis as the portal's, which is the patient timeline's (TickAxis), laid out by the
 * timeline's own axisMarks: a line and a label at each year ("0", "1y", "-2y"), month ticks inside a
 * year wide enough for them, a squiggle where empty years are cut with a dashed guide up through the
 * plot, and a faint guide up through the plot at each year; the day-0 line in the muted ink, as the
 * timeline draws it. Labels share one row under the axis.
 */
function timeAxis(ticks: AxisTick[], X: (day: number) => number, left: number, right: number, axY: number, top: number, p: ReturnType<typeof palette>): string[] {
  const out = [`<line x1="${r1(left)}" y1="${r1(axY)}" x2="${r1(right)}" y2="${r1(axY)}" stroke="${p.muted}" stroke-width="${SW.line}"/>`];
  const ly = axY + 17;
  for (const m of axisMarks(ticks, X, left, right, (t) => textWidth(t, FS.small))) {
    if (m.kind === "cut")
      out.push(`<g transform="translate(${r1(m.x)} 0)"><title>${m.years} years with no events, cut</title>` +
        `<path d="M-6 ${r1(axY)} q3 -6 6 0 t6 0" fill="none" stroke="${p.muted}" stroke-width="1.2"/>` +
        `<line x1="0" x2="0" y1="${r1(top)}" y2="${r1(axY)}" stroke="${p.muted}" stroke-width="${SW.hair}" stroke-dasharray="2 3"/></g>`);
    else if (m.kind === "year") {
      out.push(`<line x1="${r1(m.x)}" x2="${r1(m.x)}" y1="${r1(top)}" y2="${r1(axY)}" stroke="${m.day === 0 ? p.muted : p.line}" stroke-width="${SW.hair}"/>`,
        `<line x1="${r1(m.x)}" x2="${r1(m.x)}" y1="${r1(axY)}" y2="${r1(axY + 6)}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
      if (m.label) out.push(label(m.label.x, ly, m.label.text, { size: FS.small, fill: p.muted, anchor: "middle" }));
    } else {
      out.push(`<line x1="${r1(m.x)}" x2="${r1(m.x)}" y1="${r1(axY)}" y2="${r1(axY + 3)}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
      if (m.label) out.push(label(m.x, ly, m.label, { size: FS.small, fill: p.muted, anchor: "middle" }));
    }
  }
  out.push(label((left + right) / 2, ly + 15, TIME_TITLE, { size: FS.small, fill: p.muted, anchor: "middle" }));
  return out;
}

/** the time axis's title */
const TIME_TITLE = "Time from diagnosis, when each sample was collected";

/**
 * The samples' numbered markers under the plot, from `y0`: a row per group (Group by), labelled at
 * the left in the group's colour, as the portal's VAF chart gives each group its own track; samples
 * at the same x within a group stack. Returns the y below the last row.
 */
function markerRows(groups: { value: string; color: string | null; samples: number[] }[], samples: EvolutionSample[], xs: number[], y0: number, left: number, p: ReturnType<typeof palette>, out: string[]): number {
  let y = y0;
  for (const g of groups) {
    const seen = new Map<number, number>();
    const rows = g.samples.map((i) => { const k = Math.round(xs[i]); const n = seen.get(k) || 0; seen.set(k, n + 1); return n; });
    g.samples.forEach((i, k) => out.push(marker(xs[i], y + MARK_R + rows[k] * (2 * MARK_R + 2), samples[i])));
    if (groups.length > 1 && g.value) out.push(label(left - 6, y + MARK_R + FS.small * 0.35, g.value, { size: FS.small, fill: g.color ?? p.ink, anchor: "end", maxW: left - 12 }));
    y += (Math.max(0, ...rows) + 1) * (2 * MARK_R + 2);
  }
  return y;
}

/**
 * The line chart; `plot`, the timeline's plot span drawn above it: the chart's x axis then spans the
 * same pixels, so a sample sits under its own day on the timeline (the portal widens its header to match).
 */
function lineChart(v: DrawnResultOf<"evolution">, W: number, p: ReturnType<typeof palette>, plot?: { x: number; width: number }): { svg: string; height: number } {
  const e = v.evolution, samples = e.patient!.samples, drawn = e.drawn!, d = e.display;
  const out: string[] = [];
  // the samples' groups (Group by): a line per mutation and group, a marker row per group
  const groups = e.groupBy?.groups ?? [{ value: "", color: null, samples: samples.map((_, i) => i) }];
  const ys = drawn.flatMap((m) => groups.flatMap((g) => lineCells(m, g.samples)).map((x) => yOf(x.c)).filter((y): y is number => y != null));
  const top = 14, H = 220;
  let y: Scale;
  if (d.logScale) {
    const lo = d.dataRange ? Math.max(LOG_FLOOR, Math.min(...ys.map((t) => Math.max(t, LOG_FLOOR)))) : LOG_FLOOR;
    y = log(lo, d.dataRange ? Math.max(...ys, lo * 10) : 1, top + H, top);
  } else y = d.dataRange && ys.length ? linear(Math.min(...ys), Math.max(...ys), top + H, top) : linear(0, 1, top + H, top, { nice: false });
  const yv = (t: number) => y(d.logScale ? Math.max(t, LOG_FLOOR) : t);
  const yTitle = "Variant allele frequency";
  // grouped, the left margin also holds each group's label (at most a fifth of the width)
  const groupW = groups.length > 1 ? Math.min(W / 5, Math.max(0, ...groups.map((g) => textWidth(g.value, FS.small))) + 12) : 0;
  const left = plot ? plot.x : Math.max(leftAxisWidth(y, yTitle), groupW) + 8, right = plot ? plot.x + plot.width : W - 16;
  // the samples along x: evenly in order, or by the day each was collected
  const pad = 20;
  let xs: number[], bottom: number;
  if (e.x === "time") {
    const days = samples.map((s) => s.day!);
    let X: (day: number) => number;
    if (e.axis?.length) { const { x } = dayScale(e.axis, right - left); X = (t) => left + x(t); }
    else X = linear(Math.min(...days), Math.max(...days), left + pad, right - pad);
    xs = days.map((t) => X(t));
    out.push(axisLeft(y, left, p, { title: yTitle, gridTo: right }));
    const axY = markerRows(groups, samples, xs, top + H + 12, left, p, out) + 4;
    if (e.axis?.length) {
      out.push(...timeAxis(e.axis, X, left, right, axY, top, p));
      bottom = axY + 38;
    } else {
      out.push(axisBottom(X as Scale, axY, p, { title: "Days from diagnosis, when each sample was collected", fmt: (t) => fmtInt(t), minX: 0, maxX: W, line: true }));
      bottom = axY + bottomAxisHeight("x");
    }
  } else {
    xs = samples.map((_, i) => samples.length === 1 ? (left + right) / 2 : left + pad + i * (right - left - 2 * pad) / (samples.length - 1));
    out.push(axisLeft(y, left, p, { title: yTitle, gridTo: right }));
    bottom = markerRows(groups, samples, xs, top + H + 12, left, p, out) + 6;
  }
  out.push(`<line x1="${left}" y1="${r1(top + H)}" x2="${right}" y2="${r1(top + H)}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
  for (const m of drawn) for (const grp of groups) {
    const pts = lineCells(m, grp.samples);
    if (!pts.length) continue;
    const ink = grp.color ?? p.ink;
    const g: string[] = [];
    let prev: { x: number; y: number } | null = null, gap = false;
    for (const { i, c } of pts) {
      const t = yOf(c);
      if (t == null) { gap = true; continue; }
      const pt = { x: xs[i], y: yv(t) };
      if (prev) g.push(`<line x1="${r1(prev.x)}" y1="${r1(prev.y)}" x2="${r1(pt.x)}" y2="${r1(pt.y)}" stroke="${ink}" stroke-width="${SW.line}" stroke-opacity="0.55"${gap ? ` stroke-dasharray="3 3"` : ""}/>`,
        `<line x1="${r1(prev.x)}" y1="${r1(prev.y)}" x2="${r1(pt.x)}" y2="${r1(pt.y)}" stroke="transparent" stroke-width="8"/>`);
      prev = pt; gap = false;
    }
    for (const { i, c } of pts) {
      const t = yOf(c);
      if (t == null) continue;
      const x = r1(xs[i]), yy = r1(yv(t));
      g.push(c.status === "called" ? `<circle data-s="${i}" cx="${x}" cy="${yy}" r="3" fill="${ink}"/>`
        : c.status === "uncalled" ? `<circle data-s="${i}" cx="${x}" cy="${yy}" r="3" fill="${p.bg}" stroke="${ink}" stroke-width="${SW.line}"/>`
        : `<rect data-s="${i}" x="${r1(xs[i] - 2.5)}" y="${r1(yv(t) - 2.5)}" width="5" height="5" fill="${p.bg}" stroke="${ink}" stroke-width="${SW.line}"/>`);
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

/** a VAF's colour: the portal's VAF heatmap ramp, rgb(241,242,181) → rgb(19,80,88) (lib/oncoprint-style.ts) */
const heatFill = (vaf: number) => rampColor(STYLE.ramps.vaf, Math.max(0, Math.min(1, vaf)));

/** The heatmap's column at zoom 1, the portal's cell (MutationOncoprint INIT_PARAMS init_cell_width). */
export const HEAT_CELL = 20;

/**
 * The heatmap's columns at `W`: the width that fits them (`fit`) and the narrowest a column is drawn
 * (`floor`: a label's line height when labelled, 6 px; 14 px for a sample's marker when transposed).
 */
export function heatmapColumns(v: DrawnResultOf<"evolution">, W: number): { fit: number; floor: number } {
  const e = v.evolution, n = e.display.transpose ? e.patient!.samples.length : e.drawn!.length, d = e.display;
  if (d.transpose) return { fit: Math.max(14, Math.min(56, (W - 16 - rowLabelWidth(v, W)) / n)), floor: 14 };
  const floor = d.mutationLabels ? FS.small + 2 : 6;
  return { fit: Math.max(floor, Math.min(HEAT_CELL, (W - 16 - (8 + 2 * MARK_R + 8)) / Math.max(1, n))), floor };
}

/** The transposed heatmap's room for its rows' labels (GENE pChange), or a margin when they are hidden. */
const rowLabelWidth = (v: DrawnResultOf<"evolution">, W: number) => v.evolution.display.mutationLabels
  ? Math.min(W * 0.4, Math.max(60, ...v.evolution.drawn!.map((m) => textWidth(mutationName(m), FS.small))) + 10) : 8;

/**
 * The heatmap; `width` is wider than `W` when its columns need more room. `zoom` (the portal's
 * horizontal zoom) draws each column `zoom` × HEAT_CELL wide, never under the floor; without it they fit `W`.
 */
function heatmap(v: DrawnResultOf<"evolution">, W: number, p: ReturnType<typeof palette>, zoom?: number): { svg: string; height: number; width: number } {
  const e = v.evolution, samples = e.patient!.samples, drawn = e.drawn!, d = e.display;
  const G = STYLE.glyph, out: string[] = [];
  const ord = e.heatmapOrder ?? heatmapOrder(drawn, samples.length, d);
  const names = drawn.map(mutationName);
  const cols = heatmapColumns(v, W);
  const colW = zoom == null ? cols.fit : Math.max(cols.floor, zoom * HEAT_CELL);
  /** one cell of mutation i in sample j at (x, y), w × h */
  const cell = (i: number, j: number, x: number, y: number, w: number, h: number) => {
    const c = drawn[i].cells[j];
    const band = (b: readonly [number, number], color: string) => `<rect x="${r1(x)}" y="${r1(y + b[0] * h)}" width="${r1(w)}" height="${r1((b[1] - b[0]) * h)}" fill="${color}"/>`;
    let body: string;
    if (c.status === "called" || c.status === "uncalled") {
      body = band([0, 1], heatFill(c.vaf!)) + (c.status === "uncalled" ? `<circle cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" r="2" fill="${c.vaf! > 0.5 ? "#ffffff" : p.ink}"/>` : "");
    } else if (c.status === "absent") body = band([0, 1], STYLE.palette.unaltered);
    else if (c.status === "noVaf") body = band([0, 1], STYLE.palette.unaltered) + band(G.mutation.band, G.mutation.single.color);
    else body = band([0, 1], G.notProfiled.fill) + band(G.notProfiled.stripe.band, G.notProfiled.stripe.color);
    return `<g data-s="${j}"><title>${esc(names[i] + " in " + samples[j].label + " (" + samples[j].id + "): " + cellText(c))}</title>${body}</g>`;
  };
  const gap = 1, top = 4;
  let y0: number, gridBottom: number;
  let width: number;
  if (d.transpose) {
    // a row per mutation, labelled; a column per sample, its numbered marker above
    const labelW = rowLabelWidth(v, W), rowH = 14;
    const x0 = 8 + labelW;
    width = Math.max(W, x0 + samples.length * colW + 8);
    ord.samples.forEach((j, k) => out.push(marker(x0 + k * colW + colW / 2, top + MARK_R, samples[j])));
    y0 = top + 2 * MARK_R + 6;
    ord.mutations.forEach((i, r) => {
      const y = y0 + r * rowH, m = drawn[i];
      out.push(`<g class="evo-row"${m.key ? ` data-key="${esc(m.key)}"` : ""}>`, `<rect x="8" y="${r1(y)}" width="${r1(x0 + samples.length * colW - 8)}" height="${rowH}" fill="transparent"/>`);
      if (d.mutationLabels) out.push(label(x0 - 6, y + rowH / 2 + FS.small * 0.35, names[i], { size: FS.small, fill: p.ink, anchor: "end", maxW: labelW - 6 }));
      out.push(...ord.samples.map((j, k) => cell(i, j, x0 + k * colW, y, colW - gap, rowH - gap)), "</g>");
    });
    gridBottom = y0 + drawn.length * rowH;
  } else {
    // the portal's default: a row per sample, its numbered marker at the left; a column per mutation, labelled below
    // a column is at least 6 px, or a label's line height when labelled; past that the figure widens
    const x0 = 8 + 2 * MARK_R + 8, rowH = 18;
    width = Math.max(W, x0 + drawn.length * colW + 8);
    y0 = top;
    ord.samples.forEach((j, r) => out.push(marker(8 + MARK_R, y0 + r * rowH + rowH / 2, samples[j])));
    ord.mutations.forEach((i, k) => {
      const x = x0 + k * colW, m = drawn[i];
      out.push(`<g class="evo-row"${m.key ? ` data-key="${esc(m.key)}"` : ""}>`, `<rect x="${r1(x)}" y="${r1(y0)}" width="${r1(colW)}" height="${r1(samples.length * rowH)}" fill="transparent"/>`);
      out.push(...ord.samples.map((j, r) => cell(i, j, x, y0 + r * rowH, colW - gap, rowH - gap)), "</g>");
    });
    gridBottom = y0 + samples.length * rowH;
    if (d.mutationLabels) {
      // rotated a quarter turn, a label's glyphs lie on the +x side of its baseline: the baseline sits
      // 0.35 em left of the column's centre so the text is centred under its column
      const lh = Math.min(140, Math.max(...names.map((n) => textWidth(n, FS.small))) + 6);
      ord.mutations.forEach((i, k) => {
        const bx = x0 + k * colW + colW / 2 - FS.small * 0.35;
        out.push(label(bx, gridBottom + 4, names[i], { size: FS.small, fill: p.ink, rotate: 90, maxW: lh - 6 }));
      });
      gridBottom += lh;
    }
  }
  let h = gridBottom + 10;
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
  return { svg: out.join(""), height: h, width };
}

/**
 * The result with only the mutations `keys` names drawn, the portal's "Show only selected mutations"
 * (VAFChartControls): none named, none drawn; the y axis's data range then follows those drawn.
 */
export function onlySelected<T extends DrawnResultOf<"evolution">>(v: T, keys: ReadonlySet<string>): T {
  const d = v.evolution.drawn;
  return d ? { ...v, evolution: { ...v.evolution, drawn: d.filter((m) => keys.has(m.key)) } } : v;
}

/**
 * `o.caption: false` leaves the caveat out, for a page that prints it beside the figure; `o.zoom`, the
 * heatmap's zoom (HEAT_CELL px columns at 1), a zoomed heatmap keeping its width rather than shrinking to the page's.
 */
export function evolutionSvg(v: DrawnResultOf<"evolution">, o: SvgOpts & { caption?: boolean; zoom?: number }): string | null {
  const e = v.evolution, pt = e.patient;
  if (!pt || !e.drawn || !e.drawn.length) return null;
  const p = palette(o.theme), W = Math.max(420, o.width || 760);
  // Show Timeline: the patient's timeline above the line chart, the chart on its axis
  const tl = e.timeline && e.display.chart === "line" ? timelineSvg(e.timeline, { width: W, expandGaps: e.display.expandGaps, theme: o.theme }) : null;
  const chart: { svg: string; height: number; width?: number } = e.display.chart === "heatmap" ? heatmap(v, W, p, o.zoom)
    : lineChart(v, W, p, tl && e.x === "time" && e.axis?.length ? tl.layout.plot : undefined);
  const body: { svg: string; height: number; width?: number } = tl
    ? { svg: tl.body + `<g transform="translate(0,${tl.layout.height + 8})">${chart.svg}</g>`, height: tl.layout.height + 8 + chart.height } : chart;
  const FW = Math.max(W, body.width ?? W);
  let y = body.height + 4;
  const key = sampleKey(pt.samples, y, W, p);
  y += key.height + 4;
  const cap = caption(o.caption === false ? "" : v.caveat || "", W, y, p.muted);
  const hm = e.display.chart === "heatmap"
    ? "heatmap, a row per " + (e.display.transpose ? "mutation" : "sample") + (e.display.cluster ? ", clustered" : "")
    : "VAF lines";
  return frame(FW, y + cap.height + 8, body.svg + key.svg + cap.svg, p.bg, o.zoom != null && e.display.chart === "heatmap" && FW > W,
    "Genomic evolution — " + pt.id + ": " + e.drawn.length + " mutations across " + pt.samples.length + " samples (" + hm + ")", { tip: false });
}
