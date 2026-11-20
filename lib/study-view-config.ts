/**
 * The Study View's chart defaults, as cbioportal.org sets them (`StudyViewConfig.ts:131-170`,
 * `getPriorityByClinicalAttribute`, `shouldShowChart`; spec STS-LY-7, STS-LY-8).
 */
import type { BinSettings } from "./data-binner.ts";

/** the priority a clinical attribute is imported with when nobody set one */
export const DEFAULT_PRIORITY = 1;

/** the portal's own priorities, which replace a database priority left at the default */
export const STUDY_VIEW_PRIORITY: Readonly<Record<string, number>> = {
  CANCER_TYPE: 3000,
  CANCER_TYPE_DETAILED: 2000,
  SAMPLE_COUNT: 40,
  MUTATION_COUNT: 30,
  FRACTION_GENOME_ALTERED: 20,
  GENDER: 9, SEX: 9, AGE: 9,
  RACE: 8, ETHNICITY: 8, SAMPLE_TYPE: 8, HISTOLOGY: 8, TUMOR_TYPE: 8, SUBTYPE: 8, TUMOR_SITE: 8,
};

/**
 * A clinical attribute's chart priority: the database's, unless it is exactly the default 1, in
 * which case the portal's table decides (and 1 stays when the table has no entry). Higher comes
 * first; 0 is offered in Add chart but hidden by default.
 */
export function chartPriority(attribute: string, dbPriority: number): number {
  return dbPriority === DEFAULT_PRIORITY ? STUDY_VIEW_PRIORITY[attribute] ?? DEFAULT_PRIORITY : dbPriority;
}

/** the portal's chart order: priority, highest first, then display name A–Z */
export function chartOrder(a: { priority?: number; displayName?: string; attribute: string },
  b: { priority?: number; displayName?: string; attribute: string }): number {
  return (b.priority ?? 0) - (a.priority ?? 0) || (a.displayName || a.attribute).localeCompare(b.displayName || b.attribute);
}

/** how many clinical charts the page shows by default (`studyview_clinical_attribute_chart_count`) */
export const DEFAULT_CLINICAL_CHARTS = 20;

/**
 * Whether a default chart is drawn: it has two or more values (NA counting as one), or the
 * selection is filtered, or the study holds a single sample. A chart of one value says nothing
 * about the selection, so the portal leaves it in Add chart.
 */
export function shouldShowChart(values: number, filtered: boolean, totalSamples: number): boolean {
  return filtered || values >= 2 || totalSamples === 1;
}

/**
 * The charts on by default, as keys: the first DEFAULT_CLINICAL_CHARTS attributes with a priority
 * above 0 in chart order, then those with fewer than two values dropped (the portal slices first).
 */
export function defaultChartKeys<T extends { key: string; priority: number; values: number; attribute: string; displayName?: string }>(
  attrs: T[], opts: { filtered: boolean; totalSamples: number; allowed?: (a: T) => boolean }): string[] {
  return attrs.filter((a) => a.priority > 0 && (opts.allowed ? opts.allowed(a) : true)).sort(chartOrder)
    .slice(0, DEFAULT_CLINICAL_CHARTS)
    .filter((a) => shouldShowChart(a.values, opts.filtered, opts.totalSamples)).map((a) => a.key);
}

/** a chart's starting bins before its reader changes them (the portal's `initialBins`): the MSI scores' thresholds */
export const INITIAL_BIN_EDGES: Record<string, number[]> = {
  MSI_SCORE: [4, 10],
  MSI_SENSOR_SCORE: [4, 10],
  MSI_SCORE_MANTIS: [0.4, 0.6],
};

/** a chart's bins as its reader set them, or the ones it starts with (INITIAL_BIN_EDGES); `bins: null` is the default bars */
export function chartBinSettings(all: Record<string, BinSettings> | undefined, attribute: string): BinSettings | undefined {
  const s = all?.[attribute];
  const initial = INITIAL_BIN_EDGES[attribute];
  return s?.bins === undefined && initial ? { ...s, bins: { method: "custom", edges: initial } } : s;
}

/**
 * The portal's priorities for the charts that are not clinical attributes (`StudyViewConfig.ts`
 * 131-170, STS-LY-8), by the selector of their card on Explore's grid; the grid orders by them
 * (`orderCards`, lib/study-view-layout.ts).
 */
export const CARD_PRIORITY: readonly { selector: string; name: string; priority: number }[] = [
  { selector: '[data-chart="datatypes"]', name: "Data Types", priority: 1000 },           // GENOMIC_PROFILES_SAMPLE_COUNT
  { selector: '[data-special="caselists"]', name: "Case Lists", priority: 1000 },          // CASE_LISTS_SAMPLE_COUNT
  { selector: '[data-chart="survival"]', name: "Survival", priority: 400 },                 // OS survival
  { selector: '[data-chart="mutcount-fga"]', name: "Mutation Count vs FGA", priority: 200 }, // X-VS-Y FGA–MUTATION_COUNT
  { selector: '[data-genetable="mutated"]', name: "Mutated Genes", priority: 90 },
  { selector: '[data-genetable="sv"]', name: "Structural Variant Genes", priority: 85 },
  { selector: '[data-genetable="cna"]', name: "CNA Genes", priority: 80 },
  { selector: '[data-treatments="patient"]', name: "Treatment per Patient", priority: 75 },
  { selector: '[data-treatments="sample"]', name: "Treatment per Sample (pre/post)", priority: 75 },
  { selector: '[data-special="events"]', name: "Timeline Events Availability", priority: 75 },
  { selector: '[data-chart="studies"]', name: "Cancer Studies", priority: 70 },
];

/** whether Add chart offers an attribute: priority 0 is offered but hidden by default; below 0 it is dropped entirely (STS-LY-8) */
export const chartOffered = (priority: number | undefined): boolean => (priority ?? 0) >= 0;
