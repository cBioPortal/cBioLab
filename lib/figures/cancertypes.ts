// Cancer types figure: a gene list's alteration frequency per cancer type, as the portal draws it.
import { esc, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult, CancertypesGroup } from "../types.ts";
import { AMP, DEL, MULTI, MUT, SV } from "./common.ts";

type CtResult = NonNullable<ViewResult["cancertypes"]>;
const CT_KINDS: [keyof CancertypesGroup, string, string][] = [["mutation", "Mutation", MUT], ["amp", "Amplification", AMP],
  ["homdel", "Deep Deletion", DEL], ["sv", "Structural Variant", SV], ["multiple", "Multiple Alterations", MULTI]];

/**
 * One cohort's Cancer Types Summary as the portal draws it: a vertical bar per group, highest first,
 * stacked by kind of alteration; under it a "+" for each data type the group was profiled for;
 * group names slanted below; the kinds present keyed at the foot. `gene` picks one gene's bars
 * (the portal's per-gene tabs); omitted, the genes together.
 */
export function cancertypesPanelSvg(r: CtResult, panel: number, o: SvgOpts & { gene?: string | null; title?: boolean } = {}): { body: string; width: number; height: number } {
  const p = palette(o.theme), pn = r.panels[panel];
  const src = o.gene && pn.perGene ? pn.perGene.find((x) => x.gene === o.gene) || pn : pn;
  const groups = [...src.groups, ...(src.pooled ? [src.pooled] : [])];
  const freq = r.show === "frequency";
  const value = (g: CancertypesGroup, k: keyof CancertypesGroup) => freq ? 100 * Number(g[k]) / (g.profiled || 1) : Number(g[k]);
  const top = Math.max(1e-9, ...groups.map((g) => value(g, "altered")));
  const tick = freq ? (top <= 10 ? 2 : top <= 25 ? 5 : top <= 50 ? 10 : 20)
    : Math.pow(10, Math.floor(Math.log10(top))) * (top / Math.pow(10, Math.floor(Math.log10(top))) > 5 ? 2 : 1);
  const scale = freq ? Math.min(100, Math.ceil(top / tick) * tick) : Math.ceil(top / tick) * tick;
  const rows: [keyof NonNullable<CancertypesGroup["profiledFor"]>, string][] = ([["sv", "Structural variant data"], ["mutation", "Mutation data"], ["cna", "CNA data"]] as const)
    .filter(([k]) => groups.some((g) => (g.profiledFor?.[k] || 0) > 0)) as never;
  const LEFT = 175, BW = 22, GAP = 6, PH = 260, T = o.title === false ? 12 : 36;
  const longest = Math.max(4, ...groups.map((g) => Math.min(40, g.label.length)));
  const labelDrop = Math.ceil(longest * 6.2 * 0.71) + 14;
  const W = Math.max(o.width || 0, LEFT + groups.length * (BW + GAP) + labelDrop + 30);
  const X = (i: number) => LEFT + i * (BW + GAP);
  const Y = (v: number) => T + PH * (1 - v / scale);
  const out: string[] = [];
  if (o.title !== false) out.push(`<text x="10" y="18" font-size="12" font-weight="600" fill="${p.ink}">${esc(pn.cohort)}` +
    `<tspan dx="8" font-size="10.5" font-weight="400" fill="${p.muted}">${o.gene ? esc(o.gene) + " · " : ""}${fmt(pn.altered)} of ${fmt(pn.profiled)} profiled ${r.unit}s altered (${(100 * pn.altered / (pn.profiled || 1)).toFixed(1)}%)</tspan></text>`);
  // y axis
  for (let v = 0; v <= scale + 1e-9; v += tick) {
    out.push(`<line x1="${LEFT - 6}" y1="${num(Y(v))}" x2="${num(X(groups.length))}" y2="${num(Y(v))}" stroke="${p.line}" stroke-width="${v === 0 ? 0 : 0.6}" stroke-dasharray="${v === 0 ? "" : "2 3"}"/>` +
      `<text x="${LEFT - 9}" y="${num(Y(v) + 3)}" font-size="10" fill="${p.ink}" text-anchor="end">${freq ? num(v) + "%" : fmt(Math.round(v))}</text>`);
  }
  out.push(`<line x1="${LEFT - 4}" y1="${T}" x2="${LEFT - 4}" y2="${T + PH}" stroke="${p.ink}" stroke-width="0.8"/>` +
    `<line x1="${LEFT - 4}" y1="${T + PH}" x2="${num(X(groups.length))}" y2="${T + PH}" stroke="${p.ink}" stroke-width="0.8"/>` +
    `<text x="${LEFT - 48}" y="${T + PH / 2}" font-size="11" fill="${p.ink}" text-anchor="middle" transform="rotate(-90 ${LEFT - 48} ${T + PH / 2})">${freq ? "Alteration Frequency" : "Absolute Counts"}</text>`);
  // bars
  groups.forEach((g, i) => {
    let y0 = T + PH;
    for (const [k, label, col] of CT_KINDS) {
      const h = PH * value(g, k) / scale;
      if (h <= 0) continue;
      y0 -= h;
      out.push(`<rect x="${num(X(i))}" y="${num(y0)}" width="${BW}" height="${num(h)}" fill="${col}"><title>${esc(g.label + " — " + label + ": " + fmt(Number(g[k])) + " of " + fmt(g.profiled) + " profiled " + r.unit + "s")}</title></rect>`);
    }
    out.push(`<rect x="${num(X(i))}" y="${num(Y(value(g, "altered")))}" width="${BW}" height="${num(PH * value(g, "altered") / scale)}" fill="none"><title>${esc(g.label + ": " + (100 * g.altered / (g.profiled || 1)).toFixed(1) + "% (" + fmt(g.altered) + " / " + fmt(g.profiled) + " " + r.unit + "s" + (g.samples > g.profiled ? ", " + fmt(g.samples) + " in the group" : "") + ")")}</title></rect>`);
  });
  // what each group was profiled for
  let y = T + PH + 18;
  for (const [k, label] of rows) {
    out.push(`<text x="${LEFT - 9}" y="${y + 4}" font-size="10.5" fill="${p.ink}" text-anchor="end">${label}</text>`);
    groups.forEach((g, i) => { if ((g.profiledFor?.[k] || 0) > 0) out.push(`<text x="${num(X(i) + BW / 2)}" y="${y + 5}" font-size="13" font-weight="700" fill="${p.ink}" text-anchor="middle">+</text>`); });
    y += 18;
  }
  // slanted group names
  groups.forEach((g, i) => {
    const pooled = g.key === "__pooled__", x = X(i) + BW / 2;
    out.push(`<text x="${num(x)}" y="${y}" font-size="10.5" fill="${pooled ? p.muted : p.ink}"${pooled ? ' font-style="italic"' : ""} transform="rotate(45 ${num(x)} ${y})">${esc(g.label.length > 40 ? g.label.slice(0, 39) + "…" : g.label)}</text>`);
  });
  y += labelDrop;
  // key: the kinds present
  let kx = LEFT;
  for (const [k, label, col] of CT_KINDS) {
    if (!groups.some((g) => Number(g[k]) > 0)) continue;
    out.push(`<circle cx="${kx + 4}" cy="${y}" r="4" fill="${col}"/><text x="${kx + 12}" y="${y + 4}" font-size="10.5" fill="${p.ink}">${label}</text>`);
    kx += 26 + label.length * 6;
  }
  return { body: out.join(""), width: Math.max(W, kx + 10), height: y + 16 };
}

export function cancertypesSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.cancertypes!;
  let y = 0, W = o.width || 860;
  const parts: string[] = [];
  r.panels.forEach((_, i) => {
    const c = cancertypesPanelSvg(r, i, { ...o, title: true });
    parts.push(`<g transform="translate(0 ${y})">${c.body}</g>`);
    y += c.height + 10; W = Math.max(W, c.width);
  });
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 10, parts.join("") + cap.svg, p.bg, W > (o.width || 860));
}

