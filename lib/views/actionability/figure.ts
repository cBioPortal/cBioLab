// Actionability figure: per cohort (and group), the share of sequenced patients at each highest OncoKB
// level as one stacked bar, then each cohort's primary/metastasis concordance as a cross-table.
import type { DrawnResultOf } from "../../types.ts";
import { esc, palette, frame, caption, label, textWidth, legend, linear, axisBottom, bottomAxisHeight, seriesStyle, textOn, fmtInt, fmtPct, FS, SW, OTHER, type SvgOpts } from "../../svg-kit.ts";
import type { ActionLevels } from "./types.ts";

const ROW = 22, PAD = 8, GUT = 12;
const levelColor = (i: number) => i < 5 ? seriesStyle(i).color : OTHER;

export function actionabilitySvg(v: DrawnResultOf<"actionability">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.actionability, want = o.width || 936, W = Math.max(520, want);
  const pct = (k: number, d: number) => d ? fmtPct(100 * k / d) : "–";
  const actionable = (g: ActionLevels) => g.levels.slice(0, 4).reduce((a, b) => a + b, 0);
  type Row = { label: string; g: ActionLevels; head?: boolean };
  const rows: Row[] = r.panels.flatMap((pn) => [{ label: pn.cohort, g: pn, head: true },
    ...(pn.groups || []).map((g) => ({ label: g.label, g }))]);
  const sideText = (g: ActionLevels) => "1–3B " + pct(actionable(g), g.sequenced) + " · R " + pct(g.resistance[0] + g.resistance[1], g.sequenced);
  const nText = (g: ActionLevels) => "n = " + fmtInt(g.sequenced);
  const labW = Math.min(W * 0.3, Math.max(...rows.map((x) => textWidth(x.label, FS.body, x.head ? 600 : 400) + (x.head ? 0 : 10))));
  const nW = Math.max(...rows.map((x) => textWidth(nText(x.g), FS.small)));
  const sW = Math.max(...rows.map((x) => textWidth(sideText(x.g), FS.small)));
  const L = PAD + labW + GUT + nW + GUT, R = W - PAD - sW - GUT;
  const xs = linear(0, 100, L, R, { nice: false });
  const out: string[] = [];
  const lg = legend(r.levels.map((l, i) => ({ label: l, color: levelColor(i) })), PAD, 4, W - 2 * PAD, p);
  out.push(lg.svg);
  let y = 4 + lg.height + 6;
  const top = y;
  rows.forEach((x, i) => {
    if (x.head && i) y += 6;
    const cy = y + ROW / 2, ty = cy + FS.body * 0.35;
    out.push(label(PAD + (x.head ? 0 : 10), ty, x.label, { size: FS.body, fill: p.ink, weight: x.head ? 600 : 400, maxW: labW - (x.head ? 0 : 10) }));
    out.push(label(PAD + labW + GUT + nW, ty, nText(x.g), { size: FS.small, fill: p.muted, anchor: "end" }));
    let acc = 0;
    x.g.levels.forEach((k, li) => {
      if (!k || !x.g.sequenced) return;
      const a = xs(acc), share = 100 * k / x.g.sequenced, b = xs(acc + share);
      acc += share;
      out.push(`<rect x="${r1(a)}" y="${r1(cy - 7)}" width="${r1(Math.max(0.5, b - a))}" height="14" fill="${levelColor(li)}"><title>${esc(x.label + ": " + r.levels[li] + " " + fmtInt(k) + " of " + fmtInt(x.g.sequenced) + " (" + pct(k, x.g.sequenced) + ")")}</title></rect>`);
      if (b - a > textWidth(fmtPct(share, 0), FS.small) + 4)
        out.push(label((a + b) / 2, cy + FS.small * 0.35, fmtPct(share, 0), { size: FS.small, fill: textOn(levelColor(li)), anchor: "middle" }));
    });
    out.push(label(R + GUT, ty, sideText(x.g), { size: FS.small, fill: p.ink }));
    y += ROW;
  });
  const axTitle = "% of patients sequenced, by their highest sensitive level (in any cancer type)";
  out.push(`<line x1="${r1(xs(0))}" y1="${top}" x2="${r1(xs(0))}" y2="${y}" stroke="${p.muted}" stroke-width="${SW.hair}"/>`);
  out.push(axisBottom(xs, y + 2, p, { title: axTitle, minX: L - 20, maxX: R + 20 }));
  y += 2 + bottomAxisHeight(axTitle) + 14;

  // concordance: rows are side a's highest level, columns side b's
  const conc = r.panels.filter((pn) => pn.concordance);
  if (r.pairBy && conc.length) {
    const short = ["1", "2", "3A", "3B", "4", "none"];
    const cellW = Math.max(36, textWidth("00,000", FS.small) + 8);
    const rowLab = r.pairBy.a.join("/") + " ↓  " + r.pairBy.b.join("/") + " →";
    const lw = Math.max(textWidth(rowLab, FS.small), textWidth("none", FS.small)) + GUT;
    const tableW = lw + 6 * cellW;
    const per = Math.max(1, Math.floor((W - PAD) / (tableW + 24)));
    for (let k = 0; k < conc.length; k += per) {
      const chunk = conc.slice(k, k + per);
      let h = 0;
      chunk.forEach((pn, j) => {
        const c = pn.concordance!, x0 = PAD + j * (tableW + 24);
        let yy = y;
        out.push(label(x0, yy + FS.body, pn.cohort + ": " + fmtInt(c.pairs) + " patients, " + pct(c.discordant, c.pairs) + " discordant", { size: FS.body, fill: p.ink, weight: 600, maxW: tableW }));
        yy += FS.body + 10;
        out.push(label(x0, yy + FS.small, rowLab, { size: FS.small, fill: p.muted, maxW: lw - 4 }));
        short.forEach((s, ci) => out.push(label(x0 + lw + ci * cellW + cellW / 2, yy + FS.small, s, { size: FS.small, fill: p.muted, anchor: "middle" })));
        yy += FS.small + 6;
        const max = Math.max(1, ...c.table.flat());
        c.table.forEach((row, ri) => {
          out.push(label(x0 + lw - GUT, yy + 14, short[ri], { size: FS.small, fill: p.muted, anchor: "end" }));
          row.forEach((n, ci) => {
            const cx = x0 + lw + ci * cellW, diag = ri === ci;
            out.push(`<rect x="${r1(cx + 1)}" y="${r1(yy + 1)}" width="${cellW - 2}" height="18" fill="${diag ? seriesStyle(0).color : OTHER}" opacity="${n ? r1(0.12 + 0.6 * Math.sqrt(n / max)) : 0.05}"/>`);
            out.push(label(cx + cellW / 2, yy + 13, n ? fmtInt(n) : "·", { size: FS.small, fill: p.ink, anchor: "middle" }));
          });
          yy += 20;
        });
        h = Math.max(h, yy - y);
      });
      y += h + 14;
    }
  }
  const cap = caption("Bars: each patient once, at their highest sensitive level; the right column is the share at levels 1–3B and the share with a resistance level (R1/R2) besides. " + (v.caveat || ""), W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, W > want, "Clinical actionability — OncoKB " + r.pin);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
