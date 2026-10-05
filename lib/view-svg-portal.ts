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

type CtResult = NonNullable<ViewResult["cancertypes"]>;
const CT_KINDS: [keyof CancertypesGroup, string, string][] = [["mutation", "Mutation", MUT], ["amp", "Amplification", AMP],
  ["homdel", "Deep Deletion", DEL], ["sv", "Structural Variant", SV], ["multiple", "Multiple Alterations", MULTI]];

/**
 * One cohort's Cancer Types Summary as the portal draws it: a vertical bar per group, highest first,
 * stacked by kind of alteration; under it a "+" for each data type the group was profiled for;
 * group names slanted below; the kinds present keyed at the foot. `gene` picks one gene's bars
 * (the portal's per-gene tabs); omitted, the genes together.
 */
export function cancertypesPanelSvg(r: CtResult, panel: number, o: SvgOpts & { gene?: string | null; title?: boolean } = {}): { body: string; width: number; height: number } {
  const p = palette(o.theme), pn = r.panels[panel];
  const src = o.gene && pn.perGene ? pn.perGene.find((x) => x.gene === o.gene) || pn : pn;
  const groups = [...src.groups, ...(src.pooled ? [src.pooled] : [])];
  const freq = r.show === "frequency";
  const value = (g: CancertypesGroup, k: keyof CancertypesGroup) => freq ? 100 * Number(g[k]) / (g.profiled || 1) : Number(g[k]);
  const top = Math.max(1e-9, ...groups.map((g) => value(g, "altered")));
  const tick = freq ? (top <= 10 ? 2 : top <= 25 ? 5 : top <= 50 ? 10 : 20)
    : Math.pow(10, Math.floor(Math.log10(top))) * (top / Math.pow(10, Math.floor(Math.log10(top))) > 5 ? 2 : 1);
  const scale = freq ? Math.min(100, Math.ceil(top / tick) * tick) : Math.ceil(top / tick) * tick;
  const rows: [keyof NonNullable<CancertypesGroup["profiledFor"]>, string][] = ([["sv", "Structural variant data"], ["mutation", "Mutation data"], ["cna", "CNA data"]] as const)
    .filter(([k]) => groups.some((g) => (g.profiledFor?.[k] || 0) > 0)) as never;
  const LEFT = 175, BW = 22, GAP = 6, PH = 260, T = o.title === false ? 12 : 36;
  const longest = Math.max(4, ...groups.map((g) => Math.min(40, g.label.length)));
  const labelDrop = Math.ceil(longest * 6.2 * 0.71) + 14;
  const W = Math.max(o.width || 0, LEFT + groups.length * (BW + GAP) + labelDrop + 30);
  const X = (i: number) => LEFT + i * (BW + GAP);
  const Y = (v: number) => T + PH * (1 - v / scale);
  const out: string[] = [];
  if (o.title !== false) out.push(`<text x="10" y="18" font-size="12" font-weight="600" fill="${p.ink}">${esc(pn.cohort)}` +
    `<tspan dx="8" font-size="10.5" font-weight="400" fill="${p.muted}">${o.gene ? esc(o.gene) + " · " : ""}${fmt(pn.altered)} of ${fmt(pn.profiled)} profiled ${r.unit}s altered (${(100 * pn.altered / (pn.profiled || 1)).toFixed(1)}%)</tspan></text>`);
  // y axis
  for (let v = 0; v <= scale + 1e-9; v += tick) {
    out.push(`<line x1="${LEFT - 6}" y1="${num(Y(v))}" x2="${num(X(groups.length))}" y2="${num(Y(v))}" stroke="${p.line}" stroke-width="${v === 0 ? 0 : 0.6}" stroke-dasharray="${v === 0 ? "" : "2 3"}"/>` +
      `<text x="${LEFT - 9}" y="${num(Y(v) + 3)}" font-size="10" fill="${p.ink}" text-anchor="end">${freq ? num(v) + "%" : fmt(Math.round(v))}</text>`);
  }
  out.push(`<line x1="${LEFT - 4}" y1="${T}" x2="${LEFT - 4}" y2="${T + PH}" stroke="${p.ink}" stroke-width="0.8"/>` +
    `<line x1="${LEFT - 4}" y1="${T + PH}" x2="${num(X(groups.length))}" y2="${T + PH}" stroke="${p.ink}" stroke-width="0.8"/>` +
    `<text x="${LEFT - 48}" y="${T + PH / 2}" font-size="11" fill="${p.ink}" text-anchor="middle" transform="rotate(-90 ${LEFT - 48} ${T + PH / 2})">${freq ? "Alteration Frequency" : "Absolute Counts"}</text>`);
  // bars
  groups.forEach((g, i) => {
    let y0 = T + PH;
    for (const [k, label, col] of CT_KINDS) {
      const h = PH * value(g, k) / scale;
      if (h <= 0) continue;
      y0 -= h;
      out.push(`<rect x="${num(X(i))}" y="${num(y0)}" width="${BW}" height="${num(h)}" fill="${col}"><title>${esc(g.label + " — " + label + ": " + fmt(Number(g[k])) + " of " + fmt(g.profiled) + " profiled " + r.unit + "s")}</title></rect>`);
    }
    out.push(`<rect x="${num(X(i))}" y="${num(Y(value(g, "altered")))}" width="${BW}" height="${num(PH * value(g, "altered") / scale)}" fill="none"><title>${esc(g.label + ": " + (100 * g.altered / (g.profiled || 1)).toFixed(1) + "% (" + fmt(g.altered) + " / " + fmt(g.profiled) + " " + r.unit + "s" + (g.samples > g.profiled ? ", " + fmt(g.samples) + " in the group" : "") + ")")}</title></rect>`);
  });
  // what each group was profiled for
  let y = T + PH + 18;
  for (const [k, label] of rows) {
    out.push(`<text x="${LEFT - 9}" y="${y + 4}" font-size="10.5" fill="${p.ink}" text-anchor="end">${label}</text>`);
    groups.forEach((g, i) => { if ((g.profiledFor?.[k] || 0) > 0) out.push(`<text x="${num(X(i) + BW / 2)}" y="${y + 5}" font-size="13" font-weight="700" fill="${p.ink}" text-anchor="middle">+</text>`); });
    y += 18;
  }
  // slanted group names
  groups.forEach((g, i) => {
    const pooled = g.key === "__pooled__", x = X(i) + BW / 2;
    out.push(`<text x="${num(x)}" y="${y}" font-size="10.5" fill="${pooled ? p.muted : p.ink}"${pooled ? ' font-style="italic"' : ""} transform="rotate(45 ${num(x)} ${y})">${esc(g.label.length > 40 ? g.label.slice(0, 39) + "…" : g.label)}</text>`);
  });
  y += labelDrop;
  // key: the kinds present
  let kx = LEFT;
  for (const [k, label, col] of CT_KINDS) {
    if (!groups.some((g) => Number(g[k]) > 0)) continue;
    out.push(`<circle cx="${kx + 4}" cy="${y}" r="4" fill="${col}"/><text x="${kx + 12}" y="${y + 4}" font-size="10.5" fill="${p.ink}">${label}</text>`);
    kx += 26 + label.length * 6;
  }
  return { body: out.join(""), width: Math.max(W, kx + 10), height: y + 16 };
}

export function cancertypesSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.cancertypes!;
  let y = 0, W = o.width || 860;
  const parts: string[] = [];
  r.panels.forEach((_, i) => {
    const c = cancertypesPanelSvg(r, i, { ...o, title: true });
    parts.push(`<g transform="translate(0 ${y})">${c.body}</g>`);
    y += c.height + 10; W = Math.max(W, c.width);
  });
  const cap = caption(v.caveat || "", W, y, p.muted, Math.floor(W / 7.2));
  return frame(W, y + cap.height + 10, parts.join("") + cap.svg, p.bg, W > (o.width || 860));
}

// ---------------------------------------------------------------------------

// ---- overlap: area-proportional diagrams for 2–3 groups, as the portal draws them -------------

type OvResult = NonNullable<ViewResult["overlap"]>;

/** Area of the lens two circles of radii r1, r2 at distance d share. */
function lens(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return a + b - 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
}
/** The distance at which two circles share `area` (bisection; lens area falls as d grows). */
function distanceFor(r1: number, r2: number, area: number): number {
  if (area <= 0) return r1 + r2 + Math.min(r1, r2) * 0.15;
  let lo = Math.abs(r1 - r2), hi = r1 + r2;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (lens(r1, r2, m) > area) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * One overlap diagram — the cohorts' samples or their patients — with every region labelled by
 * how many are in exactly those cohorts. Circles are area-proportional and each pair is placed so
 * its lens matches the pair's overlap; with three, a three-way region can only be approximate, and
 * the labels (not the areas) carry the numbers.
 */
export function overlapVennSvg(r: OvResult, unit: "samples" | "patients", o: SvgOpts & { size?: number } = {}): { body: string; width: number; height: number } {
  const p = palette(o.theme), k = r.sets.length;
  const count = (x: { n: number; samples?: number }) => unit === "samples" ? x.samples || 0 : x.n;
  const sizeOf = (i: number) => unit === "samples" ? r.sets[i].samples || 0 : r.sets[i].size;
  const both = (i: number, j: number) => r.intersections.filter((x) => x.members.includes(r.sets[i].name) && x.members.includes(r.sets[j].name)).reduce((a, x) => a + count(x), 0);
  const rad = r.sets.map((_, i) => Math.sqrt(Math.max(sizeOf(i), 1e-9) / Math.PI));
  const c: [number, number][] = [[0, 0]];
  const d01 = distanceFor(rad[0], rad[1], both(0, 1));
  c.push([d01, 0]);
  if (k === 3) {
    const d02 = distanceFor(rad[0], rad[2], both(0, 2)), d12 = distanceFor(rad[1], rad[2], both(1, 2));
    const x = (d02 * d02 - d12 * d12 + d01 * d01) / (2 * d01);
    c.push([x, -Math.sqrt(Math.max(0, d02 * d02 - x * x))]);
  }
  // fit into the box
  const S = o.size || 300, PAD = 14;
  const x0 = Math.min(...c.map(([x], i) => x - rad[i])), x1 = Math.max(...c.map(([x], i) => x + rad[i]));
  const y0 = Math.min(...c.map(([, y], i) => y - rad[i])), y1 = Math.max(...c.map(([, y], i) => y + rad[i]));
  const sc = (S - 2 * PAD) / Math.max(x1 - x0, y1 - y0);
  const ox = PAD + ((S - 2 * PAD) - (x1 - x0) * sc) / 2, oy = 34 + ((S - 2 * PAD) - (y1 - y0) * sc) / 2;
  const cx = c.map(([x, y]) => [ox + (x - x0) * sc, oy + (y - y0) * sc] as [number, number]);
  const R = rad.map((x) => x * sc);
  const out: string[] = [`<text x="${S / 2}" y="18" font-size="12" font-weight="700" fill="${p.ink}" text-anchor="middle">${unit === "samples" ? "Samples overlap" : "Patients overlap"}</text>`];
  cx.forEach(([x, y], i) => out.push(`<circle cx="${num(x)}" cy="${num(y)}" r="${num(R[i])}" fill="${SERIES[i % SERIES.length]}" fill-opacity="0.55" stroke="${SERIES[i % SERIES.length]}" stroke-width="1"><title>${esc(r.sets[i].name + ": " + fmt(sizeOf(i)) + " " + unit)}</title></circle>`));
  // label each region at the middle of the grid points that fall in it
  const N = 140, acc = new Map<number, [number, number, number]>();
  for (let gx = 0; gx < N; gx++) for (let gy = 0; gy < N; gy++) {
    const x = gx * S / N, y = 34 + gy * S / N;
    let m = 0;
    cx.forEach(([a, b], i) => { if ((x - a) ** 2 + (y - b) ** 2 <= R[i] ** 2) m |= 1 << i; });
    if (!m) continue;
    const t = acc.get(m) || [0, 0, 0]; t[0] += x; t[1] += y; t[2]++; acc.set(m, t);
  }
  const unplaced: string[] = [];
  for (const x of r.intersections) {
    const m = x.members.reduce((a, n) => a | (1 << r.sets.findIndex((s) => s.name === n)), 0);
    const pt = acc.get(m);
    if (!count(x)) continue;
    if (pt && pt[2] >= 4) out.push(`<text x="${num(pt[0] / pt[2])}" y="${num(pt[1] / pt[2] + 4)}" font-size="11.5" font-weight="700" fill="${p.ink}" text-anchor="middle"><title>${esc(x.members.join(" ∩ ") + ": " + fmt(count(x)) + " " + unit)}</title>${fmt(count(x))}</text>`);
    else unplaced.push(x.members.join(" ∩ ") + " " + fmt(count(x)));
  }
  let h = 34 + S;
  // a region too small to hold its number is listed under the diagram, not dropped
  if (unplaced.length) { out.push(`<text x="${S / 2}" y="${h + 4}" font-size="9.5" fill="${p.muted}" text-anchor="middle">${esc(unplaced.join(" · "))}</text>`); h += 14; }
  return { body: out.join(""), width: S, height: h + 6 };
}

/** The key under the overlap diagrams: a swatch per cohort with its size. */
function overlapKey(r: OvResult, p: ReturnType<typeof palette>, x: number, y: number): string {
  return r.sets.map((s, i) => `<rect x="${x}" y="${y + i * 20}" width="11" height="11" fill="${SERIES[i % SERIES.length]}"/>` +
    `<text x="${x + 17}" y="${y + i * 20 + 10}" font-size="11" fill="${p.ink}">${esc(s.name)}<tspan fill="${p.muted}" dx="6">${fmt(s.size)} patients${s.samples != null ? " · " + fmt(s.samples) + " samples" : ""}</tspan></text>`).join("");
}

function upsetSvg(v: ViewResult, o: SvgOpts): string {
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
  const cap = caption(v.caveat || "", W, y, p.muted, Math.floor(W / 7.2));
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, W > (o.width || 960));
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

export function overlapSvg(v: ViewResult, o: SvgOpts): string {
  const r = v.overlap!;
  if (r.sets.length > 3 || r.sets.some((s) => s.samples == null)) return upsetSvg(v, o);
  // two or three groups: samples and patients side by side, as the portal's Overlap tab shows them
  const p = palette(o.theme);
  const a = overlapVennSvg(r, "samples", o), b = overlapVennSvg(r, "patients", o);
  const keyW = 40 + Math.max(...r.sets.map((s) => (s.name.length + 36) * 6.4));
  const W = Math.max(o.width || 860, a.width + b.width + 60 + keyW), H = Math.max(a.height, b.height, 30 + r.sets.length * 20);
  const body = a.body + `<g transform="translate(${a.width + 30} 0)">${b.body}</g>` + overlapKey(r, p, a.width + b.width + 60, 40);
  const cap = caption(v.caveat || "", W, H + 6, p.muted, Math.floor(W / 7.2));
  return frame(W, H + 6 + cap.height + 10, body + cap.svg, p.bg);
}

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
