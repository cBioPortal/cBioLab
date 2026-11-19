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

/**
 * The X vs Y tab's button (STV-AC-7), as the portal's: what it says and whether it adds. Two
 * numeric attributes make a density plot; a numeric and a categorical one the portal's violin table,
 * which Explore does not draw yet, so it is refused saying so.
 */
export function xVsYButton(x: { attribute: string; numeric: boolean } | null, y: { attribute: string; numeric: boolean } | null, existing: string[]):
  { label: string; adds: boolean; tip?: string } {
  if (!x || !y) return { label: "Add Chart", adds: false };
  if (x.attribute === y.attribute) return { label: "Please choose two different attributes.", adds: false };
  if (existing.includes([x.attribute, y.attribute].sort().join("|"))) return { label: "A chart with these attributes already exists", adds: false };
  if (!x.numeric && !y.numeric) return { label: "Can't add a chart with two categorical attributes (yet).", adds: false };
  if (x.numeric !== y.numeric) return { label: "Add violin/box plot table", adds: false, tip: "a numeric attribute against a categorical one is the portal's violin table, not drawn here yet" };
  return { label: "Add density plot", adds: true };
}

/** the X vs Y tab's attributes: every clinical attribute but a survival one other than OS_STATUS, as the portal lists them */
export function xVsYAttributes<T extends { attribute: string }>(attrs: T[]): T[] {
  return attrs.filter((a) => !/_(MONTHS|STATUS)$/.test(a.attribute) || a.attribute === "OS_STATUS");
}

/** the Genomic tab's charts (STV-AC-2): drawn by default, each a checkbox in Add chart that hides or shows it */
export const GENOMIC_CHARTS = [
  { key: "genomic|mutated", name: "Mutated Genes", table: "mutated" as const },
  { key: "genomic|cna", name: "CNA Genes", table: "cna" as const },
  { key: "genomic|sv", name: "Structural Variant Genes", table: "sv" as const },
  { key: "genomic|datatypes", name: "Data Types", table: null },
  { key: "genomic|density", name: "Mutation Count vs Fraction Genome Altered", table: null },
] as const;

/**
 * The Genomic tab's rows (STV-AC-2, STV-AC-4), as the portal lists them: each chart the selection
 * has data for, its Freq the selected samples with that data, a gene table's being those profiled
 * for its alteration (coadread: CNA Genes 99.7 %, Mutated Genes 89.9 %), Data Types every sample;
 * by Freq, then name; Mutation Count and FGA among them, as the portal lists them (STV-AC-4). The
 * density's has no Freq of its own here (NaN, written "—").
 */
export function genomicChartLines(profiled: Record<"mutated" | "cna" | "sv", number>, selected: number, has: { datatypes: boolean; density: boolean },
  clinical: { key: string; name: string; samples: number; attribute: string }[] = []):
  { key: string; name: string; freq: number; attribute?: string }[] {
  const pct = (n: number) => selected ? 100 * n / selected : 0;
  // Mutation Count and Fraction Genome Altered, clinical charts the portal lists here, Freq the samples with a value
  const fromClinical = clinical.map((c) => ({ key: c.key, name: c.name, freq: pct(c.samples), attribute: c.attribute }));
  return [...fromClinical, ...GENOMIC_CHARTS.flatMap((c): { key: string; name: string; freq: number }[] => {
    if (c.table) return profiled[c.table] > 0 ? [{ key: c.key, name: c.name, freq: pct(profiled[c.table]) }] : [];
    if (c.key === "genomic|datatypes") return has.datatypes ? [{ key: c.key, name: c.name, freq: 100 }] : [];
    return has.density ? [{ key: c.key, name: c.name, freq: NaN }] : [];
  })].sort((a, b) => (Number.isNaN(b.freq) ? -1 : b.freq) - (Number.isNaN(a.freq) ? -1 : a.freq) || a.name.localeCompare(b.name));
}

/** the display text the portal's server config gives a few generic-assay types (`generic_assay_display_text`) */
const ASSAY_TAB_TEXT: Record<string, string> = {
  TREATMENT_RESPONSE: "Treatment Response", MUTATIONAL_SIGNATURE: "Mutational Signature", ARMLEVEL_CNA: "Arm-level CNA", METHYLATION: "Methylation",
};

/**
 * A generic-assay type's Add chart tab (STV-AC-2, `deriveDisplayTextFromGenericAssayType`): the
 * configured text, else the type's words capitalised ("GENETIC_ANCESTRY" → "Genetic Ancestry").
 */
export function assayTabLabel(type: string): string {
  return ASSAY_TAB_TEXT[type] ?? type.split("_").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** one Add chart tab per generic-assay type the selected studies hold, by label (seen coadread: Arm-level CNA · Genetic Ancestry · Methylation) */
export function assayTabs(profiles: { type: string; assayType?: string }[]): { type: string; label: string }[] {
  const types = [...new Set(profiles.filter((p) => p.type === "GENERIC_ASSAY" && p.assayType).map((p) => p.assayType!))];
  return types.map((type) => ({ type, label: assayTabLabel(type) })).sort((a, b) => a.label.localeCompare(b.label));
}
