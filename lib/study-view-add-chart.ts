// The Explore page's Add chart ▸ Clinical list, as cBioPortal's AddChartByType draws it: each
// attribute's Freq, the order, the disabled rows, Select all / Deselect all, and the filter a chart
// takes with it when unchecked. The rules, case by case: docs/legacy-spec/parity/add-chart-cases.md.
// Browser-safe; no I/O.
import { isClinicalLeaf, type Clause } from "./types.ts";
import { fmtInt } from "./chart/format.ts";
import { PROFILE_KINDS } from "./study-view-gene-tables.ts";

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
 * numeric attributes make a density plot; a numeric and a categorical one the portal's violin table
 * (STS-VI-1).
 */
export function xVsYButton(x: { attribute: string; numeric: boolean } | null, y: { attribute: string; numeric: boolean } | null, existing: string[]):
  { label: string; adds: boolean; tip?: string } {
  if (!x || !y) return { label: "Add Chart", adds: false };
  if (x.attribute === y.attribute) return { label: "Please choose two different attributes.", adds: false };
  if (existing.includes([x.attribute, y.attribute].sort().join("|"))) return { label: "A chart with these attributes already exists", adds: false };
  if (!x.numeric && !y.numeric) return { label: "Can't add a chart with two categorical attributes (yet).", adds: false };
  if (x.numeric !== y.numeric) return { label: "Add violin/box plot table", adds: true };
  return { label: "Add density plot", adds: true };
}

/** the X vs Y tab's attributes: every clinical attribute but a survival one other than OS_STATUS, as the portal lists them */
export function xVsYAttributes<T extends { attribute: string }>(attrs: T[]): T[] {
  return attrs.filter((a) => !/_(MONTHS|STATUS)$/.test(a.attribute) || a.attribute === "OS_STATUS");
}

/** what Add chart's gene tab charts (STV-AC-5): a gene's mutation status, its mutation types, or its copy number */
export type GeneChartKind = "MUTATION" | "types" | "CNA";

/**
 * The gene tab's profile select, as the portal lists it: the selection's mutation and discrete
 * copy-number profiles, each "<name> (N samples)", N the selected samples profiled. `dataTypes` is
 * Explore's count per profile kind; the discrete copy-number kinds are the CNA gene table's
 * (PROFILE_KINDS.cna), summed, since two studies may hold it under different ids ("gistic", "cna"),
 * the label the one with the most samples.
 */
export function geneChartProfiles(dataTypes: { profile: string; label: string; alterationType: string; n: number }[]): { kind: "mutation" | "cna"; label: string }[] {
  const option = (kind: "mutation" | "cna", rows: typeof dataTypes) => {
    const held = rows.filter((d) => d.n > 0);
    if (!held.length) return [];
    const top = held.reduce((a, b) => (b.n > a.n ? b : a), held[0]);
    return [{ kind, label: top.label + " (" + fmtInt(held.reduce((n, d) => n + d.n, 0)) + " samples)" }];
  };
  return [
    ...option("mutation", dataTypes.filter((d) => d.alterationType === "MUTATION_EXTENDED")),
    ...option("cna", dataTypes.filter((d) => d.alterationType === "COPY_NUMBER_ALTERATION" && PROFILE_KINDS.cna.includes(d.profile))),
  ];
}

/** the gene charts asked for: genes whose status charts Explore counts, which of the two each shows, and genes charted by mutation type */
export interface GeneCharts { genes: string[]; kinds: Record<string, ("MUTATION" | "CNA")[]>; types: string[] }

/**
 * What the gene tab shows (STV-AC-5): the profile picked (`chosen`, else the first offered) and the
 * kind of chart Add makes, or, with no profile to chart from, a note in their place; and always
 * every charted gene's chips with what each removes, since a chart's tile has no close of its own.
 */
export function geneTabView(dataTypes: Parameters<typeof geneChartProfiles>[0], charts: GeneCharts, chosen: "mutation" | "cna", byType: boolean): {
  profiles: ReturnType<typeof geneChartProfiles>; current: ReturnType<typeof geneChartProfiles>[number] | null; kind: GeneChartKind;
  note: string | null; chips: { gene: string; kind: GeneChartKind; text: string }[];
} {
  const profiles = geneChartProfiles(dataTypes);
  const current = profiles.find((p) => p.kind === chosen) ?? profiles[0] ?? null;
  const chips = [
    ...charts.genes.flatMap((g) => (charts.kinds[g] || []).map((k) => ({ gene: g, kind: k as GeneChartKind, text: k === "CNA" ? "copy number" : "mutations" }))),
    ...charts.types.map((g) => ({ gene: g, kind: "types" as GeneChartKind, text: "mutation types" })),
  ];
  return { profiles, current, kind: current?.kind === "cna" ? "CNA" : byType ? "types" : "MUTATION",
    note: current ? null : "No selected study has mutation or copy-number data to chart a gene from.", chips };
}

/** how many charts a gene list draws: one per gene and kind shown, one per mutation-type table */
export const geneChartCount = (s: GeneCharts): number => s.genes.reduce((n, g) => n + (s.kinds[g]?.length || 0), 0) + s.types.length;

/** whether a change asks Explore for something new: its genes or mutation-type tables; another kind of a counted gene is already there */
export const geneChartsAsked = (before: GeneCharts, after: GeneCharts): boolean =>
  before.genes.join("|") !== after.genes.join("|") || before.types.join("|") !== after.types.join("|");

/** a gene chart added (`on`) or removed, at most `limit` genes of each list, as the portal adds one chart per gene and profile */
export function geneChartsChanged(s: GeneCharts, gene: string, kind: GeneChartKind, on: boolean, limit = 6): GeneCharts {
  if (kind === "types") {
    const types = on ? (s.types.includes(gene) ? s.types : [...s.types, gene].slice(-limit)) : s.types.filter((g) => g !== gene);
    return { ...s, types };
  }
  const had = s.kinds[gene] || [];
  const kinds = on ? (had.includes(kind) ? had : [...had, kind]) : had.filter((k) => k !== kind);
  const all = { ...s.kinds };
  if (kinds.length) all[gene] = kinds; else delete all[gene];
  const genes = kinds.length ? (s.genes.includes(gene) ? s.genes : [...s.genes, gene].slice(-limit)) : s.genes.filter((g) => g !== gene);
  for (const g of Object.keys(all)) if (!genes.includes(g)) delete all[g];
  return { genes, kinds: all, types: s.types };
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

/** the Clinical Data tab's Columns menu: the chart menu's Clinical, Genomic and X vs Y tabs only, as the portal's (STV-CD-9) */
const COLUMNS_TABS = ["clinical", "genomic", "xvsy"];

/** the Clinical Data tab's Columns menu: of the chart menu's tabs, its Clinical, Genomic and X vs Y ones */
export function columnsMenuTabs<T extends readonly [string, string]>(tabs: readonly T[]): T[] {
  return tabs.filter(([t]) => COLUMNS_TABS.includes(t));
}
