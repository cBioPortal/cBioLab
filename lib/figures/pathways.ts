// Pathways figure: each oncogenic signalling pathway's genes, altered fraction per cohort.
//
// Three columns: the pathway, one bar per cohort for "at least one member altered", and the
// most-altered member genes as tiles. Tiles fill the width and wrap onto further lines within
// their pathway's row; inside a tile each cohort has a line of its own (a mini bar on the
// pathway bars' scale, and its percentage), so the numbers never run together however many
// cohorts there are.
import type { ViewResult, PathwayRow, PathwayCell } from "../types.ts";
import {
  palette, frame, caption, label, legend, textWidth, linear, seriesStyle, fmtPct, fmtQ, fmtInt, esc, num,
  FS, SW, type SvgOpts
} from "../svg-kit.ts";
import { CN_GAIN, CN_LOSS } from "./common.ts";

const PAD = 8, COL_GAP = 16, TILE_GAP = 6, BAR_H = 10, BAR_PITCH = 14, MINI = 26, LINE = 12, HEAD = 34;

const pctText = (c: PathwayCell) => c.pct == null ? "not profiled" : fmtPct(c.pct);
const tilePct = (c: PathwayCell) => c.pct == null ? "–" : fmtPct(c.pct);

/** a tile's width: its widest gene name (with the star) or its widest per-cohort line */
export function tileWidth(rows: PathwayRow[]): number {
  const tops = rows.flatMap((r) => r.top);
  const gene = Math.max(0, ...tops.map((t) => textWidth(t.gene + " ★", FS.body, 600)));
  const pct = Math.max(textWidth("100.0%", FS.small), ...tops.flatMap((t) => t.cells.map((c) => textWidth(tilePct(c), FS.small))));
  return Math.ceil(Math.max(gene + 16, 9 + MINI + 4 + pct + 6));
}

/** how a pathway's tiles (and the "+N more" note after them) wrap within `room`: each item's line */
export function tileLines(widths: number[], room: number): number[] {
  const line: number[] = [];
  let x = 0, l = 0;
  widths.forEach((w, i) => {
    if (i && x + w > room) { l++; x = 0; }
    line.push(l);
    x += w + TILE_GAP;
  });
  return line;
}

export function pathwaysSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), res = v.pathways!;
  const rows = res.rows, k = rows[0]?.cells.length || 1;
  const cohorts = rows[0]?.cells.map((c) => c.cohort) || [];
  const W0 = o.width || 960;

  // columns, from what they hold
  const nameW = Math.ceil(Math.min(Math.max(90, W0 * 0.16), Math.max(...rows.map((r) =>
    Math.max(textWidth(r.name, FS.title, 600), textWidth(subLine(r), FS.small))))));
  const BW = Math.round(Math.max(90, Math.min(180, W0 * 0.12)));
  const pctW = Math.ceil(Math.max(...rows.flatMap((r) => [...r.cells.map((c) => textWidth(pctText(c), FS.small)),
    r.q != null ? textWidth(fmtQ(r.q), FS.small) : 0])));
  const BAR_X = PAD + nameW + COL_GAP, TILE_X = BAR_X + BW + 6 + pctW + COL_GAP;
  const TW = tileWidth(rows), TH = 18 + k * LINE + 4;
  const W = Math.max(W0, TILE_X + TW + PAD);
  const room = W - PAD - TILE_X;

  let maxPct = 0;
  for (const r of rows) for (const c of r.cells) maxPct = Math.max(maxPct, c.pct ?? 0);
  const xs = linear(0, Math.max(1, maxPct), BAR_X, BAR_X + BW, { count: 3 });
  const barLen = (pct: number | null, len: number) => pct == null ? 0 : len * pct / xs.domain[1];

  const out: string[] = [];
  out.push(label(PAD, 12, "pathway", { size: FS.small, fill: p.muted, maxW: nameW }));
  out.push(label(BAR_X, 12, "patients with ≥1 member " + (res.measure === "driver" ? "driver" : "altered"),
    { size: FS.small, fill: p.muted, maxW: TILE_X - BAR_X - 8 }));
  out.push(label(TILE_X, 12, "most-altered members (% per cohort" + (k === 2 ? ", ★ q < 0.05" : "") + ")",
    { size: FS.small, fill: p.muted, maxW: room }));
  // the bars' scale, once, above them
  for (const t of xs.ticks) {
    const x = xs(t);
    out.push(`<line x1="${num(x)}" y1="${HEAD - 5}" x2="${num(x)}" y2="${HEAD - 2}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    out.push(label(x, HEAD - 8, xs.fmt(t) + "%", { size: FS.small, fill: p.muted,
      anchor: t === xs.ticks[0] ? "start" : t === xs.ticks[xs.ticks.length - 1] ? "end" : "middle" }));
  }

  let y = HEAD;
  rows.forEach((r, i) => {
    // the tiles and, after them, what they leave out
    const tail = [r.otherAltered ? "+" + fmtInt(r.otherAltered) + " more altered" : "",
      r.notProfiled.length ? fmtInt(r.notProfiled.length) + " never profiled" : ""].filter(Boolean);
    const tailW = tail.length ? Math.ceil(Math.max(...tail.map((t) => textWidth(t, FS.small)))) + 4 : 0;
    const widths = [...r.top.map(() => TW), ...(tail.length ? [Math.min(tailW, room)] : [])];
    const lines = tileLines(widths, room);
    const nLines = lines.length ? lines[lines.length - 1] + 1 : 0;
    const leftH = Math.max(36, 6 + k * BAR_PITCH + (r.q != null ? LINE + 2 : 0) + 4);
    const rowH = Math.max(leftH, nLines * (TH + TILE_GAP) + 6);

    if (i % 2 === 0) out.push(`<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="${p.line}" opacity="0.35"/>`);
    out.push(label(PAD, y + 17, r.name, { size: FS.title, weight: 600, fill: p.ink, maxW: nameW }));
    out.push(label(PAD, y + 31, subLine(r), { size: FS.small, fill: p.muted, maxW: nameW }));
    r.cells.forEach((c, ci) => {
      const st = seriesStyle(ci), by = y + 6 + ci * BAR_PITCH, w = barLen(c.pct, BW);
      out.push(`<rect x="${BAR_X}" y="${by}" width="${BW}" height="${BAR_H}" rx="2" fill="${p.bg}" stroke="${p.line}"/>`);
      if (w > 0) out.push(`<rect x="${BAR_X}" y="${by}" width="${num(w)}" height="${BAR_H}" rx="2" fill="${st.color}"${st.tint < 1 ? ` opacity="${st.tint}"` : ""}>` +
        `<title>${esc(c.cohort + ": " + fmtPct(c.pct!) + " (" + fmtInt(c.altered) + " of " + fmtInt(c.profiled) + ")")}</title></rect>`);
      out.push(label(BAR_X + BW + 6, by + BAR_H - 1, pctText(c), { size: FS.small, fill: p.ink }));
    });
    if (r.q != null) out.push(label(BAR_X + BW + 6, y + 6 + k * BAR_PITCH + LINE - 2, fmtQ(r.q), { size: FS.small, fill: p.muted }));

    let lx = 0, ll = 0;
    r.top.forEach((t, ti) => {
      if (lines[ti] !== ll) { ll = lines[ti]; lx = 0; }
      out.push(tile(t, TILE_X + lx, y + 4 + ll * (TH + TILE_GAP), TW, TH, p, (pct) => barLen(pct, MINI)));
      lx += TW + TILE_GAP;
    });
    if (tail.length) {
      if (lines[r.top.length] !== ll) { ll = lines[r.top.length]; lx = 0; }
      tail.forEach((t, bi) => out.push(label(TILE_X + lx, y + 4 + ll * (TH + TILE_GAP) + 13 + bi * LINE, t,
        { size: FS.small, fill: p.muted, maxW: room - lx })));
    }
    y += rowH;
  });

  y += 6;
  const lg = legend([
    ...cohorts.map((c, ci) => ({ label: c, color: seriesStyle(ci).color, opacity: seriesStyle(ci).tint })),
    { label: "oncogene", color: CN_GAIN, kind: "line" as const }, { label: "tumour suppressor (paper's role)", color: CN_LOSS, kind: "line" as const }
  ], PAD, y, W - 2 * PAD, p);
  out.push(lg.svg);
  y += lg.height;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > W0,
    "Oncogenic signalling pathways — " + cohorts.join(", "));
}

const subLine = (r: PathwayRow) => r.profiledGenes + " of " + r.genes + " genes profiled" + (r.source === "document" ? " · your set" : "");

/** one member gene: its name (starred when q < 0.05), its role as the left stripe, a line per cohort */
function tile(t: PathwayRow["top"][number], x: number, y: number, w: number, h: number,
  p: ReturnType<typeof palette>, mini: (pct: number | null) => number): string {
  const peak = Math.max(...t.cells.map((c) => c.pct ?? 0));
  const role = t.role === "OG" ? CN_GAIN : t.role === "TSG" ? CN_LOSS : p.line;
  const tip = t.gene + (t.role ? " (" + (t.role === "OG" ? "oncogene" : "tumour suppressor") + ")" : "") +
    t.cells.map((c) => "\n" + c.cohort + ": " + (c.pct == null ? "not profiled" : fmtPct(c.pct) + " (" + fmtInt(c.altered) + " of " + fmtInt(c.profiled) + ")")).join("") +
    (t.q != null ? "\n" + fmtQ(t.q) : "");
  const out = [`<g><title>${esc(tip)}</title>`,
    `<rect x="${num(x)}" y="${num(y)}" width="${w}" height="${h}" rx="4" fill="${p.bg}" stroke="${p.line}"/>`,
    `<rect x="${num(x)}" y="${num(y)}" width="4" height="${h}" rx="2" fill="${role}" opacity="${num(Math.min(1, 0.25 + peak / 40))}"/>`,
    label(x + 9, y + 14, t.gene + (t.q != null && t.q < 0.05 ? " ★" : ""), { size: FS.body, weight: 600, fill: p.ink, maxW: w - 12 })];
  t.cells.forEach((c, ci) => {
    const st = seriesStyle(ci), ly = y + 18 + ci * LINE;
    out.push(`<rect x="${num(x + 9)}" y="${num(ly + 3)}" width="${MINI}" height="6" fill="${p.line}"/>`);
    const bw = mini(c.pct);
    if (bw > 0) out.push(`<rect x="${num(x + 9)}" y="${num(ly + 3)}" width="${num(Math.max(1, bw))}" height="6" fill="${st.color}"${st.tint < 1 ? ` opacity="${st.tint}"` : ""}/>`);
    out.push(label(x + 9 + MINI + 4, ly + 9, tilePct(c), { size: FS.small, fill: c.pct == null ? p.muted : p.ink }));
  });
  out.push("</g>");
  return out.join("");
}
