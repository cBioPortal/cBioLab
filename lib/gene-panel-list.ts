// The Patient page's gene panel window (PatientViewGenePanelModal, GenesList): a panel's genes
// filtered as typed and laid out down columns. Pure, so the page draws it and a test reads it.

/**
 * The genes a filter keeps: a case-insensitive regular expression tried on the symbol, as the
 * portal's (which also tries the Entrez id, not kept here); a filter that is not a valid expression
 * keeps the genes containing it as text.
 */
export function filterPanelGenes(genes: string[], filter: string): string[] {
  if (!filter) return genes;
  let re: RegExp | null = null;
  try { re = new RegExp(filter, "i"); } catch { re = null; }
  const f = filter.toLowerCase();
  return genes.filter((g) => re ? re.test(g) : g.toLowerCase().includes(f));
}

/**
 * The genes as table rows, `columns` across, as the portal's genesDividedToColumns /
 * genesDividedToRows lay them out: the genes cut into chunks of ceil(n / columns), taken whole when
 * that makes exactly `columns` of them, else the first chunk is a column and the rest cut again
 * (its slice by everything taken so far, as the portal's); rows ceil(n / columns) high, empty cells "".
 */
export function panelGeneRows(genes: string[], columns: number): string[][] {
  const chunk = (xs: string[], size: number) => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));
  const cols: string[][] = [];
  let rest = [...genes], left = Math.max(1, columns);
  while (left > 0 && rest.length) {
    const chunked = chunk(rest, Math.ceil(rest.length / left));
    if (chunked.length === left) { cols.push(...chunked); break; }
    cols.push(chunked[0]);
    rest = rest.slice(cols.flat().length);
    left--;
  }
  const height = Math.ceil(genes.length / Math.max(1, columns));
  return Array.from({ length: height }, (_, i) => Array.from({ length: Math.max(1, columns) }, (_, j) => cols[j]?.[i] ?? ""));
}

/** The download of the panel's genes, as the portal's: a "Genes" header and a symbol a line. */
export const panelGenesTsv = (genes: string[]): string => ["Genes", ...genes].join("\n") + "\n";

/**
 * A "Gene Panel" clinical value as the portal links it (ClinicalInformationPatientTable
 * renderGenePanelLinks): comma-separated names, each trimmed; one holding "N/A", or "WXS", is text (not
 * a panel); any other opens the panel its first word names ("TESTPANEL2 (mut)" opens TESTPANEL2).
 */
export function genePanelLinks(value: string): { text: string; panel: string | null }[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean)
    .map((text) => ({ text, panel: text.includes("N/A") || text === "WXS" ? null : text.split(" ")[0] }));
}

/** the clinical attribute whose values are gene panels, by the name the portal matches (its display name) */
export const GENE_PANEL_ATTRIBUTE = "Gene Panel";
