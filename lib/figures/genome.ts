// Genome figure: copy-number gain and loss frequency along the genome, per cohort.
import {
  palette, frame, caption, linear, axisLeft, leftAxisWidth, legend, label, textWidth,
  fmtInt, fmtNum, FS, SW, SERIES, type SvgOpts, type LegendItem
} from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { CN_GAIN, CN_LOSS } from "./common.ts";

const PAD = 8, R = 10, HEAD = 18, GAP = 14, STRIP = 10;
const Y_TITLE = "% of samples";

/**
 * Chromosome names under the plot, centred on their extent. A name that would touch the one
 * before it drops to a second row rather than being left out or overprinted.
 */
export function chromLabels(chrom: { c: string; mid: number }[], y: number, fill: string): { svg: string; height: number } {
  const out: string[] = [];
  const lastRight = [-Infinity, -Infinity];
  let rows = 1;
  for (const c of chrom) {
    const w = textWidth(c.c, FS.small), left = c.mid - w / 2;
    const row = left >= lastRight[0] + 3 ? 0 : left >= lastRight[1] + 3 ? 1 : -1;
    if (row < 0) {
      // no room in either row: still drawn, in the row that ends first, so every chromosome is named
      const r = lastRight[0] <= lastRight[1] ? 0 : 1;
      lastRight[r] = left + w; rows = Math.max(rows, r + 1);
      out.push(label(c.mid, y + FS.small + r * (FS.small + 3), c.c, { size: FS.small, fill, anchor: "middle" }));
      continue;
    }
    lastRight[row] = left + w; rows = Math.max(rows, row + 1);
    out.push(label(c.mid, y + FS.small + row * (FS.small + 3), c.c, { size: FS.small, fill, anchor: "middle" }));
  }
  return { svg: out.join(""), height: rows * (FS.small + 3) + 2 };
}

export function genomeSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), g = v.genome!;
  const W = Math.max(480, o.width || 960);
  const PH = Math.round(Math.max(96, Math.min(150, W * 0.12)));
  const n = g.bins.length;
  const pctOf = (k: number, d: number) => d ? 100 * k / d : 0;
  let top = 5;
  for (const s of g.series) for (let i = 0; i < n; i++)
    top = Math.max(top, pctOf(s.gain[i], s.profiled[i]), pctOf(s.loss[i], s.profiled[i]));
  top = Math.min(100, top);
  // one scale for every cohort, so their panels compare at a glance
  const yFmt = (t: number) => t === 0 ? "0" : (t > 0 ? "+" : "−") + fmtNum(Math.abs(t)) + "%";
  const probe = linear(-top, top, PH, 0, { count: 4, nice: false });
  const testLabels = g.test ? ["gain differs", "loss differs"] : [];
  const L = PAD + Math.max(leftAxisWidth(probe, Y_TITLE, yFmt), ...testLabels.map((t) => textWidth(t, FS.small) + 6));
  const plotW = W - L - R, bw = plotW / Math.max(1, n);
  const x = (i: number) => L + i * bw;
  const chrom: { c: string; i0: number; i1: number }[] = [];
  g.bins.forEach((b, i) => {
    const last = chrom[chrom.length - 1];
    if (last && last.c === b.chrom) last.i1 = i + 1; else chrom.push({ c: b.chrom, i0: i, i1: i + 1 });
  });

  const out: string[] = [];
  let y0 = 4;
  for (const s of g.series) {
    const head = s.cohort, hw = Math.min(textWidth(head, FS.title, 600), plotW * 0.6);
    out.push(label(L, y0 + 13, head, { size: FS.title, weight: 600, fill: p.ink, maxW: plotW * 0.6 }));
    out.push(label(L + hw + 8, y0 + 13, fmtInt(s.segmented) + " segmented samples", { size: FS.small, fill: p.muted, maxW: plotW - hw - 8 }));
    const tp = y0 + HEAD, ys = linear(-top, top, tp + PH, tp, { count: 4, nice: false }), mid = ys(0);
    chrom.forEach((c, k) => {
      if (k % 2) out.push(`<rect x="${r1(x(c.i0))}" y="${tp}" width="${r1((c.i1 - c.i0) * bw)}" height="${PH}" fill="${p.line}" opacity="0.45"/>`);
    });
    out.push(axisLeft(ys, L, p, { title: Y_TITLE, gridTo: W - R, fmt: yFmt }));
    // one path per direction: bins without a measured sample draw nothing (not zero)
    const area = (k: "gain" | "loss", sign: 1 | -1): string => {
      let d = "";
      for (let i = 0; i < n; i++) {
        if (!s.profiled[i]) continue;
        const v = pctOf(s[k][i], s.profiled[i]);
        if (v <= 0) continue;
        const hh = mid - ys(v);
        d += `M${r1(x(i))} ${r1(mid)}v${r1(-sign * hh)}h${r1(bw)}v${r1(sign * hh)}z`;
      }
      return d;
    };
    out.push(`<path d="${area("gain", 1)}" fill="${CN_GAIN}" opacity="0.85"/>`);
    out.push(`<path d="${area("loss", -1)}" fill="${CN_LOSS}" opacity="0.85"/>`);
    out.push(`<line x1="${L}" y1="${r1(mid)}" x2="${W - R}" y2="${r1(mid)}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    // unmeasured bins are shaded grey rather than read as copy-neutral
    let gapD = "";
    for (let i = 0; i < n; i++) if (!s.profiled[i]) gapD += `M${r1(x(i))} ${tp}h${r1(bw)}v${PH}h${r1(-bw)}z`;
    if (gapD) out.push(`<path d="${gapD}" fill="${p.muted}" opacity="0.18"/>`);
    y0 = tp + PH + GAP;
  }
  const cl = chromLabels(chrom.map((c) => ({ c: c.c, mid: x((c.i0 + c.i1) / 2) })), y0 - GAP + 3, p.muted);
  out.push(cl.svg);
  let y = y0 - GAP + 3 + cl.height + 8;
  if (g.test) {
    const rows: [string, (number | null)[], "gain" | "loss"][] = [["gain differs", g.test.gainQ, "gain"], ["loss differs", g.test.lossQ, "loss"]];
    const [A, B] = g.series;
    rows.forEach(([name, q, k]) => {
      out.push(label(L - 6, y + STRIP / 2 + FS.small * 0.35, name, { size: FS.small, fill: p.muted, anchor: "end" }));
      out.push(`<rect x="${L}" y="${y}" width="${r1(plotW)}" height="${STRIP}" fill="${p.line}" opacity="0.5"/>`);
      const d: string[] = ["", ""];
      for (let i = 0; i < n; i++) {
        if (q[i] == null || q[i]! >= 0.05) continue;
        const higherA = pctOf(A[k][i], A.profiled[i]) > pctOf(B[k][i], B.profiled[i]);
        d[higherA ? 0 : 1] += `M${r1(x(i))} ${y}h${r1(bw)}v${STRIP}h${r1(-bw)}z`;
      }
      if (d[0]) out.push(`<path d="${d[0]}" fill="${SERIES[0]}"/>`);
      if (d[1]) out.push(`<path d="${d[1]}" fill="${SERIES[1]}"/>`);
      y += STRIP + 3;
    });
    y += 6;
    const lgq = legend([{ label: A.cohort, color: SERIES[0] }, { label: B.cohort, color: SERIES[1] }], L, y, W - L - R, p,
      { size: FS.small, title: "q < 0.05, higher in:" });
    out.push(lgq.svg);
    y += lgq.height;
  }
  const items: LegendItem[] = [{ label: "gained", color: CN_GAIN, opacity: 0.85 }, { label: "lost", color: CN_LOSS, opacity: 0.85 },
    { label: "no segment covers this bin", color: p.muted, opacity: 0.3 }];
  const lg = legend(items, L, y, W - L - R, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 2;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, false, "Genome-wide copy number — " + g.series.map((s) => s.cohort).join(", "));
}

const r1 = (n: number) => Math.round(n * 10) / 10;
