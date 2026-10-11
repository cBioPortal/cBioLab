// Genome figure: copy-number gain and loss frequency along the genome, per cohort.
import { esc, SERIES, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { CN_GAIN, CN_LOSS } from "./common.ts";

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

