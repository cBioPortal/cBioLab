// Segments figure: one heat strip per sample along the genome (or a zoomed stretch of one
// chromosome), each segment coloured by its mean log2 ratio on IGV's segment scale.
import {
  palette, frame, caption, linear, axisBottom, legend, label, textWidth, ellipsize, textOn, esc,
  fmtInt, fmtNum, FS, SW, OTHER, segmentColor, SEGMENT_SCALE, type SvgOpts
} from "../../svg-kit.ts";
import type { DrawnResultOf } from "../../types.ts";
import { chromLabels } from "../../figures/genome-axis.ts";
import type { SegmentsResult } from "./types.ts";

const PAD = 8, R = 10;
/** the rows' height together, when there are many; a few rows are each ROW_MAX tall */
const PLOT_H = 600, ROW_MAX = 14, ROW_MIN = 0.5;
/** a row is labelled with its sample when it is at least this tall */
const LABEL_ROW = FS.small + 2;
/** past this many segments drawn, they carry no tooltip of their own (the row's still names the sample) */
const SEG_TIPS_MAX = 4000;
const MARK_R = 6;

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmtMb = (bp: number) => fmtNum(bp / 1e6, 7) + " Mb";

/** a sample's segments inside the region drawn (all of them, for the whole genome), flat as `segs` */
export function regionSegs(s: Pick<SegmentsResult, "region" | "segChroms">, segs: number[]): number[] {
  const r = s.region;
  if (r.chrom == null) return segs;
  const out: number[] = [];
  for (let k = 0; k < segs.length; k += 4)
    if (s.segChroms[segs[k]] === r.chrom && segs[k + 2] >= r.start && segs[k + 1] <= r.end) out.push(segs[k], segs[k + 1], segs[k + 2], segs[k + 3]);
  return out;
}

export function segmentsSvg(v: DrawnResultOf<"segments">, o: SvgOpts): string {
  const p = palette(o.theme), s = v.segments;
  const W = Math.max(480, o.width || 960);
  const n = s.samples.length;
  const rowH = Math.min(ROW_MAX, Math.max(ROW_MIN, PLOT_H / Math.max(1, n)));
  const labelled = rowH >= LABEL_ROW;
  const marked = s.samples.some((x) => x.mark);
  const markW = marked ? MARK_R * 2 + 8 : 0;
  const labelW = labelled ? Math.min(W * 0.22, Math.max(...s.samples.map((x) => textWidth(x.sample, FS.small)), 0)) + 6 : 0;
  const L = PAD + markW + labelW, plotW = W - L - R;

  // positions along the axis: the whole genome end to end, or the zoomed stretch
  const offs: number[] = [];
  let total = 0;
  for (const c of s.chroms) { offs.push(total); total += c.length; }
  const zoom = s.region.chrom != null;
  const x = zoom
    ? (_c: number, bp: number) => L + (Math.min(Math.max(bp, s.region.start), s.region.end) - s.region.start) / Math.max(1, s.region.end - s.region.start) * plotW
    : (c: number, bp: number) => L + (offs[c] + Math.min(Math.max(bp, 0), s.chroms[c].length)) / total * plotW;

  const out: string[] = [];
  let y = 4;
  // what is drawn, and what the row limit left out — said above the rows, not only in the caption
  out.push(label(PAD, y + 12, fmtInt(n) + " of " + fmtInt(s.segmented) + " samples with segments · " + s.region.label + " · " + s.build,
    { size: FS.small, fill: p.muted, maxW: W - PAD - R }));
  y += 16;
  if (s.leftOut > 0) {
    out.push(label(PAD, y + 12, "Row limit " + fmtInt(s.rowsLimit) + ": " + fmtInt(s.leftOut) + " samples with segments are not drawn", { size: FS.body, weight: 600, fill: p.ink, maxW: W - PAD - R }));
    y += 18;
  }
  // a gene zoom marks the gene's own span above the rows
  if (s.region.gene) {
    const g = s.region.gene, gx0 = x(0, g.start), gx1 = Math.max(gx0 + 1, x(0, g.end));
    out.push(`<rect x="${r1(gx0)}" y="${y + 14}" width="${r1(gx1 - gx0)}" height="5" fill="${p.ink}"/>`);
    out.push(label((gx0 + gx1) / 2, y + 11, g.name, { size: FS.small, weight: 600, fill: p.ink, anchor: "middle" }));
    y += 22;
  }
  const top = y, PH = rowH * n;
  const inRegion = s.samples.map((x) => regionSegs(s, x.segs));
  const segCount = inRegion.reduce((k, x) => k + x.length / 4, 0);
  const tips = segCount <= SEG_TIPS_MAX;
  const chromName = (c: number) => "chr" + s.segChroms[c];
  /** without per-segment tips, every row's segments of one colour are one path */
  const byFill = new Map<string, string[]>();

  s.samples.forEach((smp, i) => {
    const ry = top + i * rowH;
    // the row: grey where no segment reaches (not measured, never copy-neutral), named on hover
    out.push(`<rect x="${L}" y="${r1(ry)}" width="${r1(plotW)}" height="${rowH}" fill="${OTHER}" opacity="0.35"><title>${esc(smp.sample + " — patient " + smp.patient +
      (smp.score != null ? "; mean log2 ratio over the region " + fmtNum(smp.score) : "; no segment in the region"))}</title></rect>`);
    // covered stretches in white (the neutral colour), merged where segments abut
    let run: [number, number] | null = null;
    const covered: string[] = [];
    const colored: string[] = [];
    let last: { x0: number; x1: number; fill: string } | null = null;
    const flush = () => {
      if (!last) return;
      const list = byFill.get(last.fill) || [];
      list.push(`M${r1(last.x0)} ${r1(ry)}h${r1(Math.max(1, last.x1 - last.x0))}v${rowH}h${r1(-Math.max(1, last.x1 - last.x0))}z`);
      byFill.set(last.fill, list);
      last = null;
    };
    const segs = inRegion[i];
    for (let k = 0; k < segs.length; k += 4) {
      const c = segs[k], st = segs[k + 1], en = segs[k + 2], m = segs[k + 3];
      const x0 = x(c, st), x1 = x(c, en);
      if (run && x0 - run[1] < 0.5) run[1] = Math.max(run[1], x1);
      else { if (run) covered.push(`M${r1(run[0])} ${r1(ry)}h${r1(Math.max(0.5, run[1] - run[0]))}v${rowH}h${r1(-Math.max(0.5, run[1] - run[0]))}z`); run = [x0, x1]; }
      if (Math.abs(m) <= SEGMENT_SCALE.neutral) { flush(); continue; }
      const fill = segmentColor(m);
      if (tips) {
        flush();
        colored.push(`<rect x="${r1(x0)}" y="${r1(ry)}" width="${r1(Math.max(1, x1 - x0))}" height="${rowH}" fill="${fill}"><title>${esc(smp.sample + " · " + chromName(c) + ":" +
          fmtInt(st) + "-" + fmtInt(en) + " · mean log2 ratio " + fmtNum(m))}</title></rect>`);
      } else if (last && last.fill === fill && x0 - last.x1 < 0.5) last.x1 = Math.max(last.x1, x1);
      else { flush(); last = { x0, x1, fill }; }
    }
    flush();
    if (run) covered.push(`M${r1(run[0])} ${r1(ry)}h${r1(Math.max(0.5, run[1] - run[0]))}v${rowH}h${r1(-Math.max(0.5, run[1] - run[0]))}z`);
    if (covered.length) out.push(`<path d="${covered.join("")}" fill="${segmentColor(0)}"/>`);
    out.push(...colored);
    if (labelled) out.push(label(L - 4, ry + rowH / 2 + FS.small * 0.35, ellipsize(smp.sample, labelW - 6, FS.small), { size: FS.small, fill: p.ink, anchor: "end" }));
    if (smp.mark && rowH >= MARK_R * 2 - 2) {
      const cx = PAD + MARK_R, cy = ry + rowH / 2;
      out.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${MARK_R}" fill="${smp.mark.color}"/>`);
      out.push(label(cx, cy + FS.small * 0.35, smp.mark.label, { size: FS.small, fill: textOn(smp.mark.color), anchor: "middle" }));
    }
  });
  for (const [fill, d] of byFill) out.push(`<path d="${d.join("")}" fill="${fill}"/>`);
  // chromosome boundaries (whole genome), or the gene's ends (a gene zoom), over the rows
  if (!zoom) {
    const d = s.chroms.slice(1).map((_, k) => `M${r1(x(k + 1, 0))} ${top}v${r1(PH)}`).join("");
    out.push(`<path d="${d}" stroke="${p.muted}" stroke-width="${SW.hair}" fill="none"/>`);
  } else if (s.region.gene) {
    const g = s.region.gene;
    out.push(`<path d="M${r1(x(0, g.start))} ${top}v${r1(PH)}M${r1(x(0, g.end))} ${top}v${r1(PH)}" stroke="${p.ink}" stroke-width="${SW.hair}" stroke-dasharray="3 3" fill="none"/>`);
  }
  out.push(`<rect x="${L}" y="${top}" width="${r1(plotW)}" height="${r1(PH)}" fill="none" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
  y = top + PH;

  // the axis under the rows
  if (!zoom) {
    const cl = chromLabels(s.chroms.map((c, k) => ({ c: c.c, mid: (x(k, 0) + x(k, c.length)) / 2 })), y + 2, p.muted);
    out.push(cl.svg);
    y += 2 + cl.height + 6;
  } else {
    const sc = linear(s.region.start, s.region.end, L, L + plotW, { count: Math.max(2, Math.floor(plotW / 110)), nice: false });
    out.push(axisBottom(sc, y, p, { fmt: fmtMb, minX: 0, maxX: W, title: "chromosome " + s.region.chrom + " (" + s.build + ")" }));
    y += 44;
  }

  // the colour scale: a strip from −1.5 to +1.5, and the grey of a stretch no segment reaches
  const barW = Math.min(240, plotW * 0.5), bx = L + textWidth("log2 ratio", FS.small) + 8, steps = 48, lo = -SEGMENT_SCALE.saturate, hi = SEGMENT_SCALE.saturate;
  out.push(label(L, y + 9, "log2 ratio", { size: FS.small, fill: p.muted }));
  for (let k = 0; k < steps; k++) {
    const v0 = lo + (hi - lo) * (k + 0.5) / steps;
    out.push(`<rect x="${r1(bx + k * barW / steps)}" y="${y}" width="${r1(barW / steps + 0.3)}" height="10" fill="${segmentColor(v0)}"/>`);
  }
  out.push(`<rect x="${r1(bx)}" y="${y}" width="${r1(barW)}" height="10" fill="none" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
  for (const t of [lo, 0, hi]) out.push(label(bx + (t - lo) / (hi - lo) * barW, y + 22, t === 0 ? "0" : (t > 0 ? "+" : "−") + fmtNum(Math.abs(t)), { size: FS.small, fill: p.muted, anchor: "middle" }));
  const lg = legend([{ label: "no segment here", color: OTHER, opacity: 0.35 }], bx + barW + 16, y - 4, Math.max(80, W - R - (bx + barW + 16)), p, { size: FS.small });
  out.push(lg.svg);
  y += 30;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, false,
    "Copy-number segments — " + fmtInt(n) + " samples, " + s.region.label);
}
