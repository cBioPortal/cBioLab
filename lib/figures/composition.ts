// Composition figure: each cohort's cases as stacked bars, ordered by one part, with the cohort's
// mean composition beside them; under it, with two or more cohorts, a cohort × part matrix of how
// each part's mean differs from the other cohorts' (colour) and how surely (size).
//
// Bars at least MIN_BAR wide are drawn one per case; narrower ones as stacked areas over the
// sorted cases, so a cohort of 2,000 is still every case rather than a sample of them.
import type { ViewResult } from "../types.ts";
import {
  palette, frame, caption, label, legend, linear, axisLeft, leftAxisWidth, textWidth,
  fmtInt, fmtNum, fmtShare, fmtP, esc, num, FS, SW, type SvgOpts, type LegendItem
} from "../svg-kit.ts";
import { categoryColor, numericColor, STYLE } from "../oncoprint-style.ts";

type CResult = NonNullable<ViewResult["composition"]>;

const PAD = 8, BAR_H = 180, HEAD_H = 2 * (FS.body + 4) + 4, MEAN_W = 26, MEAN_GAP = 5, BLOCK_GAP = 18, MIN_BLOCK = 64;
const MIN_BAR = 2, ROW_H = 18, LOG2_CLAMP = 2;

/**
 * A part's fill: the categorical palette, and past it the same hues as diagonal hatching, so a
 * ninth part is never a lighter twin of a first. `ns` makes the hatching's pattern ids unique to
 * one figure, since a page holds several.
 */
export function partFill(i: number, ns: string): { fill: string; def: string } {
  const n = STYLE.palette.categorical.length, color = categoryColor(i);
  if (i < n) return { fill: color, def: "" };
  const id = "cmp" + ns + "p" + i;
  return { fill: "url(#" + id + ")",
    def: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">` +
      `<rect width="5" height="5" fill="#ffffff"/><rect width="2.6" height="5" fill="${color}"/></pattern>` };
}

/** a short stable token from the text, for ids that must not collide between figures on one page */
function nsOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** each block's width: room for its bars and mean bar, at least MIN_BLOCK, the rest shared by case count */
function blockWidths(counts: number[], room: number): number[] {
  const fixed = MEAN_W + MEAN_GAP;
  let free = room - counts.length * fixed, unit = 0;
  const pinned = new Set<number>();
  for (let pass = 0; pass < counts.length; pass++) {
    const open = counts.map((c, i) => i).filter((i) => !pinned.has(i));
    const cases = open.reduce((a, i) => a + counts[i], 0);
    unit = cases ? Math.max(0, free) / cases : 0;
    const small = open.filter((i) => counts[i] * unit + fixed < MIN_BLOCK);
    if (!small.length) break;
    for (const i of small) { pinned.add(i); free -= MIN_BLOCK - fixed; }
  }
  return counts.map((c, i) => pinned.has(i) ? MIN_BLOCK : c * unit + fixed);
}

export function compositionSvg(v: ViewResult, o: SvgOpts): string {
  const r = v.composition as CResult;
  const p = palette(o.theme);
  const W0 = o.width || 760;
  // the value axis's scale, laid out before anything else: its labels set the left margin
  const totals = r.groups.flatMap((g) => (g.cases || []).map((c) => c.reduce((a, b) => a + b, 0)));
  const means = r.groups.map((g) => r.parts.map((pt) => r.cells.find((c) => c.cohort === g.cohort && c.part === pt.id)?.mean ?? 0));
  const yMax = r.normalize ? 1 : Math.max(1e-9, ...totals, ...means.map((m) => m.reduce((a, b) => a + b, 0)));
  const yTitle = r.normalize ? "share of " + r.unit.replace(/s$/, "") : "value";
  const probe = linear(0, yMax, BAR_H, 0, { nice: !r.normalize });
  const fmtY = r.normalize ? (t: number) => fmtShare(t, 0) : probe.fmt;
  const left = PAD + leftAxisWidth(probe, yTitle, fmtY);
  // every cohort's block at its narrowest, and the matrix's columns at theirs, must fit: past
  // that the figure widens and scrolls rather than squeeze or overrun them
  const matrixLabelMin = 90, matrixColMin = 70;
  const need = Math.max(left + PAD + r.groups.length * MIN_BLOCK + BLOCK_GAP * (r.groups.length - 1),
    r.groups.length >= 2 ? 2 * PAD + matrixLabelMin + r.groups.length * matrixColMin : 0);
  const W = Math.max(W0, need);
  const k = r.parts.length;
  const out: string[] = [];
  const ns = nsOf(r.sourceName + "|" + r.parts.map((x) => x.id).join(",") + "|" + r.groups.map((g) => g.cohort).join(",") + "|" + W);
  const fills = r.parts.map((_, i) => partFill(i, ns));
  const defs = fills.map((f) => f.def).join("");
  if (defs) out.push("<defs>" + defs + "</defs>");

  // ---- the parts' legend
  const items: LegendItem[] = r.parts.map((pt, i) => ({ label: pt.name, color: fills[i].fill }));
  const lg = legend(items, PAD, PAD, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  let y = PAD + lg.height + 6;

  // ---- stacked bars, one block per cohort
  const top = y + HEAD_H, bottom = top + BAR_H;
  const ys = linear(0, yMax, bottom, top, { nice: !r.normalize });
  out.push(axisLeft(ys, left - 2, p, { title: yTitle, fmt: fmtY }));
  const room = W - PAD - left - BLOCK_GAP * (r.groups.length - 1);
  const widths = blockWidths(r.groups.map((g) => g.cases?.length || 0), room);
  let x = left;
  r.groups.forEach((g, gi) => {
    const bw = widths[gi], cases = g.cases || [];
    const casesW = bw - MEAN_W - MEAN_GAP;
    out.push(label(x, y + FS.body, g.cohort, { size: FS.body, weight: 600, fill: p.ink, maxW: bw }));
    const sub = fmtInt(g.n) + " " + r.unit + (g.entropy ? " · entropy " + fmtNum(g.entropy.mean, 3) : "") + (cases.length ? "" : " · mean only");
    out.push(label(x, y + 2 * FS.body + 6, sub, { size: FS.small, fill: p.muted, maxW: bw }));
    if (cases.length) {
      const step = casesW / cases.length;
      if (step >= MIN_BAR) {
        const gap = step >= 5 ? 1 : 0;
        cases.forEach((c, ci) => {
          let acc = 0;
          const bx = x + ci * step;
          c.forEach((val, j) => {
            if (!(val > 0)) return;
            const y1 = ys(acc), y0 = ys(acc + val);
            out.push(`<rect x="${num(bx)}" y="${num(y0)}" width="${num(step - gap)}" height="${num(Math.max(0, y1 - y0))}" fill="${fills[j].fill}"/>`);
            acc += val;
          });
        });
      } else {
        // stacked areas over the sorted cases: part j fills between the running sums before and after it
        const lo = cases.map(() => 0);
        for (let j = 0; j < k; j++) {
          const hi = cases.map((c, ci) => lo[ci] + Math.max(0, c[j]));
          const xs = cases.map((_, ci) => x + (ci + 0.5) * step);
          const pts = xs.map((px, ci) => num(px) + "," + num(ys(hi[ci]))).concat(xs.map((px, ci) => num(px) + "," + num(ys(lo[ci]))).reverse());
          out.push(`<polygon points="${pts.join(" ")}" fill="${fills[j].fill}" stroke="none"/>`);
          for (let ci = 0; ci < cases.length; ci++) lo[ci] = hi[ci];
        }
      }
    } else {
      out.push(`<rect x="${num(x)}" y="${num(top)}" width="${num(Math.max(0, casesW))}" height="${BAR_H}" fill="none" stroke="${p.line}" stroke-dasharray="3 3"/>`);
      if (textWidth("cases not drawn", FS.small) <= casesW - 6)
        out.push(label(x + casesW / 2, top + BAR_H / 2, "cases not drawn", { size: FS.small, fill: p.muted, anchor: "middle" }));
    }
    // the mean bar
    const mx = x + bw - MEAN_W;
    let acc = 0;
    means[gi].forEach((val, j) => {
      if (!(val > 0)) return;
      const y1 = ys(acc), y0 = ys(acc + val);
      out.push(`<rect x="${num(mx)}" y="${num(y0)}" width="${MEAN_W}" height="${num(Math.max(0, y1 - y0))}" fill="${fills[j].fill}">` +
        `<title>${esc(g.cohort + " · " + r.parts[j].name + ": mean " + (r.normalize ? fmtShare(val, 1) : fmtNum(val, 3)))}</title></rect>`);
      acc += val;
    });
    out.push(`<rect x="${num(mx)}" y="${num(ys(acc))}" width="${MEAN_W}" height="${num(Math.max(0, bottom - ys(acc)))}" fill="none" stroke="${p.ink}" stroke-width="${SW.hair}"/>`);
    out.push(label(mx + MEAN_W / 2, bottom + FS.small + 4, "mean", { size: FS.small, fill: p.muted, anchor: "middle" }));
    x += bw + BLOCK_GAP;
  });
  y = bottom + FS.small + 12;

  // ---- the enrichment matrix
  if (r.groups.length >= 2) {
    y += 8;
    out.push(label(PAD, y + FS.body, "Each cohort against the others, per part", { size: FS.body, weight: 600, fill: p.ink, maxW: W - 2 * PAD }));
    y += FS.body + 8;
    const colW = Math.max(matrixColMin, Math.min(130, (W - 2 * PAD - matrixLabelMin) / r.groups.length));
    const labelW = Math.max(matrixLabelMin, Math.min(Math.max(...r.parts.map((pt) => textWidth(pt.name, FS.small))) + 22, W - 2 * PAD - colW * r.groups.length));
    const x0 = PAD + labelW;
    r.groups.forEach((g, gi) => out.push(label(x0 + gi * colW + 4, y + FS.small, g.cohort, { size: FS.small, weight: 600, fill: p.ink, maxW: colW - 14 })));
    y += FS.small + 8;
    r.parts.forEach((pt, j) => {
      const cy = y + j * ROW_H + ROW_H / 2;
      out.push(`<rect x="${PAD}" y="${num(cy - 5)}" width="10" height="10" rx="2" fill="${fills[j].fill}"/>`);
      out.push(label(PAD + 15, cy + FS.small * 0.35, pt.name, { size: FS.small, fill: p.ink, maxW: labelW - 20 }));
      r.groups.forEach((g, gi) => {
        const c = r.cells.find((x) => x.cohort === g.cohort && x.part === pt.id);
        const cx = x0 + gi * colW + 12;
        if (!c) return;
        out.push(label(cx + 11, cy + FS.small * 0.35, r.normalize ? fmtShare(c.mean, 1) : fmtNum(c.mean, 3), { size: FS.small, fill: p.muted, maxW: colW - 26 }));
        if (c.log2 == null) return;
        const t = Math.max(-1, Math.min(1, c.log2 / LOG2_CLAMP));
        const fill = numericColor(127.5 + t * 127.5, 127.5);
        const q = c.q ?? 1, rad = 2.5 + Math.min(5, -Math.log10(Math.max(q, 1e-10)) * 1.6);
        const tip = g.cohort + " · " + pt.name + ": mean " + (r.normalize ? fmtShare(c.mean, 1) : fmtNum(c.mean, 3)) +
          ", log2 vs others " + fmtNum(c.log2, 2) + (c.p != null ? ", " + fmtP(c.p) + ", " + fmtP(q, "q") : ", not tested");
        out.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(rad)}" fill="${fill}" stroke="${q < 0.05 ? p.ink : p.line}" stroke-width="${q < 0.05 ? SW.line : SW.hair}"><title>${esc(tip)}</title></circle>`);
      });
    });
    y += k * ROW_H + 8;
    const key = "Each cell: the cohort's mean" + (r.normalize ? " share" : "") + ", and a dot whose colour is log2 of it over the other cohorts' mean (blue lower, red higher, clamped at ±" + LOG2_CLAMP + "), " +
      "size −log10 q, outlined when q < 0.05. " + fmtInt(r.tested) + " comparisons tested, " + fmtInt(r.significant) + " at q < 0.05.";
    const kc = caption(key, W, y - 6, p.muted);
    out.push(kc.svg);
    y += kc.height;
  }

  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > W0,
    "Composition — " + r.sourceName + " by " + r.groups.map((g) => g.cohort).join(", "));
}

