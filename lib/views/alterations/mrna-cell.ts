// The Patient mutation table's mRNA Expr. cell as the portal draws it (MrnaExprColumnFormatter): a
// grey line with a dot at the gene's mRNA percentile in the sample, coloured by where it falls, the
// rounded percentile beside it, and the tooltip's lines. Pure: the page draws it and a test reads it.
import { STYLE, type Style } from "../../oncoprint-style.ts";

export interface MrnaDot {
  width: number; height: number; lineWidth: number; lineY: number; lineStroke: number; line: string;
  cx: number; r: number; fill: string; textX: number; textY: number; fontSize: number; text: string;
}

/** The cell for a percentile (0–100): the dot between the line's ends, inset by its radius. */
export function mrnaDot(percentile: number, S: Style = STYLE): MrnaDot {
  const b = S.mrnaBar;
  const left = b.radius, right = b.width - b.radius, textX = right + b.radius + b.textGap;
  const p = percentile / 100;
  return {
    width: textX + b.textWidth, height: b.svgHeight, lineWidth: b.width, lineY: b.lineY, lineStroke: b.lineWidth, line: b.line,
    cx: left * (1 - p) + right * p, r: b.radius, fill: percentile < b.lowBelow ? b.low : percentile > b.highAbove ? b.high : b.mid,
    textX, textY: b.textBaseline, fontSize: b.fontSize, text: Math.round(percentile) + "%",
  };
}

/** The tooltip: the portal's three lines, or its words when the gene has no mRNA value in the sample. */
export function mrnaTooltip(percentile: number | null, z: number | null | undefined): string {
  if (percentile == null) return "mRNA data is not available for this gene.";
  return "mRNA level of the gene in this tumor\nmRNA z-score: " + (z ?? "") + "\nPercentile: " + percentile;
}
