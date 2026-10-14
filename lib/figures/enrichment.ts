// Enrichment figure: every gene's alteration frequency compared between cohorts.
import { esc, SERIES, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";

type Grid = { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number][] };

/** A volcano: every other tested item as a density grid, the reported ones as dots, the first
 *  `labels` named. x is clamped to ±xMax (an infinite ratio sits on the edge). */
export function volcano(p: ReturnType<typeof palette>, g: Grid, pts: { key: string; x: number; p: number; color: string; label?: string }[],
  labels: string[], xTitle: string, sides?: [string, string]): { svg: string; bottom: number } {
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
  // which side is which, as the portal marks them: "← lower group · higher group →"
  if (sides) out.push(`<text x="${VL}" y="${VT + VH + 40}" font-size="9.5" fill="${p.muted}">← ${esc(sides[1])}</text>` +
    `<text x="${VL + VW}" y="${VT + VH + 40}" font-size="9.5" fill="${p.muted}" text-anchor="end">${esc(sides[0])} →</text>`);
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
  return { svg: out.join(""), bottom: VT + VH + (sides ? 48 : 34) };
}

type EnResult = NonNullable<ViewResult["enrichment"]>;

/** Two groups: the volcano, log2 ratio against −log10 p, the portal's first chart. */
export function enrichmentVolcanoSvg(r: EnResult, o: SvgOpts = {}): { body: string; width: number; height: number } | null {
  if (r.groups.length !== 2 || !r.grid) return null;
  const p = palette(o.theme), g = r.grid;
  const xOf = (row: EnResult["rows"][number]) => row.log2Ratio == null ? (row.cells[0].altered ? g.xMax : -g.xMax) : row.log2Ratio;
  const v = volcano(p, g, r.rows.map((row) => ({ key: row.gene, x: xOf(row), p: row.p,
    color: row.q < 0.05 ? (row.enrichedIn === r.groups[0] ? SERIES[0] : SERIES[1]) : p.muted })), r.labels, "Log2 Ratio", [r.groups[0], r.groups[1]]);
  return { body: v.svg, width: 470, height: v.bottom };
}

/** Two groups: each gene's frequency in one against the other, the diagonal where they are equal. */
export function enrichmentScatterSvg(r: EnResult, o: SvgOpts = {}): { body: string; width: number; height: number } | null {
  if (r.groups.length !== 2) return null;
  const p = palette(o.theme), L = 54, T = 30, S = 300;
  const top = niceCeilPct(Math.max(1, ...r.rows.flatMap((g) => g.cells.map((c) => c.pct ?? 0))));
  const X = (v: number) => L + S * v / top, Y = (v: number) => T + S * (1 - v / top);
  const out: string[] = [];
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const v = top * f;
    out.push(`<line x1="${num(X(v))}" y1="${T}" x2="${num(X(v))}" y2="${T + S}" stroke="${p.line}" stroke-width="0.6"/><line x1="${L}" y1="${num(Y(v))}" x2="${L + S}" y2="${num(Y(v))}" stroke="${p.line}" stroke-width="0.6"/>` +
      `<text x="${num(X(v))}" y="${T + S + 13}" font-size="9" fill="${p.muted}" text-anchor="middle">${num(v)}</text><text x="${L - 4}" y="${num(Y(v) + 3)}" font-size="9" fill="${p.muted}" text-anchor="end">${num(v)}</text>`);
  }
  out.push(`<line x1="${L}" y1="${T + S}" x2="${L + S}" y2="${T}" stroke="${p.muted}" stroke-width="0.8" stroke-dasharray="4 3"/>`);
  out.push(r.rows.map((g) => `<circle cx="${num(X(g.cells[0].pct ?? 0))}" cy="${num(Y(g.cells[1].pct ?? 0))}" r="3" fill="${g.q < 0.05 ? (g.enrichedIn === r.groups[0] ? SERIES[0] : SERIES[1]) : p.muted}" opacity="0.75"><title>${esc(g.gene + ": " + (g.cells[0].pct ?? 0) + "% vs " + (g.cells[1].pct ?? 0) + "%")}</title></circle>`).join(""));
  out.push(`<text x="${L + S / 2}" y="${T + S + 28}" font-size="10" fill="${p.muted}" text-anchor="middle">Altered frequency in ${esc(r.groups[0])} (%)</text>` +
    `<text x="14" y="${T + S / 2}" font-size="10" fill="${p.muted}" text-anchor="middle" transform="rotate(-90 14 ${T + S / 2})">Altered frequency in ${esc(r.groups[1])} (%)</text>` +
    `<text x="${L}" y="16" font-size="9.5" fill="${p.muted}">the ${fmt(r.rows.length)} most significant genes</text>`);
  return { body: out.join(""), width: L + S + 20, height: T + S + 36 };
}
function niceCeilPct(v: number): number { for (const s of [5, 10, 20, 25, 40, 50, 60, 80, 100]) if (v <= s) return s; return 100; }

/** "Genes with highest frequency in any group": the ten most-altered genes, a bar per group. */
export function enrichmentTopSvg(r: EnResult, o: SvgOpts = {}, n = 10): { body: string; width: number; height: number } {
  const p = palette(o.theme), L = 50, T = 34, H = 220, k = r.groups.length;
  const genes = [...r.rows].sort((a, b) => Math.max(...b.cells.map((c) => c.pct ?? 0)) - Math.max(...a.cells.map((c) => c.pct ?? 0))).slice(0, n);
  const top = niceCeilPct(Math.max(1, ...genes.flatMap((g) => g.cells.map((c) => c.pct ?? 0))));
  const BW = 9, GW = k * BW + 12, Y = (v: number) => T + H * (1 - v / top);
  const out: string[] = [`<text x="${L}" y="16" font-size="12" font-weight="700" fill="${p.ink}">Genes with highest frequency in any group</text>`];
  for (const f of [0, 0.25, 0.5, 0.75, 1]) out.push(`<line x1="${L}" y1="${num(Y(top * f))}" x2="${L + genes.length * GW}" y2="${num(Y(top * f))}" stroke="${p.line}" stroke-width="0.6"/>` +
    `<text x="${L - 4}" y="${num(Y(top * f) + 3)}" font-size="9" fill="${p.muted}" text-anchor="end">${num(top * f)}</text>`);
  genes.forEach((g, i) => {
    g.cells.forEach((c, ci) => {
      const h = H * (c.pct ?? 0) / top;
      out.push(`<rect x="${L + i * GW + 6 + ci * BW}" y="${num(T + H - h)}" width="${BW - 1}" height="${num(h)}" fill="${SERIES[ci % SERIES.length]}"><title>${esc(g.gene + " in " + c.cohort + ": " + (c.pct ?? 0) + "% (" + c.altered + "/" + c.profiled + ")")}</title></rect>`);
    });
    const x = L + i * GW + GW / 2;
    out.push(`<text x="${x}" y="${T + H + 12}" font-size="10" fill="${p.ink}" transform="rotate(45 ${x} ${T + H + 12})">${esc(g.gene)}${g.q < 0.05 ? "*" : ""}</text>`);
  });
  out.push(`<text x="14" y="${T + H / 2}" font-size="10" fill="${p.muted}" text-anchor="middle" transform="rotate(-90 14 ${T + H / 2})">Alteration frequency (%)</text>`);
  let ky = T;
  r.groups.forEach((g, i) => { out.push(`<rect x="${L + genes.length * GW + 14}" y="${ky}" width="10" height="10" fill="${SERIES[i % SERIES.length]}"/><text x="${L + genes.length * GW + 28}" y="${ky + 9}" font-size="10" fill="${p.ink}">${esc(g)}</text>`); ky += 16; });
  return { body: out.join(""), width: L + genes.length * GW + 40 + Math.max(...r.groups.map((g) => g.length)) * 6.2, height: T + H + 60 };
}

export function enrichmentSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.enrichment!;
  const out: string[] = [`<text x="10" y="14" font-size="10.5" fill="${p.muted}">${fmt(r.tested)} genes tested for ${esc(r.alteration)} · ${fmt(r.significant)} at q &lt; 0.05 · ${esc(r.test)}</text>`];
  // the portal's three charts in a row (one with more than two groups)
  const charts = [enrichmentVolcanoSvg(r, o), enrichmentScatterSvg(r, o), enrichmentTopSvg(r, o)].filter((c): c is NonNullable<typeof c> => !!c);
  let x = 0, ch = 0;
  for (const c of charts) { out.push(`<g transform="translate(${x} 22)">${c.body}</g>`); x += c.width + 16; ch = Math.max(ch, c.height); }
  // the table: Gene · Cytoband · each group n (%) · Log2 Ratio · p · q · Enriched in
  const two = r.groups.length === 2;
  const cols: [string, number, "start" | "end"][] = [["Gene", 90, "start"], ["Cytoband", 90, "start"],
    ...r.groups.map((g) => [g.length > 22 ? g.slice(0, 21) + "…" : g, 150, "end"] as [string, number, "end"]),
    ...(two ? [["Log2 Ratio", 80, "end"] as [string, number, "end"]] : []), ["p-Value", 80, "end"], ["q-Value", 80, "end"], ["Enriched in", 150, "start"]];
  const W = Math.max(o.width || 960, x, 20 + cols.reduce((a, c) => a + c[1], 0));
  let y = 22 + ch + 18;
  let cx = 10;
  const at: number[] = [];
  for (const [label, w, anchor] of cols) { at.push(anchor === "end" ? cx + w - 8 : cx); out.push(`<text x="${anchor === "end" ? cx + w - 8 : cx}" y="${y}" font-size="10.5" font-weight="700" fill="${p.ink}" text-anchor="${anchor}">${esc(label)}</text>`); cx += w; }
  out.push(`<line x1="10" y1="${y + 5}" x2="${cx}" y2="${y + 5}" stroke="${p.line}" stroke-width="1.5"/>`);
  const shown = r.rows.slice(0, 18), pv = (x: number) => x === 0 ? "<1e-300" : x < 1e-3 ? x.toExponential(1) : x.toFixed(3);
  shown.forEach((g, i) => {
    const yy = y + 20 + i * 17;
    const vals = [g.gene, g.cytoband || "", ...g.cells.map((c) => fmt(c.altered) + " (" + (c.pct == null ? "—" : c.pct.toFixed(2) + "%") + ")"),
      ...(two ? [g.log2Ratio == null ? (g.cells[0].altered ? ">10" : "<-10") : g.log2Ratio.toFixed(2)] : []), pv(g.p), pv(g.q)];
    vals.forEach((t, j) => out.push(`<text x="${at[j]}" y="${yy}" font-size="10.5" fill="${p.ink}" text-anchor="${cols[j][2]}"${j === 0 || (j === vals.length - 1 && g.q < 0.05) ? ' font-weight="600"' : ""}>${esc(t)}</text>`));
    const gi = r.groups.indexOf(g.enrichedIn), bx = at[vals.length];
    out.push(`<rect x="${bx}" y="${yy - 10}" width="${Math.min(140, 12 + g.enrichedIn.length * 6.3)}" height="14" rx="3" fill="${g.q < 0.05 ? SERIES[gi % SERIES.length] : p.line}"/>` +
      `<text x="${bx + 6}" y="${yy + 1}" font-size="10" font-weight="600" fill="${g.q < 0.05 ? "#fff" : p.ink}">${esc(g.enrichedIn.length > 22 ? g.enrichedIn.slice(0, 21) + "…" : g.enrichedIn)}</text>`);
  });
  y += 20 + shown.length * 17;
  if (r.tested > shown.length) out.push(`<text x="10" y="${y + 4}" font-size="9" fill="${p.muted}">+${fmt(r.tested - shown.length)} more genes tested (the full table is in the result and the MCP text)</text>`);
  y += 14;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, W > (o.width || 960));
}

