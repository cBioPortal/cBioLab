// Server-side renderers for the view kinds in lib/views-more.ts. Same contract and the same
// two rules as lib/view-svg.ts (every label escaped, uniform scaling), drawn through the same
// frame, palette and caption, so a figure here cannot drift from the others.
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "./svg-kit.ts";
import type { ViewResult } from "./types.ts";
import { STYLE } from "./oncoprint-style.ts";

/** gains and losses take the oncoprint's amplification and deep-deletion hues */
const CN_GAIN = STYLE.glyph.cna.options.find((o) => o.bit === "AMP")!.color;
const CN_LOSS = STYLE.glyph.cna.options.find((o) => o.bit === "HOMDEL")!.color;

type Pal = ReturnType<typeof palette>;

/** Greedy word wrap to at most `perLine` characters; a single over-long word is kept whole. */
export function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > perLine) { lines.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** a q-value short enough for a row: one significant figure below 1e-4, and never "0" */
export const qFmt = (q: number): string => q === 0 ? "q<1e-300" : "q=" + (q < 1e-4 ? q.toExponential(0) : q.toFixed(3));

const pct = (n: number, d: number): string => d ? (Math.round(1000 * n / d) / 10).toFixed(1) + "%" : "—";

// ---------------------------------------------------------------------------

export function attritionSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme);
  const panels = v.attrition || [];
  const COL = 270, GAP = 18, PAD = 10, BOX_W = 196, LINE_H = 13, ARROW = 22;
  const W0 = o.width || 760;
  const W = Math.max(W0, PAD * 2 + panels.length * COL + (panels.length - 1) * GAP);
  const out: string[] = [];
  let bottom = 0;
  panels.forEach((pn, i) => {
    const x0 = PAD + i * (COL + GAP), colour = SERIES[i % SERIES.length];
    let y = 14;
    out.push(`<text x="${x0}" y="${y}" font-size="12" font-weight="600" fill="${p.ink}">${esc(pn.cohort)}</text>`);
    y += 10;
    const box = (lines: string[], n: number, sub: string, strong: boolean) => {
      const h = 10 + lines.length * LINE_H + LINE_H + 6;
      out.push(`<rect x="${x0}" y="${y}" width="${BOX_W}" height="${h}" rx="4" fill="${p.bg}" stroke="${strong ? colour : p.line}" stroke-width="${strong ? 2 : 1}"/>`);
      lines.forEach((l, k) => out.push(`<text x="${x0 + 8}" y="${y + 14 + k * LINE_H}" font-size="10.5" fill="${p.muted}">${esc(l)}</text>`));
      out.push(`<text x="${x0 + 8}" y="${y + 14 + lines.length * LINE_H + 2}" font-size="12" font-weight="600" fill="${p.ink}">` +
        `${fmt(n)}<tspan dx="5" font-size="10" font-weight="400" fill="${p.muted}">${esc(sub)}</tspan></text>`);
      const top = y;
      y += h;
      return { top, h };
    };
    box(["Every patient in " + (pn.studies.length === 1 ? pn.studies[0] : pn.studies.length + " studies")], pn.base, "patients", pn.steps.length === 0);
    pn.steps.forEach((s, k) => {
      const ax = x0 + BOX_W / 2;
      out.push(`<line x1="${ax}" y1="${y}" x2="${ax}" y2="${y + ARROW - 4}" stroke="${p.muted}" stroke-width="1.2"/>` +
        `<path d="M ${ax - 4} ${y + ARROW - 8} L ${ax} ${y + ARROW - 2} L ${ax + 4} ${y + ARROW - 8}" fill="none" stroke="${p.muted}" stroke-width="1.2"/>`);
      if (s.excluded > 0)
        out.push(`<text x="${ax + 8}" y="${y + ARROW / 2 + 3}" font-size="10" fill="${p.muted}">−${fmt(s.excluded)} excluded</text>`);
      y += ARROW;
      const lines = wrap(s.label, 34);
      const shown = lines.length > 4 ? [...lines.slice(0, 3), lines.slice(3).join(" ").slice(0, 31) + "…"] : lines;
      box(shown, s.n, s.pctOfBase == null ? "" : "(" + s.pctOfBase.toFixed(1) + "% of base)", k === pn.steps.length - 1);
    });
    bottom = Math.max(bottom, y);
  });
  const cap = caption(v.caveat || "", W, bottom + 12, p.muted, Math.floor(W / 7.4));
  const H = bottom + 12 + cap.height + 12;
  return frame(W, H, out.join("") + cap.svg, p.bg, W > W0);
}

// ---------------------------------------------------------------------------

export function genomeSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), g = v.genome!;
  const W = o.width || 960, L = g.test ? 76 : 44, R = 10, PH = 118, GAP = 30, T = 8;
  const n = g.bins.length, plotW = W - L - R, bw = plotW / n;
  const x = (i: number) => L + i * bw;
  const pctOf = (k: number, d: number) => d ? 100 * k / d : 0;
  let yMax = 10;
  for (const s of g.series) for (let i = 0; i < n; i++)
    yMax = Math.max(yMax, pctOf(s.gain[i], s.profiled[i]), pctOf(s.loss[i], s.profiled[i]));
  yMax = Math.min(100, Math.ceil(yMax / 10) * 10);
  // chromosome extents on the bin axis
  const chrom: { c: string; i0: number; i1: number }[] = [];
  g.bins.forEach((b, i) => {
    const last = chrom[chrom.length - 1];
    if (last && last.c === b.chrom) last.i1 = i + 1; else chrom.push({ c: b.chrom, i0: i, i1: i + 1 });
  });
  const out: string[] = [];
  let y0 = T;
  g.series.forEach((s, si) => {
    const top = y0 + 16, mid = top + PH / 2, h = (pct: number) => (PH / 2) * pct / yMax;
    out.push(`<text x="${L}" y="${y0 + 11}" font-size="11.5" font-weight="600" fill="${p.ink}">${esc(s.cohort)}` +
      `<tspan dx="6" font-weight="400" font-size="10.5" fill="${p.muted}">${fmt(s.segmented)} segmented samples</tspan></text>`);
    chrom.forEach((c, k) => {
      if (k % 2) out.push(`<rect x="${num(x(c.i0))}" y="${top}" width="${num((c.i1 - c.i0) * bw)}" height="${PH}" fill="${p.line}" opacity="0.45"/>`);
    });
    for (const f of [1, 0.5]) {
      for (const sign of [-1, 1]) {
        const yy = mid - sign * (PH / 2) * f;
        out.push(`<line x1="${L}" y1="${num(yy)}" x2="${W - R}" y2="${num(yy)}" stroke="${p.line}" stroke-width="0.6"/>`);
        out.push(`<text x="${L - 4}" y="${num(yy + 3)}" font-size="9" fill="${p.muted}" text-anchor="end">${sign > 0 ? "+" : "−"}${num(yMax * f)}%</text>`);
      }
    }
    // one step path per direction: bins without a measured sample draw nothing (not zero)
    const area = (k: "gain" | "loss", sign: 1 | -1): string => {
      let d = "";
      for (let i = 0; i < n; i++) {
        if (!s.profiled[i]) continue;
        const hh = h(pctOf(s[k][i], s.profiled[i]));
        if (hh <= 0) continue;
        d += `M${num(x(i))} ${num(mid)}v${num(-sign * hh)}h${num(bw)}v${num(sign * hh)}z`;
      }
      return d;
    };
    out.push(`<path d="${area("gain", 1)}" fill="${CN_GAIN}" opacity="0.85"/>`);
    out.push(`<path d="${area("loss", -1)}" fill="${CN_LOSS}" opacity="0.85"/>`);
    out.push(`<line x1="${L}" y1="${mid}" x2="${W - R}" y2="${mid}" stroke="${p.muted}" stroke-width="0.8"/>`);
    // unmeasured bins are hatched in grey rather than read as copy-neutral
    let gapD = "";
    for (let i = 0; i < n; i++) if (!s.profiled[i]) gapD += `M${num(x(i))} ${num(top)}h${num(bw)}v${PH}h${num(-bw)}z`;
    if (gapD) out.push(`<path d="${gapD}" fill="${p.muted}" opacity="0.18"/>`);
    void si;
    y0 = top + PH + GAP - 16;
  });
  // chromosome labels
  const labY = y0 + 4;
  chrom.forEach((c) => out.push(`<text x="${num(x((c.i0 + c.i1) / 2))}" y="${labY}" font-size="9" fill="${p.muted}" text-anchor="middle">${esc(c.c)}</text>`));
  let yb = labY + 8;
  if (g.test) {
    const rows: [string, (number | null)[], "gain" | "loss"][] = [["gain differs", g.test.gainQ, "gain"], ["loss differs", g.test.lossQ, "loss"]];
    const [A, B] = g.series;
    rows.forEach(([label, q, k], r) => {
      const ry = yb + r * 13;
      out.push(`<text x="${L - 4}" y="${ry + 8}" font-size="9" fill="${p.muted}" text-anchor="end">${label}</text>`);
      out.push(`<rect x="${L}" y="${ry}" width="${plotW}" height="10" fill="${p.line}" opacity="0.5"/>`);
      const dA: string[] = ["", ""];
      for (let i = 0; i < n; i++) {
        if (q[i] == null || q[i]! >= 0.05) continue;
        const higherA = pctOf(A[k][i], A.profiled[i]) > pctOf(B[k][i], B.profiled[i]);
        dA[higherA ? 0 : 1] += `M${num(x(i))} ${ry}h${num(bw)}v10h${num(-bw)}z`;
      }
      if (dA[0]) out.push(`<path d="${dA[0]}" fill="${SERIES[0]}"/>`);
      if (dA[1]) out.push(`<path d="${dA[1]}" fill="${SERIES[1]}"/>`);
    });
    yb += 26 + 14;
    const key = (i: number, text: string, xk: number) =>
      `<rect x="${xk}" y="${yb - 9}" width="9" height="9" rx="2" fill="${SERIES[i]}"/><text x="${xk + 13}" y="${yb}" font-size="10" fill="${p.ink}">${esc(text)}</text>`;
    out.push(`<text x="${L}" y="${yb}" font-size="10" fill="${p.muted}">q &lt; 0.05, higher in:</text>` +
      key(0, A.cohort, L + 118) + key(1, B.cohort, L + 118 + 26 + 7 * Math.min(40, A.cohort.length)));
    yb += 8;
  }
  const lk = yb + 14;
  out.push(`<rect x="${L}" y="${lk - 9}" width="9" height="9" rx="2" fill="${CN_GAIN}"/><text x="${L + 13}" y="${lk}" font-size="10" fill="${p.ink}">gained</text>` +
    `<rect x="${L + 70}" y="${lk - 9}" width="9" height="9" rx="2" fill="${CN_LOSS}"/><text x="${L + 83}" y="${lk}" font-size="10" fill="${p.ink}">lost</text>` +
    `<rect x="${L + 120}" y="${lk - 9}" width="9" height="9" rx="2" fill="${p.muted}" opacity="0.3"/><text x="${L + 133}" y="${lk}" font-size="10" fill="${p.ink}">no segment covers this bin</text>`);
  const cap = caption(v.caveat || "", W, lk + 6, p.muted, Math.floor(W / 7.2));
  return frame(W, lk + 6 + cap.height + 10, out.join("") + cap.svg, p.bg);
}

// ---------------------------------------------------------------------------

export function pathwaysSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), res = v.pathways!;
  const rows = res.rows, k = rows[0]?.cells.length || 1;
  const NAME_W = 150, BAR_X = 160, BAR_W = 190, TILE_X = BAR_X + BAR_W + 70, TILE_W = 86, TILE_GAP = 6;
  const maxTiles = Math.max(1, ...rows.map((r) => r.top.length));
  const W0 = o.width || 960;
  const W = Math.max(W0, TILE_X + maxTiles * (TILE_W + TILE_GAP) + 130);
  const rowH = Math.max(46, 12 + k * 14);
  const out: string[] = [];
  const T = 26;
  out.push(`<text x="10" y="16" font-size="10" fill="${p.muted}">pathway</text>` +
    `<text x="${BAR_X}" y="16" font-size="10" fill="${p.muted}">patients with ≥1 member ${res.measure === "driver" ? "driver" : "altered"}</text>` +
    `<text x="${TILE_X}" y="16" font-size="10" fill="${p.muted}">most-altered members (% per cohort${k === 2 ? ", ★ q &lt; 0.05" : ""})</text>`);
  let maxPct = 0;
  for (const r of rows) for (const c of r.cells) maxPct = Math.max(maxPct, c.pct ?? 0);
  const scale = maxPct > 0 ? Math.min(100, Math.ceil(maxPct / 10) * 10) : 100;
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    if (i % 2 === 0) out.push(`<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="${p.line}" opacity="0.35"/>`);
    out.push(`<text x="10" y="${y + 17}" font-size="12" font-weight="600" fill="${p.ink}">${esc(r.name)}</text>`);
    out.push(`<text x="10" y="${y + 31}" font-size="9.5" fill="${p.muted}">${r.profiledGenes} of ${r.genes} genes profiled${r.source === "document" ? " · your set" : ""}</text>`);
    r.cells.forEach((c, ci) => {
      const by = y + 7 + ci * 14, w = c.pct == null ? 0 : BAR_W * c.pct / scale;
      out.push(`<rect x="${BAR_X}" y="${by}" width="${BAR_W}" height="10" rx="2" fill="${p.bg}" stroke="${p.line}"/>`);
      if (w > 0) out.push(`<rect x="${BAR_X}" y="${by}" width="${num(w)}" height="10" rx="2" fill="${SERIES[ci % SERIES.length]}"/>`);
      out.push(`<text x="${BAR_X + BAR_W + 6}" y="${by + 9}" font-size="10" fill="${p.ink}">${c.pct == null ? "not profiled" : c.pct.toFixed(1) + "%"}</text>`);
    });
    if (r.q != null) out.push(`<text x="${BAR_X + BAR_W + 6}" y="${y + rowH - 4}" font-size="9" fill="${p.muted}">${esc(qFmt(r.q))}</text>`);
    r.top.forEach((t, ti) => {
      const tx = TILE_X + ti * (TILE_W + TILE_GAP), ty = y + 4, th = rowH - 8;
      const peak = Math.max(...t.cells.map((c) => c.pct ?? 0));
      out.push(`<rect x="${tx}" y="${ty}" width="${TILE_W}" height="${th}" rx="4" fill="${p.bg}" stroke="${p.line}"/>`);
      out.push(`<rect x="${tx}" y="${ty}" width="4" height="${th}" rx="2" fill="${t.role === "OG" ? CN_GAIN : t.role === "TSG" ? CN_LOSS : p.line}" opacity="${Math.min(1, 0.25 + peak / 40)}"/>`);
      out.push(`<text x="${tx + 9}" y="${ty + 13}" font-size="10.5" font-weight="600" fill="${p.ink}">${esc(t.gene)}${t.q != null && t.q < 0.05 ? " ★" : ""}</text>`);
      t.cells.forEach((c, ci) => {
        out.push(`<text x="${tx + 9 + ci * (k > 2 ? 19 : 36)}" y="${ty + 27}" font-size="${k > 2 ? 8.5 : 10}" fill="${SERIES[ci % SERIES.length]}">` +
          `${c.pct == null ? "–" : (k > 2 ? Math.round(c.pct) : c.pct.toFixed(1)) + "%"}</text>`);
      });
    });
    const tail = TILE_X + r.top.length * (TILE_W + TILE_GAP);
    const bits = [r.otherAltered ? "+" + r.otherAltered + " more altered" : "", r.notProfiled.length ? r.notProfiled.length + " never profiled" : ""].filter(Boolean);
    bits.forEach((b, bi) => out.push(`<text x="${tail}" y="${y + 17 + bi * 13}" font-size="9.5" fill="${p.muted}">${esc(b)}</text>`));
  });
  let y = T + rows.length * rowH + 16;
  rows[0]?.cells.forEach((c, ci) => {
    const x = 10 + ci * 190;
    out.push(`<rect x="${x}" y="${y - 9}" width="9" height="9" rx="2" fill="${SERIES[ci % SERIES.length]}"/>` +
      `<text x="${x + 13}" y="${y}" font-size="10.5" fill="${p.ink}">${esc(c.cohort)}</text>`);
  });
  const lx = 10 + k * 190;
  out.push(`<rect x="${lx}" y="${y - 9}" width="4" height="9" fill="${CN_GAIN}"/><text x="${lx + 8}" y="${y}" font-size="10" fill="${p.muted}">oncogene</text>` +
    `<rect x="${lx + 70}" y="${y - 9}" width="4" height="9" fill="${CN_LOSS}"/><text x="${lx + 78}" y="${y}" font-size="10" fill="${p.muted}">tumour suppressor (paper's role)</text>`);
  y += 6;
  const cap = caption(v.caveat || "", W, y, p.muted, Math.floor(W / 7.2));
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, W > W0);
}

// ---------------------------------------------------------------------------

export function diffexprSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), d = v.diffexpr!;
  const W0 = o.width || 960, W = W0;
  const hasGsea = !!(d.gsea && d.gsea.sets.length);
  const VW = hasGsea ? 470 : W - 20, VL = 50, VT = 26, VH = 330;
  const plotW = VW - VL - 10;
  const { xMax, yMax, nx, ny } = d.grid;
  const X = (e: number) => VL + plotW * (e + xMax) / (2 * xMax);
  const Y = (lp: number) => VT + VH * (1 - lp / yMax);
  const lp = (pv: number) => -Math.log10(Math.max(1e-300, pv));
  const out: string[] = [];
  const [A, B] = d.groups;
  out.push(`<text x="${VL}" y="14" font-size="10.5" fill="${p.muted}">${esc(d.tested.toLocaleString("en-US"))} genes · ` +
    `<tspan fill="${SERIES[0]}">${d.up.toLocaleString("en-US")} higher in ${esc(A)}</tspan> · ` +
    `<tspan fill="${SERIES[1]}">${d.down.toLocaleString("en-US")} higher in ${esc(B)}</tspan> (q &lt; 0.05)</text>`);
  // axes
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const yy = VT + VH * (1 - f);
    out.push(`<line x1="${VL}" y1="${num(yy)}" x2="${VL + plotW}" y2="${num(yy)}" stroke="${p.line}" stroke-width="0.6"/>`);
    out.push(`<text x="${VL - 4}" y="${num(yy + 3)}" font-size="9" fill="${p.muted}" text-anchor="end">${num(yMax * f)}</text>`);
  }
  for (const f of [-1, -0.5, 0, 0.5, 1]) {
    const xx = X(f * xMax);
    out.push(`<line x1="${num(xx)}" y1="${VT}" x2="${num(xx)}" y2="${VT + VH}" stroke="${p.line}" stroke-width="${f === 0 ? 1 : 0.6}"/>`);
    out.push(`<text x="${num(xx)}" y="${VT + VH + 12}" font-size="9" fill="${p.muted}" text-anchor="middle">${num(f * xMax)}</text>`);
  }
  out.push(`<text x="${VL + plotW / 2}" y="${VT + VH + 26}" font-size="10" fill="${p.muted}" text-anchor="middle">${esc(d.effectLabel)} (${esc(A)} − ${esc(B)})</text>`);
  out.push(`<text x="12" y="${VT + VH / 2}" font-size="10" fill="${p.muted}" text-anchor="middle" transform="rotate(-90 12 ${VT + VH / 2})">−log10 p</text>`);
  // density of everything not drawn as a point
  const cw = plotW / nx, ch = VH / ny;
  const maxC = Math.max(1, ...d.grid.cells.map((c) => c[2]));
  let dens = "";
  for (const [bx, by, c, cls] of d.grid.cells) {
    const op = 0.12 + 0.6 * Math.log1p(c) / Math.log1p(maxC);
    const col = cls === 1 ? SERIES[0] : cls === 2 ? SERIES[1] : p.muted;
    dens += `<rect x="${num(VL + bx * cw)}" y="${num(VT + VH - (by + 1) * ch)}" width="${num(cw + 0.3)}" height="${num(ch + 0.3)}" fill="${col}" opacity="${num(op)}"/>`;
  }
  out.push(dens);
  // the significant genes, coloured by direction
  let dots = "";
  for (const g of d.points) {
    const col = g.q < 0.05 ? (g.effect > 0 ? SERIES[0] : SERIES[1]) : p.muted;
    dots += `<circle cx="${num(X(g.effect))}" cy="${num(Y(lp(g.p)))}" r="1.8" fill="${col}" opacity="0.75"/>`;
  }
  out.push(dots);
  // labels: placed beside their point, nudged down when they would overlap the previous one
  const placed: { x: number; y: number }[] = [];
  for (const name of d.labels) {
    const g = d.points.find((x) => x.gene === name);
    if (!g) continue;
    const px = X(g.effect), py = Y(lp(g.p));
    let ly = py - 4;
    while (placed.some((q) => Math.abs(q.y - ly) < 10 && Math.abs(q.x - px) < 60)) ly += 10;
    placed.push({ x: px, y: ly });
    const right = px < VL + plotW * 0.75;
    out.push(`<circle cx="${num(px)}" cy="${num(py)}" r="2.6" fill="none" stroke="${p.ink}" stroke-width="0.8"/>` +
      `<text x="${num(px + (right ? 5 : -5))}" y="${num(ly)}" font-size="9.5" fill="${p.ink}" text-anchor="${right ? "start" : "end"}">${esc(name)}</text>`);
  }
  let bottom = VT + VH + 34;
  if (hasGsea) {
    const gx = VW + 24, gw = W - gx - 10;
    const sets = d.gsea!.sets;
    const shown = sets.slice(0, 12);
    out.push(`<text x="${gx}" y="14" font-size="10.5" fill="${p.muted}">gene-set enrichment (preranked GSEA, ${d.gsea!.permutations} permutations)</text>`);
    const nesMax = Math.max(1, ...shown.map((x) => Math.abs(x.nes)));
    const BAR_X = gx + 210, BAR_W = gw - 210 - 70, mid = BAR_X + BAR_W / 2;
    shown.forEach((x, i) => {
      const y = 30 + i * 17;
      const nm = x.name.replace(/^HALLMARK_/, "").replace(/_/g, " ").toLowerCase();
      out.push(`<text x="${gx}" y="${y + 9}" font-size="9.5" fill="${x.q < 0.05 ? p.ink : p.muted}">${esc(nm.length > 36 ? nm.slice(0, 35) + "…" : nm)}</text>`);
      const w = BAR_W / 2 * Math.abs(x.nes) / nesMax;
      out.push(`<rect x="${num(x.nes >= 0 ? mid : mid - w)}" y="${y}" width="${num(w)}" height="11" rx="2" fill="${x.nes >= 0 ? SERIES[0] : SERIES[1]}" opacity="${x.q < 0.05 ? 0.9 : 0.35}"/>`);
      out.push(`<text x="${BAR_X + BAR_W + 6}" y="${y + 9}" font-size="9" fill="${p.muted}">${num(x.nes)} · ${esc(qFmt(x.q))}</text>`);
    });
    out.push(`<line x1="${mid}" y1="26" x2="${mid}" y2="${30 + shown.length * 17}" stroke="${p.muted}" stroke-width="0.8"/>`);
    let y = 30 + shown.length * 17 + 8;
    if (sets.length > shown.length)
      out.push(`<text x="${gx}" y="${y + 6}" font-size="9" fill="${p.muted}">+${sets.length - shown.length} more sets tested (${sets.filter((x) => x.q < 0.05).length} of ${sets.length} at q &lt; 0.05)</text>`);
    y += 18;
    // running-sum curves: the strongest set in each direction
    const best = [sets.find((x) => x.nes > 0), sets.find((x) => x.nes < 0)].filter(Boolean) as typeof sets;
    const CH = 70, n = d.tested;
    best.forEach((x, k) => {
      const top = y + k * (CH + 44);
      const nm = x.name.replace(/^HALLMARK_/, "").replace(/_/g, " ").toLowerCase();
      out.push(`<text x="${gx}" y="${top + 9}" font-size="10" fill="${p.ink}">${esc(nm)}<tspan dx="6" fill="${p.muted}" font-size="9">ES ${num(x.es)}, ${x.leadingEdge.length} leading-edge genes</tspan></text>`);
      const py0 = top + 14, cx = (i: number) => gx + gw * i / Math.max(1, n - 1);
      const lo = Math.min(0, ...x.curve), hi = Math.max(0, ...x.curve), span = hi - lo || 1;
      const cy = (v: number) => py0 + CH * (hi - v) / span;
      out.push(`<line x1="${gx}" y1="${num(cy(0))}" x2="${gx + gw}" y2="${num(cy(0))}" stroke="${p.line}"/>`);
      out.push(`<path d="M${x.curve.map((v, i) => num(cx(x.curveAt[i])) + " " + num(cy(v))).join(" L")}" fill="none" stroke="${x.nes >= 0 ? SERIES[0] : SERIES[1]}" stroke-width="1.5"/>`);
      let ticks = "";
      for (const h of x.hits) ticks += `M${num(cx(h))} ${py0 + CH + 3}v7`;
      out.push(`<path d="${ticks}" stroke="${p.ink}" stroke-width="0.5"/>`);
      out.push(`<text x="${gx}" y="${py0 + CH + 22}" font-size="8.5" fill="${p.muted}">higher in ${esc(A)}</text>` +
        `<text x="${gx + gw}" y="${py0 + CH + 22}" font-size="8.5" fill="${p.muted}" text-anchor="end">higher in ${esc(B)}</text>`);
    });
    bottom = Math.max(bottom, y + best.length * (CH + 44));
  }
  const cap = caption(v.caveat || "", W, bottom + 4, p.muted, Math.floor(W / 7.2));
  return frame(W, bottom + 4 + cap.height + 10, out.join("") + cap.svg, p.bg);
}

// ---------------------------------------------------------------------------

export function pairedSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.paired!;
  const W = o.width || 960, LBL = 90, STAT = 250, BAR_L = LBL + 10, BAR_W = W - BAR_L - STAT - 10;
  const aL = r.pairBy.a.join("/"), bL = r.pairBy.b.join("/");
  const BOTH = p.muted;
  const out: string[] = [];
  let y = 8;
  // one scale for every panel: patients altered anywhere, the widest bar
  const widest = Math.max(1, ...r.panels.flatMap((pn) => pn.genes.map((g) => g.aOnly + g.both + g.bOnly)));
  const sx = (n: number) => BAR_W * n / widest;
  r.panels.forEach((pn) => {
    out.push(`<text x="10" y="${y + 12}" font-size="12" font-weight="600" fill="${p.ink}">${esc(pn.cohort)}` +
      `<tspan dx="6" font-size="10" font-weight="400" fill="${p.muted}">${fmt(pn.patients)} patients with both · ${fmt(pn.aSamples)} ${esc(aL)} and ${fmt(pn.bSamples)} ${esc(bL)} samples</tspan></text>`);
    y += 22;
    out.push(`<text x="${BAR_L}" y="${y + 8}" font-size="9.5" fill="${SERIES[0]}">${esc(aL)} only</text>` +
      `<text x="${BAR_L + 90}" y="${y + 8}" font-size="9.5" fill="${p.muted}">both</text>` +
      `<text x="${BAR_L + 130}" y="${y + 8}" font-size="9.5" fill="${SERIES[1]}">${esc(bL)} only</text>` +
      `<text x="${W - STAT + 8}" y="${y + 8}" font-size="9.5" fill="${p.muted}">concordant · profiled pairs · McNemar q</text>`);
    y += 14;
    pn.genes.forEach((g) => {
      out.push(`<text x="${LBL}" y="${y + 11}" font-size="11" font-weight="600" fill="${p.ink}" text-anchor="end">${esc(g.gene)}</text>`);
      let x = BAR_L;
      const seg = (n: number, col: string, op = 0.9) => {
        if (n <= 0) return;
        out.push(`<rect x="${num(x)}" y="${y + 2}" width="${num(Math.max(0.8, sx(n)))}" height="12" fill="${col}" opacity="${op}"/>`);
        if (sx(n) > 22) out.push(`<text x="${num(x + sx(n) / 2)}" y="${y + 11.5}" font-size="9" fill="#ffffff" text-anchor="middle">${n}</text>`);
        x += sx(n);
      };
      seg(g.aOnly, SERIES[0]); seg(g.both, BOTH, 0.75); seg(g.bOnly, SERIES[1]);
      if (!g.pairs) out.push(`<text x="${BAR_L}" y="${y + 11}" font-size="9.5" fill="${p.muted}">never profiled on both sides</text>`);
      const sig = g.q < 0.05 && g.aOnly + g.bOnly > 0;
      out.push(`<text x="${W - STAT + 8}" y="${y + 11}" font-size="10" fill="${sig ? p.ink : p.muted}">` +
        `${g.concordance == null ? "—" : Math.round(100 * g.concordance) + "%"} · ${fmt(g.pairs)} · ${g.aOnly + g.bOnly ? esc(qFmt(g.q)) : "no discordance"}` +
        `${sig ? " · more " + esc(g.bOnly > g.aOnly ? bL : aL) + "-only" : ""}</text>`);
      y += 18;
    });
    y += 10;
  });
  const cap = caption(v.caveat || "", W, y, p.muted, Math.floor(W / 7.2));
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg);
}

// ---------------------------------------------------------------------------

/** A small histogram as bars, scaled to its own tallest bin. */
function sparkHist(h: number[], x: number, y: number, w: number, hgt: number, colour: string, p: Pal): string {
  const max = Math.max(1, ...h), bw = w / h.length;
  let d = "";
  h.forEach((c, i) => { if (c) { const bh = hgt * c / max; d += `M${num(x + i * bw)} ${num(y + hgt)}v${num(-bh)}h${num(bw - 0.6)}v${num(bh)}z`; } });
  return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" fill="${p.line}" opacity="0.35"/><path d="${d}" fill="${colour}"/>`;
}

export function clonalitySvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.clonality!;
  const W = o.width || 960, LBL = 80, BAR_X = LBL + 10, BAR_W = 300, TXT_X = BAR_X + BAR_W + 8, SIDE_X = 640;
  const k = r.panels.length, subH = 14, rowH = k * subH + 10;
  const out: string[] = [];
  out.push(`<text x="${BAR_X}" y="14" font-size="10" fill="${p.muted}">${r.measure === "driver" ? "driver " : ""}mutation calls: ` +
    `<tspan font-weight="600">clonal</tspan> · subclonal (paler) · indeterminate (grey)</text>`);
  const T = 24;
  const genes = r.panels[0]?.genes.map((g) => g.gene) || [];
  genes.forEach((gene, gi) => {
    const y = T + gi * rowH;
    if (gi % 2 === 0) out.push(`<rect x="0" y="${y - 3}" width="${SIDE_X - 16}" height="${rowH}" fill="${p.line}" opacity="0.3"/>`);
    out.push(`<text x="${LBL}" y="${y + rowH / 2}" font-size="11" font-weight="600" fill="${p.ink}" text-anchor="end">${esc(gene)}</text>`);
    r.panels.forEach((pn, ci) => {
      const g = pn.genes[gi], by = y + ci * subH, col = SERIES[ci % SERIES.length];
      const called = g.clonal + g.subclonal + g.indeterminate;
      if (!g.calls) {
        out.push(`<text x="${BAR_X}" y="${by + 9}" font-size="9.5" fill="${p.muted}">no ${r.measure === "driver" ? "driver " : ""}mutation call with a FACETS estimate</text>`);
        return;
      }
      let x = BAR_X;
      for (const [n, op, fill] of [[g.clonal, 0.95, col], [g.subclonal, 0.4, col], [g.indeterminate, 0.8, p.line]] as [number, number, string][]) {
        if (!n || !called) continue;
        const w = BAR_W * n / called;
        out.push(`<rect x="${num(x)}" y="${by}" width="${num(w)}" height="10" fill="${fill}" opacity="${op}"/>`);
        x += w;
      }
      const clonalPct = g.clonal + g.subclonal ? Math.round(100 * g.clonal / (g.clonal + g.subclonal)) : null;
      out.push(`<text x="${TXT_X}" y="${by + 9}" font-size="9.5" fill="${col}">${clonalPct == null ? "—" : clonalPct + "% clonal"}` +
        `<tspan fill="${p.muted}">&#160;· LOH ${g.lohKnown ? Math.round(100 * g.loh / g.lohKnown) + "%" : "—"} · ${fmt(g.calls)} calls</tspan>` +
        `${ci === 0 && g.q != null ? `<tspan fill="${g.q < 0.05 ? p.ink : p.muted}">&#160;· ${esc(qFmt(g.q))}</tspan>` : ""}</text>`);
    });
  });
  // per cohort: WGD, purity, ploidy
  let sy = T;
  out.push(`<text x="${SIDE_X}" y="14" font-size="10" fill="${p.muted}">per sample (FACETS)</text>`);
  r.panels.forEach((pn, ci) => {
    const col = SERIES[ci % SERIES.length], wgdN = pn.wgd.yes + pn.wgd.no;
    out.push(`<text x="${SIDE_X}" y="${sy + 10}" font-size="11.5" font-weight="600" fill="${col}">${esc(pn.cohort)}</text>`);
    out.push(`<text x="${SIDE_X}" y="${sy + 25}" font-size="10" fill="${p.ink}">whole-genome doubled: ${wgdN ? (100 * pn.wgd.yes / wgdN).toFixed(1) + "%" : "—"}` +
      `<tspan fill="${p.muted}">&#160;of ${fmt(wgdN)} samples</tspan></text>`);
    const hw = (W - SIDE_X - 20) / 2 - 6;
    out.push(`<text x="${SIDE_X}" y="${sy + 40}" font-size="9" fill="${p.muted}">purity 0 → 1</text>` + sparkHist(pn.purity, SIDE_X, sy + 44, hw, 28, col, p));
    out.push(`<text x="${SIDE_X + hw + 12}" y="${sy + 40}" font-size="9" fill="${p.muted}">ploidy 0 → 8</text>` + sparkHist(pn.ploidy, SIDE_X + hw + 12, sy + 44, hw, 28, col, p));
    out.push(`<text x="${SIDE_X}" y="${sy + 86}" font-size="9" fill="${p.muted}">${fmt(pn.ascnSamples)} of ${fmt(pn.samples)} samples have FACETS estimates` +
      `${r.qc ? "; " + fmt(pn.qcPass) + " pass QC" : ""}</text>`);
    sy += 100;
  });
  if (r.wgdP != null) { out.push(`<text x="${SIDE_X}" y="${sy + 4}" font-size="10" fill="${p.ink}">WGD differs: Fisher ${esc(pFmt(r.wgdP))}</text>`); sy += 14; }
  const bottom = Math.max(T + genes.length * rowH, sy) + 8;
  const cap = caption(v.caveat || "", W, bottom, p.muted, Math.floor(W / 7.2));
  return frame(W, bottom + cap.height + 10, out.join("") + cap.svg, p.bg);
}

// ---------------------------------------------------------------------------

export function incidenceSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.incidence!;
  const W = o.width || 760, L = 46, R = 14, T = 14, PH = 250;
  const curves = r.curves.filter((c) => c.points.length || c.n);
  const tLast = Math.max(12, ...curves.map((c) => c.points.length ? c.points[c.points.length - 1].t : 0));
  const tMax = Math.min(tLast, Math.max(...r.horizons.map((h) => h.months)) * 1.25);
  const step = tMax > 120 ? 24 : tMax > 60 ? 12 : 6;
  const peak = Math.max(0.05, ...curves.flatMap((c) => c.points.filter((q) => q.t <= tMax).map((q) => Math.max(q.f1 + 1.96 * q.se1, q.f2))));
  const tick = peak <= 0.2 ? 0.05 : peak <= 0.5 ? 0.1 : 0.2;
  const yTop = Math.min(1, Math.ceil(peak / tick - 1e-9) * tick);
  const x = (t: number) => L + (W - L - R) * Math.min(t, tMax) / tMax;
  const y = (f: number) => T + PH * (1 - f / yTop);
  const out: string[] = [];
  for (let k = 0; k * tick <= yTop + 1e-9; k++) {
    const f = k * tick;
    out.push(`<line x1="${L}" y1="${num(y(f))}" x2="${W - R}" y2="${num(y(f))}" stroke="${p.line}" stroke-width="1"/>` +
      `<text x="${L - 6}" y="${num(y(f) + 3)}" font-size="10" fill="${p.muted}" text-anchor="end">${Math.round(f * 100)}%</text>`);
  }
  for (let t = 0; t <= tMax + 1e-9; t += step)
    out.push(`<text x="${num(x(t))}" y="${T + PH + 14}" font-size="10" fill="${p.muted}" text-anchor="middle">${t}mo</text>`);
  curves.forEach((c, i) => {
    const col = SERIES[i % SERIES.length];
    const pts = c.points.filter((q) => q.t <= tMax);
    // the 95% band as a step polygon under the event curve
    if (pts.length) {
      let up = `M${num(x(0))} ${num(y(0))}`, lo = "";
      let pu = 0, pl = 0;
      for (const q of pts) {
        const u = Math.min(1, q.f1 + 1.96 * q.se1), l = Math.max(0, q.f1 - 1.96 * q.se1);
        up += ` L${num(x(q.t))} ${num(y(pu))} L${num(x(q.t))} ${num(y(u))}`; pu = u;
        lo = ` L${num(x(q.t))} ${num(y(l))} L${num(x(q.t))} ${num(y(pl))}` + lo; pl = l;
      }
      up += ` L${num(x(tMax))} ${num(y(pu))} L${num(x(tMax))} ${num(y(pl))}` + lo + " Z";
      out.push(`<path d="${up}" fill="${col}" opacity="0.13"/>`);
    }
    const stepPath = (key: "f1" | "f2") => {
      let d = `M${num(x(0))} ${num(y(0))}`, py = 0;
      for (const q of pts) { d += ` L${num(x(q.t))} ${num(y(py))} L${num(x(q.t))} ${num(y(q[key]))}`; py = q[key]; }
      return d + ` L${num(x(tMax))} ${num(y(py))}`;
    };
    out.push(`<path d="${stepPath("f2")}" fill="none" stroke="${col}" stroke-width="1.3" stroke-dasharray="4,3" opacity="0.7"/>`);
    out.push(`<path d="${stepPath("f1")}" fill="none" stroke="${col}" stroke-width="2"/>`);
  });
  let yy = T + PH + 30;
  out.push(`<text x="8" y="${yy}" font-size="10" fill="${p.muted}">solid: ${esc(r.eventLabel)} · dashed: death without it · band: 95%</text>`);
  yy += 18;
  // horizon table: estimate [CI] beside what 1 − KM would claim
  const colW = Math.min(200, (W - 150) / Math.max(1, curves.length));
  out.push(`<text x="8" y="${yy}" font-size="10" fill="${p.muted}">incidence by</text>`);
  curves.forEach((c, i) => out.push(`<text x="${150 + i * colW}" y="${yy}" font-size="10.5" font-weight="600" fill="${SERIES[i % SERIES.length]}">${esc(c.cohort)}</text>`));
  yy += 15;
  r.horizons.forEach((h) => {
    out.push(`<text x="8" y="${yy}" font-size="10.5" fill="${p.ink}">${h.months} months</text>`);
    h.cells.forEach((c, i) => out.push(`<text x="${150 + i * colW}" y="${yy}" font-size="10.5" fill="${p.ink}">${(100 * c.f1).toFixed(1)}%` +
      `<tspan fill="${p.muted}" font-size="9.5">&#160;[${(100 * c.lo).toFixed(1)}–${(100 * c.hi).toFixed(1)}] · 1−KM ${(100 * c.naive).toFixed(1)}%</tspan></text>`));
    yy += 15;
  });
  yy += 2;
  curves.forEach((c, i) => {
    out.push(`<text x="8" y="${yy}" font-size="10" fill="${p.muted}"><tspan fill="${SERIES[i % SERIES.length]}">${esc(c.cohort)}</tspan>` +
      `&#160;n=${fmt(c.n)}: ${fmt(c.events)} events, ${fmt(c.competing)} died first, ${fmt(c.censored)} censored` +
      ` · not at risk: ${fmt(c.excluded.prior)} already had it${c.excluded.unobserved ? ", " + fmt(c.excluded.unobserved) + " before observation" : ""}` +
      `${c.excluded.noAnchor ? ", " + fmt(c.excluded.noAnchor) + " no anchor event" : ""}${c.excluded.noFollowup ? ", " + fmt(c.excluded.noFollowup) + " no follow-up" : ""}</text>`);
    yy += 13;
  });
  if (r.gray) {
    yy += 3;
    const floor = r.gray.p <= 1 / (r.gray.permutations + 1) + 1e-12;
    out.push(`<text x="8" y="${yy}" font-size="10.5" fill="${p.ink}">Gray's test across ${r.gray.groups} cohorts: statistic ${num(r.gray.statistic)}, permutation ` +
      `${floor ? esc("p ≤ " + r.gray.p.toPrecision(2) + " (no shuffle of " + r.gray.permutations + " as extreme)") : esc(pFmt(r.gray.p)) + " (" + r.gray.permutations + " shuffles)"}</text>`);
    yy += 12;
  }
  const cap = caption(v.caveat || "", W, yy, p.muted);
  return frame(W, yy + cap.height + 10, out.join("") + cap.svg, p.bg);
}

export function moreViewToSvg(v: ViewResult, o: SvgOpts): string | null {
  if (v.kind === "attrition" && v.attrition && v.attrition.length) return attritionSvg(v, o);
  if (v.kind === "genome" && v.genome && v.genome.series.length) return genomeSvg(v, o);
  if (v.kind === "pathways" && v.pathways && v.pathways.rows.length) return pathwaysSvg(v, o);
  if (v.kind === "diffexpr" && v.diffexpr && v.diffexpr.tested) return diffexprSvg(v, o);
  if (v.kind === "paired" && v.paired && v.paired.panels.some((pn) => pn.patients)) return pairedSvg(v, o);
  if (v.kind === "clonality" && v.clonality && v.clonality.panels.length) return clonalitySvg(v, o);
  if (v.kind === "incidence" && v.incidence && v.incidence.curves.some((c) => c.n)) return incidenceSvg(v, o);
  return null;
}

export function moreViewTitle(v: ViewResult): string | null {
  if (v.kind === "attrition") return "Cohort attrition";
  if (v.kind === "genome") return "Genome-wide copy number";
  if (v.kind === "pathways") return "Oncogenic signalling pathways";
  if (v.kind === "clonality") return "Clonality (FACETS)";
  if (v.kind === "incidence") return "Cumulative incidence" + (v.incidence ? " — " + v.incidence.eventLabel + (v.incidence.anchoredTo ? " from " + v.incidence.anchoredTo : "") : "");
  if (v.kind === "paired") return "Paired samples" + (v.paired ? " — " + v.paired.pairBy.a.join("/") + " vs " + v.paired.pairBy.b.join("/") : "");
  if (v.kind === "diffexpr") return "Differential expression" + (v.diffexpr ? " — " + v.diffexpr.profileType : "");
  return null;
}

void num; void pFmt; void pct;
export type { Pal };
