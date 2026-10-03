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

export function enrichmentSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.enrichment!;
  const W = o.width || 960, two = r.groups.length === 2 && !!r.grid;
  const out: string[] = [];
  const lp = (x: number) => -Math.log10(Math.max(1e-300, x));
  out.push(`<text x="10" y="14" font-size="10.5" fill="${p.muted}">${fmt(r.tested)} genes tested for ${esc(r.alteration)} · ${fmt(r.significant)} at q &lt; 0.05</text>`);
  let bottom = 30;
  const TX = two ? 470 : 10;
  if (two) {
    const g = r.grid!, VL = 50, VT = 30, VW = 400, VH = 300;
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
    out.push(`<text x="${VL + VW / 2}" y="${VT + VH + 26}" font-size="10" fill="${p.muted}" text-anchor="middle">log2 ratio (${esc(r.groups[0])} / ${esc(r.groups[1])})</text>`);
    out.push(`<text x="12" y="${VT + VH / 2}" font-size="10" fill="${p.muted}" text-anchor="middle" transform="rotate(-90 12 ${VT + VH / 2})">−log10 p</text>`);
    const cw = VW / g.nx, ch = VH / g.ny, maxC = Math.max(1, ...g.cells.map((c) => c[2]));
    let dens = "";
    for (const [bx, by, c] of g.cells) dens += `<rect x="${num(VL + bx * cw)}" y="${num(VT + VH - (by + 1) * ch)}" width="${num(cw + 0.3)}" height="${num(ch + 0.3)}" fill="${p.muted}" opacity="${num(0.15 + 0.6 * Math.log1p(c) / Math.log1p(maxC))}"/>`;
    out.push(dens);
    let dots = "";
    for (const row of r.rows) {
      const x = row.log2Ratio == null ? (row.cells[0].altered ? g.xMax : -g.xMax) : row.log2Ratio;
      const col = row.q < 0.05 ? (row.enrichedIn === r.groups[0] ? SERIES[0] : SERIES[1]) : p.muted;
      dots += `<circle cx="${num(X(x))}" cy="${num(Y(lp(row.p)))}" r="2.4" fill="${col}" opacity="0.8"/>`;
    }
    out.push(dots);
    const placed: { x: number; y: number }[] = [];
    for (const name of r.labels) {
      const row = r.rows.find((x) => x.gene === name);
      if (!row) continue;
      const px = X(row.log2Ratio == null ? (row.cells[0].altered ? g.xMax : -g.xMax) : row.log2Ratio), py = Y(lp(row.p));
      let ly = py - 4;
      while (placed.some((q) => Math.abs(q.y - ly) < 10 && Math.abs(q.x - px) < 55)) ly += 10;
      placed.push({ x: px, y: ly });
      const right = px < VL + VW * 0.7;
      out.push(`<text x="${num(px + (right ? 5 : -5))}" y="${num(ly)}" font-size="9.5" fill="${p.ink}" text-anchor="${right ? "start" : "end"}">${esc(name)}</text>`);
    }
    bottom = VT + VH + 34;
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

void pFmt;

export function portalViewToSvg(v: ViewResult, o: SvgOpts): string | null {
  if (v.kind === "cancertypes" && v.cancertypes && v.cancertypes.panels.some((pn) => pn.profiled)) return cancertypesSvg(v, o);
  if (v.kind === "overlap" && v.overlap && v.overlap.union > 0) return overlapSvg(v, o);
  if (v.kind === "enrichment" && v.enrichment && v.enrichment.tested > 0) return enrichmentSvg(v, o);
  return null;
}

export function portalViewTitle(v: ViewResult): string | null {
  if (v.kind === "enrichment") return "Alteration enrichment" + (v.enrichment ? " — " + v.enrichment.alteration + ", " + v.enrichment.groups.join(" vs ") : "");
  if (v.kind === "overlap") return "Cohort overlap" + (v.overlap ? " — " + v.overlap.sets.map((x) => x.name).join(", ") : "");
  if (v.kind === "cancertypes") return "Cancer types summary" + (v.cancertypes ? " — " + v.cancertypes.genes.join(", ") + " by " + v.cancertypes.groupBy : "");
  return null;
}
