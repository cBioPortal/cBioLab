// Treatment sequences as a Sankey.
import type { ViewResult, SequencePanel, SequenceNodeKind } from "../types.ts";
import { esc, SERIES, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";

/**
 * Treatment sequences as a Sankey: columns are lines of therapy, ribbons are
 * patients moving between them. One panel per cohort, stacked.
 *
 * ONE SCALE EVERYWHERE — across columns AND across panels. The second line being
 * visibly thinner than the first is the point, and so is one cohort being
 * smaller than the other; normalising either would hide exactly the attrition
 * and imbalance the chart exists to show.
 *
 * TWO KINDS OF ENDING, drawn differently. A path that ends because the study
 * watched and saw no further therapy is a finding; a path that ends because the
 * record stops is an artefact. Merging them into one grey block — which is what
 * this chart did before the fates were measured — makes censoring look like a
 * clinical decision, and censoring is usually the bigger share.
 */
const SEQ_STOPPED = "#8fa3ae";
const SEQ_CENSORED = "#c8ced2";
export function sequenceSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W = o.width || 720;
  const sq = v.sequence!;
  const panels = sq.panels;
  const L = 8, R = 8, NODE_W = 13, GAP = 6, PANEL_H = 270, HEAD = 30, PANEL_GAP = 22;
  const cols = [...new Set(panels.flatMap((pn) => pn.nodes.map((n) => n.column)))].sort((a, b) => a - b);

  // One scale for every panel: the biggest column anywhere fills PANEL_H.
  const colTotal = (pn: SequencePanel, c: number) =>
    pn.nodes.filter((n) => n.column === c).reduce((t, n) => t + n.n, 0);
  const maxTotal = Math.max(1, ...panels.flatMap((pn) => cols.map((c) => colTotal(pn, c))));
  const maxCount = Math.max(1, ...panels.flatMap((pn) => cols.map((c) => pn.nodes.filter((n) => n.column === c).length)));
  const scale = (PANEL_H - GAP * (maxCount - 1)) / maxTotal;

  // Colour follows the regimen globally, so a label means the same thing in
  // every column and every panel.
  const ranked = [...new Set(panels.flatMap((pn) => pn.nodes)
    .filter((n) => n.kind === "regimen" && n.label !== "other")
    .sort((a, b) => b.n - a.n).map((n) => n.label))];
  const colourOf = (kind: SequenceNodeKind, label: string) =>
    kind === "stopped" ? SEQ_STOPPED : kind === "censored" ? SEQ_CENSORED
      : label === "other" ? "#9aa7b0" : SERIES[ranked.indexOf(label) % SERIES.length];
  const nameOf = (kind: SequenceNodeKind, label: string) =>
    kind === "stopped" ? "no further line" : kind === "censored" ? "record ends here" : label;

  const colX = (c: number) => cols.length < 2 ? L
    : L + (W - L - R - NODE_W) * (cols.indexOf(c) / (cols.length - 1));
  const bodyH = panels.length * (HEAD + PANEL_H) + (panels.length - 1) * PANEL_GAP;
  const cap = caption(v.caveat || "", W, bodyH + 30, p.muted);
  const H = bodyH + 30 + cap.height + 12;

  const out: string[] = [];
  panels.forEach((pn, pi) => {
    const top = pi * (HEAD + PANEL_H + PANEL_GAP) + HEAD;
    out.push(`<text x="8" y="${top - 16}" font-size="11" font-weight="600" fill="${p.ink}">${esc(pn.cohort)}` +
      `<tspan font-weight="400" fill="${p.muted}"> \u2014 ${fmt(pn.started)} with a first line, ` +
      `${pn.started ? Math.round(100 * pn.censored / pn.started) : 0}% of paths censored</tspan></text>`);
    for (const c of cols) {
      const last = c === cols[cols.length - 1];
      out.push(`<text x="${num(last ? colX(c) + NODE_W : colX(c))}" y="${top - 4}" font-size="9.5" ` +
        `text-anchor="${last ? "end" : "start"}" fill="${p.muted}">` +
        (c <= sq.steps ? `line ${c}` : `line ${c}+`) + `</text>`);
    }

    // Regimens biggest-first, then the two terminals at the bottom: they are
    // usually the largest nodes, and sorting them by size would shove every
    // continuing regimen down and cross most of the ribbons.
    const rank = (k: SequenceNodeKind) => k === "regimen" ? 0 : k === "stopped" ? 1 : 2;
    const box = new Map<string, { x: number; y: number; h: number }>();
    for (const c of cols) {
      const list = pn.nodes.filter((n) => n.column === c)
        .sort((a, b) => rank(a.kind) - rank(b.kind) || b.n - a.n);
      let y = top;
      for (const n of list) {
        const h = Math.max(1, n.n * scale);
        box.set(c + "\u0000" + n.kind + "\u0000" + n.label, { x: colX(c), y, h });
        y += h + GAP;
      }
    }

    const outOff = new Map<string, number>(), inOff = new Map<string, number>();
    for (const f of [...pn.flows].sort((a, b) => a.column - b.column || rank(a.kind) - rank(b.kind) || b.n - a.n)) {
      const ka = f.column + "\u0000regimen\u0000" + f.from;
      const kb = (f.column + 1) + "\u0000" + f.kind + "\u0000" + f.to;
      const a = box.get(ka), b = box.get(kb);
      if (!a || !b) continue;
      const h = Math.max(0.6, f.n * scale);
      const y0 = a.y + (outOff.get(ka) || 0), y1 = b.y + (inOff.get(kb) || 0);
      outOff.set(ka, (outOff.get(ka) || 0) + h);
      inOff.set(kb, (inOff.get(kb) || 0) + h);
      const x0 = a.x + NODE_W, x1 = b.x, xm = (x0 + x1) / 2;
      const colour = f.kind === "regimen" ? colourOf("regimen", f.from) : colourOf(f.kind, "");
      out.push(`<path d="M ${num(x0)} ${num(y0)} C ${num(xm)} ${num(y0)}, ${num(xm)} ${num(y1)}, ${num(x1)} ${num(y1)} ` +
        `L ${num(x1)} ${num(y1 + h)} C ${num(xm)} ${num(y1 + h)}, ${num(xm)} ${num(y0 + h)}, ${num(x0)} ${num(y0 + h)} Z" ` +
        `fill="${colour}" fill-opacity="${f.kind === "regimen" ? 0.32 : 0.45}"/>`);
    }

    for (const n of pn.nodes) {
      const bx = box.get(n.column + "\u0000" + n.kind + "\u0000" + n.label);
      if (!bx) continue;
      out.push(`<rect x="${num(bx.x)}" y="${num(bx.y)}" width="${NODE_W}" height="${num(bx.h)}" rx="2" ` +
        `fill="${colourOf(n.kind, n.label)}"/>`);
      if (bx.h >= 11) {
        const last = bx.x + NODE_W > W - 150;
        const text = nameOf(n.kind, n.label) + " " + fmt(n.n);
        out.push(`<text x="${num(last ? bx.x - 5 : bx.x + NODE_W + 5)}" y="${num(bx.y + bx.h / 2 + 3)}" ` +
          `font-size="9.5" text-anchor="${last ? "end" : "start"}" fill="${p.ink}">${esc(text)}</text>`);
      }
    }
  });

  // Legend for the two terminals: their difference is the whole point, and a
  // reader must not have to infer it from two shades of grey.
  const ly = bodyH + 14;
  [["no further line \u2014 watched, none started", SEQ_STOPPED],
   ["record ends here \u2014 nothing can be concluded", SEQ_CENSORED]].forEach(([t, c], i) => {
    out.push(`<rect x="${8 + i * 300}" y="${ly - 8}" width="9" height="9" rx="2" fill="${c}"/>`);
    out.push(`<text x="${22 + i * 300}" y="${ly}" font-size="9.5" fill="${p.muted}">${esc(t)}</text>`);
  });
  out.push(cap.svg);
  return frame(W, H, out.join(""), p.bg);
}

