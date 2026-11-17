// The Download tab's gene-by-sample files in the portal's own formats (DownloadUtils generateDownloadData,
// cd8c6df): Tab Delimited Format and Transposed Matrix.

/**
 * A gene-by-sample file as the portal writes it: a STUDY_ID and a SAMPLE_ID column, then one per gene;
 * cells joined by tabs and lines by "\n", nothing quoted, no newline at the end. `transposed`: the same
 * matrix with rows and columns swapped (lodash unzip) — a line for STUDY_ID, one for SAMPLE_ID, one per gene.
 */
export function portalMatrix(genes: string[], rows: { study: string; sample: string; values: string[] }[], transposed: boolean): string {
  const m = [["STUDY_ID", "SAMPLE_ID", ...genes], ...rows.map((r) => [r.study, r.sample, ...r.values])];
  const out = transposed ? m[0].map((_, j) => m.map((line) => line[j])) : m;
  return out.map((line) => line.join("\t")).join("\n");
}
