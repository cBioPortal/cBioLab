// A Study View chart's ☰ › Download files as cBioPortal writes them. The rules, case by case with
// the portal's source lines, are in docs/legacy-spec/parity/download-cases.md. Browser-safe.
import { fmtInt, portalFreq } from "./chart/format.ts";

export type DownloadUnit = "sample" | "patient";

/** a chart's download file name: its name with each space and tab replaced by "_", then the kind's suffix */
export function chartFileName(chartName: string, kind: "summary" | "full" | "data" | "svg" | "pdf"): string {
  const base = chartName.replace(/[ \t]/g, "_");
  if (kind === "svg" || kind === "pdf") return base + "." + kind;
  return base + (kind === "data" ? "" : "." + kind) + ".txt";
}

/** one category's count, in the order the counts arrived */
export interface CategoryCount { value: string; count: number }

const isNa = (value: string) => value.toLowerCase().trim() === "na";

/** the Summary Data file's text: a row per category, the most frequent first and NA last */
export function summaryDataTsv(counts: CategoryCount[], unit: DownloadUnit): string {
  const noun = unit === "patient" ? "patients" : "samples";
  const sum = counts.reduce((n, c) => n + c.count, 0);
  const rows = [...counts].sort((a, b) => isNa(a.value) ? (isNa(b.value) ? 0 : 1) : isNa(b.value) ? -1 : b.count - a.count);
  return [
    ["Category", "Number of " + noun, "Percentage of " + noun].join("\t"),
    ...rows.map((c) => [c.value, String(c.count), portalFreq(c.count / sum * 100)].join("\t"))
  ].join("\n");
}

const MUTATION_CODES: Record<string, string> = { altered: "MUTATED", unaltered: "NOT_MUTATED", notProfiled: "NOT_PROFILED" };
const CNA_CODES: Record<string, string> = { amp: "2", gain: "1", diploid: "0", hetloss: "-1", del: "-2", notProfiled: "NA" };

/**
 * A gene-state chart's Summary Data category (SD14): the portal's backend code, byte for byte
 * (/api/mutation-data-counts' MUTATED, NOT_MUTATED, NOT_PROFILED; /api/genomic-data-counts' discrete
 * level, NA when not profiled), as its file writes them though its screen shows names. Under OncoKB
 * drivers only, a chart the portal does not have, a state keeps the name it is shown by (`label`).
 */
export function geneStateCode(type: "MUTATION" | "CNA", state: string, drivers: boolean, label: string): string {
  if (drivers) return label;
  return (type === "CNA" ? CNA_CODES : MUTATION_CODES)[state] ?? label;
}

/** why Summary Data can't be offered: the chart holds only its most frequent values; null when it holds them all */
export function summaryCut(shown: number, distinct: number | undefined): string | null {
  if (distinct == null || shown >= distinct) return null;
  return "this chart holds its " + fmtInt(shown) + " most frequent values of " + fmtInt(distinct) + ", so a summary of it would leave values out";
}

/** saves text as a file the browser downloads */
export function saveText(fileName: string, text: string): void {
  saveBlob(fileName, new Blob([text], { type: "application/octet-stream" }));
}

/** saves a blob the page already holds, without another copy */
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
