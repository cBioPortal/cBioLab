// The Download tab's gene alteration frequency table as the portal's (GeneAlterationTable, cd8c6df): its
// sort, its filter and its file. Pure, for the card and its tests.
import { portalPercentAltered } from "../../chart/format.ts";
import type { LineFrequency } from "./types.ts";

export type FrequencyColumn = "gene" | "line" | "altered" | "percent";

/** a row's sort value in a column; a line nobody was profiled for has no percent (null) */
function sortValue(r: LineFrequency, c: FrequencyColumn): string | number | null {
  switch (c) {
    case "gene": return r.gene;
    case "line": return r.line;
    case "altered": return r.altered;
    case "percent": return r.profiled ? r.altered / r.profiled : null;
  }
}

/**
 * The rows sorted as the portal's table sorts (LazyMobXTable lazyMobXTableSort, compareValues): numbers by
 * size, text by localeCompare, a missing value last whichever the direction, ties in the rows' order.
 * Ours alone: the portal's key for a line nobody was profiled for is NaN, which its comparison places
 * inconsistently; here it is missing, so last.
 */
export function frequencySort(rows: LineFrequency[], column: FrequencyColumn, asc: boolean): LineFrequency[] {
  return rows.map((r, i) => ({ r, i, v: sortValue(r, column) })).sort((a, b) => {
    let c = 0;
    if (a.v !== b.v) {
      if (a.v === null) c = 1;
      else if (b.v === null) c = -1;
      else if (typeof a.v === "number") c = (a.v < (b.v as number) ? -1 : 1) * (asc ? 1 : -1);
      else c = (asc ? 1 : -1) * a.v.localeCompare(b.v as string);
    }
    return c || a.i - b.i;
  }).map((x) => x.r);
}

/**
 * The rows whose gene holds the text, case aside — or whose line does, while the OQL Line column is shown: the
 * portal's filter reads only the visible columns (LazyMobXTable, visibleColumns), and that one starts hidden.
 */
export function frequencyFilter(rows: LineFrequency[], text: string, lineShown: boolean): LineFrequency[] {
  const t = text.toUpperCase();
  return rows.filter((r) => r.gene.toUpperCase().includes(t) || (lineShown && r.line.toUpperCase().includes(t)));
}

/**
 * The portal's gene_alteration_frequency.tsv (LazyMobXTable downloadData, Serializer serializeData): its four
 * columns, the OQL line included though the table hides it; the rows in the order given; cells joined by
 * tabs, every row ended by "\r\n", nothing quoted.
 */
export function frequencyTsv(rows: LineFrequency[]): string {
  const lines = [["Gene Symbol", "OQL Line", "Num Samples Altered", "Percent Samples Altered"],
    ...rows.map((r) => [r.gene, r.line, r.profiled ? String(r.altered) : "N/P", portalPercentAltered(r.altered, r.profiled)])];
  return lines.map((l) => l.join("\t") + "\r\n").join("");
}
