// Horizontal bars, one row per item: the figure MCP gets for the views the page shows as tables
// (compare, co-occurrence, co-expression, clinical).
import type { ViewResult, CooccurRow, CompareRow, ClinicalRow, CoexprRow } from "../types.ts";
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "../svg-kit.ts";

/** Shared horizontal-bar figure: label, bar, value. */
function barsSvg(title: string, rows: { label: string; v: number; text: string; colour?: string; signed?: boolean }[],
  note: string, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const ROW = 18, LEFT = 190, RIGHT = 96, T = 22;
  const cap = caption(note, W, T + rows.length * ROW + 6, p.muted);
  const H = T + rows.length * ROW + cap.height + 12;
  const span = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  const plotW = W - LEFT - RIGHT;
  const out = [`<text x="8" y="14" font-size="11" font-weight="600" fill="${p.ink}">${esc(title)}</text>`];
  rows.forEach((r, i) => {
    const y = T + i * ROW;
    out.push(`<text x="8" y="${y + 11}" font-size="10" fill="${p.ink}">${esc(r.label.length > 30 ? r.label.slice(0, 29) + "…" : r.label)}</text>`);
    const w = Math.max(1, (Math.abs(r.v) / span) * (r.signed ? plotW / 2 : plotW));
    const x = r.signed ? (r.v < 0 ? LEFT + plotW / 2 - w : LEFT + plotW / 2) : LEFT;
    out.push(`<rect x="${num(x)}" y="${y + 3}" width="${num(w)}" height="8" rx="2" fill="${r.colour || SERIES[0]}" opacity="0.8"/>`);
    if (r.signed) out.push(`<line x1="${LEFT + plotW / 2}" y1="${y + 1}" x2="${LEFT + plotW / 2}" y2="${y + 13}" stroke="${p.muted}" stroke-width="1" opacity="0.5"/>`);
    out.push(`<text x="${W - 8}" y="${y + 11}" font-size="10" fill="${p.muted}" text-anchor="end">${esc(r.text)}</text>`);
  });
  out.push(cap.svg);
  return frame(W, H, out.join(""), p.bg);
}

export function cooccurrenceSvg(v: ViewResult, o: SvgOpts): string {
  const pairs = ((v.pairs || []) as CooccurRow[]);
  return barsSvg("Co-occurrence — log₂ odds ratio", pairs.map((r) => {
    const lor = r.oddsRatioMH != null ? Math.log2(r.oddsRatioMH) : (r.log2Odds ?? 0);
    return { label: r.a + " / " + r.b, v: lor, signed: true,
      colour: lor < 0 ? "#D55E00" : "#0072B2",
      text: num(lor) + "   " + pFmt(r.pStratified ?? r.p).replace("p=", "") };
  }), v.note || "", o);
}

export function compareSvg(v: ViewResult, o: SvgOpts): string {
  const rows = ((v.rows || []) as CompareRow[]);
  const names = v.cohorts || [];
  const out: { label: string; v: number; text: string; colour?: string }[] = [];
  for (const r of rows)
    r.cells.forEach((c, ci) => out.push({
      label: (ci === 0 ? r.gene : ""), v: c.anyPct ?? 0, colour: SERIES[ci % SERIES.length],
      text: esc(names[ci] || c.cohort) + " " + (c.anyPct ?? 0) + "%"
    }));
  return barsSvg("Altered %, by cohort", out, v.note || "", o);
}

export function coexpressionSvg(v: ViewResult, o: SvgOpts): string {
  const rows = ((v.coexpression || []) as CoexprRow[]);
  return barsSvg("Co-expression — Pearson r", rows.map((r) => {
    const rr = r.rMeta ?? r.r ?? 0;
    return { label: r.a + " / " + r.b, v: rr, signed: true,
      colour: rr < 0 ? "#D55E00" : "#0072B2", text: num(rr) + "   n=" + fmt(r.n) };
  }), v.note || "", o);
}

export function clinicalSvg(v: ViewResult, o: SvgOpts): string {
  const rows = ((v.clinical || []) as ClinicalRow[]).filter((r) => !r.skipped);
  return barsSvg("Clinical comparison — −log₁₀ q", rows.map((r) => ({
    label: r.attribute, v: r.q ? Math.min(50, -Math.log10(Math.max(r.q, 1e-50))) : 0,
    text: r.test + "  q=" + (r.q == null ? "—" : r.q < 1e-4 ? r.q.toExponential(1) : r.q.toFixed(4))
  })), v.note || "", o);
}

