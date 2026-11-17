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

/**
 * The Content-Disposition of a portal file: its name as the portal saves it (`<profile name>.txt`, commas and
 * all), in RFC 5987's filename* for browsers that read it, beside an ASCII filename for those that do not.
 */
export function portalDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded;
}
