// Differential expression figure: a volcano of every gene, and the GSEA gene sets.
import { esc, SERIES, palette, num, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { qFmt } from "./common.ts";

export function diffexprSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), d = v.diffexpr!;
  const W0 = o.width || 960, W = W0;
  const hasGsea = !!(d.gsea && d.gsea.sets.length);
  const VW = hasGsea ? 470 : W - 20, VL = 50, VT = 26, VH = 330;
  const plotW = VW - VL - 10;
  const { xMax, yMax, nx, ny } = d.grid;
  const X = (e: number) => VL + plotW * (e + xMax) / (2 * xMax);
  const Y = (lp: number) => VT + VH * (1 - lp / yMax);
  const lp = (pv: number) => -Math.log10(Math.max(1e-300, pv));
  const out: string[] = [];
  const [A, B] = d.groups;
  out.push(`<text x="${VL}" y="14" font-size="10.5" fill="${p.muted}">${esc(d.tested.toLocaleString("en-US"))} genes · ` +
    `<tspan fill="${SERIES[0]}">${d.up.toLocaleString("en-US")} higher in ${esc(A)}</tspan> · ` +
    `<tspan fill="${SERIES[1]}">${d.down.toLocaleString("en-US")} higher in ${esc(B)}</tspan> (q &lt; 0.05)</text>`);
  // axes
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const yy = VT + VH * (1 - f);
    out.push(`<line x1="${VL}" y1="${num(yy)}" x2="${VL + plotW}" y2="${num(yy)}" stroke="${p.line}" stroke-width="0.6"/>`);
    out.push(`<text x="${VL - 4}" y="${num(yy + 3)}" font-size="9" fill="${p.muted}" text-anchor="end">${num(yMax * f)}</text>`);
  }
  for (const f of [-1, -0.5, 0, 0.5, 1]) {
    const xx = X(f * xMax);
    out.push(`<line x1="${num(xx)}" y1="${VT}" x2="${num(xx)}" y2="${VT + VH}" stroke="${p.line}" stroke-width="${f === 0 ? 1 : 0.6}"/>`);
    out.push(`<text x="${num(xx)}" y="${VT + VH + 12}" font-size="9" fill="${p.muted}" text-anchor="middle">${num(f * xMax)}</text>`);
  }
  out.push(`<text x="${VL + plotW / 2}" y="${VT + VH + 26}" font-size="10" fill="${p.muted}" text-anchor="middle">${esc(d.effectLabel)} (${esc(A)} − ${esc(B)})</text>`);
  out.push(`<text x="12" y="${VT + VH / 2}" font-size="10" fill="${p.muted}" text-anchor="middle" transform="rotate(-90 12 ${VT + VH / 2})">−log10 p</text>`);
  // density of everything not drawn as a point
  const cw = plotW / nx, ch = VH / ny;
  const maxC = Math.max(1, ...d.grid.cells.map((c) => c[2]));
  let dens = "";
  for (const [bx, by, c, cls] of d.grid.cells) {
    const op = 0.12 + 0.6 * Math.log1p(c) / Math.log1p(maxC);
    const col = cls === 1 ? SERIES[0] : cls === 2 ? SERIES[1] : p.muted;
    dens += `<rect x="${num(VL + bx * cw)}" y="${num(VT + VH - (by + 1) * ch)}" width="${num(cw + 0.3)}" height="${num(ch + 0.3)}" fill="${col}" opacity="${num(op)}"/>`;
  }
  out.push(dens);
  // the significant genes, coloured by direction
  let dots = "";
  for (const g of d.points) {
    const col = g.q < 0.05 ? (g.effect > 0 ? SERIES[0] : SERIES[1]) : p.muted;
    dots += `<circle cx="${num(X(g.effect))}" cy="${num(Y(lp(g.p)))}" r="1.8" fill="${col}" opacity="0.75"/>`;
  }
  out.push(dots);
  // labels: placed beside their point, nudged down when they would overlap the previous one
  const placed: { x: number; y: number }[] = [];
  for (const name of d.labels) {
    const g = d.points.find((x) => x.gene === name);
    if (!g) continue;
    const px = X(g.effect), py = Y(lp(g.p));
    let ly = py - 4;
    while (placed.some((q) => Math.abs(q.y - ly) < 10 && Math.abs(q.x - px) < 60)) ly += 10;
    placed.push({ x: px, y: ly });
    const right = px < VL + plotW * 0.75;
    out.push(`<circle cx="${num(px)}" cy="${num(py)}" r="2.6" fill="none" stroke="${p.ink}" stroke-width="0.8"/>` +
      `<text x="${num(px + (right ? 5 : -5))}" y="${num(ly)}" font-size="9.5" fill="${p.ink}" text-anchor="${right ? "start" : "end"}">${esc(name)}</text>`);
  }
  let bottom = VT + VH + 34;
  if (hasGsea) {
    const gx = VW + 24, gw = W - gx - 10;
    const sets = d.gsea!.sets;
    const shown = sets.slice(0, 12);
    out.push(`<text x="${gx}" y="14" font-size="10.5" fill="${p.muted}">gene-set enrichment (preranked GSEA, ${d.gsea!.permutations} permutations)</text>`);
    const nesMax = Math.max(1, ...shown.map((x) => Math.abs(x.nes)));
    const BAR_X = gx + 210, BAR_W = gw - 210 - 70, mid = BAR_X + BAR_W / 2;
    shown.forEach((x, i) => {
      const y = 30 + i * 17;
      const nm = x.name.replace(/^HALLMARK_/, "").replace(/_/g, " ").toLowerCase();
      out.push(`<text x="${gx}" y="${y + 9}" font-size="9.5" fill="${x.q < 0.05 ? p.ink : p.muted}">${esc(nm.length > 36 ? nm.slice(0, 35) + "…" : nm)}</text>`);
      const w = BAR_W / 2 * Math.abs(x.nes) / nesMax;
      out.push(`<rect x="${num(x.nes >= 0 ? mid : mid - w)}" y="${y}" width="${num(w)}" height="11" rx="2" fill="${x.nes >= 0 ? SERIES[0] : SERIES[1]}" opacity="${x.q < 0.05 ? 0.9 : 0.35}"/>`);
      out.push(`<text x="${BAR_X + BAR_W + 6}" y="${y + 9}" font-size="9" fill="${p.muted}">${num(x.nes)} · ${esc(qFmt(x.q))}</text>`);
    });
    out.push(`<line x1="${mid}" y1="26" x2="${mid}" y2="${30 + shown.length * 17}" stroke="${p.muted}" stroke-width="0.8"/>`);
    let y = 30 + shown.length * 17 + 8;
    if (sets.length > shown.length)
      out.push(`<text x="${gx}" y="${y + 6}" font-size="9" fill="${p.muted}">+${sets.length - shown.length} more sets tested (${sets.filter((x) => x.q < 0.05).length} of ${sets.length} at q &lt; 0.05)</text>`);
    y += 18;
    // running-sum curves: the strongest set in each direction
    const best = [sets.find((x) => x.nes > 0), sets.find((x) => x.nes < 0)].filter(Boolean) as typeof sets;
    const CH = 70, n = d.tested;
    best.forEach((x, k) => {
      const top = y + k * (CH + 44);
      const nm = x.name.replace(/^HALLMARK_/, "").replace(/_/g, " ").toLowerCase();
      out.push(`<text x="${gx}" y="${top + 9}" font-size="10" fill="${p.ink}">${esc(nm)}<tspan dx="6" fill="${p.muted}" font-size="9">ES ${num(x.es)}, ${x.leadingEdge.length} leading-edge genes</tspan></text>`);
      const py0 = top + 14, cx = (i: number) => gx + gw * i / Math.max(1, n - 1);
      const lo = Math.min(0, ...x.curve), hi = Math.max(0, ...x.curve), span = hi - lo || 1;
      const cy = (v: number) => py0 + CH * (hi - v) / span;
      out.push(`<line x1="${gx}" y1="${num(cy(0))}" x2="${gx + gw}" y2="${num(cy(0))}" stroke="${p.line}"/>`);
      out.push(`<path d="M${x.curve.map((v, i) => num(cx(x.curveAt[i])) + " " + num(cy(v))).join(" L")}" fill="none" stroke="${x.nes >= 0 ? SERIES[0] : SERIES[1]}" stroke-width="1.5"/>`);
      let ticks = "";
      for (const h of x.hits) ticks += `M${num(cx(h))} ${py0 + CH + 3}v7`;
      out.push(`<path d="${ticks}" stroke="${p.ink}" stroke-width="0.5"/>`);
      out.push(`<text x="${gx}" y="${py0 + CH + 22}" font-size="8.5" fill="${p.muted}">higher in ${esc(A)}</text>` +
        `<text x="${gx + gw}" y="${py0 + CH + 22}" font-size="8.5" fill="${p.muted}" text-anchor="end">higher in ${esc(B)}</text>`);
    });
    bottom = Math.max(bottom, y + best.length * (CH + 44));
  }
  const cap = caption(v.caveat || "", W, bottom + 4, p.muted);
  return frame(W, bottom + 4 + cap.height + 10, out.join("") + cap.svg, p.bg);
}

