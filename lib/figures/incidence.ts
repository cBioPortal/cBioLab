// Incidence figure: cumulative incidence curves, with death as a competing risk.
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { Z_975 } from "../stats.ts";

export function incidenceSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.incidence!;
  const W = o.width || 760, L = 46, R = 14, T = 14, PH = 250;
  const curves = r.curves.filter((c) => c.points.length || c.n);
  const tLast = Math.max(12, ...curves.map((c) => c.points.length ? c.points[c.points.length - 1].t : 0));
  const tMax = Math.min(tLast, Math.max(...r.horizons.map((h) => h.months)) * 1.25);
  const step = tMax > 120 ? 24 : tMax > 60 ? 12 : 6;
  const peak = Math.max(0.05, ...curves.flatMap((c) => c.points.filter((q) => q.t <= tMax).map((q) => Math.max(q.f1 + Z_975 * q.se1, q.f2))));
  const tick = peak <= 0.2 ? 0.05 : peak <= 0.5 ? 0.1 : 0.2;
  const yTop = Math.min(1, Math.ceil(peak / tick - 1e-9) * tick);
  const x = (t: number) => L + (W - L - R) * Math.min(t, tMax) / tMax;
  const y = (f: number) => T + PH * (1 - f / yTop);
  const out: string[] = [];
  for (let k = 0; k * tick <= yTop + 1e-9; k++) {
    const f = k * tick;
    out.push(`<line x1="${L}" y1="${num(y(f))}" x2="${W - R}" y2="${num(y(f))}" stroke="${p.line}" stroke-width="1"/>` +
      `<text x="${L - 6}" y="${num(y(f) + 3)}" font-size="10" fill="${p.muted}" text-anchor="end">${Math.round(f * 100)}%</text>`);
  }
  for (let t = 0; t <= tMax + 1e-9; t += step)
    out.push(`<text x="${num(x(t))}" y="${T + PH + 14}" font-size="10" fill="${p.muted}" text-anchor="middle">${t}mo</text>`);
  curves.forEach((c, i) => {
    const col = SERIES[i % SERIES.length];
    const pts = c.points.filter((q) => q.t <= tMax);
    // the 95% band as a step polygon under the event curve
    if (pts.length) {
      let up = `M${num(x(0))} ${num(y(0))}`, lo = "";
      let pu = 0, pl = 0;
      for (const q of pts) {
        const u = Math.min(1, q.f1 + Z_975 * q.se1), l = Math.max(0, q.f1 - Z_975 * q.se1);
        up += ` L${num(x(q.t))} ${num(y(pu))} L${num(x(q.t))} ${num(y(u))}`; pu = u;
        lo = ` L${num(x(q.t))} ${num(y(l))} L${num(x(q.t))} ${num(y(pl))}` + lo; pl = l;
      }
      up += ` L${num(x(tMax))} ${num(y(pu))} L${num(x(tMax))} ${num(y(pl))}` + lo + " Z";
      out.push(`<path d="${up}" fill="${col}" opacity="0.13"/>`);
    }
    const stepPath = (key: "f1" | "f2") => {
      let d = `M${num(x(0))} ${num(y(0))}`, py = 0;
      for (const q of pts) { d += ` L${num(x(q.t))} ${num(y(py))} L${num(x(q.t))} ${num(y(q[key]))}`; py = q[key]; }
      return d + ` L${num(x(tMax))} ${num(y(py))}`;
    };
    out.push(`<path d="${stepPath("f2")}" fill="none" stroke="${col}" stroke-width="1.3" stroke-dasharray="4,3" opacity="0.7"/>`);
    out.push(`<path d="${stepPath("f1")}" fill="none" stroke="${col}" stroke-width="2"/>`);
  });
  let yy = T + PH + 30;
  out.push(`<text x="8" y="${yy}" font-size="10" fill="${p.muted}">solid: ${esc(r.eventLabel)} · dashed: death without it · band: 95%</text>`);
  yy += 18;
  // horizon table: estimate [CI] beside what 1 − KM would claim
  const colW = Math.min(200, (W - 150) / Math.max(1, curves.length));
  out.push(`<text x="8" y="${yy}" font-size="10" fill="${p.muted}">incidence by</text>`);
  curves.forEach((c, i) => out.push(`<text x="${150 + i * colW}" y="${yy}" font-size="10.5" font-weight="600" fill="${SERIES[i % SERIES.length]}">${esc(c.cohort)}</text>`));
  yy += 15;
  r.horizons.forEach((h) => {
    out.push(`<text x="8" y="${yy}" font-size="10.5" fill="${p.ink}">${h.months} months</text>`);
    h.cells.forEach((c, i) => out.push(`<text x="${150 + i * colW}" y="${yy}" font-size="10.5" fill="${p.ink}">${(100 * c.f1).toFixed(1)}%` +
      `<tspan fill="${p.muted}" font-size="9.5">&#160;[${(100 * c.lo).toFixed(1)}–${(100 * c.hi).toFixed(1)}] · 1−KM ${(100 * c.naive).toFixed(1)}%</tspan></text>`));
    yy += 15;
  });
  yy += 2;
  curves.forEach((c, i) => {
    out.push(`<text x="8" y="${yy}" font-size="10" fill="${p.muted}"><tspan fill="${SERIES[i % SERIES.length]}">${esc(c.cohort)}</tspan>` +
      `&#160;n=${fmt(c.n)}: ${fmt(c.events)} events, ${fmt(c.competing)} died first, ${fmt(c.censored)} censored` +
      ` · not at risk: ${fmt(c.excluded.prior)} already had it${c.excluded.unobserved ? ", " + fmt(c.excluded.unobserved) + " before observation" : ""}` +
      `${c.excluded.noAnchor ? ", " + fmt(c.excluded.noAnchor) + " no anchor event" : ""}${c.excluded.noFollowup ? ", " + fmt(c.excluded.noFollowup) + " no follow-up" : ""}</text>`);
    yy += 13;
  });
  if (r.gray) {
    yy += 3;
    const floor = r.gray.p <= 1 / (r.gray.permutations + 1) + 1e-12;
    out.push(`<text x="8" y="${yy}" font-size="10.5" fill="${p.ink}">Gray's test across ${r.gray.groups} cohorts: statistic ${num(r.gray.statistic)}, permutation ` +
      `${floor ? esc("p ≤ " + r.gray.p.toPrecision(2) + " (no shuffle of " + r.gray.permutations + " as extreme)") : esc(pFmt(r.gray.p)) + " (" + r.gray.permutations + " shuffles)"}</text>`);
    yy += 12;
  }
  const cap = caption(v.caveat || "", W, yy, p.muted);
  return frame(W, yy + cap.height + 10, out.join("") + cap.svg, p.bg);
}

