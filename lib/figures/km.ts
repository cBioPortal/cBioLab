// A Kaplan–Meier panel several figures draw: step curves, one per group, the number still at risk
// under each tick, and a legend with each group's detail. Positioned at (0, y0) and `W` wide;
// returns its drawing and height, so a figure stacks it with its own parts.
import type { KmPoint } from "../types.ts";
import { stepPath, r1 } from "../chart/marks.ts";
import { plotHeight, type Pal } from "./common.ts";
import {
  linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, legend, timeScale,
  seriesStyle, fmtInt, fmtNum, label, textWidth, esc, FS, SW,
} from "../svg-kit.ts";

export interface KmPanelCurve {
  name: string; points: KmPoint[];
  /** the number at risk at each whole month from 0 */
  atRisk?: number[];
  /** the legend's detail line (median, n, events) */
  detail: string;
}

/** `shadeTo`: the area under each curve from 0 to that time is shaded (a restricted mean), with a rule at it */
export function kmPanel(curves: KmPanelCurve[], o: { y0: number; W: number; p: Pal; xTitle: string; yTitle?: string; tMax?: number; title?: string; shadeTo?: number }):
  { svg: string; height: number } {
  const { y0, W, p } = o;
  const out: string[] = [];
  let T = y0 + 12;
  if (o.title) { out.push(label(8, y0 + FS.title, o.title, { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 })); T += FS.title + 6; }
  const R = 16, PLOT = plotHeight(W);
  const yTitle = o.yTitle || "Probability";
  const ys = linear(0, 1, T + PLOT, T, { nice: false });
  ys.ticks = [0, 0.25, 0.5, 0.75, 1];
  const yFmt = (t: number) => Math.round(t * 100) + "%";
  const risk = curves.length > 0 && curves.every((c) => Array.isArray(c.atRisk));
  const nameW = risk ? Math.min(W * 0.14, 180, Math.max(...curves.map((c) => textWidth(c.name, FS.small)))) : 0;
  const L = Math.max(8 + leftAxisWidth(ys, yTitle, yFmt), risk ? 8 + 20 + nameW + 10 : 0);
  const tMax = o.tMax ?? Math.max(1, ...curves.flatMap((c) => c.points.map((q) => q.t)), ...curves.map((c) => (c.atRisk?.length || 1) - 1));
  const widest = risk ? Math.max(...curves.map((c) => textWidth(fmtInt(c.atRisk![0] || 0), FS.small))) : 0;
  const xs = timeScale(0, tMax, L, W - R, { minGap: widest });
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: W - R, fmt: yFmt }));
  out.push(axisBottom(xs, T + PLOT, p, { title: o.xTitle, minX: 0, maxX: W, fmt: (t) => fmtNum(t) }));
  if (o.shadeTo != null) {
    const tau = Math.min(o.shadeTo, tMax);
    curves.forEach((c, i) => {
      const line = stepPath(c.points.filter((q) => q.t <= tau), xs, ys, { t: 0, s: 1 }, tau);
      out.push(`<path d="${line}V${r1(ys(0))}H${r1(xs(0))}Z" fill="${seriesStyle(i).color}" opacity="${r1(0.12 * seriesStyle(i).tint * 100) / 100}"/>`);
    });
    out.push(`<line x1="${r1(xs(tau))}" y1="${r1(T)}" x2="${r1(xs(tau))}" y2="${r1(T + PLOT)}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="4 3"/>`);
    const tl = "τ = " + fmtNum(tau);
    const tx = xs(tau) + 4 + textWidth(tl, FS.small) <= W - R ? xs(tau) + 4 : xs(tau) - 4 - textWidth(tl, FS.small);
    out.push(label(tx, T + FS.small, tl, { size: FS.small, fill: p.muted }));
  }
  curves.forEach((c, i) => {
    const st = seriesStyle(i);
    out.push(`<path d="${stepPath(c.points.filter((q) => q.t <= tMax), xs, ys, { t: 0, s: 1 }, tMax)}" fill="none" stroke="${st.color}" stroke-width="${SW.series}"` +
      (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + ` stroke-linejoin="round"/>`);
  });
  let y = T + PLOT + bottomAxisHeight(o.xTitle) + 10;
  if (risk) {
    const ROW = Math.round(FS.small * 1.6);
    const at = (c: KmPanelCurve, t: number) => { const a = c.atRisk!; const m = Math.round(t); return m < a.length ? a[m] : 0; };
    const wid = Math.max(...curves.flatMap((c) => xs.ticks.map((t) => textWidth(fmtInt(at(c, t)), FS.small))));
    const gap = xs.ticks.length > 1 ? xs(xs.ticks[1]) - xs(xs.ticks[0]) : Infinity;
    const every = Math.max(1, Math.ceil((wid + 6) / gap));
    out.push(label(8, y + FS.small, "Number at risk", { size: FS.small, fill: p.muted, weight: 600 }));
    curves.forEach((c, i) => {
      const st = seriesStyle(i), cy = y + ROW * (i + 1) + ROW / 2, ty = cy + FS.small * 0.35;
      out.push(`<line x1="8" y1="${cy}" x2="24" y2="${cy}" stroke="${st.color}" stroke-width="${SW.series}"` + (st.dash ? ` stroke-dasharray="${st.dash}"` : "") + `/>`);
      out.push(label(28, ty, c.name, { size: FS.small, fill: p.ink, maxW: nameW }));
      xs.ticks.forEach((t, k) => {
        if (k % every) return;
        const text = fmtInt(at(c, t)), w = textWidth(text, FS.small), x = xs(t);
        const left = Math.min(Math.max(x - w / 2, L - 4), W - 4 - w);
        out.push(`<text x="${Math.round(left * 10) / 10}" y="${Math.round(ty * 10) / 10}" font-size="${FS.small}" fill="${p.muted}">` +
          `<title>${esc(c.name + ": " + text + " at risk at " + fmtNum(t) + " months")}</title>${text}</text>`);
      });
    });
    y += ROW * (curves.length + 1) + 8;
  }
  const lg = legend(curves.map((c, i) => ({ label: c.name, color: seriesStyle(i).color, dash: seriesStyle(i).dash, kind: "line" as const, detail: c.detail })),
    8, y, W - 16, p, { grid: true });
  out.push(lg.svg);
  y += lg.height + 4;
  return { svg: out.join(""), height: y - y0 };
}
