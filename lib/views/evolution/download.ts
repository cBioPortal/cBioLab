// The Genomic Evolution heatmap's Data download, the portal's (MutationOncoprintUtils getDownloadData,
// file vafHeatmap): a line per cell with a VAF — a called mutation with reads, or an uncalled one with
// variant reads, alt / (alt + ref) unrounded — over the heatmap's tracks: by sample in sample order, each sample's mutations in the
// figure's order; transposed, by mutation ("GENE pChange" alphabetically), each mutation's samples in order.
import type { EvolutionMutation, EvolutionSample } from "./types.ts";
import { mutationName } from "./order.ts";
import type { TableRows } from "../../types.ts";
import { csvField } from "../../table-query.ts";

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

/**
 * The mutation table's CSV while "Show only selected mutations" keeps only the picked rows: the
 * rows shown, written as the table's download writes every row (a header of cohort, study and every
 * column's id; a line per row, cohort and study first), named as its file with "_selected".
 */
export function selectedCsv(t: TableRows<string | number | null>, patient: { study: string; id: string }): { name: string; text: string } {
  const line = (xs: unknown[]) => xs.map(csvField).join(",") + "\r\n";
  const keep = t.columns.map((c, i) => (c.id === "cohort" || c.id === "study" ? -1 : i)).filter((i) => i >= 0);
  return {
    name: ("cohort-lab_" + patient.study + "_" + patient.id + "_evolution_mutations_selected.csv").replace(/[^A-Za-z0-9._-]/g, "_"),
    text: line(["cohort", "study", ...keep.map((i) => t.columns[i].id)]) + t.rows.map((r) => line([r.cohort, r.study, ...keep.map((i) => r.values[i])])).join(""),
  };
}
