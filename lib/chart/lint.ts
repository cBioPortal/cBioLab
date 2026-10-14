// A figure's text, checked the way a reader would find it wrong: type below the smallest size,
// a label running off the figure, two labels printed over each other. Measured with the same
// widths the layout uses (./text.ts), so it holds the renderers to what they claim to do.
// Used by test/figure-layout.test.ts over drawn fixtures and by scripts/check-figures.ts over real
// results at several widths.
import { textWidth } from "./text.ts";
import { MIN_FS } from "./style.ts";

export interface LintIssue { kind: "small" | "outside" | "overlap"; text: string; other?: string; detail: string }

interface Box { x0: number; x1: number; y0: number; y1: number; text: string; rotated: boolean }

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp("\\s" + name + "=\"([^\"]*)\"").exec(tag);
  return m ? m[1] : null;
};
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

/** every drawn <text>'s box, in figure coordinates (translate() groups applied; rotations bounded) */
export function textBoxes(svg: string): { boxes: Box[]; width: number; height: number; sizes: { text: string; size: number }[] } {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const width = vb ? Number(vb[1]) : Infinity, height = vb ? Number(vb[2]) : Infinity;
  // tooltips and definitions are not drawn
  const body = svg.replace(/<title>[\s\S]*?<\/title>/g, "").replace(/<defs>[\s\S]*?<\/defs>/g, "");
  const boxes: Box[] = [], sizes: { text: string; size: number }[] = [];
  const stack: [number, number][] = [[0, 0]];
  const re = /<(\/?)(g|text|svg)\b([^>]*?)(\/?)>([^<]*(?:<tspan[^>]*>[^<]*<\/tspan>[^<]*)*)/g;
  let m: RegExpExecArray | null;
  let first = true;
  while ((m = re.exec(body))) {
    const [, close, name, rest, selfClose, inner] = m;
    if (name === "svg") { if (first) { first = false; continue; } }
    if (name === "g" || name === "svg") {
      if (close) { if (stack.length > 1) stack.pop(); continue; }
      if (selfClose) continue;
      const [tx0, ty0] = stack[stack.length - 1];
      const t = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(attr(" " + rest, "transform") || "");
      const nx = name === "svg" ? Number(attr(" " + rest, "x") || 0) : 0, ny = name === "svg" ? Number(attr(" " + rest, "y") || 0) : 0;
      stack.push([tx0 + (t ? Number(t[1]) : 0) + nx, ty0 + (t ? Number(t[2]) : 0) + ny]);
      continue;
    }
    if (close) continue;
    const tag = " " + rest;
    const size = Number(attr(tag, "font-size") || 0);
    const text = unesc(inner.replace(/<[^>]+>/g, "")).trim();
    if (!text || !size) continue;
    sizes.push({ text, size });
    const [tx, ty] = stack[stack.length - 1];
    const x = Number(attr(tag, "x") || 0) + tx, y = Number(attr(tag, "y") || 0) + ty;
    const weight = Number(attr(tag, "font-weight") || 400);
    const dx = [...inner.matchAll(/dx="([-\d.]+)"/g)].reduce((a, d) => a + Number(d[1]), 0);
    const w = textWidth(text, size, weight) + dx;
    const anchor = attr(tag, "text-anchor") || "start";
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    const base = attr(tag, "dominant-baseline");
    const top = base === "middle" ? y - size * 0.5 : base === "hanging" ? y : y - size * 0.75;
    const rot = /rotate\(\s*([-\d.]+)(?:[ ,]+([-\d.]+)[ ,]+([-\d.]+))?\s*\)/.exec(attr(tag, "transform") || "");
    if (rot) {
      const a = Number(rot[1]) * Math.PI / 180, cx = rot[2] != null ? Number(rot[2]) + tx : 0, cy = rot[3] != null ? Number(rot[3]) + ty : 0;
      const pts = [[x0, top], [x0 + w, top], [x0, top + size], [x0 + w, top + size]].map(([px, py]) => [
        cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a)]);
      boxes.push({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])), text, rotated: true });
    } else {
      boxes.push({ x0, x1: x0 + w, y0: top, y1: top + size, text, rotated: false });
    }
  }
  return { boxes, width, height, sizes };
}

/**
 * What is wrong with a figure's text. `tolerance` is how far (px) a box may cross the edge or
 * another box before it counts: the width table rounds, and glyphs have side bearings.
 */
export function lintSvg(svg: string, tolerance = 1.5): LintIssue[] {
  const { boxes, width, height, sizes } = textBoxes(svg);
  const out: LintIssue[] = [];
  for (const s of sizes) if (s.size < MIN_FS) out.push({ kind: "small", text: s.text, detail: s.size + "px, below " + MIN_FS + "px" });
  for (const b of boxes)
    if (b.x0 < -tolerance || b.x1 > width + tolerance || b.y0 < -tolerance - 2 || b.y1 > height + tolerance)
      out.push({ kind: "outside", text: b.text, detail: "box " + [b.x0, b.y0, b.x1, b.y1].map((n) => Math.round(n)).join(",") + " in a " + width + "×" + height + " figure" });
  // overprinting, among unrotated labels (turned labels share a slant, and their boxes overlap by design)
  const flat = boxes.filter((b) => !b.rotated);
  const rows = new Map<number, Box[]>();
  for (const b of flat) for (let r = Math.floor(b.y0 / 8); r <= Math.floor(b.y1 / 8); r++) (rows.get(r) ?? rows.set(r, []).get(r)!).push(b);
  const seen = new Set<string>();
  for (const list of rows.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.x1 - tolerance <= b.x0 || b.x1 - tolerance <= a.x0) continue;
      if (a.y1 - tolerance * 1.5 <= b.y0 || b.y1 - tolerance * 1.5 <= a.y0) continue;
      const key = [a.x0, a.y0, b.x0, b.y0].join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "overlap", text: a.text, other: b.text, detail: "at " + Math.round(a.x0) + "," + Math.round(a.y0) + " / " + Math.round(b.x0) + "," + Math.round(b.y0) });
    }
  }
  return out;
}
