// Assays figure: one generic-assay profile's entities compared between cohorts — the shared volcano
// (two cohorts, numeric), a row per entity with each cohort's mean or mix of values, and the picked
// entity per cohort (assayEntitySvg, the page's plot beside its table).
import type { ViewResultOf, DrawnResultOf } from "../../types.ts";
import {
  palette, frame, caption, label, textWidth, wrapWidth, linear, axisBottom, bottomAxisHeight, legend,
  seriesStyle, fmtInt, fmtNum, pDigits, esc, FS, SW, type SvgOpts, type LegendItem
} from "../../svg-kit.ts";
import { AMP, DEL } from "../../figures/common.ts";
import { volcano, volcanoPlotH } from "../../figures/volcano.ts";

type Pal = ReturnType<typeof palette>;
type AsResult = NonNullable<ViewResultOf<"assays">["assays"]>;
type AsRow = AsResult["rows"][number];
interface Fill { color: string; opacity: number }

/**
 * A categorical assay's value colours, the same in every figure: the first gain-like value takes the
 * oncoprint's amplification colour and the first loss-like its deep-deletion colour, a neutral
 * value the rule colour, and every other value the next series colour (tinted past six), skipping
 * the series hues nearest those two so no two values read alike.
 */
export function valueColors(values: string[], p: Pal): Map<string, Fill> {
  const m = new Map<string, Fill>();
  const gain = values.find((v) => /^(gain|amp)/i.test(v)), loss = values.find((v) => /^(loss|del|homdel)/i.test(v));
  if (gain) m.set(gain, { color: AMP, opacity: 1 });
  if (loss) m.set(loss, { color: DEL, opacity: 1 });
  // SERIES[0] (blue) sits next to DEL, SERIES[4] (vermilion) next to AMP
  const skip = new Set([...(loss ? [0] : []), ...(gain ? [4] : [])]);
  let k = 0;
  for (const v of values) {
    if (m.has(v)) continue;
    if (/^(unchanged|neutral|normal|wt|no)$/i.test(v)) { m.set(v, { color: p.line, opacity: 1 }); continue; }
    while (skip.has(k % 6) && k < 6) k++;
    const st = seriesStyle(k++);
    m.set(v, { color: st.color, opacity: st.tint });
  }
  return m;
}
const op = (f: Fill) => f.opacity < 1 ? ` opacity="${f.opacity}"` : "";

const GAP = 28;
const MIN_W = 360;
/** rows of the entity table drawn; the rest are counted */
const ROWS_NUM = 18, ROWS_CAT = 24;

export function assaysSvg(v: DrawnResultOf<"assays">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.assays;
  const want = o.width || 960;
  const cat = r.datatype === "categorical";
  const two = r.groups.length === 2 && !!r.grid;
  const k = r.groups.length;
  const shown = r.rows.slice(0, cat ? ROWS_CAT : ROWS_NUM);
  // the table needs: a name column, and per cohort a bar and its value
  const nameW = Math.min(220, Math.max(textWidth("entity", FS.small), ...shown.map((g) => textWidth(g.name, FS.body, 600))));
  const qW = Math.max(textWidth("q", FS.small), ...shown.map((g) => textWidth(pDigits(g.q), FS.small)));
  const MIN_COL = cat ? 70 : 90;
  const tableMin = nameW + 12 + k * MIN_COL + 10 + qW;
  const sideBySide = two && want - GAP - tableMin >= MIN_W;
  const W = Math.max(want, MIN_W, Math.ceil(tableMin + 16));
  const out: string[] = [];
  const head = fmtInt(r.tested) + " " + r.profileName + " entities tested (" + r.test + ") · " + fmtInt(r.significant) + " at q < 0.05";
  const hl = wrapWidth(head, W - 16, FS.body);
  hl.forEach((l, i) => out.push(label(8, 14 + i * Math.round(FS.body * 1.4), l, { size: FS.body, fill: p.muted })));
  const y0 = 14 + hl.length * Math.round(FS.body * 1.4) + 4;
  let bottom = y0;
  let TX = 8, TW = W - 16, ty = y0;
  if (two) {
    const vw = sideBySide ? Math.max(MIN_W, Math.round((W - GAP) * 0.45)) : W;
    const vo = volcano(p, { x0: 0, y0, width: vw, plotH: volcanoPlotH(vw), grid: r.grid!, labels: r.labels, r: 3, noun: "entities",
      xTitle: "difference in mean (" + r.groups[0] + " − " + r.groups[1] + ")", sides: ["higher in " + r.groups[0], "higher in " + r.groups[1]],
      pts: r.rows.map((row) => ({ key: row.entity, label: row.name, x: row.diff ?? 0, p: row.p,
        color: row.q < 0.05 ? seriesStyle(Math.max(0, r.groups.indexOf(row.higherIn))).color : p.muted,
        tip: row.name + ": " + fmtNum(row.diff ?? 0) + " · q " + pDigits(row.q) })) });
    out.push(vo.svg);
    bottom = y0 + vo.height;
    if (sideBySide) { TX = vw + GAP; TW = W - TX - 8; }
    else ty = bottom + GAP;
  }
  const t = entityTable(r, p, shown, TX, ty, TW, nameW, qW, cat);
  out.push(t.svg);
  let tb = ty + t.height;
  if (r.tested > shown.length) {
    tb += FS.small + 6;
    out.push(label(TX, tb, "+" + fmtInt(r.tested - shown.length) + " more entities tested (the full table is in the result and the MCP text)", { size: FS.small, fill: p.muted, maxW: W - TX - 8 }));
  }
  bottom = Math.max(bottom, tb) + 8;
  const cap = caption(v.caveat || "", W, bottom, p.muted);
  return frame(W, bottom + cap.height + 8, out.join("") + cap.svg, p.bg, W > want,
    "Generic assays — " + r.profileName + " — " + r.groups.join(" vs "));
}

/** one row per entity: its name, each cohort's mean as a bar (or its mix of values as a 100% bar), q */
function entityTable(r: AsResult, p: Pal, shown: AsRow[], x0: number, y0: number, w: number, nameW: number, qW: number, cat: boolean): { svg: string; height: number } {
  const out: string[] = [];
  const k = r.groups.length;
  let y = y0;
  const colors = valueColors(r.values || [], p);
  if (cat && r.values) {
    const lg = legend(r.values.map((val) => ({ label: val, color: colors.get(val)!.color, opacity: colors.get(val)!.opacity })), x0, y, w, p, { size: FS.small });
    out.push(lg.svg);
    y += lg.height + 4;
  }
  const colL = x0 + nameW + 12, qx = x0 + w;
  const colW = (qx - qW - 10 - colL) / k;
  // numeric: one scale for every bar, so means compare down and across
  const means = shown.flatMap((g) => g.cells.map((c) => c.mean ?? 0));
  const nonNeg = means.every((m) => m >= 0), maxMean = Math.max(1e-12, ...means.map(Math.abs));
  const valW = cat ? 0 : Math.max(...shown.flatMap((g) => g.cells.map((c) => textWidth(c.mean == null ? "–" : fmtNum(c.mean), FS.small))));
  const barMax = Math.max(8, colW - valW - 12);
  y += FS.small;
  out.push(label(x0, y, cat ? "entity" : "entity · mean", { size: FS.small, fill: p.muted, maxW: nameW }));
  r.groups.forEach((n, i) => {
    const st = seriesStyle(i), x = colL + i * colW;
    out.push(`<rect x="${r1(x)}" y="${y - 8}" width="8" height="8" rx="1" fill="${st.color}"${st.tint < 1 ? ` opacity="${st.tint}"` : ""}/>`);
    out.push(label(x + 12, y, n, { size: FS.small, fill: p.ink, weight: 600, maxW: colW - 20 }));
  });
  out.push(label(qx, y, "q", { size: FS.small, fill: p.muted, anchor: "end" }));
  y += 4;
  out.push(`<line x1="${x0}" y1="${y}" x2="${qx}" y2="${y}" stroke="${p.line}" stroke-width="${SW.line}"/>`);
  const ROW = 18;
  shown.forEach((g, i) => {
    const top = y + 3 + i * ROW, mid = top + ROW / 2;
    out.push(label(x0, mid + FS.body * 0.35, g.name, { size: FS.body, fill: p.ink, weight: 600, maxW: nameW }));
    g.cells.forEach((c, ci) => {
      const bx = colL + ci * colW;
      if (cat) {
        let x = bx;
        const bw = colW - 8;
        for (const val of r.values || []) {
          const n = c.values?.[val] || 0;
          if (!n || !c.n) continue;
          const ww = bw * n / c.n, f = colors.get(val)!;
          out.push(`<rect x="${r1(x)}" y="${mid - 5}" width="${r1(ww)}" height="10" fill="${f.color}"${op(f)}><title>${esc(c.cohort + ": " + val + " " + n + "/" + c.n)}</title></rect>`);
          x += ww;
        }
      } else {
        const m = c.mean, st = seriesStyle(ci);
        const bw = nonNeg && m != null ? barMax * m / maxMean : 0;
        if (nonNeg) out.push(`<rect x="${r1(bx)}" y="${mid - 5}" width="${r1(Math.max(0.5, bw))}" height="10" fill="${st.color}" opacity="${r2(0.85 * st.tint)}"/>`);
        out.push(label(bx + bw + 4, mid + FS.small * 0.35, m == null ? "–" : fmtNum(m), { size: FS.small, fill: p.muted }));
      }
    });
    out.push(label(qx, mid + FS.small * 0.35, pDigits(g.q), { size: FS.small, fill: g.q < 0.05 ? p.ink : p.muted, anchor: "end" }));
  });
  return { svg: out.join(""), height: y + 3 + shown.length * ROW - y0 };
}

/**
 * The picked entity, per cohort: mean ± SD on one axis (numeric) or the cohort's mix of values as
 * a 100% bar (categorical). A measure that cannot go below zero (every mean ≥ 0) has its whiskers
 * stopped at 0, and a contribution or proportion (means within 0–1) at 1 as well; the axis title
 * says so.
 */
export function assayEntitySvg(r: AsResult, e: AsRow, o: SvgOpts = {}): string {
  const p = palette(o.theme), want = o.width || 520, W = Math.max(320, want);
  const out: string[] = [label(8, 16, e.name, { size: FS.title, fill: p.ink, weight: 600, maxW: W - 16 })];
  const rowLabel = (c: AsRow["cells"][number]) => c.cohort + " (n = " + fmtInt(c.n) + ")";
  const labW = Math.min(W * 0.4, Math.max(...e.cells.map((c) => textWidth(rowLabel(c), FS.body))));
  const L = 8 + labW + 10, R = W - 12, ROW = 30, T = 30;
  const unit = r.unit.replace(/s$/, "");
  if (r.datatype === "numeric") {
    const cells = e.cells.filter((c) => c.mean != null);
    const nonNeg = cells.every((c) => c.mean! >= 0);
    const share = nonNeg && cells.every((c) => c.mean! <= 1) && /signature|contribution|proportion|fraction/i.test(r.assayType + " " + r.profileName);
    const lo = (c: AsRow["cells"][number]) => Math.max(nonNeg ? 0 : -Infinity, c.mean! - (c.sd ?? 0));
    const hi = (c: AsRow["cells"][number]) => Math.min(share ? 1 : Infinity, c.mean! + (c.sd ?? 0));
    const a = Math.min(0, ...cells.map(lo)), b = Math.max(a + 1e-9, ...cells.map(hi));
    const xs = linear(a, b, L, R);
    const yb = T + 8 + e.cells.length * ROW;
    for (const t of xs.ticks) out.push(`<line x1="${r1(xs(t))}" y1="${T}" x2="${r1(xs(t))}" y2="${yb}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
    e.cells.forEach((c, i) => {
      const y = T + 14 + i * ROW, st = seriesStyle(i);
      out.push(label(L - 10, y + FS.body * 0.35, rowLabel(c), { size: FS.body, fill: p.ink, anchor: "end", maxW: labW }));
      if (c.mean == null) { out.push(label(L, y + FS.small * 0.35, "no values", { size: FS.small, fill: p.muted })); return; }
      if (c.sd != null) out.push(`<line x1="${r1(xs(lo(c)))}" y1="${y}" x2="${r1(xs(hi(c)))}" y2="${y}" stroke="${st.color}" stroke-width="${SW.series}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/>`);
      out.push(`<circle cx="${r1(xs(c.mean))}" cy="${y}" r="5" fill="${st.color}"/>`);
      const txt = fmtNum(c.mean), half = textWidth(txt, FS.small) / 2;
      out.push(label(Math.max(L + half, Math.min(R - half, xs(c.mean))), y - 8, txt, { size: FS.small, fill: p.muted, anchor: "middle" }));
    });
    const title = "mean ± SD per " + unit;
    out.push(axisBottom(xs, yb, p, { title, minX: 0, maxX: W }));
    const cap = caption(share ? "Whiskers stop at 0 and 1, the ends a proportion can take." : nonNeg ? "Whiskers stop at 0: the values cannot go below it." : "",
      W, yb + bottomAxisHeight(title), p.muted);
    return frame(W, yb + bottomAxisHeight(title) + cap.height + 8, out.join("") + cap.svg, p.bg, W > want, e.name + " — per cohort");
  }
  const vals = r.values || [];
  const colors = valueColors(vals, p);
  e.cells.forEach((c, i) => {
    const y = T + 6 + i * ROW;
    out.push(label(L - 10, y + 8 + FS.body * 0.35, rowLabel(c), { size: FS.body, fill: p.ink, anchor: "end", maxW: labW }));
    let x = L;
    for (const val of vals) {
      const n = c.values?.[val] || 0, w = c.n ? (R - L) * n / c.n : 0;
      const f = colors.get(val)!;
      if (w > 0) out.push(`<rect x="${r1(x)}" y="${y}" width="${r1(w)}" height="16" fill="${f.color}"${op(f)}><title>${esc(val + ": " + fmtInt(n) + " of " + fmtInt(c.n))}</title></rect>`);
      x += w;
    }
  });
  const yb = T + 6 + e.cells.length * ROW + 4;
  const items: LegendItem[] = vals.map((val) => ({ label: val, color: colors.get(val)!.color, opacity: colors.get(val)!.opacity }));
  const lg = legend(items, L, yb, R - L, p, { size: FS.small });
  out.push(lg.svg);
  return frame(W, yb + lg.height + 8, out.join(""), p.bg, W > want, e.name + " — per cohort");
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
