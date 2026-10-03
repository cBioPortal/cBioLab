// Server-side renderers for the view kinds in lib/views-portal.ts — the same frame, palette and
// caption as every other figure (lib/svg-kit.ts), and the oncoprint's colours for alterations.
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "./svg-kit.ts";
import { STYLE } from "./oncoprint-style.ts";
import type { ViewResult, CancertypesGroup } from "./types.ts";

const MUT = STYLE.glyph.mutation.single.color;
const AMP = STYLE.glyph.cna.options.find((o) => o.bit === "AMP")!.color;
const DEL = STYLE.glyph.cna.options.find((o) => o.bit === "HOMDEL")!.color;
const SV = STYLE.glyph.sv.color;
const MULTI = "#6e7a83";

// ---------------------------------------------------------------------------

export function cancertypesSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.cancertypes!;
  const W = o.width || 860, LBL = 250, BAR_X = LBL + 12, STAT = 150, BAR_W = W - BAR_X - STAT - 10;
  const kinds: [keyof CancertypesGroup, string, string][] = [["mutation", "mutation", MUT], ["amp", "amplification", AMP],
    ["homdel", "deep deletion", DEL], ["sv", "structural variant", SV], ["multiple", "multiple alterations", MULTI]];
  const freq = r.show === "frequency";
  const value = (g: CancertypesGroup, k: keyof CancertypesGroup) => freq ? 100 * Number(g[k]) / (g.profiled || 1) : Number(g[k]);
  const rowsOf = (pn: typeof r.panels[number]) => [...pn.groups, ...(pn.pooled ? [pn.pooled] : [])];
  const top = Math.max(1e-9, ...r.panels.flatMap((pn) => rowsOf(pn).map((g) => value(g, "altered"))));
  // a tick every 5, 10, 20 or 25 points (or a round count), and the axis ending on one
  const tick = freq ? (top <= 20 ? 5 : top <= 50 ? 10 : top <= 80 ? 20 : 25)
    : Math.pow(10, Math.floor(Math.log10(top))) * (top / Math.pow(10, Math.floor(Math.log10(top))) > 5 ? 2 : 1);
  const scale = freq ? Math.min(100, Math.ceil(top / tick) * tick) : Math.ceil(top / tick) * tick;
  const out: string[] = [];
  let y = 8;
  // key
  let kx = 10;
  for (const [, label, col] of kinds) {
    out.push(`<rect x="${kx}" y="${y}" width="9" height="9" rx="2" fill="${col}"/><text x="${kx + 13}" y="${y + 8}" font-size="10" fill="${p.ink}">${esc(label)}</text>`);
    kx += 22 + label.length * 5.6;
  }
  y += 24;
  for (const [pi, pn] of r.panels.entries()) {
    if (r.panels.length > 1 || pn.cohort) {
      out.push(`<text x="10" y="${y + 10}" font-size="12" font-weight="600" fill="${SERIES[pi % SERIES.length]}">${esc(pn.cohort)}` +
        `<tspan dx="6" font-size="10" font-weight="400" fill="${p.muted}">${fmt(pn.altered)} of ${fmt(pn.profiled)} profiled samples altered (${(100 * pn.altered / (pn.profiled || 1)).toFixed(1)}%)</tspan></text>`);
      y += 20;
    }
    for (const g of rowsOf(pn)) {
      const pooled = g.key === "__pooled__";
      const label = g.label.length > 40 ? g.label.slice(0, 39) + "…" : g.label;
      out.push(`<text x="${LBL}" y="${y + 10}" font-size="10.5" fill="${pooled ? p.muted : p.ink}" text-anchor="end"${pooled ? ' font-style="italic"' : ""}>${esc(label)}</text>`);
      out.push(`<rect x="${BAR_X}" y="${y + 1}" width="${BAR_W}" height="12" fill="${p.line}" opacity="0.4"/>`);
      let x = BAR_X;
      for (const [k, , col] of kinds) {
        const w = BAR_W * value(g, k) / scale;
        if (w > 0) { out.push(`<rect x="${num(x)}" y="${y + 1}" width="${num(w)}" height="12" fill="${col}"/>`); x += w; }
      }
      out.push(`<text x="${num(W - STAT)}" y="${y + 10}" font-size="10" fill="${p.ink}">${(100 * g.altered / (g.profiled || 1)).toFixed(1)}%` +
        `<tspan dx="5" fill="${p.muted}">${fmt(g.altered)} / ${fmt(g.profiled)}${g.samples > g.profiled ? " of " + fmt(g.samples) : ""}</tspan></text>`);
      y += 17;
    }
    y += 10;
  }
  // axis
  out.push(`<line x1="${BAR_X}" y1="${y - 6}" x2="${BAR_X + BAR_W}" y2="${y - 6}" stroke="${p.muted}" stroke-width="0.6"/>`);
  for (let xv = 0; xv <= scale + 1e-9; xv += tick) {
    const xx = BAR_X + BAR_W * xv / scale;
    out.push(`<text x="${num(xx)}" y="${y + 6}" font-size="9" fill="${p.muted}" text-anchor="middle">${freq ? num(xv) + "%" : fmt(Math.round(xv))}</text>`);
  }
  y += 14;
  const cap = caption(v.caveat || "", W, y, p.muted, Math.floor(W / 7.2));
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg);
}

// ---------------------------------------------------------------------------

export function overlapSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.overlap!;
  const sets = r.sets, inter = r.intersections;
  const W0 = o.width || 860, NAME = 170, SIZE = 58, SETBAR = 110, BAR0 = NAME + SIZE + 8, LEFT = BAR0 + SETBAR + 18, COL = 30, T = 34, BARH = 170, ROW = 22;
  const W = Math.max(W0, LEFT + inter.length * COL + 20);
  const maxN = Math.max(1, ...inter.map((x) => x.n)), maxSet = Math.max(1, ...sets.map((s) => s.size));
  const out: string[] = [];
  const matrixTop = T + BARH + 18;
  // intersection bars, with their counts
  inter.forEach((x, i) => {
    const cx = LEFT + i * COL + COL / 2, h = BARH * x.n / maxN;
    out.push(`<rect x="${num(cx - 9)}" y="${num(T + BARH - h)}" width="18" height="${num(Math.max(h, 0.8))}" fill="${p.ink}" opacity="0.85"/>`);
    out.push(`<text x="${num(cx)}" y="${num(T + BARH - h - 4)}" font-size="9" fill="${p.ink}" text-anchor="middle">${fmt(x.n)}</text>`);
  });
  out.push(`<text x="${LEFT}" y="13" font-size="10" fill="${p.muted}">patients in exactly these cohorts</text>`);
  out.push(`<text x="${NAME + SIZE}" y="${matrixTop - 14}" font-size="9" fill="${p.muted}" text-anchor="end">patients</text>`);
  // set rows: name, size bar (growing leftwards), the dot matrix
  sets.forEach((st, j) => {
    const y = matrixTop + j * ROW, col = SERIES[j % SERIES.length];
    if (j % 2 === 0) out.push(`<rect x="${LEFT - 4}" y="${y - ROW / 2}" width="${inter.length * COL + 8}" height="${ROW}" fill="${p.line}" opacity="0.35"/>`);
    const bw = SETBAR * st.size / maxSet;
    out.push(`<rect x="${BAR0}" y="${y - 6}" width="${num(bw)}" height="12" fill="${col}" opacity="0.85"/>`);
    out.push(`<text x="${NAME}" y="${y + 4}" font-size="11" fill="${p.ink}" text-anchor="end">${esc(st.name.length > 26 ? st.name.slice(0, 25) + "…" : st.name)}</text>`);
    out.push(`<text x="${NAME + SIZE}" y="${y + 4}" font-size="9.5" fill="${p.muted}" text-anchor="end">${fmt(st.size)}</text>`);
    inter.forEach((x, i) => {
      const on = x.members.includes(st.name);
      out.push(`<circle cx="${LEFT + i * COL + COL / 2}" cy="${y}" r="5" fill="${on ? p.ink : p.line}"/>`);
    });
  });
  // lines joining the members of each combination
  inter.forEach((x, i) => {
    const ys = x.members.map((m) => matrixTop + sets.findIndex((s) => s.name === m) * ROW);
    if (ys.length > 1) out.push(`<line x1="${LEFT + i * COL + COL / 2}" y1="${Math.min(...ys)}" x2="${LEFT + i * COL + COL / 2}" y2="${Math.max(...ys)}" stroke="${p.ink}" stroke-width="2"/>`);
  });
  let y = matrixTop + sets.length * ROW + 6;
  out.push(`<text x="10" y="${y + 6}" font-size="10.5" fill="${p.ink}">${fmt(r.union)} patients in at least one cohort · ${inter.length} non-empty combination${inter.length === 1 ? "" : "s"} of ${Math.pow(2, sets.length) - 1}</text>`);
  y += 14;
  const cap = caption(v.caveat || "", W, y, p.muted, Math.floor(Math.min(W, 960) / 7.2));
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, W > W0);
}

// ---------------------------------------------------------------------------

type Grid = { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number][] };

/** A volcano: every other tested item as a density grid, the reported ones as dots, the first
 *  `labels` named. x is clamped to ±xMax (an infinite ratio sits on the edge). */
function volcano(p: ReturnType<typeof palette>, g: Grid, pts: { key: string; x: number; p: number; color: string; label?: string }[],
  labels: string[], xTitle: string): { svg: string; bottom: number } {
  const out: string[] = [];
  const VL = 50, VT = 30, VW = 400, VH = 300;
  const lp = (x: number) => -Math.log10(Math.max(1e-300, x));
  const X = (x: number) => VL + VW * (Math.max(-g.xMax, Math.min(g.xMax, x)) + g.xMax) / (2 * g.xMax);
  const Y = (y: number) => VT + VH * (1 - Math.min(y, g.yMax) / g.yMax);
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    out.push(`<line x1="${VL}" y1="${num(VT + VH * (1 - f))}" x2="${VL + VW}" y2="${num(VT + VH * (1 - f))}" stroke="${p.line}" stroke-width="0.6"/>` +
      `<text x="${VL - 4}" y="${num(VT + VH * (1 - f) + 3)}" font-size="9" fill="${p.muted}" text-anchor="end">${num(g.yMax * f)}</text>`);
  }
  for (const f of [-1, -0.5, 0, 0.5, 1]) {
    const xx = X(f * g.xMax);
    out.push(`<line x1="${num(xx)}" y1="${VT}" x2="${num(xx)}" y2="${VT + VH}" stroke="${p.line}" stroke-width="${f === 0 ? 1 : 0.6}"/>` +
      `<text x="${num(xx)}" y="${VT + VH + 12}" font-size="9" fill="${p.muted}" text-anchor="middle">${num(f * g.xMax)}</text>`);
  }
  out.push(`<text x="${VL + VW / 2}" y="${VT + VH + 26}" font-size="10" fill="${p.muted}" text-anchor="middle">${esc(xTitle)}</text>`);
  out.push(`<text x="12" y="${VT + VH / 2}" font-size="10" fill="${p.muted}" text-anchor="middle" transform="rotate(-90 12 ${VT + VH / 2})">−log10 p</text>`);
  const cw = VW / g.nx, ch = VH / g.ny, maxC = Math.max(1, ...g.cells.map((c) => c[2]));
  let dens = "";
  for (const [bx, by, c] of g.cells) dens += `<rect x="${num(VL + bx * cw)}" y="${num(VT + VH - (by + 1) * ch)}" width="${num(cw + 0.3)}" height="${num(ch + 0.3)}" fill="${p.muted}" opacity="${num(0.15 + 0.6 * Math.log1p(c) / Math.log1p(maxC))}"/>`;
  out.push(dens);
  out.push(pts.map((d) => `<circle cx="${num(X(d.x))}" cy="${num(Y(lp(d.p)))}" r="2.4" fill="${d.color}" opacity="0.8"/>`).join(""));
  const placed: { x: number; y: number }[] = [];
  for (const key of labels) {
    const d = pts.find((x) => x.key === key);
    if (!d) continue;
    const px = X(d.x), py = Y(lp(d.p));
    // a free line at most two above or below the point, inside the plot; a label with no room nearby is left
    // to the table beside the plot rather than drawn over the axis
    const free = (y: number) => y > VT + 8 && y < VT + VH - 2 && !placed.some((q) => Math.abs(q.y - y) < 10 && Math.abs(q.x - px) < 70);
    let ly: number | null = null;
    for (let k = 0; k < 3 && ly == null; k++) for (const s of [-1, 1]) { const y = py - 4 + s * 10 * k; if (ly == null && free(y)) ly = y; }
    if (ly == null) continue;
    placed.push({ x: px, y: ly });
    const right = px < VL + VW * 0.7;
    out.push(`<text x="${num(px + (right ? 5 : -5))}" y="${num(ly)}" font-size="9.5" fill="${p.ink}" text-anchor="${right ? "start" : "end"}">${esc(d.label || key)}</text>`);
  }
  return { svg: out.join(""), bottom: VT + VH + 34 };
}

export function enrichmentSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.enrichment!;
  const W = o.width || 960, two = r.groups.length === 2 && !!r.grid;
  const out: string[] = [];
  out.push(`<text x="10" y="14" font-size="10.5" fill="${p.muted}">${fmt(r.tested)} genes tested for ${esc(r.alteration)} · ${fmt(r.significant)} at q &lt; 0.05</text>`);
  let bottom = 30;
  const TX = two ? 470 : 10;
  if (two) {
    const g = r.grid!;
    const xOf = (row: (typeof r.rows)[number]) => row.log2Ratio == null ? (row.cells[0].altered ? g.xMax : -g.xMax) : row.log2Ratio;
    const v2 = volcano(p, g, r.rows.map((row) => ({ key: row.gene, x: xOf(row), p: row.p,
      color: row.q < 0.05 ? (row.enrichedIn === r.groups[0] ? SERIES[0] : SERIES[1]) : p.muted })), r.labels,
      "log2 ratio (" + r.groups[0] + " / " + r.groups[1] + ")");
    out.push(v2.svg);
    bottom = v2.bottom;
  }
  // the table of the most significant genes, with a bar per cohort
  const shown = r.rows.slice(0, 18), TW = W - TX - 10, BAR = Math.max(60, TW - 260) / r.groups.length;
  const maxPct = Math.max(1, ...shown.flatMap((g) => g.cells.map((c) => c.pct ?? 0)));
  out.push(`<text x="${TX}" y="40" font-size="10" fill="${p.muted}">gene</text>` +
    r.groups.map((n, i) => `<text x="${num(TX + 80 + i * BAR)}" y="40" font-size="10" fill="${SERIES[i % SERIES.length]}">${esc(n.length > 18 ? n.slice(0, 17) + "…" : n)}</text>`).join("") +
    `<text x="${num(TX + 80 + r.groups.length * BAR + 6)}" y="40" font-size="10" fill="${p.muted}">q</text>`);
  shown.forEach((g, i) => {
    const y = 50 + i * 17;
    out.push(`<text x="${TX}" y="${y + 9}" font-size="10.5" font-weight="600" fill="${p.ink}">${esc(g.gene)}</text>`);
    g.cells.forEach((c, ci) => {
      const bx = TX + 80 + ci * BAR, w = (BAR - 44) * (c.pct ?? 0) / maxPct;
      out.push(`<rect x="${num(bx)}" y="${y + 1}" width="${num(Math.max(0.5, w))}" height="10" fill="${SERIES[ci % SERIES.length]}" opacity="0.85"/>` +
        `<text x="${num(bx + w + 3)}" y="${y + 9}" font-size="9" fill="${p.muted}">${c.pct == null ? "—" : c.pct.toFixed(1) + "%"}</text>`);
    });
    out.push(`<text x="${num(TX + 80 + r.groups.length * BAR + 6)}" y="${y + 9}" font-size="9.5" fill="${g.q < 0.05 ? p.ink : p.muted}">${esc(g.q === 0 ? "<1e-300" : g.q < 1e-4 ? g.q.toExponential(0) : g.q.toFixed(3))}</text>`);
  });
  bottom = Math.max(bottom, 50 + shown.length * 17 + 6);
  if (r.tested > shown.length)
    out.push(`<text x="${TX}" y="${bottom + 4}" font-size="9" fill="${p.muted}">+${fmt(r.tested - shown.length)} more genes tested (the full table is in the result and the MCP text)</text>`);
  bottom += 14;
  const cap = caption(v.caveat || "", W, bottom, p.muted, Math.floor(W / 7.2));
  return frame(W, bottom + cap.height + 10, out.join("") + cap.svg, p.bg);
}

// ---------------------------------------------------------------------------

/** A categorical assay's value colours: copy-number words take the oncoprint's, the rest the series. */
function valueColor(v: string, i: number, p: ReturnType<typeof palette>): string {
  if (/^(gain|amp)/i.test(v)) return AMP;
  if (/^(loss|del|homdel)/i.test(v)) return DEL;
  if (/^(unchanged|neutral|normal|wt|no)$/i.test(v)) return p.line;
  return SERIES[i % SERIES.length];
}

export function assaysSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.assays!;
  const W = o.width || 960, cat = r.datatype === "categorical";
  const two = r.groups.length === 2 && !!r.grid;
  const out: string[] = [];
  out.push(`<text x="10" y="14" font-size="10.5" fill="${p.muted}">${fmt(r.tested)} ${esc(r.profileName)} entities tested (${esc(r.test)}) · ${fmt(r.significant)} at q &lt; 0.05</text>`);
  let bottom = 30;
  if (two) {
    const v2 = volcano(p, r.grid!, r.rows.map((row) => ({ key: row.entity, label: row.name, x: row.diff ?? 0, p: row.p,
      color: row.q < 0.05 ? (row.higherIn === r.groups[0] ? SERIES[0] : SERIES[1]) : p.muted })), r.labels,
      "difference in mean (" + r.groups[0] + " − " + r.groups[1] + ")");
    out.push(v2.svg);
    bottom = v2.bottom;
  }
  const TX = two ? 470 : 10, TW = W - TX - 10;
  const shown = r.rows.slice(0, cat ? 24 : 18);
  const NAME = Math.min(190, Math.max(90, 6.2 * Math.max(...shown.map((g) => g.name.length)))), Q = 52;
  const BAR = (TW - NAME - Q) / r.groups.length;
  let ty = 40;
  if (cat && r.values) {
    // legend of the values, in order of frequency
    let lx = TX;
    r.values.forEach((val, i) => {
      out.push(`<rect x="${num(lx)}" y="${ty - 8}" width="9" height="9" fill="${valueColor(val, i, p)}"/>` +
        `<text x="${num(lx + 12)}" y="${ty}" font-size="9.5" fill="${p.ink}">${esc(val)}</text>`);
      lx += 22 + 6 * val.length;
    });
    ty += 14;
  }
  out.push(`<text x="${TX}" y="${ty}" font-size="10" fill="${p.muted}">${cat ? "entity" : "entity · mean"}</text>` +
    r.groups.map((n, i) => `<text x="${num(TX + NAME + i * BAR)}" y="${ty}" font-size="10" fill="${SERIES[i % SERIES.length]}">${esc(n.length > 18 ? n.slice(0, 17) + "…" : n)}</text>`).join("") +
    `<text x="${num(TX + NAME + r.groups.length * BAR + 6)}" y="${ty}" font-size="10" fill="${p.muted}">q</text>`);
  const top = ty + 10;
  const means = shown.flatMap((g) => g.cells.map((c) => c.mean ?? 0));
  const nonNeg = means.every((m) => m >= 0), maxMean = Math.max(1e-12, ...means.map(Math.abs));
  shown.forEach((g, i) => {
    const y = top + i * 17;
    out.push(`<text x="${TX}" y="${y + 9}" font-size="10.5" font-weight="600" fill="${p.ink}">${esc(g.name.length > 30 ? g.name.slice(0, 29) + "…" : g.name)}</text>`);
    g.cells.forEach((c, ci) => {
      const bx = TX + NAME + ci * BAR;
      if (cat) {
        // the cohort's mix of values as one 100% bar
        let x = bx;
        const w = BAR - 8;
        (r.values || []).forEach((val, vi) => {
          const n = c.values?.[val] || 0;
          if (!n || !c.n) return;
          const ww = w * n / c.n;
          out.push(`<rect x="${num(x)}" y="${y + 1}" width="${num(ww)}" height="10" fill="${valueColor(val, vi, p)}"><title>${esc(c.cohort + ": " + val + " " + n + "/" + c.n)}</title></rect>`);
          x += ww;
        });
      } else {
        const m = c.mean, w = nonNeg && m != null ? (BAR - 50) * m / maxMean : 0;
        if (nonNeg) out.push(`<rect x="${num(bx)}" y="${y + 1}" width="${num(Math.max(0.5, w))}" height="10" fill="${SERIES[ci % SERIES.length]}" opacity="0.85"/>`);
        out.push(`<text x="${num(bx + w + 3)}" y="${y + 9}" font-size="9" fill="${p.muted}">${m == null ? "—" : esc(m.toPrecision(3))}</text>`);
      }
    });
    out.push(`<text x="${num(TX + NAME + r.groups.length * BAR + 6)}" y="${y + 9}" font-size="9.5" fill="${g.q < 0.05 ? p.ink : p.muted}">${esc(g.q === 0 ? "<1e-300" : g.q < 1e-4 ? g.q.toExponential(0) : g.q.toFixed(3))}</text>`);
  });
  bottom = Math.max(bottom, top + shown.length * 17 + 6);
  if (r.tested > shown.length)
    out.push(`<text x="${TX}" y="${bottom + 4}" font-size="9" fill="${p.muted}">+${fmt(r.tested - shown.length)} more entities tested (the full table is in the result and the MCP text)</text>`);
  bottom += 14;
  const cap = caption(v.caveat || "", W, bottom, p.muted, Math.floor(W / 7.2));
  return frame(W, bottom + cap.height + 10, out.join("") + cap.svg, p.bg);
}

// ---------------------------------------------------------------------------

export function correlatesSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.correlates!;
  const W = o.width || 960;
  const out: string[] = [];
  out.push(`<text x="10" y="14" font-size="10.5" fill="${p.muted}">${fmt(r.tested)} genes against ${esc(r.gene)} · ${fmt(r.significant)} at q &lt; 0.05 · Spearman ρ${r.rhoFrom === "meta" ? " (Fisher-z across studies)" : ""}</text>`);
  // every tested gene's ρ, as a histogram
  const HL = 40, HT = 34, HW = 300, HH = 200;
  const maxN = Math.max(1, ...r.histogram.map((h) => h[1]));
  const X = (rho: number) => HL + HW * (rho + 1) / 2;
  for (const f of [-1, -0.5, 0, 0.5, 1]) out.push(`<line x1="${num(X(f))}" y1="${HT}" x2="${num(X(f))}" y2="${HT + HH}" stroke="${p.line}" stroke-width="${f === 0 ? 1 : 0.6}"/>` +
    `<text x="${num(X(f))}" y="${HT + HH + 12}" font-size="9" fill="${p.muted}" text-anchor="middle">${num(f)}</text>`);
  for (const [lo, n] of r.histogram) {
    const h = HH * n / maxN;
    out.push(`<rect x="${num(X(lo))}" y="${num(HT + HH - h)}" width="${num(HW / 40 - 0.6)}" height="${num(h)}" fill="${lo < 0 ? SERIES[1] : SERIES[0]}" opacity="0.75"><title>ρ ${lo} to ${num(lo + 0.05)}: ${fmt(n)} genes</title></rect>`);
  }
  out.push(`<text x="${HL + HW / 2}" y="${HT + HH + 26}" font-size="10" fill="${p.muted}" text-anchor="middle">Spearman ρ with ${esc(r.gene)}</text>` +
    `<text x="${HL - 6}" y="${HT + 8}" font-size="9" fill="${p.muted}" text-anchor="end">${fmt(maxN)}</text>` +
    `<text x="${HL - 6}" y="${HT + HH}" font-size="9" fill="${p.muted}" text-anchor="end">0</text>`);
  // the most positive and most negative genes, side by side
  const TX = HL + HW + 30, COL = (W - TX - 10) / 2, ROWS = Math.min(25, Math.max(r.positive.length, r.negative.length));
  const list = (genes: typeof r.positive, x: number, title: string, color: string) => {
    out.push(`<text x="${num(x)}" y="30" font-size="10" fill="${color}">${esc(title)}</text>` +
      `<text x="${num(x + COL - 12)}" y="30" font-size="9" fill="${p.muted}" text-anchor="end">ρ · r · q</text>`);
    genes.slice(0, ROWS).forEach((g, i) => {
      const y = 40 + i * 15, w = 60 * Math.abs(g.rho ?? 0);
      out.push(`<text x="${num(x)}" y="${y + 9}" font-size="10" font-weight="600" fill="${p.ink}">${esc(g.gene)}</text>` +
        `<rect x="${num(x + 70)}" y="${y + 1}" width="${num(Math.max(0.5, w))}" height="9" fill="${color}" opacity="0.85"/>` +
        `<text x="${num(x + COL - 12)}" y="${y + 9}" font-size="9" fill="${p.muted}" text-anchor="end">${esc(String(g.rho))} · ${esc(String(g.r))} · ${esc(g.q === 0 ? "<1e-300" : g.q < 1e-4 ? g.q.toExponential(0) : g.q.toFixed(3))}</text>`);
    });
  };
  list(r.positive, TX, "rise with " + r.gene, SERIES[0]);
  list(r.negative, TX + COL, "fall as " + r.gene + " rises", SERIES[1]);
  let bottom = Math.max(HT + HH + 34, 40 + ROWS * 15 + 6);
  const hidden = Math.max(0, r.positive.length - ROWS) + Math.max(0, r.negative.length - ROWS);
  out.push(`<text x="${TX}" y="${bottom + 4}" font-size="9" fill="${p.muted}">${hidden ? "+" + fmt(hidden) + " more listed in the result and the MCP text; " : ""}every one of the ${fmt(r.tested)} genes is in the histogram</text>`);
  bottom += 14;
  const cap = caption(v.caveat || "", W, bottom, p.muted, Math.floor(W / 7.2));
  return frame(W, bottom + cap.height + 10, out.join("") + cap.svg, p.bg);
}

void pFmt;

export function portalViewToSvg(v: ViewResult, o: SvgOpts): string | null {
  if (v.kind === "cancertypes" && v.cancertypes && v.cancertypes.panels.some((pn) => pn.profiled)) return cancertypesSvg(v, o);
  if (v.kind === "overlap" && v.overlap && v.overlap.union > 0) return overlapSvg(v, o);
  if (v.kind === "enrichment" && v.enrichment && v.enrichment.tested > 0) return enrichmentSvg(v, o);
  if (v.kind === "assays" && v.assays && v.assays.tested > 0) return assaysSvg(v, o);
  if (v.kind === "correlates" && v.correlates && v.correlates.tested > 0) return correlatesSvg(v, o);
  return null;
}

export function portalViewTitle(v: ViewResult): string | null {
  if (v.kind === "correlates") return "Co-expression" + (v.correlates ? " — " + v.correlates.gene + " against every gene" : "");
  if (v.kind === "assays") return "Generic assays" + (v.assays ? " — " + v.assays.profileName : "");
  if (v.kind === "enrichment") return "Alteration enrichment" + (v.enrichment ? " — " + v.enrichment.alteration : "");
  if (v.kind === "overlap") return "Cohort overlap";
  if (v.kind === "cancertypes") return "Cancer types summary" + (v.cancertypes ? " — " + v.cancertypes.genes.join(", ") + " by " + v.cancertypes.groupBy : "");
  return null;
}
