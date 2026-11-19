// The Genomic Evolution heatmap's Data download, the portal's (MutationOncoprintUtils getDownloadData,
// file vafHeatmap): a line per cell with a VAF — a called mutation with reads, or an uncalled one with
// variant reads, alt / (alt + ref) unrounded — over the heatmap's tracks: by sample in sample order, each sample's mutations in the
// figure's order; transposed, by mutation ("GENE pChange" alphabetically), each mutation's samples in order.
import type { EvolutionMutation, EvolutionSample } from "./types.ts";
import { mutationName } from "./order.ts";

export const HEATMAP_FILE = "vafHeatmap";
const HEAD = ["Sample_ID", "Gene", "Protein_Change", "Variant_Allele_Frequency"];

export function heatmapTsv(drawn: readonly EvolutionMutation[], samples: readonly EvolutionSample[], transpose: boolean): string {
  const lines = [HEAD];
  const add = (m: EvolutionMutation, s: number) => {
    const c = m.cells[s];
    if (!c || (c.status !== "called" && c.status !== "uncalled") || c.vaf == null) return;
    // the unrounded ratio from the reads, as the portal writes it; the cell's own VAF is rounded for display
    const vaf = c.alt != null && c.ref != null && c.alt + c.ref > 0 ? c.alt / (c.alt + c.ref) : c.vaf;
    lines.push([samples[s].id, m.gene, m.proteinChange, String(vaf)]);
  };
  if (transpose) {
    for (const m of [...drawn].sort((a, b) => mutationName(a).localeCompare(mutationName(b)))) samples.forEach((_, s) => add(m, s));
  } else {
    samples.forEach((_, s) => { for (const m of drawn) add(m, s); });
  }
  return lines.map((l) => l.join("\t")).join("\n");
}
