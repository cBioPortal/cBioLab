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
