// Acquired-under-therapy figure: per gene, patients who lost an alteration (left) or acquired one
// (right) between their sample before a treatment start and their sample after it.
import {
  esc, palette, frame, caption, linear, axisBottom, bottomAxisHeight, legend, label, textWidth, wrapWidth,
  fmtInt, pDigits, textOn, FS, SW, SERIES, type SvgOpts
} from "../svg-kit.ts";
import type { DrawnResultOf, AcquiredGene } from "../types.ts";

const PAD = 8, GUT = 14, ROW = 20, BAR = 14, MIN_BAR_W = 220;

export function acquiredSvg(v: DrawnResultOf<"acquired">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.acquired;
  let W = Math.max(480, o.width || 960);
  const LOST = SERIES[0], GAINED = SERIES[1];
  const genes = r.panels.flatMap((pn) => pn.genes);
  const qOf = (g: AcquiredGene) => g.acquired + g.lost ? pDigits(g.q) : "–";
  const cols: { head: string; text: (g: AcquiredGene) => string; w: number }[] = [
    { head: "shared", text: (g) => fmtInt(g.shared), w: 0 },
    { head: "pairs", text: (g) => fmtInt(g.pairs), w: 0 },
    { head: "McNemar q", text: qOf, w: 0 }
  ];
  for (const c of cols) c.w = Math.max(textWidth(c.head, FS.small), ...genes.map((g) => textWidth(c.text(g), FS.small)), 0);
  const statW = cols.reduce((s, c) => s + c.w + GUT, 0);
  const geneW = Math.max(30, ...genes.map((g) => textWidth(g.gene, FS.body, 600)));
  const need = PAD + geneW + GUT + MIN_BAR_W + statW + PAD;
  const grown = need > W;
  if (grown) W = Math.ceil(need);
  const BL = PAD + geneW + GUT, BR = W - PAD - statW;
  // one symmetric scale for every panel, lost to the left of zero and acquired to the right
  const widest = Math.max(1, ...genes.map((g) => Math.max(g.acquired, g.lost)));
  const xs = linear(-widest, widest, BL, BR);
  const x0 = xs(0);
  const out: string[] = [];
  let y = 4;
  const lg = legend([{ label: "lost (before only)", color: LOST }, { label: "acquired (after only)", color: GAINED }], PAD, y, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 6;

  r.panels.forEach((pn, pi) => {
    if (pi) y += 12;
    const head = pn.cohort, hw = Math.min(textWidth(head, FS.title, 600), W * 0.5);
    out.push(label(PAD, y + FS.title, head, { size: FS.title, weight: 600, fill: p.ink, maxW: W * 0.5 }));
    const detail = fmtInt(pn.patients) + " patients sampled before and after" +
      (pn.gapDays ? " · samples a median " + fmtInt(pn.gapDays.median) + " days apart" : "") +
      (pn.tested != null ? " · " + fmtInt(pn.tested) + " genes tested, " + (pn.genes.length < pn.tested ? "the " + fmtInt(pn.genes.length) + " smallest p" : "all") + " drawn" : "");
    const lines = wrapWidth(detail, W - PAD - hw - 12 - PAD, FS.small);
    lines.forEach((l, i) => out.push(label(PAD + hw + 12, y + FS.title + i * (FS.small + 3), l, { size: FS.small, fill: p.muted })));
    y += FS.title + (lines.length - 1) * (FS.small + 3) + 8;
    let cx = BR;
    for (const c of cols) { cx += GUT; out.push(label(cx + c.w, y + FS.small, c.head, { size: FS.small, fill: p.muted, anchor: "end" })); cx += c.w; }
    y += FS.small + 4;
    const top = y;
    for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${top + pn.genes.length * ROW}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    pn.genes.forEach((g, gi) => {
      const ry = top + gi * ROW, cy = ry + ROW / 2;
      if (gi % 2 === 0) out.push(`<rect x="${PAD / 2}" y="${ry}" width="${W - PAD}" height="${ROW}" fill="${p.line}" opacity="0.3"/>`);
      out.push(label(BL - GUT, cy + FS.body * 0.35, g.gene, { size: FS.body, weight: 600, fill: p.ink, anchor: "end" }));
      for (const [n, col, name, sign] of [[g.lost, LOST, "lost", -1], [g.acquired, GAINED, "acquired", 1]] as [number, string, string, number][]) {
        if (n <= 0) continue;
        const w = Math.max(1, Math.abs(xs(sign * n) - x0)), x = sign < 0 ? x0 - w : x0;
        out.push(`<rect x="${r1(x)}" y="${r1(cy - BAR / 2)}" width="${r1(w)}" height="${BAR}" fill="${col}"><title>${esc(g.gene + " — " + fmtInt(n) + (n === 1 ? " patient " : " patients ") + name)}</title></rect>`);
        const t = fmtInt(n);
        if (textWidth(t, FS.small) + 6 <= w) out.push(label(x + w / 2, cy + FS.small * 0.35, t, { size: FS.small, fill: textOn(col), anchor: "middle" }));
      }
      if (!g.pairs) out.push(label(x0 + 4, cy + FS.small * 0.35, "never covered on both samples", { size: FS.small, fill: p.muted }));
      const sig = g.q < 0.05 && g.acquired + g.lost > 0;
      let sx = BR;
      for (const c of cols) {
        sx += GUT;
        out.push(label(sx + c.w, cy + FS.small * 0.35, c.text(g), { size: FS.small, fill: sig ? p.ink : p.muted, anchor: "end", weight: sig && c.head === "McNemar q" ? 600 : 400 }));
        sx += c.w;
      }
    });
    out.push(`<line x1="${r1(x0)}" y1="${top}" x2="${r1(x0)}" y2="${top + pn.genes.length * ROW}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    y = top + pn.genes.length * ROW;
  });
  const axTitle = "patients: ← lost after treatment · acquired after treatment →";
  out.push(axisBottom(xs, y, p, { title: axTitle, minX: BL - GUT, maxX: BR + GUT, fmt: (t) => fmtInt(Math.abs(t)) }));
  y += bottomAxisHeight(axTitle) + 8;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, grown, "Acquired under therapy — from " + r.anchoredTo);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
