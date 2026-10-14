// Text measured the way the figure's font draws it, so a layout can be computed rather than guessed:
// margins from the longest label, a label shortened to the room it has, a caption wrapped to the
// figure's width. Server and browser get the same numbers (a table, not a canvas), so a figure laid
// out for MCP is laid out identically in the page.
import { CHARS, REGULAR, BOLD } from "./metrics.ts";
import { esc } from "./esc.ts";

const W_REG = new Map<string, number>(), W_BOLD = new Map<string, number>();
for (let i = 0; i < CHARS.length; i++) { W_REG.set(CHARS[i], REGULAR[i]); W_BOLD.set(CHARS[i], BOLD[i]); }
/** a character outside the table: wide enough not to under-measure (CJK and symbols run near 1em) */
const UNKNOWN = 800;

/** the drawn width of `s` at `size` px; `weight` 600 and up measures as bold */
export function textWidth(s: string, size: number, weight = 400): number {
  const t = weight >= 600 ? W_BOLD : W_REG;
  let u = 0;
  for (const ch of String(s)) u += t.get(ch) ?? UNKNOWN;
  return u * size / 1000;
}

/** `s` cut to fit `maxW`, ending in "…" when cut; never shorter than its first character */
export function ellipsize(s: string, maxW: number, size: number, weight = 400): string {
  s = String(s);
  if (textWidth(s, size, weight) <= maxW) return s;
  const room = maxW - textWidth("…", size, weight);
  let w = 0, i = 0;
  const chars = [...s];
  for (; i < chars.length; i++) {
    const cw = textWidth(chars[i], size, weight);
    if (w + cw > room) break;
    w += cw;
  }
  return chars.slice(0, Math.max(1, i)).join("").trimEnd() + "…";
}

/** greedy word wrap to `maxW`; a word wider than a line is cut with "…" rather than overflowing */
export function wrapWidth(s: string, maxW: number, size: number, weight = 400): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of String(s).split(/\s+/).filter(Boolean)) {
    const next = line ? line + " " + word : word;
    if (line && textWidth(next, size, weight) > maxW) { lines.push(line); line = word; }
    else line = next;
    if (textWidth(line, size, weight) > maxW) line = ellipsize(line, maxW, size, weight);
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export interface LabelOpts {
  size: number; fill: string; anchor?: "start" | "middle" | "end"; weight?: number;
  /** the room the label has; a longer one is shortened, and its full text kept as a tooltip */
  maxW?: number;
  /** degrees, about (x, y) */
  rotate?: number;
  baseline?: "middle" | "hanging";
  extra?: string;
}

/** a <text>, shortened to `maxW` if given; a shortened label carries its full text in a <title> */
export function label(x: number, y: number, s: unknown, o: LabelOpts): string {
  const full = String(s ?? "");
  const shown = o.maxW != null ? ellipsize(full, o.maxW, o.size, o.weight) : full;
  const attrs = `x="${r1(x)}" y="${r1(y)}" font-size="${o.size}" fill="${o.fill}"` +
    (o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : "") +
    (o.weight && o.weight !== 400 ? ` font-weight="${o.weight}"` : "") +
    (o.rotate ? ` transform="rotate(${o.rotate} ${r1(x)} ${r1(y)})"` : "") +
    (o.baseline ? ` dominant-baseline="${o.baseline}"` : "") +
    (o.extra ? " " + o.extra : "");
  return `<text ${attrs}>${shown !== full ? `<title>${esc(full)}</title>` : ""}${esc(shown)}</text>`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
