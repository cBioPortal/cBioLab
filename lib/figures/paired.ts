// Paired-samples figure: each gene's alteration in the two kinds of sample, within patients.
import { esc, SERIES, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { qFmt } from "./common.ts";

export function pairedSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.paired!;
  const W = o.width || 960, LBL = 90, STAT = 250, BAR_L = LBL + 10, BAR_W = W - BAR_L - STAT - 10;
  const aL = r.labels.a, bL = r.labels.b;
  const BOTH = p.muted;
  const out: string[] = [];
  let y = 8;
  // one scale for every panel: patients altered anywhere, the widest bar
  const widest = Math.max(1, ...r.panels.flatMap((pn) => pn.genes.map((g) => g.aOnly + g.both + g.bOnly)));
  const sx = (n: number) => BAR_W * n / widest;
  r.panels.forEach((pn) => {
    out.push(`<text x="10" y="${y + 12}" font-size="12" font-weight="600" fill="${p.ink}">${esc(pn.cohort)}` +
      `<tspan dx="6" font-size="10" font-weight="400" fill="${p.muted}">${fmt(pn.patients)} patients with both · ${fmt(pn.aSamples)} ${esc(aL)} and ${fmt(pn.bSamples)} ${esc(bL)} samples` +
      `${pn.tested != null ? ` · ${fmt(pn.tested)} genes with a discordant patient, ${pn.genes.length < pn.tested ? "the " + fmt(pn.genes.length) + " most one-sided" : "all"} drawn` : ""}</tspan></text>`);
    y += 22;
    // legend entries spaced by their own text, so a long side label never runs into the next
    const bothX = BAR_L + Math.max(90, Math.ceil((aL.length + 5) * 5.6) + 12);
    out.push(`<text x="${BAR_L}" y="${y + 8}" font-size="9.5" fill="${SERIES[0]}">${esc(aL)} only</text>` +
      `<text x="${bothX}" y="${y + 8}" font-size="9.5" fill="${p.muted}">both</text>` +
      `<text x="${bothX + 40}" y="${y + 8}" font-size="9.5" fill="${SERIES[1]}">${esc(bL)} only</text>` +
      `<text x="${W - STAT + 8}" y="${y + 8}" font-size="9.5" fill="${p.muted}">concordant · profiled pairs · McNemar q</text>`);
    y += 14;
    pn.genes.forEach((g) => {
      out.push(`<text x="${LBL}" y="${y + 11}" font-size="11" font-weight="600" fill="${p.ink}" text-anchor="end">${esc(g.gene)}</text>`);
      let x = BAR_L;
      const seg = (n: number, col: string, op = 0.9) => {
        if (n <= 0) return;
        out.push(`<rect x="${num(x)}" y="${y + 2}" width="${num(Math.max(0.8, sx(n)))}" height="12" fill="${col}" opacity="${op}"/>`);
        if (sx(n) > 22) out.push(`<text x="${num(x + sx(n) / 2)}" y="${y + 11.5}" font-size="9" fill="#ffffff" text-anchor="middle">${n}</text>`);
        x += sx(n);
      };
      seg(g.aOnly, SERIES[0]); seg(g.both, BOTH, 0.75); seg(g.bOnly, SERIES[1]);
      if (!g.pairs) out.push(`<text x="${BAR_L}" y="${y + 11}" font-size="9.5" fill="${p.muted}">never profiled on both sides</text>`);
      const sig = g.q < 0.05 && g.aOnly + g.bOnly > 0;
      out.push(`<text x="${W - STAT + 8}" y="${y + 11}" font-size="10" fill="${sig ? p.ink : p.muted}">` +
        `${g.concordance == null ? "—" : Math.round(100 * g.concordance) + "%"} · ${fmt(g.pairs)} · ${g.aOnly + g.bOnly ? esc(qFmt(g.q)) : "no discordance"}` +
        `${sig ? " · more " + esc(g.bOnly > g.aOnly ? bL : aL) + "-only" : ""}</text>`);
      y += 18;
    });
    y += 10;
  });
  const cap = caption(v.caveat || "", W, y, p.muted, Math.floor(W / 7.2));
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg);
}

