// Attrition figure: each cohort narrowing clause by clause, as a CONSORT-style column.
import { esc, SERIES, palette, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { wrap } from "./common.ts";

export function attritionSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme);
  const panels = v.attrition || [];
  const COL = 270, GAP = 18, PAD = 10, BOX_W = 196, LINE_H = 13, ARROW = 22;
  const W0 = o.width || 760;
  const W = Math.max(W0, PAD * 2 + panels.length * COL + (panels.length - 1) * GAP);
  const out: string[] = [];
  let bottom = 0;
  panels.forEach((pn, i) => {
    const x0 = PAD + i * (COL + GAP), colour = SERIES[i % SERIES.length];
    let y = 14;
    out.push(`<text x="${x0}" y="${y}" font-size="12" font-weight="600" fill="${p.ink}">${esc(pn.cohort)}</text>`);
    y += 10;
    const box = (lines: string[], n: number, sub: string, strong: boolean) => {
      const h = 10 + lines.length * LINE_H + LINE_H + 6;
      out.push(`<rect x="${x0}" y="${y}" width="${BOX_W}" height="${h}" rx="4" fill="${p.bg}" stroke="${strong ? colour : p.line}" stroke-width="${strong ? 2 : 1}"/>`);
      lines.forEach((l, k) => out.push(`<text x="${x0 + 8}" y="${y + 14 + k * LINE_H}" font-size="10.5" fill="${p.muted}">${esc(l)}</text>`));
      out.push(`<text x="${x0 + 8}" y="${y + 14 + lines.length * LINE_H + 2}" font-size="12" font-weight="600" fill="${p.ink}">` +
        `${fmt(n)}<tspan dx="5" font-size="10" font-weight="400" fill="${p.muted}">${esc(sub)}</tspan></text>`);
      const top = y;
      y += h;
      return { top, h };
    };
    box(["Every patient in " + (pn.studies.length === 1 ? pn.studies[0] : pn.studies.length + " studies")], pn.base, "patients", pn.steps.length === 0);
    pn.steps.forEach((s, k) => {
      const ax = x0 + BOX_W / 2;
      out.push(`<line x1="${ax}" y1="${y}" x2="${ax}" y2="${y + ARROW - 4}" stroke="${p.muted}" stroke-width="1.2"/>` +
        `<path d="M ${ax - 4} ${y + ARROW - 8} L ${ax} ${y + ARROW - 2} L ${ax + 4} ${y + ARROW - 8}" fill="none" stroke="${p.muted}" stroke-width="1.2"/>`);
      if (s.excluded > 0)
        out.push(`<text x="${ax + 8}" y="${y + ARROW / 2 + 3}" font-size="10" fill="${p.muted}">−${fmt(s.excluded)} excluded</text>`);
      y += ARROW;
      const lines = wrap(s.label, 34);
      const shown = lines.length > 4 ? [...lines.slice(0, 3), lines.slice(3).join(" ").slice(0, 31) + "…"] : lines;
      box(shown, s.n, s.pctOfBase == null ? "" : "(" + s.pctOfBase.toFixed(1) + "% of base)", k === pn.steps.length - 1);
    });
    bottom = Math.max(bottom, y);
  });
  const cap = caption(v.caveat || "", W, bottom + 12, p.muted, Math.floor(W / 7.4));
  const H = bottom + 12 + cap.height + 12;
  return frame(W, H, out.join("") + cap.svg, p.bg, W > W0);
}

