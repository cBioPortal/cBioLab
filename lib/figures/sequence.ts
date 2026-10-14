// Treatment sequences as a Sankey.
import type { ViewResult, SequencePanel, SequenceNodeKind } from "../types.ts";
import {
  palette, frame, caption, label, legend, textWidth, seriesStyle, fmtInt, fmtShare, esc, num,
  FS, OTHER, type SvgOpts, type LegendItem
} from "../svg-kit.ts";

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
 * record stops is an artefact. Merging them into one grey block makes censoring
 * look like a clinical decision, and censoring is usually the bigger share.
 *
 * Every regimen the engine kept has a colour in the key above the panels (the rest are
 * already pooled into "other" by the engine). A node is labelled where its label has room
 * beside it without touching another; the caption says how many are not, and every node
 * and ribbon names itself on hover.
 */
const SEQ_STOPPED = "#62737d";
const SEQ_CENSORED = "#c8ced2";
const L = 8, R = 8, NODE_W = 13, GAP = 10, HEAD = 32, PANEL_GAP = 24, MIN_SPACING = 110, MAX_LAST = 200;
const LABEL_H = FS.small + 2;

const nameOf = (kind: SequenceNodeKind, label: string) =>
  kind === "stopped" ? "no further line" : kind === "censored" ? "record ends here" : label;
const nodeText = (n: { kind: SequenceNodeKind; label: string; n: number }) => nameOf(n.kind, n.label) + " " + fmtInt(n.n);

/**
 * One column's labels, placed biggest node first: each at its node's centre, or moved up or
 * down by at most `shift(i)` to clear the labels already placed; one that cannot is left out.
 * Returns each label's centre, or null.
 */
export function placeLabels(nodes: { y: number; h: number }[], height = LABEL_H): (number | null)[] {
  const order = nodes.map((_, i) => i).sort((a, b) => nodes[b].h - nodes[a].h);
  const taken: [number, number][] = [];
  const free = (c: number) => taken.every(([a, b]) => c + height / 2 + 1 <= a || c - height / 2 - 1 >= b);
  const at: (number | null)[] = nodes.map(() => null);
  for (const i of order) {
    const c0 = nodes[i].y + nodes[i].h / 2, max = Math.max(GAP / 2, nodes[i].h / 2 - height / 2);
    for (let d = 0; d <= max; d += 0.5) {
      const c = free(c0 - d) ? c0 - d : free(c0 + d) ? c0 + d : null;
      if (c == null) continue;
      at[i] = c;
      taken.push([c - height / 2, c + height / 2]);
      break;
    }
  }
  return at;
}

export function sequenceSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), W0 = o.width || 720;
  const sq = v.sequence!;
  const panels = sq.panels;
  const cols = [...new Set(panels.flatMap((pn) => pn.nodes.map((n) => n.column)))].sort((a, b) => a - b);
  const lastCol = cols[cols.length - 1];

  // the last column's labels have a margin of their own; the other columns spread across the rest
  const lastRoom = Math.min(MAX_LAST, Math.ceil(Math.max(0, ...panels.flatMap((pn) =>
    pn.nodes.filter((n) => n.column === lastCol).map((n) => textWidth(nodeText(n), FS.small)))))) + 6;
  const W = Math.max(W0, L + R + NODE_W + lastRoom + 4 + (cols.length - 1) * MIN_SPACING);
  const span = W - L - R - NODE_W - lastRoom - 4;
  const colX = (c: number) => cols.length < 2 ? L : L + span * (cols.indexOf(c) / (cols.length - 1));
  const spacing = cols.length < 2 ? span : span / (cols.length - 1);
  const roomOf = (c: number) => c === lastCol ? lastRoom : spacing - NODE_W - 8;

  // One scale for every panel: the biggest column anywhere fills the panel's height.
  const colTotal = (pn: SequencePanel, c: number) =>
    pn.nodes.filter((n) => n.column === c).reduce((t, n) => t + n.n, 0);
  const maxTotal = Math.max(1, ...panels.flatMap((pn) => cols.map((c) => colTotal(pn, c))));
  const maxCount = Math.max(1, ...panels.flatMap((pn) => cols.map((c) => pn.nodes.filter((n) => n.column === c).length)));
  const PANEL_H = Math.max(270, Math.min(560, maxCount * 24));
  const scale = (PANEL_H - GAP * (maxCount - 1)) / maxTotal;

  // Colour follows the regimen globally, so a label means the same thing in
  // every column and every panel.
  const ranked = [...new Set(panels.flatMap((pn) => pn.nodes)
    .filter((n) => n.kind === "regimen" && n.label !== "other")
    .sort((a, b) => b.n - a.n).map((n) => n.label))];
  const hasOther = panels.some((pn) => pn.nodes.some((n) => n.kind === "regimen" && n.label === "other"));
  const styleOf = (kind: SequenceNodeKind, label: string): { color: string; tint: number } =>
    kind === "stopped" ? { color: SEQ_STOPPED, tint: 1 } : kind === "censored" ? { color: SEQ_CENSORED, tint: 1 }
      : label === "other" ? { color: OTHER, tint: 1 } : seriesStyle(ranked.indexOf(label));

  const out: string[] = [];
  // the key: every regimen's colour, then "other" and the two endings, whose difference is the point
  const items: LegendItem[] = [
    ...ranked.map((r) => { const s = styleOf("regimen", r); return { label: r, color: s.color, opacity: s.tint }; }),
    ...(hasOther ? [{ label: "other", color: OTHER, detail: sq.foldedLabels ? fmtInt(sq.foldedLabels) + " less common regimens" : undefined }] : []),
    { label: "no further line", color: SEQ_STOPPED, detail: "watched, none started" },
    { label: "record ends here", color: SEQ_CENSORED, detail: "nothing can be concluded" },
  ];
  const lg = legend(items, L, 4, W - L - R, p);
  out.push(lg.svg);
  const bodyTop = 4 + lg.height + 10;

  let labelled = 0, total = 0, bottom = bodyTop - PANEL_GAP;
  panels.forEach((pn) => {
    const top = bottom + PANEL_GAP + HEAD;
    const nameW = Math.min(textWidth(pn.cohort, FS.body, 600), W * 0.5);
    out.push(label(L, top - 18, pn.cohort, { size: FS.body, weight: 600, fill: p.ink, maxW: W * 0.5 }));
    out.push(label(L + nameW + 4, top - 18, "— " + fmtInt(pn.started) + " with a first line, " +
      (pn.started ? fmtShare(pn.censored / pn.started) : "0%") + " of paths censored",
      { size: FS.body, fill: p.muted, maxW: W - L - R - nameW - 4 }));
    for (const c of cols)
      out.push(label(colX(c), top - 5, c <= sq.steps ? `line ${c}` : `line ${c}+`, { size: FS.small, fill: p.muted }));

    // Regimens biggest-first, then the two terminals at the bottom: they are
    // usually the largest nodes, and sorting them by size would shove every
    // continuing regimen down and cross most of the ribbons.
    const rank = (k: SequenceNodeKind) => k === "regimen" ? 0 : k === "stopped" ? 1 : 2;
    const box = new Map<string, { x: number; y: number; h: number }>();
    const byCol = new Map<number, { n: SequencePanel["nodes"][number]; y: number; h: number }[]>();
    for (const c of cols) {
      const list = pn.nodes.filter((n) => n.column === c)
        .sort((a, b) => rank(a.kind) - rank(b.kind) || b.n - a.n);
      let y = top;
      const placed: { n: SequencePanel["nodes"][number]; y: number; h: number }[] = [];
      for (const n of list) {
        const h = Math.max(1, n.n * scale);
        box.set(c + "\u0000" + n.kind + "\u0000" + n.label, { x: colX(c), y, h });
        placed.push({ n, y, h });
        bottom = Math.max(bottom, y + h);
        y += h + GAP;
      }
      byCol.set(c, placed);
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
      const st = f.kind === "regimen" ? styleOf("regimen", f.from) : styleOf(f.kind, "");
      const op = (f.kind === "regimen" ? 0.32 : 0.45) * st.tint;
      out.push(`<path d="M ${num(x0)} ${num(y0)} C ${num(xm)} ${num(y0)}, ${num(xm)} ${num(y1)}, ${num(x1)} ${num(y1)} ` +
        `L ${num(x1)} ${num(y1 + h)} C ${num(xm)} ${num(y1 + h)}, ${num(xm)} ${num(y0 + h)}, ${num(x0)} ${num(y0 + h)} Z" ` +
        `fill="${st.color}" fill-opacity="${num(op)}"><title>${esc(f.from + " → " + nameOf(f.kind, f.to) + ", line " + f.column + " to " + (f.column + 1) + ": " + fmtInt(f.n))}</title></path>`);
    }

    const labels: string[] = [];
    for (const c of cols) {
      const list = byCol.get(c)!;
      const at = placeLabels(list);
      list.forEach(({ n, y, h }, i) => {
        const st = styleOf(n.kind, n.label);
        total++;
        out.push(`<rect x="${num(colX(c))}" y="${num(y)}" width="${NODE_W}" height="${num(h)}" rx="2" ` +
          `fill="${st.color}"${st.tint < 1 ? ` opacity="${st.tint}"` : ""}><title>${esc(nodeText(n) + " (line " + c + ")")}</title></rect>`);
        const cy = at[i];
        if (cy == null) return;
        labelled++;
        labels.push(label(colX(c) + NODE_W + 4, cy + FS.small * 0.35, nodeText(n), { size: FS.small, fill: p.ink, maxW: roomOf(c),
          extra: `stroke="${p.bg}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"` }));
      });
    }
    // labels over every ribbon, each with a halo of the background so a ribbon cannot cross it
    out.push(labels.join(""));
  });

  const bodyH = bottom + 4;
  const unl = total - labelled;
  const note = unl ? fmtInt(unl) + " of " + fmtInt(total) + " nodes are too small to label here; each names itself and its count on hover, and its colour is in the key above. " : "";
  const cap = caption(note + (v.caveat || ""), W, bodyH + 8, p.muted);
  return frame(W, bodyH + 8 + cap.height + 8, out.join("") + cap.svg, p.bg, W > W0,
    "Treatment sequence — " + panels.map((pn) => pn.cohort).join(", "));
}
