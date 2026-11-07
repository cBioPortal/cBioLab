// The pathwaymap view's figure: one PathwayMapper pathway drawn from its own layout (node centres
// and sizes as the library stores them), each gene node carrying its altered % per cohort on
// PathwayMapper's white-to-red scale (lib/oncoprint-style.ts frequencyColor).
import { PAD, titleLine } from "../../figures/bars.ts";
import type { DrawnResultOf } from "../../types.ts";
import { palette, frame, caption, label, textWidth, wrapWidth, textOn, legend, esc, fmtPct, fmtInt, fmtNum, r1, FS, SW, OTHER, type SvgOpts } from "../../svg-kit.ts";
import { frequencyColor } from "../../oncoprint-style.ts";
import { pathwayNamed, type Pathway, type PathwayNode, type EdgeType } from "./library.ts";
import type { PathwayMapCell } from "./types.ts";

/** the diagram's own units drawn at most this size (PathwayMapper's 14px labels on 150-wide nodes) and at least this,
 *  below which the figure keeps its width and scrolls rather than shrink nodes under their labels */
const SCALE_MAX = 1, SCALE_MIN = 0.75;
/** compound padding by type, and the room a compound's name takes under it (PathwayMapper's stylesheet) */
const COMPOUND_PAD: Record<string, number> = { FAMILY: 5, COMPLEX: 5, COMPARTMENT: 10, PROCESS: 10, GENE: 5 };
const COMPOUND_LABEL = FS.body + 4;
/** the colour key's stops, % */
const KEY = [0, 1, 5, 10, 25, 50, 100];
const ARROW = 7;

interface Box { x0: number; y0: number; x1: number; y1: number }

/** each node's box in diagram units: a leaf its own size about its centre, a compound its children's extent padded */
export function nodeBoxes(p: Pathway): Map<string, Box> {
  const kids = new Map<string, PathwayNode[]>();
  for (const n of p.nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) || []), n]);
  const out = new Map<string, Box>();
  const box = (n: PathwayNode, depth: number): Box => {
    const had = out.get(n.id);
    if (had) return had;
    const ch = kids.get(n.id) || [];
    let b: Box;
    if (!ch.length || depth > 20) b = { x0: n.x - n.w / 2, y0: n.y - n.h / 2, x1: n.x + n.w / 2, y1: n.y + n.h / 2 };
    else {
      const bs = ch.map((c) => { const cb = box(c, depth + 1); return kids.has(c.id) ? { ...cb, y1: cb.y1 + COMPOUND_LABEL } : cb; });
      const pad = COMPOUND_PAD[n.type] ?? 5;
      b = { x0: Math.min(...bs.map((x) => x.x0)) - pad, y0: Math.min(...bs.map((x) => x.y0)) - pad,
        x1: Math.max(...bs.map((x) => x.x1)) + pad, y1: Math.max(...bs.map((x) => x.y1)) + pad };
    }
    out.set(n.id, b);
    return b;
  };
  for (const n of p.nodes) box(n, 0);
  return out;
}

/** where the segment from the centre of `a` towards (tx, ty) leaves box `a` */
function exitPoint(a: Box, tx: number, ty: number): [number, number] {
  const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx ? (a.x1 - a.x0) / 2 / Math.abs(dx) : Infinity, sy = dy ? (a.y1 - a.y0) / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy, 1);
  return [cx + dx * t, cy + dy * t];
}

const DASHED = new Set<EdgeType>(["INDUCES", "REPRESSES"]);
const HEAD: Record<EdgeType, "triangle" | "tee" | "none"> = { ACTIVATES: "triangle", INDUCES: "triangle", INHIBITS: "tee", REPRESSES: "tee", BINDS: "none", NONE: "none" };

/** an edge's line and its head at (x2, y2), coming from (x1, y1) */
function edgeSvg(x1: number, y1: number, x2: number, y2: number, type: EdgeType, ink: string): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return "";
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, head = HEAD[type];
  const ex = head === "triangle" ? x2 - ux * ARROW : x2, ey = head === "triangle" ? y2 - uy * ARROW : y2;
  let s = `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(ex)}" y2="${r1(ey)}" stroke="${ink}" stroke-width="${SW.line}"${DASHED.has(type) ? ` stroke-dasharray="4 3"` : ""}/>`;
  if (head === "triangle") s += `<path d="M${r1(x2)},${r1(y2)} L${r1(ex - uy * ARROW / 2)},${r1(ey + ux * ARROW / 2)} L${r1(ex + uy * ARROW / 2)},${r1(ey - ux * ARROW / 2)} Z" fill="${ink}"/>`;
  if (head === "tee") s += `<line x1="${r1(x2 - uy * 6)}" y1="${r1(y2 + ux * 6)}" x2="${r1(x2 + uy * 6)}" y2="${r1(y2 - ux * 6)}" stroke="${ink}" stroke-width="${SW.series}"/>`;
  return s;
}

const cellText = (c: PathwayMapCell | undefined) => c && c.pct != null ? fmtPct(c.pct) : "N/P";

export function pathwayMapSvg(v: DrawnResultOf<"pathwaymap">, o: SvgOpts): string {
  const pm = v.pathwaymap;
  const p = palette(o.theme);
  const path = pathwayNamed(pm.pathway);
  if (!path) throw new Error("no pathway named “" + pm.pathway + "”");
  const names = v.cohorts && v.cohorts.length ? v.cohorts : (pm.genes[0]?.cells || []).map((c) => c.cohort);
  const k = Math.max(1, names.length);
  const byGene = new Map(pm.genes.map((g) => [g.gene, g.cells]));
  const query = new Set(pm.query);
  const boxes = nodeBoxes(path);
  const all = [...boxes.values()];
  const minX = Math.min(...all.map((b) => b.x0)), minY = Math.min(...all.map((b) => b.y0));
  const maxX = Math.max(...all.map((b) => b.x1)), maxY = Math.max(...all.map((b) => b.y1)) + COMPOUND_LABEL;

  let W = Math.max(360, o.width || 720);
  const room = W - 2 * PAD;
  const s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, room / (maxX - minX)));
  const grown = (maxX - minX) * s > room;
  if (grown) W = Math.ceil((maxX - minX) * s + 2 * PAD);

  const title = path.name + " — altered % per gene";
  const out: string[] = [];
  const t = titleLine(title, W, p);
  out.push(t.svg);
  let y = t.y;
  // the colour key, then (several cohorts) the order of a node's boxes, then the edge key
  const key = legend([...KEY.map((pct) => ({ label: pct === 100 ? "100%" : pct + "%", color: frequencyColor(pct) })), { label: "N/P (not profiled)", color: OTHER }],
    PAD, y, W - 2 * PAD, p, { title: "altered" });
  out.push(key.svg.replace(/<rect /g, `<rect stroke="${p.muted}" stroke-width="${SW.hair}" `));
  y += key.height;
  if (k > 1) {
    // which cohort each of a node's boxes is, in words: the boxes carry no colour of their own
    const lh = Math.round(FS.body * 1.5);
    const lines = wrapWidth("boxes, left to right: " + names.map((n, i) => (i + 1) + ". " + n).join(" · "), W - 2 * PAD, FS.body);
    lines.forEach((l, i) => out.push(label(PAD, y + lh * (i + 0.5) + FS.body * 0.35, l, { size: FS.body, fill: p.muted })));
    y += lh * lines.length + 2;
  }
  {
    const kinds: [EdgeType, string][] = [["ACTIVATES", "activates"], ["INHIBITS", "inhibits"], ["INDUCES", "induces"], ["REPRESSES", "represses"], ["BINDS", "binds"]];
    let x = PAD;
    const mid = y + 9;
    out.push(label(x, mid + FS.body * 0.35, "edges", { size: FS.body, fill: p.muted }));
    x += textWidth("edges", FS.body) + 10;
    for (const [type, word] of kinds) {
      const w = 26 + 5 + textWidth(word, FS.body) + 16;
      if (x + w > W - PAD) break;
      out.push(edgeSvg(x, mid, x + 26, mid, type, p.ink));
      out.push(label(x + 31, mid + FS.body * 0.35, word, { size: FS.body, fill: p.ink }));
      x += w;
    }
    y += 22;
  }
  y += 6;

  const ox = PAD - minX * s + (grown ? 0 : Math.max(0, (room - (maxX - minX) * s) / 2)), oy = y - minY * s;
  const X = (u: number) => ox + u * s, Y = (u: number) => oy + u * s;
  const sb = (b: Box): Box => ({ x0: X(b.x0), y0: Y(b.y0), x1: X(b.x1), y1: Y(b.y1) });
  const parents = new Set(path.nodes.filter((n) => n.parent).map((n) => n.parent!));
  const depthOf = (n: PathwayNode): number => { let d = 0, c: PathwayNode | undefined = n; while (c?.parent && d < 20) { d++; c = path.nodes.find((x) => x.id === c!.parent); } return d; };

  // compounds first, outermost first, each with its name under it
  for (const n of path.nodes.filter((x) => parents.has(x.id)).sort((a, b) => depthOf(a) - depthOf(b))) {
    const b = sb(boxes.get(n.id)!), w = b.x1 - b.x0, h = b.y1 - b.y0;
    const stroke = n.type === "COMPLEX" ? SW.line : SW.series;
    if (n.type === "COMPLEX") {
      const c = 6;
      out.push(`<path d="M${r1(b.x0 + c)},${r1(b.y0)} H${r1(b.x1 - c)} L${r1(b.x1)},${r1(b.y0 + c)} V${r1(b.y1 - c)} L${r1(b.x1 - c)},${r1(b.y1)} H${r1(b.x0 + c)} L${r1(b.x0)},${r1(b.y1 - c)} V${r1(b.y0 + c)} Z" fill="${p.bg}" fill-opacity="0.5" stroke="${p.ink}" stroke-width="${stroke}"/>`);
    } else {
      const rx = n.type === "COMPARTMENT" ? 14 : n.type === "PROCESS" ? 6 : 0;
      out.push(`<rect x="${r1(b.x0)}" y="${r1(b.y0)}" width="${r1(w)}" height="${r1(h)}" rx="${rx}" fill="${p.bg}" fill-opacity="0.5" stroke="${p.ink}" stroke-width="${n.type === "PROCESS" ? SW.hair : stroke}"/>`);
    }
    if (n.name.trim()) out.push(label((b.x0 + b.x1) / 2, b.y1 + FS.body + 1, n.name, { size: FS.body, weight: 600, fill: p.ink, anchor: "middle", maxW: Math.max(w, 60) }));
  }
  // edges, clipped to the boxes they join, under the leaf nodes
  for (const e of path.edges) {
    const a = sb(boxes.get(e.source)!), b = sb(boxes.get(e.target)!);
    const [x1, y1] = exitPoint(a, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const [x2, y2] = exitPoint(b, (a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
    out.push(edgeSvg(x1, y1, x2, y2, e.type, p.ink));
  }
  // leaf nodes: a gene with its name and one box per cohort; a process or an empty compound, its name alone
  const notProfiled: string[] = [], labels: string[] = [];
  let unprinted = false;
  for (const n of path.nodes.filter((x) => !parents.has(x.id))) {
    const b = sb(boxes.get(n.id)!), w = b.x1 - b.x0, h = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2;
    const cells = n.type === "GENE" ? byGene.get(n.name) : undefined;
    if (n.type === "PROCESS") {
      out.push(`<rect x="${r1(b.x0)}" y="${r1(b.y0)}" width="${r1(w)}" height="${r1(h)}" rx="6" fill="${p.bg}"/>`);
      out.push(label(cx, (b.y0 + b.y1) / 2 + FS.body * 0.35, n.name, { size: FS.body, fill: p.muted, anchor: "middle" }));
      continue;
    }
    const isQuery = n.type === "GENE" && query.has(n.name);
    const tip = n.type !== "GENE" ? n.name + " (" + n.type.toLowerCase() + ")"
      : !cells ? n.name + " names a group, not a gene: no frequency"
      : n.name + (isQuery ? " (query gene)" : "") + " — " + cells.map((c) => c.cohort + ": " + (c.pct == null ? "not profiled" : fmtPct(c.pct) + " (" + fmtInt(c.altered) + " of " + fmtInt(c.profiled) + " profiled samples)")).join("; ");
    out.push(`<rect x="${r1(b.x0)}" y="${r1(b.y0)}" width="${r1(w)}" height="${r1(h)}" rx="${n.type === "GENE" ? 5 : 0}" fill="${p.bg}" stroke="${p.ink}" stroke-width="${isQuery ? SW.series * 1.5 : n.type === "GENE" ? SW.line : SW.series}"><title>${esc(tip)}</title></rect>`);
    if (!cells) {
      if (n.type === "GENE") labels.push(n.name);
      out.push(label(cx, (b.y0 + b.y1) / 2 + FS.body * 0.35, n.name, { size: FS.body, weight: 600, fill: p.ink, anchor: "middle", maxW: w - 6 }));
      continue;
    }
    if (cells.every((c) => c.pct == null)) notProfiled.push(n.name);
    const nameY = b.y0 + Math.min(h / 2, FS.body + 4);
    out.push(label(cx, nameY, n.name, { size: FS.body, weight: 600, fill: p.ink, anchor: "middle", maxW: w - 6 }));
    const by0 = nameY + 4, bh = Math.max(FS.small + 4, b.y1 - 3 - by0), gap = 2;
    const bw = (w - 6 - gap * (k - 1)) / k;
    const showText = textWidth("100.0%", FS.small) + 2 <= bw;
    if (!showText) unprinted = true;
    names.forEach((cohort, i) => {
      const c = cells.find((x) => x.cohort === cohort);
      const fill = c && c.pct != null ? frequencyColor(c.pct) : OTHER;
      const bx = b.x0 + 3 + i * (bw + gap);
      out.push(`<rect x="${r1(bx)}" y="${r1(by0)}" width="${r1(bw)}" height="${r1(bh)}" fill="${fill}" stroke="${p.muted}" stroke-width="${SW.hair}"><title>${esc(tip)}</title></rect>`);
      if (showText) out.push(label(bx + bw / 2, by0 + bh / 2 + FS.small * 0.35, cellText(c), { size: FS.small, fill: textOn(fill), anchor: "middle" }));
    });
  }
  y = Y(maxY) + 8;

  const at = pm.ranked.findIndex((r) => r.name === path.name);
  const rankWords = pm.settings.rank === "count" ? (pm.settings.byFrequency ? "the summed altered % of the query genes it holds" : "the number of query genes it holds")
    : (pm.settings.byFrequency ? "query genes held × their summed altered % ÷ its gene nodes" : "the share of its gene nodes that are query genes");
  const cohortWords = k === 1 ? names[0] : names.join(", ") + " (one box each, in that order)";
  const text = [
    path.description ? path.description.replace(/\s+/g, " ").trim() + (/[.!?]$/.test(path.description.trim()) ? "" : ".") : "",
    "Each gene node shows its altered % in " + cohortWords + ": samples with a mutation, amplification, deep deletion or structural variant in the gene, of those profiled for it." +
      (unprinted ? " Boxes too narrow to print their value give it on hover." : ""),
    pm.query.length ? (pm.queryFrom === "genes" ? "A thick border marks a query gene (" + pm.query.join(", ") + ")." : "A thick border marks a gene altered in the cohort.") : "",
    at >= 0 ? (pm.defaulted ? "Drawn as the best-ranked " : "Ranked " + (at + 1) + " of " + pm.ranked.length + " ") +
      (pm.settings.pancanOnly ? "TCGA PanCanAtlas pathway" : "pathway of PathwayMapper's library") + " by " + rankWords +
      " (score " + fmtNum(pm.ranked[at].score) + (pm.ranked[at].matched.length ? "; " + pm.ranked[at].matched.join(", ") : "") + ")." +
      (pm.ranked.length > 1 ? " Next: " + pm.ranked.filter((r) => r.name !== path.name).slice(0, 3).map((r) => r.name + " " + fmtNum(r.score)).join(", ") + "." : "")
      : "Not among the pathways ranked (" + (pm.settings.pancanOnly ? "the TCGA PanCanAtlas ten" : "the library") + ").",
    notProfiled.length ? "Not profiled in any sample, so N/P rather than 0%: " + notProfiled.join(", ") + "." : "",
    labels.length ? "Nodes " + labels.join(", ") + " name a group rather than a gene and carry no frequency." : "",
    "Diagram: PathwayMapper (i-Vis at Bilkent)."
  ].filter(Boolean).join(" ");
  const cap = caption(text, W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, grown, title + " — " + names.join(", "));
}
