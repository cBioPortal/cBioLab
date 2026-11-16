// The Study View's Mutated, CNA and Structural Variant gene tables as cBioPortal shows them: their
// titles, column sort, header tooltips and Data file. The rules, case by case with the portal's
// source lines, are in docs/legacy-spec/parity/gene-tables-cases.md. Browser-safe.
import type { GeneTableRow } from "./types.ts";
import { portalFreq } from "./chart/format.ts";

export type GeneTableKind = "mutated" | "cna" | "sv";

const NAMES: Record<GeneTableKind, string> = { mutated: "Mutated Genes", cna: "CNA Genes", sv: "Structural Variant Genes" };

export function geneTableName(kind: GeneTableKind): string {
  return NAMES[kind];
}

/** the table's name with the samples profiled for its alteration type, when there are any */
export function geneTableTitle(kind: GeneTableKind, profiled: number | undefined): string {
  if (!profiled || profiled <= 0) return NAMES[kind];
  return NAMES[kind] + " (" + String(profiled) + " profiled " + (profiled === 1 ? "sample" : "samples") + ")";
}

/** the profile kinds a table's count is read from, the first that is not 0 winning */
const PROFILE_KINDS: Record<GeneTableKind, string[]> = {
  mutated: ["mutations"],
  sv: ["fusion", "structural_variants"],
  cna: ["cna", "gistic", "cna_rae", "cna_consensus"]
};

/** the selected samples profiled for the table's alteration type, from the count per profile kind */
export function profiledSamples(kind: GeneTableKind, counts: Record<string, number>): number {
  for (const k of PROFILE_KINDS[kind]) if (counts[k]) return counts[k];
  return 0;
}

export type GeneSortColumn = "gene" | "cytoband" | "cna" | "events" | "altered" | "freq";
export interface GeneSort { column: GeneSortColumn; desc: boolean }

export function defaultGeneSort(kind: GeneTableKind): GeneSort {
  return kind === "sv" ? { column: "events", desc: true } : { column: "freq", desc: true };
}

/** columns that sort lowest first on their first click: the text ones, and the CNA call (HOMDEL −2 before AMP 2) */
const ASCENDING_FIRST = new Set<GeneSortColumn>(["gene", "cytoband", "cna"]);

/** the sort after a click on `column`'s header */
export function nextGeneSort(current: GeneSort, column: GeneSortColumn): GeneSort {
  if (current.column === column) return { column, desc: !current.desc };
  return { column, desc: !ASCENDING_FIRST.has(column) };
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** the rows' own order: the most events first, then the gene A to Z */
export function geneRowOrder<T extends GeneTableRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.events - a.events || byCode(a.gene, b.gene));
}

/** a row's frequency as a fraction: altered on a covering panel over profiled; null without a profiled sample */
function freqOf(r: GeneTableRow): number | null {
  return r.profiled > 0 ? (r.alteredOnPanel ?? r.altered) / r.profiled : null;
}

/** the rows sorted by a column, ties in the rows' own order; a row without a frequency last either way */
export function sortGeneRows<T extends GeneTableRow>(rows: T[], sort: GeneSort): T[] {
  const sign = sort.desc ? -1 : 1;
  const cmp = (a: T, b: T): number => {
    switch (sort.column) {
      case "gene": return sign * byCode(a.gene, b.gene);
      case "cytoband": return sign * byCode(a.cytoband || "", b.cytoband || "");
      case "cna": return sign * ((a.cna ?? 0) - (b.cna ?? 0));
      case "events": return sign * (a.events - b.events);
      case "altered": return sign * (a.altered - b.altered);
      case "freq": {
        const fa = freqOf(a), fb = freqOf(b);
        if (fa == null || fb == null) return fa == null ? (fb == null ? 0 : 1) : -1;
        return sign * (fa - fb);
      }
    }
  };
  const base = geneRowOrder(rows);
  const rank = new Map(base.map((r, i) => [r, i]));
  return base.sort((a, b) => cmp(a, b) || rank.get(a)! - rank.get(b)!);
}

const WHAT: Record<GeneTableKind, string> = { mutated: "mutations", sv: "structural variants", cna: "copy number alterations" };

/** the header tooltips, by column */
export function geneHeaderTips(kind: GeneTableKind): Partial<Record<GeneSortColumn, string>> {
  const tips: Partial<Record<GeneSortColumn, string>> = {
    altered: "Number of samples with one or more " + WHAT[kind],
    freq: "Percentage of samples with one or more " + WHAT[kind]
  };
  if (kind === "mutated") tips.events = "Total number of mutations";
  if (kind === "sv") tips.events = "Total number of structural variants";
  if (kind === "cna") {
    tips.cytoband = "Cytoband";
    tips.cna = "Copy number alteration, only amplifications and deep deletions are shown";
  }
  return tips;
}

const CALL: Record<number, string> = { 2: "AMP", [-2]: "HOMDEL" };

/** the table's Data file: every row in the rows' own order */
export function geneTableTsv(kind: GeneTableKind, rows: GeneTableRow[]): string {
  const header = kind === "mutated" ? ["Gene", "MutSig(Q-value)", "# Mut", "#", "Profiled Samples", "Freq"]
    : kind === "sv" ? ["Gene", "# Structural Variant", "#", "Profiled Samples", "Freq"]
    : ["Gene", "Gistic(Q-value)", "Cytoband", "CNA", "Profiled Samples", "#", "Freq"];
  const freq = (r: GeneTableRow) => { const f = freqOf(r); return f == null ? "NA" : portalFreq(f * 100); };
  const line = (r: GeneTableRow): (string | number)[] =>
    kind === "mutated" ? [r.gene, "", r.events, r.altered, r.profiled, freq(r)]
    : kind === "sv" ? [r.gene, r.events, r.altered, r.profiled, freq(r)]
    : [r.gene, "", r.cytoband || "", CALL[r.cna ?? 0] || "", r.profiled, r.altered, freq(r)];
  return [header.join("\t"), ...geneRowOrder(rows).map((r) => line(r).join("\t"))].join("\n");
}
