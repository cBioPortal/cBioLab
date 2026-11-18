// The Genomic Evolution heatmap's row and column order, computed with the result so the SVG, the
// page, the text readback and the CLI all draw the same order.
import { clusterHeatmap } from "../../oncoprint-cluster.ts";
import type { EvolutionMutation } from "./types.ts";

/** "GENE pChange", the portal's mutation label (getMutationLabel) */
export const mutationName = (m: EvolutionMutation) => m.gene + " " + m.proteinChange;

/**
 * The heatmap's order, as the portal's (MutationOncoprint, PTB-GE-HM-2/4): clustered (average linkage,
 * 1 − Spearman over the VAFs, lib/oncoprint-cluster.ts) or, unclustered, the samples in their order and
 * the mutations by "GENE pChange" in either orientation (MutationOncoprint's mutationWithIdOrder sorts
 * by getMutationLabel). Indices into `drawn` and the patient's samples.
 */
export function heatmapOrder(drawn: EvolutionMutation[], nSamples: number, o: { transpose: boolean; cluster: boolean }): { mutations: number[]; samples: number[] } {
  const ms = drawn.map((_, i) => i), ss = Array.from({ length: nSamples }, (_, j) => j);
  if (!o.cluster) return { mutations: [...ms].sort((a, b) => mutationName(drawn[a]).localeCompare(mutationName(drawn[b]))), samples: ss };
  const vaf = (i: number, j: number) => { const c = drawn[i].cells[j]; return c.vaf != null && (c.status === "called" || c.status === "uncalled") ? c.vaf : NaN; };
  if (o.transpose) {
    // tracks are the mutations, columns the samples
    const r = clusterHeatmap({ rows: ms.map((i) => Float64Array.from(ss, (j) => vaf(i, j))), n: nSamples });
    return { mutations: r.rows.map((k) => ms[k]), samples: r.order };
  }
  const r = clusterHeatmap({ rows: ss.map((j) => Float64Array.from(ms, (i) => vaf(i, j))), n: drawn.length });
  return { mutations: r.order, samples: r.rows.map((k) => ss[k]) };
}
