// Clonality figure: clonal and subclonal calls, LOH, WGD, purity and ploidy per cohort.
import {
  palette, frame, caption, linear, axisBottom, axisLeft, leftAxisWidth, bottomAxisHeight, legend, label, textWidth,
  fmtInt, fmtPct, fmtP, pDigits, seriesStyle, FS, SW, OTHER, type SvgOpts, type LegendItem
} from "../../svg-kit.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { ClonalityPanel } from "./types.ts";

type Pal = ReturnType<typeof palette>;
const PAD = 8, GUT = 12, SUB = 15, BAR = 10, GROUP_GAP = 8, MIN_BAR_W = 140;
/** the per-cohort FACETS column sits beside the genes from this width; below it, under them */
const SIDE_BY_SIDE = 900;
const HIST_H = 44;

/** A histogram over [lo, hi] in equal bins, with its own count axis and a value axis under it. */
function histogram(h: number[], lo: number, hi: number, x: number, y: number, w: number, title: string, colour: string, p: Pal): { svg: string; height: number } {
  const max = Math.max(1, ...h);
  const ys = linear(0, max, y + HIST_H, y, { count: 2 });
  const L = x + leftAxisWidth(ys);
  const xs = linear(lo, hi, L, x + w, { nice: false, count: 4 });
  const bw = (x + w - L) / Math.max(1, h.length);
  let d = "";
  h.forEach((c, i) => { if (c) { const top = ys(c); d += `M${r1(L + i * bw)} ${r1(y + HIST_H)}V${r1(top)}h${r1(Math.max(0.5, bw - 0.6))}V${r1(y + HIST_H)}z`; } });
  const svg = axisLeft(ys, L, p, { gridTo: x + w, fmt: (t) => fmtInt(t) }) + `<path d="${d}" fill="${colour}"/>` +
    axisBottom(xs, y + HIST_H, p, { title, minX: x, maxX: x + w });
  return { svg, height: HIST_H + bottomAxisHeight(title) };
}

/** One cohort's per-sample FACETS summary: whole-genome doubling, then purity and ploidy histograms. */
function sidePanel(pn: ClonalityPanel, ci: number, qc: boolean, x: number, y0: number, w: number, p: Pal): { svg: string; height: number } {
  const st = seriesStyle(ci), out: string[] = [];
  let y = y0;
  out.push(`<rect x="${x}" y="${y + 2}" width="10" height="10" rx="2" fill="${st.color}"${st.tint < 1 ? ` opacity="${st.tint}"` : ""}/>`);
  out.push(label(x + 15, y + 11, pn.cohort, { size: FS.body, weight: 600, fill: p.ink, maxW: w - 15 }));
  y += 16;
  const wgdN = pn.wgd.yes + pn.wgd.no;
  out.push(label(x, y + FS.small, "whole-genome doubled: " + (wgdN ? fmtPct(100 * pn.wgd.yes / wgdN) + " of " + fmtInt(wgdN) + " samples" : "–"), { size: FS.small, fill: p.ink, maxW: w }));
  y += FS.small + 6;
  const two = w >= 300, hw = two ? (w - GUT) / 2 : w;
  const a = histogram(pn.purity, 0, 1, x, y + 4, hw, "purity", st.color, p);
  const b = histogram(pn.ploidy, 0, 8, two ? x + hw + GUT : x, two ? y + 4 : y + 4 + a.height + 8, hw, "ploidy", st.color, p);
  out.push(a.svg, b.svg);
  y += 4 + (two ? Math.max(a.height, b.height) : a.height + 8 + b.height) + 6;
  out.push(label(x, y + FS.small, fmtInt(pn.ascnSamples) + " of " + fmtInt(pn.samples) + " samples have FACETS estimates" + (qc ? "; " + fmtInt(pn.qcPass) + " pass QC" : ""), { size: FS.small, fill: p.muted, maxW: w }));
  y += FS.small + 4;
  return { svg: out.join(""), height: y - y0 };
}

export function clonalitySvg(v: DrawnResultOf<"clonality">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.clonality;
  let W = Math.max(480, o.width || 960);
  const k = r.panels.length;
  const genes = r.panels[0]?.genes.map((g) => g.gene) || [];
  const all = r.panels.flatMap((pn) => pn.genes);
  const what = (r.measure === "driver" ? "driver " : "") + "mutation";

  // the stats columns beside each bar, each as wide as its widest entry or its head
  const clonalPct = (g: (typeof all)[number]) => g.clonal + g.subclonal ? fmtPct(100 * g.clonal / (g.clonal + g.subclonal)) + " clonal" : "–";
  const loh = (g: (typeof all)[number]) => "LOH " + (g.lohKnown ? fmtPct(100 * g.loh / g.lohKnown) : "–");
  const calls = (g: (typeof all)[number]) => fmtInt(g.calls) + " calls";
  const hasQ = all.some((g) => g.q != null);
  const cols: { head: string; text: (g: (typeof all)[number], ci: number) => string }[] = [
    { head: "", text: (g) => clonalPct(g) },
    { head: "", text: (g) => loh(g) },
    { head: "", text: (g) => calls(g) },
    ...(hasQ ? [{ head: "clonal share differs", text: (g: (typeof all)[number], ci: number) => ci === 0 && g.q != null ? "q " + pDigits(g.q) : "" }] : [])
  ];
  const colW = cols.map((c) => Math.max(textWidth(c.head, FS.small), ...r.panels.flatMap((pn) => pn.genes.map((g) => textWidth(c.text(g, r.panels.indexOf(pn)), FS.small))), 0));
  const statW = colW.reduce((s, w) => s + w + GUT, 0);
  const geneW = Math.max(30, ...genes.map((g) => textWidth(g, FS.body, 600)));
  const mainNeed = PAD + geneW + GUT + MIN_BAR_W + statW;
  const side = W >= SIDE_BY_SIDE;
  const sideW = side ? Math.max(300, Math.round(W * 0.32)) : W - 2 * PAD;
  const grown = mainNeed + PAD + (side ? sideW + 2 * GUT : 0) > W;
  if (grown) W = Math.ceil(mainNeed + PAD + (side ? sideW + 2 * GUT : 0));
  const mainR = side ? W - PAD - sideW - 2 * GUT : W - PAD;
  const BL = PAD + geneW + GUT, BR = mainR - statW;

  const out: string[] = [];
  let y = 4;
  const items: LegendItem[] = [
    ...r.panels.map((pn, ci) => ({ label: pn.cohort, color: seriesStyle(ci).color, opacity: seriesStyle(ci).tint })),
  ];
  const lg = legend(items, PAD, y, W - 2 * PAD, p, { size: FS.small, title: "cohorts:" });
  out.push(lg.svg);
  y += lg.height;
  const key = legend([{ label: "clonal", color: p.muted }, { label: "subclonal (paler)", color: p.muted, opacity: 0.4 }, { label: "indeterminate", color: OTHER, opacity: 0.5 }],
    PAD, y, W - 2 * PAD, p, { size: FS.small, title: what + " calls:" });
  out.push(key.svg);
  y += key.height + 6;

  // column heads
  let hx = BR;
  cols.forEach((c, i) => { hx += GUT; if (c.head) out.push(label(hx + colW[i], y + FS.small, c.head, { size: FS.small, fill: p.muted, anchor: "end" })); hx += colW[i]; });
  if (hasQ) y += FS.small + 4;
  const top = y, side0 = y;
  const rowH = k * SUB + GROUP_GAP;
  const xs = linear(0, 100, BL, BR, { nice: false, count: 4 });
  for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${top + genes.length * rowH}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
  genes.forEach((gene, gi) => {
    const gy = top + gi * rowH;
    if (gi % 2 === 0) out.push(`<rect x="${PAD / 2}" y="${gy}" width="${r1(mainR - PAD / 2 + 4)}" height="${rowH}" fill="${p.line}" opacity="0.3"/>`);
    out.push(label(BL - GUT, gy + GROUP_GAP / 2 + k * SUB / 2 + FS.body * 0.35, gene, { size: FS.body, weight: 600, fill: p.ink, anchor: "end" }));
    r.panels.forEach((pn, ci) => {
      const g = pn.genes[gi], st = seriesStyle(ci), cy = gy + GROUP_GAP / 2 + ci * SUB + SUB / 2;
      if (!g.calls) {
        out.push(label(BL, cy + FS.small * 0.35, "no " + what + " call with a FACETS estimate", { size: FS.small, fill: p.muted, maxW: BR - BL + statW }));
        return;
      }
      const called = g.clonal + g.subclonal + g.indeterminate;
      let x = BL;
      for (const [n, op, fill] of [[g.clonal, st.tint, st.color], [g.subclonal, 0.4 * st.tint, st.color], [g.indeterminate, 0.5, OTHER]] as [number, number, string][]) {
        if (!n || !called) continue;
        const w = (BR - BL) * n / called;
        out.push(`<rect x="${r1(x)}" y="${r1(cy - BAR / 2)}" width="${r1(w)}" height="${BAR}" fill="${fill}"${op < 1 ? ` opacity="${op}"` : ""}/>`);
        x += w;
      }
      let sx = BR;
      cols.forEach((c, i) => {
        sx += GUT;
        const t = c.text(g, ci);
        const strong = i === 3 && g.q != null && g.q < 0.05;
        if (t) out.push(label(sx + colW[i], cy + FS.small * 0.35, t, { size: FS.small, fill: i === 0 || strong ? p.ink : p.muted, anchor: "end", weight: strong ? 600 : 400 }));
        sx += colW[i];
      });
    });
  });
  const mainBottom = top + genes.length * rowH;
  const axT = "share of the gene's calls";
  out.push(axisBottom(xs, mainBottom, p, { title: axT, minX: BL - GUT, maxX: BR + GUT, fmt: (t) => t + "%" }));
  let bottom = mainBottom + bottomAxisHeight(axT) + 8;

  // per cohort: WGD, purity, ploidy — beside the genes, or under them on a narrow figure
  const sx0 = side ? W - PAD - sideW : PAD;
  let sy = side ? side0 : bottom + 4;
  out.push(label(sx0, sy + FS.small, "per sample (FACETS)", { size: FS.small, fill: p.muted }));
  sy += FS.small + 6;
  const perRow = side ? 1 : Math.max(1, Math.min(k, Math.floor((sideW + GUT * 2) / (300 + GUT * 2))));
  const cellW = (sideW - (perRow - 1) * GUT * 2) / perRow;
  for (let i = 0; i < k; i += perRow) {
    let h = 0;
    for (let j = i; j < Math.min(k, i + perRow); j++) {
      const sp = sidePanel(r.panels[j], j, r.qc, sx0 + (j - i) * (cellW + GUT * 2), sy, cellW, p);
      out.push(sp.svg); h = Math.max(h, sp.height);
    }
    sy += h + 12;
  }
  if (r.wgdP != null) { out.push(label(sx0, sy + FS.small, "WGD differs: Fisher " + fmtP(r.wgdP), { size: FS.small, fill: p.ink })); sy += FS.small + 6; }
  bottom = Math.max(bottom, sy + 4);
  const cap = caption(v.caveat || "", W, bottom, p.muted);
  return frame(W, bottom + cap.height + 10, out.join("") + cap.svg, p.bg, grown, "Clonality (FACETS) — " + r.panels.map((pn) => pn.cohort).join(", "));
}

const r1 = (n: number) => Math.round(n * 10) / 10;
