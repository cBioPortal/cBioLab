// Labs figure: a lab value's course from a treatment start, and the response waterfall.
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";

/** The labs course draws a bin only from this many patients; the engine's caption says so. */
export const LAB_MIN_POINT_N = 5;

export function labsSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.labs!;
  const W = o.width || 960, CW = 470, L = 46, T = 22, PH = 250;
  const out: string[] = [];
  // the course: median and interquartile band of % change, per cohort
  const yLo = -100, yHi = Math.min(300, Math.max(50, Math.ceil(Math.max(0, ...r.panels.flatMap((pn) => pn.course.map((c) => c.q3 ?? 0))) / 50) * 50));
  const x = (w: number) => L + (CW - L - 10) * (w - r.fromWeeks) / (r.toWeeks - r.fromWeeks);
  const y = (pc: number) => T + PH * (yHi - Math.max(yLo, Math.min(yHi, pc))) / (yHi - yLo);
  out.push(`<text x="${L}" y="12" font-size="10.5" fill="${p.muted}">${esc(r.test)}, % change from baseline · weeks from ${esc(r.anchoredTo)}</text>`);
  for (let pc = yLo; pc <= yHi; pc += 50) {
    out.push(`<line x1="${L}" y1="${num(y(pc))}" x2="${CW - 10}" y2="${num(y(pc))}" stroke="${p.line}" stroke-width="${pc === 0 ? 1.2 : 0.6}"/>` +
      `<text x="${L - 5}" y="${num(y(pc) + 3)}" font-size="9.5" fill="${p.muted}" text-anchor="end">${pc > 0 ? "+" : ""}${pc}%</text>`);
  }
  out.push(`<line x1="${L}" y1="${num(y(-r.responseDrop))}" x2="${CW - 10}" y2="${num(y(-r.responseDrop))}" stroke="${p.muted}" stroke-dasharray="4,3"/>` +
    `<text x="${CW - 12}" y="${num(y(-r.responseDrop) - 3)}" font-size="9" fill="${p.muted}" text-anchor="end">−${r.responseDrop}%</text>`);
  out.push(`<line x1="${num(x(0))}" y1="${T}" x2="${num(x(0))}" y2="${T + PH}" stroke="${p.ink}" stroke-width="0.8" stroke-dasharray="2,2"/>`);
  const wStep = r.toWeeks - r.fromWeeks > 104 ? 26 : 12;
  for (let w = Math.ceil(r.fromWeeks / wStep) * wStep; w <= r.toWeeks; w += wStep)
    out.push(`<text x="${num(x(w))}" y="${T + PH + 13}" font-size="9.5" fill="${p.muted}" text-anchor="middle">${w}w</text>`);
  r.panels.forEach((pn, i) => {
    const col = SERIES[i % SERIES.length];
    const pts = pn.course.filter((c) => c.median != null && c.n >= LAB_MIN_POINT_N);
    if (!pts.length) return;
    const mid = (c: typeof pts[number]) => x(c.week + r.binWeeks / 2);
    const band = "M" + pts.map((c) => num(mid(c)) + " " + num(y(c.q3!))).join(" L") + " L" + [...pts].reverse().map((c) => num(mid(c)) + " " + num(y(c.q1!))).join(" L") + " Z";
    out.push(`<path d="${band}" fill="${col}" opacity="0.15"/>`);
    out.push(`<path d="M${pts.map((c) => num(mid(c)) + " " + num(y(c.median!))).join(" L")}" fill="none" stroke="${col}" stroke-width="2"/>`);
    for (const c of pts) out.push(`<circle cx="${num(mid(c))}" cy="${num(y(c.median!))}" r="2.2" fill="${col}"/>`);
  });
  // waterfall of best response per cohort (a histogram of it when values were withheld)
  const WX = CW + 30, WW = W - WX - 10, panelH = Math.floor((PH - 10 * (r.panels.length - 1)) / r.panels.length);
  out.push(`<text x="${WX}" y="12" font-size="10.5" fill="${p.muted}">best % change after the start, worst to best (bars clipped at ±100%)</text>`);
  r.panels.forEach((pn, i) => {
    const col = SERIES[i % SERIES.length], head = T + i * (panelH + 10), top = head + 16, bodyH = panelH - 16;
    const yw = (pc: number) => top + bodyH * (100 - Math.max(-100, Math.min(100, pc))) / 200;
    out.push(`<line x1="${WX}" y1="${num(yw(0))}" x2="${WX + WW}" y2="${num(yw(0))}" stroke="${p.muted}" stroke-width="0.8"/>` +
      `<line x1="${WX}" y1="${num(yw(-r.responseDrop))}" x2="${WX + WW}" y2="${num(yw(-r.responseDrop))}" stroke="${p.muted}" stroke-dasharray="3,3" stroke-width="0.7"/>`);
    const rate = pn.evaluable ? (100 * pn.responders / pn.evaluable).toFixed(1) + "%" : "—";
    out.push(`<text x="${WX}" y="${head + 10}" font-size="10.5" font-weight="600" fill="${col}">${esc(pn.cohort)}` +
      `<tspan dx="6" font-weight="400" fill="${p.ink}">${rate} fell ≥${r.responseDrop}% (${fmt(pn.responders)}/${fmt(pn.evaluable)})</tspan></text>`);
    if (pn.waterfall && pn.waterfall.length) {
      const vals = [...pn.waterfall].sort((a, b) => b - a), bw = WW / vals.length;
      let d = "";
      vals.forEach((val, k) => {
        const y0 = yw(0), y1 = yw(val);
        d += `M${num(WX + k * bw)} ${num(Math.min(y0, y1))}h${num(Math.max(bw, 0.5))}v${num(Math.abs(y1 - y0))}h${num(-Math.max(bw, 0.5))}z`;
      });
      out.push(`<path d="${d}" fill="${col}" opacity="0.85"/>`);
    } else {
      const max = Math.max(1, ...pn.best), bw = WW / pn.best.length;
      let d = "";
      pn.best.forEach((c, k) => { if (c) { const hh = (bodyH - 4) * c / max; d += `M${num(WX + k * bw)} ${num(top + bodyH)}v${num(-hh)}h${num(bw)}v${num(hh)}z`; } });
      out.push(`<path d="${d}" fill="${col}" opacity="0.8"/><text x="${WX + WW}" y="${head + 10}" font-size="9" fill="${p.muted}" text-anchor="end">histogram, −100 → +300%</text>`);
    }
  });
  let yy = T + PH + 30;
  r.panels.forEach((pn, i) => {
    out.push(`<rect x="8" y="${yy - 9}" width="9" height="9" rx="2" fill="${SERIES[i % SERIES.length]}"/>` +
      `<text x="22" y="${yy}" font-size="10.5" fill="${p.ink}">${esc(pn.cohort)}<tspan dx="4" fill="${p.muted}">· ${fmt(pn.anchored)} started, ${fmt(pn.baseline)} with a baseline, ${fmt(pn.evaluable)} measured after</tspan></text>`);
    yy += 15;
  });
  if (r.responseP != null) { out.push(`<text x="8" y="${yy}" font-size="10.5" fill="${p.ink}">response rates differ: Fisher ${esc(pFmt(r.responseP))}</text>`); yy += 14; }
  const cap = caption(v.caveat || "", W, yy, p.muted);
  return frame(W, yy + cap.height + 10, out.join("") + cap.svg, p.bg);
}
