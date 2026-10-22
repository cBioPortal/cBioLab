// Overlap figure: how the cohorts' patients intersect — a Venn for 2–3 groups, else an UpSet.
import {
  palette, frame, caption, label, legend, textWidth, packLines, linear, axisLeft, leftAxisWidth, seriesStyle,
  fmtInt, esc, num, FS, SW, OTHER, type SvgOpts
} from "../svg-kit.ts";
import type { ViewResultOf } from "../types.ts";

type OvResult = NonNullable<ViewResultOf<"overlap">["overlap"]>;
type Pal = ReturnType<typeof palette>;

// ---- overlap: area-proportional diagrams for 2–3 groups, as the portal draws them -------------

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

/** a set's fill: its series colour, and past six the same hue lighter */
const setFill = (i: number) => { const s = seriesStyle(i); return { color: s.color, opacity: 0.55 * s.tint }; };


const VENN_TOP = 24;

/**
 * One overlap diagram — the cohorts' samples or their patients — with every region labelled by
 * how many are in exactly those cohorts. Circles are area-proportional and each pair is placed so
 * its lens matches the pair's overlap; with three, a three-way region can only be approximate, and
 * the labels (not the areas) carry the numbers. A region too small to hold its number without
 * touching another is listed under the diagram instead, never dropped.
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
  const S = o.size || 300, PAD = 8;
  const x0 = Math.min(...c.map(([x], i) => x - rad[i])), x1 = Math.max(...c.map(([x], i) => x + rad[i]));
  const y0 = Math.min(...c.map(([, y], i) => y - rad[i])), y1 = Math.max(...c.map(([, y], i) => y + rad[i]));
  const sc = (S - 2 * PAD) / Math.max(x1 - x0, y1 - y0);
  const ox = PAD + ((S - 2 * PAD) - (x1 - x0) * sc) / 2, oy = VENN_TOP + PAD + ((S - 2 * PAD) - (y1 - y0) * sc) / 2;
  const cx = c.map(([x, y]) => [ox + (x - x0) * sc, oy + (y - y0) * sc] as [number, number]);
  const R = rad.map((x) => x * sc);
  const out: string[] = [label(S / 2, FS.title + 2, unit === "samples" ? "Samples overlap" : "Patients overlap",
    { size: FS.title, weight: 600, fill: p.ink, anchor: "middle" })];
  cx.forEach(([x, y], i) => {
    const f = setFill(i);
    out.push(`<circle cx="${num(x)}" cy="${num(y)}" r="${num(R[i])}" fill="${f.color}" fill-opacity="${num(f.opacity)}" stroke="${f.color}" stroke-width="${SW.line}"><title>${esc(r.sets[i].name + ": " + fmtInt(sizeOf(i)) + " " + unit)}</title></circle>`);
  });
  // each region's grid points: where to put its number, and how much room it has
  const N = 140, cell = S / N, pts = new Map<number, [number, number][]>();
  const maskAt = (x: number, y: number) => { let m = 0; cx.forEach(([a, b], i) => { if ((x - a) ** 2 + (y - b) ** 2 <= R[i] ** 2) m |= 1 << i; }); return m; };
  for (let gx = 0; gx < N; gx++) for (let gy = 0; gy < N; gy++) {
    const x = (gx + 0.5) * cell, y = VENN_TOP + (gy + 0.5) * cell, m = maskAt(x, y);
    if (!m) continue;
    const a = pts.get(m) || []; a.push([x, y]); pts.set(m, a);
  }
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const unplaced: string[] = [];
  for (const x of r.intersections) {
    if (!count(x)) continue;
    const m = x.members.reduce((a, n) => a | (1 << r.sets.findIndex((s) => s.name === n)), 0);
    const text = fmtInt(count(x)), tw = textWidth(text, FS.body, 600), th = FS.body;
    const at = regionSpot(pts.get(m) || [], (px, py) => {
      // the label's box must lie inside its region and clear of every number already placed
      const b = { x0: px - tw / 2 - 2, y0: py - th / 2 - 1, x1: px + tw / 2 + 2, y1: py + th / 2 + 1 };
      for (const [qx, qy] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) if (maskAt(qx, qy) !== m) return false;
      return !placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
    });
    const name = x.members.join(" ∩ ");
    if (at) {
      placed.push({ x0: at[0] - tw / 2 - 2, y0: at[1] - th / 2 - 1, x1: at[0] + tw / 2 + 2, y1: at[1] + th / 2 + 1 });
      out.push(`<text x="${num(at[0])}" y="${num(at[1] + th * 0.35)}" font-size="${FS.body}" font-weight="600" fill="${p.ink}" text-anchor="middle"><title>${esc(name + ": " + text + " " + unit)}</title>${text}</text>`);
    } else unplaced.push(name + ": " + text);
  }
  let h = VENN_TOP + S;
  if (unplaced.length) {
    const lh = Math.round(FS.small * 1.4);
    out.push(label(4, h + FS.small, "too small to label:", { size: FS.small, fill: p.muted }));
    h += lh;
    for (const line of packLines(unplaced, S - 8, FS.small)) {
      out.push(label(4, h + FS.small, line, { size: FS.small, fill: p.muted, maxW: S - 8 }));
      h += lh;
    }
  }
  return { body: out.join(""), width: S, height: h + 6 };
}

/**
 * Where to put a region's number: the region's centroid if `fits` there, else the fitting grid
 * point nearest it (a crescent's centroid can lie outside the crescent). Null when none fits.
 */
function regionSpot(pts: [number, number][], fits: (x: number, y: number) => boolean): [number, number] | null {
  if (pts.length < 4) return null;
  const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length, my = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  if (fits(mx, my)) return [mx, my];
  const byDist = [...pts].sort((a, b) => (a[0] - mx) ** 2 + (a[1] - my) ** 2 - ((b[0] - mx) ** 2 + (b[1] - my) ** 2));
  for (const q of byDist) if (fits(q[0], q[1])) return q;
  return null;
}

// ---- UpSet: every non-empty combination as a column, for 4+ groups -----------------------------

/** the narrowest column an UpSet draws: room for a dot and a count turned on its side */
export const UPSET_MIN_COL = 14;
const UPSET_MAX_COL = 48, UPSET_ROW = 22, DOT_R = 5;

/**
 * How `n` combination columns fit in `room` at UPSET_MIN_COL or wider: all of them, or the largest
 * `shown` and one pooled column for the rest. `cols` is the number of columns drawn.
 */
export function upsetColumns(n: number, room: number): { shown: number; pooled: boolean; cols: number; pitch: number } {
  const fit = Math.max(2, Math.floor(room / UPSET_MIN_COL));
  const pooled = n > fit, shown = pooled ? fit - 1 : n, cols = shown + (pooled ? 1 : 0);
  return { shown, pooled, cols, pitch: Math.min(UPSET_MAX_COL, room / Math.max(1, cols)) };
}

function upsetSvg(v: ViewResultOf<"overlap">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.overlap!;
  const sets = r.sets, inter = r.intersections;
  const W = Math.max(480, o.width || 860);

  // left block: names | sizes | size bars; then the matrix takes what is left
  const nameW = Math.min(Math.max(W * 0.18, 90), Math.max(...sets.map((s) => textWidth(s.name, FS.body))));
  const sizeW = Math.max(textWidth("patients", FS.small), ...sets.map((s) => textWidth(fmtInt(s.size), FS.small)));
  const barW = Math.max(60, Math.min(120, W * 0.08));
  const NAME_X = 8 + nameW, SIZE_X = NAME_X + 8 + sizeW, BAR0 = SIZE_X + 8, LEFT = BAR0 + barW + 16;
  const room = W - 8 - LEFT;
  const { shown, pooled, cols, pitch } = upsetColumns(inter.length, room);
  const drawn = inter.slice(0, shown), rest = inter.slice(shown);
  const restN = rest.reduce((a, x) => a + x.n, 0);
  const bars = [...drawn.map((x) => ({ n: x.n, name: x.members.join(" ∩ "), pooled: false })),
    ...(pooled ? [{ n: restN, name: "the other " + rest.length + " combinations, pooled", pooled: true }] : [])];

  // counts above the bars: flat when the widest fits the column, else turned on their side
  const maxN = Math.max(1, ...bars.map((x) => x.n));
  const countW = Math.max(...bars.map((x) => textWidth(fmtInt(x.n), FS.small)));
  const flat = countW <= pitch - 3;
  const above = flat ? FS.small + 4 : countW + 6;
  const axTitle = "patients in exactly these cohorts";
  const T = 8 + above, BARH = Math.max(160, Math.ceil(textWidth(axTitle, FS.body)) + 8);
  const ys = linear(0, maxN, T + BARH, T, { count: 4 });
  const axX = LEFT - 4;
  const out: string[] = [];
  // the bars' axis sits in the empty corner above the names, as wide as that corner allows
  if (leftAxisWidth(ys, axTitle) <= LEFT - 8) out.push(axisLeft(ys, axX, p, { title: axTitle, gridTo: LEFT + cols * pitch }));
  else out.push(axisLeft(ys, axX, p, { gridTo: LEFT + cols * pitch }));
  const colX = (i: number) => LEFT + i * pitch + pitch / 2;
  const bw = Math.max(4, Math.min(24, pitch * 0.6));
  bars.forEach((x, i) => {
    const cxi = colX(i), y = ys(x.n), h = T + BARH - y;
    out.push(`<rect x="${num(cxi - bw / 2)}" y="${num(y)}" width="${num(bw)}" height="${num(Math.max(h, 0.8))}" fill="${x.pooled ? OTHER : p.ink}" opacity="0.85"><title>${esc(x.name + ": " + fmtInt(x.n) + " patients")}</title></rect>`);
    out.push(flat
      ? label(cxi, y - 4, fmtInt(x.n), { size: FS.small, fill: p.ink, anchor: "middle" })
      : label(cxi + FS.small * 0.35, y - 4, fmtInt(x.n), { size: FS.small, fill: p.ink, rotate: -90 }));
  });

  const matrixTop = T + BARH + 18 + UPSET_ROW / 2;
  out.push(label(SIZE_X, matrixTop - UPSET_ROW / 2 - 4, "patients", { size: FS.small, fill: p.muted, anchor: "end" }));
  const maxSet = Math.max(1, ...sets.map((s) => s.size));
  sets.forEach((st, j) => {
    const y = matrixTop + j * UPSET_ROW, f = setFill(j);
    if (j % 2 === 0) out.push(`<rect x="${LEFT}" y="${y - UPSET_ROW / 2}" width="${num(cols * pitch)}" height="${UPSET_ROW}" fill="${p.line}" opacity="0.35"/>`);
    out.push(`<rect x="${BAR0}" y="${y - 6}" width="${num(Math.max(0.8, barW * st.size / maxSet))}" height="12" fill="${f.color}" opacity="${num(Math.min(1, f.opacity / 0.55 * 0.85))}"/>`);
    out.push(label(NAME_X, y + FS.body * 0.35, st.name, { size: FS.body, fill: p.ink, anchor: "end", maxW: nameW }));
    out.push(label(SIZE_X, y + FS.small * 0.35, fmtInt(st.size), { size: FS.small, fill: p.muted, anchor: "end" }));
    drawn.forEach((x, i) => {
      const on = x.members.includes(st.name);
      out.push(`<circle cx="${num(colX(i))}" cy="${y}" r="${DOT_R}" fill="${on ? p.ink : p.line}"/>`);
    });
  });
  // lines joining the members of each combination
  drawn.forEach((x, i) => {
    const yy = x.members.map((m) => matrixTop + sets.findIndex((s) => s.name === m) * UPSET_ROW);
    if (yy.length > 1) out.push(`<line x1="${num(colX(i))}" y1="${Math.min(...yy)}" x2="${num(colX(i))}" y2="${Math.max(...yy)}" stroke="${p.ink}" stroke-width="${SW.series}"/>`);
  });
  // the pooled column has no one pattern of dots: it says how many combinations it holds
  if (pooled) out.push(label(colX(shown) + FS.small * 0.35, matrixTop - UPSET_ROW / 2 + 2, "+" + rest.length + " more",
    { size: FS.small, fill: p.muted, anchor: "end", rotate: -90 }));

  let y = matrixTop + (sets.length - 1) * UPSET_ROW + UPSET_ROW / 2 + 8;
  const summary = fmtInt(r.union) + " patients in at least one cohort · " + inter.length + " non-empty combination" +
    (inter.length === 1 ? "" : "s") + " of " + (Math.pow(2, sets.length) - 1);
  out.push(label(8, y + FS.body, summary, { size: FS.body, fill: p.ink, maxW: W - 16 }));
  y += Math.round(FS.body * 1.6);
  const note = pooled
    ? "The " + shown + " largest combinations are drawn one by one; the other " + rest.length + " are pooled in the last, grey column (" +
      fmtInt(restN) + " patients, at most " + fmtInt(Math.max(...rest.map((x) => x.n))) + " in any one) — a wider figure draws more of them. "
    : "";
  const cap = caption(note + (v.caveat || ""), W, y - 6, p.muted);
  return frame(W, y - 6 + cap.height + 8, out.join("") + cap.svg, p.bg, W > (o.width || 860),
    "Cohort overlap — " + sets.map((s) => s.name).join(", "));
}

/** the key under the Venn diagrams: a swatch per cohort with its size */
function overlapKey(r: OvResult, p: Pal, x: number, y: number, w: number): { svg: string; height: number } {
  return legend(r.sets.map((s, i) => ({
    label: s.name, color: setFill(i).color, opacity: Math.min(1, setFill(i).opacity / 0.55 * 0.85),
    detail: fmtInt(s.size) + " patients" + (s.samples != null ? " · " + fmtInt(s.samples) + " samples" : "")
  })), x, y, w, p);
}

export function overlapSvg(v: ViewResultOf<"overlap">, o: SvgOpts): string {
  const r = v.overlap!;
  if (r.sets.length > 3 || r.sets.some((s) => s.samples == null)) return upsetSvg(v, o);
  // two or three groups: samples and patients side by side, as the portal's Overlap tab shows them
  const p = palette(o.theme);
  const W0 = o.width || 860, GAP = 32;
  const S = Math.round(Math.max(200, Math.min(400, (W0 - 16 - GAP) / 2)));
  const W = Math.max(W0, 16 + 2 * S + GAP);
  const a = overlapVennSvg(r, "samples", { ...o, size: S }), b = overlapVennSvg(r, "patients", { ...o, size: S });
  const H = Math.max(a.height, b.height);
  const key = overlapKey(r, p, 8, H + 4, W - 16);
  const body = `<g transform="translate(8 0)">${a.body}</g><g transform="translate(${8 + S + GAP} 0)">${b.body}</g>` + key.svg;
  const y = H + 4 + key.height;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, body + cap.svg, p.bg, W > W0, "Cohort overlap — " + r.sets.map((s) => s.name).join(", "));
}
