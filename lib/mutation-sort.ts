// The mutation table's sort keys for Protein Change and Chromosome, as the portal computes them
// (MUT-STM-9). Each rule has a SQL builder, which the table orders by, and the same rule in
// TypeScript, which states it and lets the tests pin it.
import { finiteSql } from "./sql-number.ts";

/** a residue and its position, then one character: "V600E", "G12_", "V600" (as "V60" + "0") */
const ALLELE_AND_POSITION = "[A-Za-z][0-9]+.";

/**
 * The portal's Protein Change sort value (ProteinChangeUtils calcProteinChangeSortValue). The first
 * residue+position+character match gives the position as the integer part and the character codes of
 * its letters as the decimals ("V600E" → 600.8669, so A600T < V600E < V600K < V601A). With no such
 * match, the first number ("600" → 600). With no number, null.
 */
export function proteinChangeSortValue(proteinChange: string | null | undefined): number | null {
  if (!proteinChange) return null;
  const m = proteinChange.match(new RegExp(ALLELE_AND_POSITION));
  if (m) {
    const position = m[0].match(/[0-9]+/)![0];
    const codes = [...m[0].replace(/[0-9]+/g, "")].map((c) => c.charCodeAt(0)).join("");
    return parseFloat(codes ? position + "." + codes : position);
  }
  const n = proteinChange.match(/[0-9]+/);
  return n ? parseFloat(n[0]) : null;
}

/** proteinChangeSortValue in ClickHouse, on a Nullable(String) expression (its decimal parse may differ from parseFloat by an ulp, never the order) */
export function proteinChangeSortSql(x: string): string {
  const s = "ifNull(" + x + ", '')";
  const m = "extract(" + s + ", '" + ALLELE_AND_POSITION + "')";
  const codes = "arrayStringConcat(arrayMap(c -> toString(reinterpretAsUInt8(c)), splitByRegexp('', replaceRegexpAll(" + m + ", '[0-9]+', ''))))";
  return "multiIf(" + m + " != '', " + finiteSql("concat(extract(" + m + ", '[0-9]+'), if(" + codes + " = '', '', concat('.', " + codes + ")))") + ", " +
    "match(" + s + ", '[0-9]'), " + finiteSql("extract(" + s + ", '[0-9]+')") + ", NULL)";
}

/**
 * The portal's Chromosome sort value (ChromosomeColumnFormatter extractSortValue): the first integer;
 * else 23 for anything containing x, 24 for y (either case); else -1. An empty chromosome is null.
 */
export function chromosomeSortValue(chr: string | null | undefined): number | null {
  if (!chr) return null;
  const n = chr.match(/[0-9]+/);
  if (n) return parseInt(n[0], 10);
  const lower = chr.toLowerCase();
  return lower.includes("x") ? 23 : lower.includes("y") ? 24 : -1;
}

/** chromosomeSortValue in ClickHouse, on a Nullable(String) expression */
export function chromosomeSortSql(x: string): string {
  const s = "ifNull(" + x + ", '')";
  return "multiIf(" + s + " = '', NULL, match(" + s + ", '[0-9]'), " + finiteSql("extract(" + s + ", '[0-9]+')") + ", " +
    "positionCaseInsensitive(" + s + ", 'x') > 0, 23, positionCaseInsensitive(" + s + ", 'y') > 0, 24, -1)";
}
