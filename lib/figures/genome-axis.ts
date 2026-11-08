// What figures laid along the genome share: the chromosome names under (or over) the axis.
import { label, textWidth, FS } from "../svg-kit.ts";

/**
 * Chromosome names under the plot, centred on their extent. A name that would touch the one
 * before it drops to a second row rather than being left out or overprinted.
 */
export function chromLabels(chrom: { c: string; mid: number }[], y: number, fill: string): { svg: string; height: number } {
  const out: string[] = [];
  const lastRight = [-Infinity, -Infinity];
  let rows = 1;
  for (const c of chrom) {
    const w = textWidth(c.c, FS.small), left = c.mid - w / 2;
    const row = left >= lastRight[0] + 3 ? 0 : left >= lastRight[1] + 3 ? 1 : -1;
    if (row < 0) {
      // no room in either row: still drawn, in the row that ends first, so every chromosome is named
      const r = lastRight[0] <= lastRight[1] ? 0 : 1;
      lastRight[r] = left + w; rows = Math.max(rows, r + 1);
      out.push(label(c.mid, y + FS.small + r * (FS.small + 3), c.c, { size: FS.small, fill, anchor: "middle" }));
      continue;
    }
    lastRight[row] = left + w; rows = Math.max(rows, row + 1);
    out.push(label(c.mid, y + FS.small + row * (FS.small + 3), c.c, { size: FS.small, fill, anchor: "middle" }));
  }
  return { svg: out.join(""), height: rows * (FS.small + 3) + 2 };
}
