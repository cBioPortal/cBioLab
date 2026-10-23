// Organotropism figure: a gene × site heatmap of the Mantel–Haenszel odds ratio of alteration with
// metastasis to each site (outlined where q < 0.05), the strongest associations as a table, and,
// from dated timeline sites, the cumulative incidence of one site by one gene's status.
import type { DrawnResultOf } from "../../types.ts";
import { palette, frame, caption, label, textWidth, wrapWidth, fmtInt, fmtNum, fmtPct, fmtP, pDigits, esc, num, FS, SW, type SvgOpts } from "../../svg-kit.ts";
import { numericColor } from "../../oncoprint-style.ts";
import { kmPanel } from "../../figures/km.ts";
import type { OrganotropismCell } from "./types.ts";

const PAD = 8, LOG2_CLAMP = 1, TABLE_ROWS = 10, MIN_CELL = 18, MAX_CELL = 56, HEAD_MAX = 120;

const cellFill = (log2: number) => numericColor(127.5 + Math.max(-1, Math.min(1, log2 / LOG2_CLAMP)) * 127.5, 127.5);
const pct = (k: number, n: number) => n ? fmtPct(100 * k / n) : "–";

export function organotropismSvg(v: DrawnResultOf<"organotropism">, o: SvgOpts): string {
  const r = v.organotropism, p = palette(o.theme), want = o.width || 936;
  const siteLabel = new Map(r.sites.map((s) => [s.site, s.label]));
  const geneW = Math.max(...r.genes.map((g) => textWidth(g.gene, FS.body))) + 10;
  const need = 2 * PAD + geneW + r.sites.length * MIN_CELL + 60;
  const W = Math.max(want, need, 360);
  const out: string[] = [];
  let y = 0;
  const head = fmtInt(r.patients) + " patients · sites from " + r.sourceLabel + " · " + (r.measure === "driver" ? "OncoKB-driver " : "") + r.alteration + "s" +
    (r.stratifyBy ? " · stratified by " + r.stratifyBy : " · not stratified");
  for (const l of wrapWidth(head, W - 2 * PAD, FS.body)) { y += Math.round(FS.body * 1.4); out.push(label(PAD, y, l, { size: FS.body, fill: p.muted })); }
  y += 14;

  // the heatmap: genes down, sites across, labels turned above the columns
  const cw = Math.max(MIN_CELL, Math.min(MAX_CELL, (W - 2 * PAD - geneW - 60) / r.sites.length));
  const headH = Math.min(HEAD_MAX, Math.max(...r.sites.map((s) => textWidth(s.label, FS.small)))) + 6;
  const x0 = PAD + geneW, top = y + headH;
  r.sites.forEach((s, j) => {
    const cx = x0 + j * cw + cw / 2 + FS.small * 0.35;
    out.push(label(cx, top - 4, s.label, { size: FS.small, fill: p.ink, rotate: -90, maxW: HEAD_MAX }));
  });
  const cellOf = new Map(r.cells.map((c) => [c.site + "\u0000" + c.gene, c]));
  const ch = Math.max(16, Math.min(22, cw));
  r.genes.forEach((g, i) => {
    const cy = top + i * ch;
    out.push(label(x0 - 6, cy + ch / 2 + FS.body * 0.35, g.gene, { size: FS.body, fill: p.ink, anchor: "end" }));
    r.sites.forEach((s, j) => {
      const c = cellOf.get(s.site + "\u0000" + g.gene);
      const x = x0 + j * cw;
      const tip = c ? tipOf(c, s.label) : g.gene + " · " + s.label + ": no patient profiled";
      if (!c || c.p == null) {
        out.push(`<rect x="${num(x + 1)}" y="${num(cy + 1)}" width="${num(cw - 2)}" height="${num(ch - 2)}" fill="none" stroke="${p.line}" stroke-width="${SW.hair}"><title>${esc(tip)}</title></rect>`);
        return;
      }
      const fill = c.log2Or == null ? p.line : cellFill(c.log2Or);
      const sig = c.q != null && c.q < 0.05;
      out.push(`<rect x="${num(x + 1)}" y="${num(cy + 1)}" width="${num(cw - 2)}" height="${num(ch - 2)}" fill="${fill}"` +
        (sig ? ` stroke="${p.ink}" stroke-width="${SW.series}"` : "") + `><title>${esc(tip)}</title></rect>`);
    });
  });
  y = top + r.genes.length * ch + 14;
  // the colour key
  const keys = [-1, -0.5, 0, 0.5, 1];
  let kx = PAD;
  out.push(label(kx, y + FS.small * 0.35, "Odds ratio", { size: FS.small, fill: p.muted }));
  kx += textWidth("Odds ratio", FS.small) + 8;
  for (const k of keys) {
    const t = k < 0 ? "1/" + fmtNum(2 ** -k, 2) : fmtNum(2 ** k, 2);
    out.push(`<rect x="${num(kx)}" y="${num(y - 6)}" width="14" height="12" fill="${cellFill(k)}"/>`);
    out.push(label(kx + 18, y + FS.small * 0.35, t, { size: FS.small, fill: p.ink }));
    kx += 18 + textWidth(t, FS.small) + 10;
  }
  const keyNote = "outlined: q < 0.05 · empty: not tested";
  if (kx + textWidth(keyNote, FS.small) < W - PAD) out.push(label(kx + 4, y + FS.small * 0.35, keyNote, { size: FS.small, fill: p.muted }));
  else { y += Math.round(FS.small * 1.6); out.push(label(PAD, y + FS.small * 0.35, keyNote, { size: FS.small, fill: p.muted })); }
  y += 20;

  // the strongest associations
  const top10 = r.cells.filter((c) => c.q != null && c.q < 0.05).sort((a, b) => a.p! - b.p!).slice(0, TABLE_ROWS);
  out.push(label(PAD, y, fmtInt(r.tested) + " site × gene cells tested, " + fmtInt(r.significant) + " at q < 0.05" + (top10.length ? "; the strongest:" : ""), { size: FS.body, fill: p.ink, weight: 600, maxW: W - 2 * PAD }));
  y += 6;
  if (top10.length) {
    type C = OrganotropismCell;
    const cols = [
      { head: "Site", text: (c: C) => siteLabel.get(c.site) || c.site, end: false },
      { head: "Gene", text: (c: C) => c.gene, end: false },
      { head: "With the site", text: (c: C) => fmtInt(c.withAltered) + "/" + fmtInt(c.withSite) + " (" + pct(c.withAltered, c.withSite) + ")", end: true },
      { head: "Without", text: (c: C) => fmtInt(c.withoutAltered) + "/" + fmtInt(c.without) + " (" + pct(c.withoutAltered, c.without) + ")", end: true },
      { head: "MH OR", text: (c: C) => c.or == null ? "–" : fmtNum(c.or, 2), end: true },
      { head: "q", text: (c: C) => pDigits(c.q!), end: true },
    ].map((c) => ({ ...c, w: Math.ceil(Math.max(textWidth(c.head, FS.body, 600), ...top10.map((x) => textWidth(c.text(x), FS.body)))) }));
    const gap = Math.max(8, Math.min(14, (W - 2 * PAD - cols.reduce((a, c) => a + c.w, 0)) / (cols.length - 1)));
    let cx = PAD;
    const at = cols.map((c) => { const a = c.end ? cx + c.w : cx; cx += c.w + gap; return a; });
    y += FS.body + 4;
    cols.forEach((c, j) => out.push(label(at[j], y, c.head, { size: FS.body, fill: p.ink, weight: 600, anchor: c.end ? "end" : "start" })));
    out.push(`<line x1="${PAD}" y1="${y + 5}" x2="${num(cx - gap)}" y2="${y + 5}" stroke="${p.line}" stroke-width="${SW.line}"/>`);
    top10.forEach((c) => { y += 18; cols.forEach((col, j) => out.push(label(at[j], y + 4, col.text(c), { size: FS.body, fill: p.ink, anchor: col.end ? "end" : "start" }))); });
  }
  y += 22;

  // the cumulative incidence of one site by one gene
  const inc = r.incidence;
  if (inc) {
    const km = kmPanel(inc.curves.map((c) => {
      const h = inc.horizons.map((z) => { const x = z.cells.find((q) => q.cohort === c.cohort); return x ? fmtNum(z.months) + " mo " + fmtPct(100 * x.f1) : ""; }).filter(Boolean).join(", ");
      return { name: c.cohort, points: c.points.map((pt) => ({ t: pt.t, s: pt.f1 })), detail: "n = " + fmtInt(c.n) + " · " + fmtInt(c.events) + " with " + inc.site + ", " + fmtInt(c.competing) + " died first · " + h };
    }), { y0: y, W, p, origin: 0, xTitle: "Months from the timeline's day 0", yTitle: "Cumulative incidence",
      title: "Cumulative incidence of " + inc.site + " by " + inc.gene + ", death competing" });
    out.push(km.svg);
    y += km.height + 4;
    if (inc.gray) { out.push(label(PAD, y + FS.body, "Gray's test (permutation, " + inc.gray.permutations + " shuffles) " + fmtP(inc.gray.p), { size: FS.body, fill: p.ink, maxW: W - 2 * PAD })); y += Math.round(FS.body * 1.8); }
  }
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > want, "Organotropism — " + r.genes.length + " genes × " + r.sites.length + " sites");
}

function tipOf(c: OrganotropismCell, site: string): string {
  return c.gene + " · " + site + ": altered in " + fmtInt(c.withAltered) + "/" + fmtInt(c.withSite) + " (" + pct(c.withAltered, c.withSite) + ") with the site, " +
    fmtInt(c.withoutAltered) + "/" + fmtInt(c.without) + " (" + pct(c.withoutAltered, c.without) + ") without" +
    (c.p == null ? " · not tested" : " · MH OR " + (c.or == null ? "undefined" : fmtNum(c.or, 2)) + ", " + fmtP(c.p) + ", " + fmtP(c.q ?? 1, "q") + " over " + c.strata + " strata");
}
