// The Explore page's Add chart ▸ Clinical list, as cBioPortal's AddChartByType draws it: each
// attribute's Freq, the order, the disabled rows, Select all / Deselect all, and the filter a chart
// takes with it when unchecked. The rules, case by case: docs/legacy-spec/parity/add-chart-cases.md.
// Browser-safe; no I/O.
import { isClinicalLeaf, type Clause } from "./types.ts";

/** a row of the list: its key, its name, the selected samples with data (unknown when not counted), and whether it is checked */
export interface AddChartRow { key: string; name: string; samples: number | undefined; checked: boolean }

/** a row as the list draws it */
export interface AddChartLine extends AddChartRow { freq: number; disabled: boolean }

/** the share of the selected samples with data, in percent; NaN with no selected sample or an uncounted attribute */
export function chartFreq(samples: number | undefined, selected: number): number {
  return selected > 0 && samples != null ? samples * 100 / selected : NaN;
}

/** the rows with their Freq and disabled flag, ordered by Freq (highest first), then name */
export function addChartLines(rows: AddChartRow[], selected: number): AddChartLine[] {
  const rank = (f: number) => Number.isNaN(f) ? -Infinity : f;
  // a checked chart stays uncheckable-proof: the dialog is the only way to take a chart off
  return rows.map((r) => { const freq = chartFreq(r.samples, selected); return { ...r, freq, disabled: freq === 0 && !r.checked }; })
    .sort((a, b) => rank(b.freq) - rank(a.freq) || a.name.localeCompare(b.name));
}

/**
 * The bulk buttons over `shown` (the rows the search keeps) of the whole list `all`: Select all's
 * count (null when it is hidden) and the keys it checks; whether Deselect all shows, and the keys it unchecks.
 */
export function bulkButtons(shown: AddChartLine[], all: AddChartLine[]): { selectAll: { n: number; keys: string[] } | null; deselectAll: string[] | null } {
  const checked = all.filter((r) => r.checked).length;
  return {
    selectAll: checked === all.length ? null : { n: shown.length, keys: shown.filter((r) => !r.disabled).map((r) => r.key) },
    deselectAll: checked === 0 ? null : shown.map((r) => r.key),
  };
}

/** a clause's clinical leaves name only `attribute` (and it has at least one leaf) */
function onlyAbout(c: Clause, attribute: string): boolean {
  const leaves = "any" in c ? c.any : "not" in c ? ("any" in c.not ? c.not.any : [c.not]) : [c];
  return leaves.length > 0 && leaves.every((l) => isClinicalLeaf(l) && l.attribute === attribute);
}

/** the selection's top-level clauses less those that filter only `attribute` */
export function withoutAttribute(all: Clause[], attribute: string): Clause[] {
  return all.filter((c) => !onlyAbout(c, attribute));
}

/** the tables the portal offers in Add chart rather than showing by default (STS-OT-2, STS-OT-7): their checkbox keys */
export const SPECIAL_CHART_KEYS = { events: "special|events", caseLists: "special|caselists" } as const;

/**
 * Whether Timeline Events Availability and Case Lists are drawn: when checked in Add chart, or while
 * the draft filters on what they list (the portal shows Case Lists when the filters hold one).
 * Timeline events only where the selection has some. `leaves` are the draft's top-level leaves,
 * an `any` clause's alternatives each.
 */
export function specialChartsShown(checked: (key: string) => boolean, leaves: unknown[], hasEvents: boolean): { events: boolean; caseLists: boolean } {
  const kind = (k: string) => leaves.some((l) => !!l && (l as { kind?: string }).kind === k);
  const eventFilter = leaves.some((l) => { const e = l as { kind?: string; rel?: { type?: string } } | null; return !!e && e.kind === "event" && e.rel?.type === "NONE"; });
  return {
    events: hasEvents && (checked(SPECIAL_CHART_KEYS.events) || eventFilter),
    caseLists: checked(SPECIAL_CHART_KEYS.caseLists) || kind("caseList"),
  };
}
