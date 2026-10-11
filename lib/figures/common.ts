// What several figures share: alteration colours, word wrap and number formats.
import { palette } from "../svg-kit.ts";
import { STYLE } from "../oncoprint-style.ts";

/** gains and losses take the oncoprint's amplification and deep-deletion hues */
export const CN_GAIN = STYLE.glyph.cna.options.find((o) => o.bit === "AMP")!.color;
export const CN_LOSS = STYLE.glyph.cna.options.find((o) => o.bit === "HOMDEL")!.color;

export type Pal = ReturnType<typeof palette>;

/** Greedy word wrap to at most `perLine` characters; a single over-long word is kept whole. */
export function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > perLine) { lines.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** a q-value short enough for a row: one significant figure below 1e-4, and never "0" */
export const qFmt = (q: number): string => q === 0 ? "q<1e-300" : "q=" + (q < 1e-4 ? q.toExponential(0) : q.toFixed(3));

export const MUT = STYLE.glyph.mutation.single.color;
export const AMP = STYLE.glyph.cna.options.find((o) => o.bit === "AMP")!.color;
export const DEL = STYLE.glyph.cna.options.find((o) => o.bit === "HOMDEL")!.color;
export const SV = STYLE.glyph.sv.color;
export const MULTI = "#6e7a83";
