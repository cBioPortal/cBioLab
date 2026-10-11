// Overlap figure: how the cohorts' patients intersect — a Venn for 2–3 groups, else an UpSet.
import { esc, SERIES, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";

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
