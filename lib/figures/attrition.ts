// Attrition figure: each cohort narrowing clause by clause, as a CONSORT-style column.
//
// Columns share the figure's width; past as many as fit at a readable width they wrap onto a
// further row of columns rather than run off the edge. Every box is as wide as its column and its
// clause wraps to that width, so a long clause takes more lines, never more than the box.
import type { AttritionPanel, DrawnResultOf } from "../types.ts";
import {
  palette, frame, caption, label, wrapWidth, ellipsize, seriesStyle, fmtInt, fmtPct, esc, FS, SW, type SvgOpts
} from "../svg-kit.ts";

const PAD = 8, GAP = 20, MIN_COL = 200, MAX_COL = 340, ARROW = 24, LH = 14, ROW_GAP = 22;
/** a clause wraps to at most this many lines; the rest is cut, the full clause kept as the box's tooltip */
const MAX_LINES = 4;

/** how many columns of at least MIN_COL fit across `w`, and how wide each is */
export function attritionColumns(n: number, w: number): { perRow: number; col: number } {
  const room = w - 2 * PAD;
  const perRow = Math.max(1, Math.min(n, Math.floor((room + GAP) / (MIN_COL + GAP))));
  const col = Math.min(MAX_COL, (room - GAP * (perRow - 1)) / perRow);
  return { perRow, col: Math.floor(Math.max(MIN_COL, col)) };
}

/** a clause's lines inside a box `w` wide: wrapped, and past MAX_LINES the last one cut */
export function clauseLines(text: string, w: number): { lines: string[]; cut: boolean } {
  const lines = wrapWidth(text, w, FS.body);
  if (lines.length <= MAX_LINES) return { lines, cut: lines.some((l) => l.endsWith("…")) };
  return { lines: [...lines.slice(0, MAX_LINES - 1), ellipsize(lines.slice(MAX_LINES - 1).join(" "), w, FS.body)], cut: true };
}

export function attritionSvg(v: DrawnResultOf<"attrition">, o: SvgOpts): string {
  const p = palette(o.theme);
  const panels = v.attrition || [];
  const W0 = o.width || 760;
  const W = Math.max(W0, MIN_COL + 2 * PAD);
  const { perRow, col } = attritionColumns(panels.length, W);
  const inner = col - 16;

  // one header height per row of columns, so boxes start level
  const heads = panels.map((pn) => {
    const lines = wrapWidth(pn.cohort, col, FS.title, 600);
    return lines.length > 2 ? [lines[0], lines.slice(1).join(" ")] : lines;
  });

  const out: string[] = [];
  let rowTop = 0, bottom = 0;
  for (let r0 = 0; r0 < panels.length; r0 += perRow) {
    const row = panels.slice(r0, r0 + perRow);
    const headH = Math.max(...heads.slice(r0, r0 + perRow).map((h) => h.length)) * (FS.title + 4) + 6;
    let rowBottom = rowTop;
    row.forEach((pn, j) => {
      const i = r0 + j;
      const y = drawColumn(out, pn, i, PAD + j * (col + GAP), rowTop, col, inner, heads[i], headH, p);
      rowBottom = Math.max(rowBottom, y);
    });
    bottom = rowBottom;
    rowTop = rowBottom + ROW_GAP;
  }
  const cap = caption(v.caveat || "", W, bottom + 6, p.muted);
  return frame(W, bottom + 6 + cap.height + 8, out.join("") + cap.svg, p.bg, W > W0,
    "Cohort attrition — " + panels.map((pn) => pn.cohort).join(", "));
}

function drawColumn(out: string[], pn: AttritionPanel, i: number, x0: number, top: number, col: number, inner: number,
  head: string[], headH: number, p: ReturnType<typeof palette>): number {
  const st = seriesStyle(i);
  head.forEach((l, k) => out.push(label(x0, top + FS.title + 2 + k * (FS.title + 4), l,
    { size: FS.title, weight: 600, fill: p.ink, maxW: col })));
  if (head.length > 1 && head.join(" ") !== pn.cohort) out.push(`<title>${esc(pn.cohort)}</title>`);
  let y = top + headH;
  const box = (text: string, n: number, sub: string, strong: boolean) => {
    const { lines, cut } = clauseLines(text, inner);
    const h = 8 + lines.length * LH + FS.title + 8;
    const stroke = strong ? st.color : p.line;
    out.push(`<g>${cut ? `<title>${esc(text)}</title>` : ""}<rect x="${x0}" y="${y}" width="${col}" height="${h}" rx="4" fill="${p.bg}" ` +
      `stroke="${stroke}" stroke-width="${strong ? SW.series : SW.line}"${strong && st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/>`);
    lines.forEach((l, k) => out.push(label(x0 + 8, y + 6 + FS.body + k * LH, l, { size: FS.body, fill: p.muted })));
    const ny = y + 8 + lines.length * LH + FS.title - 1;
    out.push(`<text x="${x0 + 8}" y="${ny}" font-size="${FS.title}" font-weight="600" fill="${p.ink}">${fmtInt(n)}` +
      (sub ? `<tspan dx="5" font-size="${FS.small}" font-weight="400" fill="${p.muted}">${esc(sub)}</tspan>` : "") + `</text></g>`);
    y += h;
  };
  box("Every patient in " + (pn.studies.length === 1 ? pn.studies[0] : pn.studies.length + " studies"), pn.base, "patients", pn.steps.length === 0);
  pn.steps.forEach((s, k) => {
    const ax = x0 + 24;
    out.push(`<line x1="${ax}" y1="${y}" x2="${ax}" y2="${y + ARROW - 2}" stroke="${p.muted}" stroke-width="${SW.line}"/>` +
      `<path d="M ${ax - 4} ${y + ARROW - 7} L ${ax} ${y + ARROW - 1} L ${ax + 4} ${y + ARROW - 7}" fill="none" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
    if (s.excluded > 0)
      out.push(label(ax + 10, y + ARROW / 2 + FS.small * 0.35, "−" + fmtInt(s.excluded) + " excluded", { size: FS.small, fill: p.muted, maxW: col - 34 }));
    y += ARROW;
    box(s.label, s.n, s.pctOfBase == null ? "" : "(" + fmtPct(s.pctOfBase) + " of base)", k === pn.steps.length - 1);
  });
  return y;
}
