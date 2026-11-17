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

/** why Summary Data can't be offered: the chart holds only its most frequent values; null when it holds them all */
export function summaryCut(shown: number, distinct: number | undefined): string | null {
  if (distinct == null || shown >= distinct) return null;
  return "this chart holds its " + fmtInt(shown) + " most frequent values of " + fmtInt(distinct) + ", so a summary of it would leave values out";
}

/** saves text as a file the browser downloads */
export function saveText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
