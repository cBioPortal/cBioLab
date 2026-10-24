import { r1, ROW, HEAD } from "../../figures/forest.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { SvgOpts } from "../../svg-kit.ts";
import { palette, fmtRatio, textWidth, FS, pDigits, log, label, SERIES, SW, axisBottom, bottomAxisHeight, caption, frame } from "../../svg-kit.ts";
import type { ForestPooled } from "./types.ts";

/**
 * The forest view: one row per stratum (n, events, HR [CI], its random-effects weight, the square
 * sized by that weight), then the fixed- and random-effects pools as diamonds.
 */
export function metaForestSvg(v: DrawnResultOf<"forest">, o: SvgOpts): string {
  const f = v.forest, W = Math.max(520, o.width || 760), p = palette(o.theme);
  const pools: [string, ForestPooled][] = [];
  if (f.random) pools.push(["Random effects (DerSimonian–Laird)", f.random]);
  if (f.fixed) pools.push(["Fixed effect", f.fixed]);
  const value = (x: { hr: number; ciLow: number; ciHigh: number }) => fmtRatio(x.hr) + " [" + fmtRatio(x.ciLow) + "–" + fmtRatio(x.ciHigh) + "]";
  const count = (r: { n: number; events: number }) => r.n.toLocaleString("en-US") + " (" + r.events.toLocaleString("en-US") + ")";
  const pct = (w: number) => (100 * w).toFixed(1) + "%";
  const labW = Math.min(W * 0.3, Math.max(textWidth(f.strata, FS.small), ...f.rows.map((r) => textWidth(r.label, FS.body)),
    ...pools.map(([l]) => textWidth(l, FS.body, 600) * 0.75)));
  const cntW = Math.max(textWidth("n (events)", FS.small), ...f.rows.map((r) => textWidth(count(r), FS.body)));
  const valW = Math.max(textWidth("HR [95% CI]", FS.small), ...f.rows.map((x) => textWidth(value(x), FS.body)), ...pools.map(([, x]) => textWidth(value(x), FS.body, 600)));
  const wW = pools.length ? Math.max(textWidth("weight / p", FS.small), textWidth("100.0%", FS.body), ...pools.map(([, x]) => textWidth(pDigits(x.p), FS.body))) : 0;
  const cntR = 8 + labW + 12 + cntW, L = cntR + 16;
  const wR = W - 8, valL = wR - (wW ? wW + 14 : 0) - valW, R = valL - 14;
  const all = [...f.rows, ...pools.map(([, x]) => x)];
  const est = all.map((c) => c.hr).filter((r) => Number.isFinite(r) && r > 0);
  const eLo = Math.min(1, ...est), eHi = Math.max(1, ...est);
  const ci = all.flatMap((c) => [c.ciLow, c.ciHigh]).filter((r) => Number.isFinite(r) && r > 0).map((r) => Math.min(eHi * 4, Math.max(eLo / 4, r)));
  const xs = log(Math.min(eLo, ...ci) * 0.9, Math.max(eHi, ...ci) * 1.1, L, R, { nice: false });
  const [d0, d1] = xs.domain;
  const at = (r: number) => r1(xs(Math.min(d1, Math.max(d0, r))));
  let offScale = 0;
  const out: string[] = [];
  out.push(label(8, 14, f.strata, { size: FS.small, fill: p.muted }));
  out.push(label(cntR, 14, "n (events)", { size: FS.small, fill: p.muted, anchor: "end" }));
  out.push(label(valL, 14, "HR [95% CI]", { size: FS.small, fill: p.muted }));
  if (wW) out.push(label(wR, 14, "weight / p", { size: FS.small, fill: p.muted, anchor: "end" }));
  let y = HEAD;
  const top = y, maxW = Math.max(...f.rows.map((r) => r.weight), 1e-9);
  const interval = (lo: number, hi: number, cy: number) => {
    const a = Math.max(lo, d0), b = Math.min(hi, d1);
    if (b > a) out.push(`<line x1="${r1(xs(a))}" y1="${cy}" x2="${r1(xs(b))}" y2="${cy}" stroke="${SERIES[0]}" stroke-width="${SW.series}"/>`);
    for (const [past, x, dir] of [[lo < d0, xs(d0), -1], [hi > d1, xs(d1), 1]] as [boolean, number, number][]) {
      if (!past) continue;
      offScale++;
      out.push(`<path d="M${r1(x)} ${cy} l${-dir * 6} -4 v8 Z" fill="${SERIES[0]}"/>`);
    }
  };
  f.rows.forEach((r, i) => {
    const cy = y + ROW / 2, ty = cy + FS.body * 0.35;
    if (i % 2 === 0) out.push(`<rect x="4" y="${y}" width="${W - 8}" height="${ROW}" fill="${p.line}" opacity="0.35"/>`);
    out.push(label(8, ty, r.label, { size: FS.body, fill: p.ink, maxW: labW }));
    out.push(label(cntR, ty, count(r), { size: FS.body, fill: p.ink, anchor: "end" }));
    interval(r.ciLow, r.ciHigh, cy);
    const s = pools.length ? 4 + 5 * Math.sqrt(r.weight / maxW) : 8;
    out.push(`<rect x="${r1(at(r.hr) - s / 2)}" y="${r1(cy - s / 2)}" width="${r1(s)}" height="${r1(s)}" fill="${SERIES[0]}"/>`);
    out.push(label(valL, ty, value(r), { size: FS.body, fill: p.ink }));
    if (wW) out.push(label(wR, ty, pct(r.weight), { size: FS.body, fill: p.muted, anchor: "end" }));
    y += ROW;
  });
  if (pools.length) {
    out.push(`<line x1="4" y1="${y + 4}" x2="${W - 4}" y2="${y + 4}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    y += 8;
    for (const [name, x] of pools) {
      const cy = y + ROW / 2, ty = cy + FS.body * 0.35;
      out.push(label(8, ty, name, { size: FS.body, fill: p.ink, weight: 600, maxW: cntR - 8 }));
      const a = at(x.ciLow), b = at(x.ciHigh), m = at(x.hr);
      out.push(`<path d="M${a} ${cy} L${m} ${cy - 6} L${b} ${cy} L${m} ${cy + 6} Z" fill="${SERIES[1]}"/>`);
      out.push(label(valL, ty, value(x), { size: FS.body, fill: p.ink, weight: 600 }));
      out.push(label(wR, ty, pDigits(x.p), { size: FS.body, fill: x.p < 0.05 ? p.ink : p.muted, anchor: "end" }));
      y += ROW;
    }
  }
  out.push(`<line x1="${r1(xs(1))}" y1="${top - 4}" x2="${r1(xs(1))}" y2="${y}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
  const axTitle = "HR for " + f.exposedLabel + " (log scale) — right of 1 is worse " + f.endpoint;
  out.push(axisBottom(xs, y + 4, p, { title: axTitle, minX: L - 20, maxX: R + 20 }));
  y += 4 + bottomAxisHeight(axTitle) + 6;
  const cap = caption((pools.length ? "Rows' last column is their weight in the random-effects pool; the pooled rows' is their p. " : "") + (v.caveat || "") + (offScale ? " " + offScale + " interval end" + (offScale === 1 ? " runs" : "s run") + " past the axis and " +
    (offScale === 1 ? "is" : "are") + " drawn as an arrow; the numbers beside it are exact." : ""), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, false, "Forest plot — " + f.exposedLabel + " by " + f.strata);
}
