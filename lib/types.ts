// Shared domain types for the Cohort Lab DSL and engine.
//
// These mirror the grammar documented in lib/dsl-reference.ts (the single source
// of DSL documentation). Types here are deliberately *structural and permissive
// at the boundary*: documents arrive as untrusted JSON from clients, chat, and
// MCP, so the compilers validate at runtime and these types describe what
// validated data looks like — they are not a substitute for those checks.

// ---------- ClickHouse ------------------------------------------------------
// Every column arrives JSON-encoded: numerics come back as strings. Row types
// below say `string` where that is the truth, so coercion stays explicit.
export type ChRow = Record<string, string>;
export interface ChResult<R = ChRow> {
  data: R[];
  statistics?: { rows_read?: number; elapsed?: number };
  _ms?: number;
}

// ---------- cohort DSL (v2) -------------------------------------------------
export type ClinicalRange = { gt?: number; gte?: number; lt?: number; lte?: number };
export type ClinicalOp = "=" | "!=" | ">" | ">=" | "<" | "<=";

export interface OqlLeaf { kind: "oql"; q: string }
export interface ClinicalLeaf {
  kind: "clinical";
  attribute: string;
  /** patient-level by default; "sample" = patient matches if ANY sample matches */
  per?: "patient" | "sample";
  values?: (string | number)[];
  range?: ClinicalRange;
  op?: ClinicalOp;
  value?: string | number;
}
export interface PatientsLeaf { kind: "patients"; ids: string[] }
export interface ProfiledLeaf { kind: "profiled"; type: "MUTATION" | "CNA" | "SV" }
export interface CaseListLeaf { kind: "caseList"; id: string }
export interface GenomicDataLeaf {
  kind: "genomicData"; gene: string; profileType: string;
  range?: ClinicalRange; values?: (string | number)[];
}
export interface GenericAssayLeaf {
  kind: "genericAssay"; profileType: string; entity: string;
  range?: ClinicalRange; values?: (string | number)[];
}
/** deprecated alias, translated to OQL internally */
export interface AlterationLeaf {
  kind: "alteration"; gene: string;
  driver?: "driverOnly" | string; types?: ("MUT" | "CNA" | "SV")[];
}

// ---------- timeline sub-DSL (v1, embedded as an `event` leaf) --------------
export type Occurrence = "ANY" | "FIRST" | "LAST";
export interface EventSelector {
  eventType: string;
  attrs?: { key: string; value: string }[];
  /** value arrives as a string from JSON clients; validateSelector coerces */
  numeric?: { key: string; op: ClinicalOp; value: number | string };
  occurrence?: Occurrence;
  minDurationDays?: number | null;
}
export type EventRel =
  | { type: "NONE" }
  | { type: "BEFORE"; minDays?: number; maxDays: number }
  | { type: "DURING" }
  | { type: "NOT_FOLLOWED_BY"; withinDays: number; observed?: boolean };
export interface EventLeafFields {
  a: EventSelector; b?: EventSelector | null; rel: EventRel;
  priorGuard?: boolean; lineGap?: number;
}
export interface EventLeaf extends EventLeafFields { kind: "event" }

/**
 * A filter on a value computed from the shape of the data — dates, gene symbols
 * — rather than on a study's own event names or attribute keys, which vary from
 * study to study and so cannot be relied on.
 */
export interface DerivedLeaf {
  kind: "derived";
  metric: "followupMonths" | "historyMonths" | "alteredGenes";
  range: { gte?: number; gt?: number; lte?: number; lt?: number };
}
export type Leaf =
  | OqlLeaf | ClinicalLeaf | EventLeaf | PatientsLeaf | ProfiledLeaf
  | CaseListLeaf | GenomicDataLeaf | GenericAssayLeaf | AlterationLeaf | DerivedLeaf
  /** back-compat: the flat v1 event shape, accepted without a `kind` */
  | EventLeafFields;

export type Clause = Leaf | { any: Leaf[] } | { not: Leaf };

/** Narrow a clause to a clinical leaf (clauses may also be any/not groups). */
export function isClinicalLeaf(c: Clause | null | undefined): c is ClinicalLeaf {
  return !!c && (c as ClinicalLeaf).kind === "clinical" && !!(c as ClinicalLeaf).attribute;
}

export interface CohortDef {
  all?: Clause[];
  /** evaluate in another study */
  study?: string;
  /** union across studies (federated; members stay study-qualified) */
  studies?: string[];
  lineGap?: number;
  /** v1 sugar: a bare event definition, or an explicit patient list */
  a?: EventSelector; b?: EventSelector | null; rel?: EventRel; priorGuard?: boolean;
  patients?: string[];
}

/** Context threaded into every leaf compiler. */
export interface CompileCtx {
  study: string;
  /** database (schema) holding this study — per instance, so never a constant */
  db?: string;
  oncokbPin?: string | null;
  profiles?: string[];
  gaProfiles?: string[];
  lineGap?: number;
}

// ---------- analysis document ----------------------------------------------
export interface CompareView {
  kind: "compare"; genes: string[]; cohorts?: string[];
}
export interface SurvivalView {
  kind: "survival"; cohorts?: string[];
  /** endpoint prefix: OS (default), PFS, DFS, DSS… reads <X>_MONTHS/<X>_STATUS */
  endpoint?: string;
  /**
   * Re-anchor the clock to a timeline event instead of the study's day 0.
   * Delayed entry is applied automatically — without it, anchoring earlier than
   * day 0 manufactures immortal time.
   */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
}
export interface CooccurrenceView { kind: "cooccurrence"; genes: string[]; cohorts?: string[] }
export interface ClinicalView { kind: "clinical"; attributes: string[]; cohorts?: string[] }
export interface CoexpressionView { kind: "coexpression"; genes: string[]; profileType: string; cohorts?: string[] }
export interface HotspotsView { kind: "hotspots"; genes: string[]; cohorts?: string[]; minCount?: number }
export interface HeatmapSpec {
  profileType: string; genes?: string[];
  /**
   * "federation" z-scores the drawn values against a reference distribution
   * pooled from EVERY participating study — including instances that disclose
   * no patients and so contribute no columns. Default "cohort" leaves values
   * as the profile stores them.
   */
  reference?: "cohort" | "federation";
}
/** Pooled reference distribution for one (profileType, gene), from per-site moments. */
export interface ZReference { mean: number; sd: number; n: number; studies: string[] }
export interface OncoprintView {
  kind: "oncoprint"; genes: string[]; cohorts?: string[];
  clinical?: string[]; heatmap?: HeatmapSpec[]; sort?: string[];
}
export type View = CompareView | SurvivalView | OncoprintView | CooccurrenceView | ClinicalView | CoexpressionView | HotspotsView;

export interface AnalysisDoc {
  study?: string;
  cohorts: Record<string, CohortDef>;
  views?: View[];
}

// ---------- results ---------------------------------------------------------
export interface CohortResult {
  count: number; text: string; studies: string[]; sql: string;
}
export interface CompareCell {
  cohort: string; profiled: number; any: number; driver: number;
  anyPct: number | null; driverPct: number | null;
}
export interface CompareRow {
  gene: string; cells: CompareCell[]; pAny?: number; pDriver?: number;
}
export interface KmPoint { t: number; s: number }
export interface KmCurve {
  cohort: string; points: KmPoint[]; median: number | null;
  n: number; events: number; missing?: number;
}
export interface Cmh {
  chi2: number; p: number; df: number;
  /** Mantel-Haenszel common odds ratio, null when undefined */
  oddsRatio: number | null;
  /** strata that carried information */
  tables: number;
}
/** One gene pair, as a 2x2 among patients profiled for both, plus its inference. */
export interface CooccurRow {
  a: string; b: string;
  both: number; onlyA: number; onlyB: number; neither: number; profiled: number;
  log2Odds: number | null;
  /** two-sided Fisher on the POOLED table */
  p: number;
  /** BH-adjusted across all pairs in this view, using whichever p is primary */
  q: number;
  /** present when more than one study contributed: the site-stratified answer */
  pStratified?: number; oddsRatioMH?: number | null; strata?: number;
  tendency: "co-occurrence" | "mutual exclusivity" | null;
}
/** Recurrent protein changes in one gene, with the cohort's mutated total. */
export interface HotspotGene {
  gene: string;
  /** patients with ANY mutation in this gene, and how many distinct changes */
  mutated: number; distinctVariants: number;
  variants: { variant: string; type: string; pos: number | null; n: number; pct: number }[];
  /** variants withheld by the display cap, and by the suppression floor */
  cappedAt?: number; withheld?: number;
}
/** One gene pair's correlation on a continuous profile, from six sums per site. */
export interface CoexprRow {
  a: string; b: string;
  /** correlation of the pooled population, from summed moments (exact) */
  r: number | null; n: number; p: number; q: number;
  /** present with >1 study: per-site correlations combined by Fisher z */
  rMeta?: number | null; pMeta?: number; sites?: number;
  /** per-site r and n, so a reader can see whether the sites agree */
  perStudy?: { study: string; r: number | null; n: number }[];
}
/** One clinical attribute compared across cohorts. */
export interface ClinicalCell {
  cohort: string; n: number;
  /** categorical: the most common values */
  top?: { v: string; n: number }[];
  /** numeric: computed from additive moments, never from transmitted values */
  mean?: number | null; sd?: number; min?: number | null; max?: number | null;
}
export interface ClinicalRow {
  attribute: string; per: "patient" | "sample"; kind: "cat" | "num";
  cells: ClinicalCell[];
  test?: string; statistic?: number; df?: number; p?: number; q?: number;
  /** categorical only: vocabulary size, and the smallest expected cell */
  distinct?: number; minExpected?: number;
  /** why this attribute was not tested — stated, never silently omitted */
  skipped?: string;
}
/**
 * How each study behind a view answered. The distinction the whole system turns
 * on: an aggregate-only participant returns counts and never an identifier, so a
 * view built entirely from such participants moved no patient-level data at all.
 */
export interface ViewParticipation {
  studies: { study: string; mode: "patient-level" | "aggregate-only"; instance: string; remote?: boolean }[];
  /** true only for views whose output IS patients (the oncoprint's columns) */
  requiresPatientLevel: boolean;
  /** the studies that answered with aggregates only */
  aggregateOnly: string[];
}
export interface LogRank {
  chi2: number; p: number; df: number;
  /** total events in each group, then the expected counts under the null */
  observed: number[]; expected: number[];
  variance: number;
  /** how many strata contributed events — >1 means the test is site-stratified */
  strata: number;
}
export interface ViewResult {
  kind: string; error?: string; note?: string; studies?: string[];
  participation?: ViewParticipation;
  /** wall-clock for this view alone, in ms (its queries run concurrently) */
  ms?: number;
  /** of that, time spent rendering on the SERVER (the oncoprint's SVG) */
  renderMs?: number;
  /** the aggregate queries that produced THIS view's numbers, in order */
  queries?: { study: string; label: string; sql: string; ms?: number; remote?: boolean }[];
  cohorts?: string[]; annotation?: string;
  rows?: CompareRow[];                      // compare
  curves?: KmCurve[]; caveat?: string;      // survival
  endpoint?: string;                        // survival: which endpoint was used
  anchoredTo?: string;                      // survival: the event the clock was reset to
  truncated?: boolean;                      // survival: delayed entry was applied
  /** survival: how long after the anchor patients became observable */
  entryMonths?: { median: number; p90: number; max: number };
  logrank?: LogRank; logrankPooled?: LogRank;
  pairs?: CooccurRow[];                     // cooccurrence
  clinical?: ClinicalRow[];                 // clinical comparison
  coexpression?: CoexprRow[];               // co-expression
  hotspots?: HotspotGene[];                 // hotspots / lollipop
  svg?: string; nColumns?: number;          // oncoprint
  genes?: { gene: string; driverPct: number | null; anyPct: number | null }[];
}
export interface AnalysisResult {
  study: string; involvedStudies: string[]; oncokbPin: string | null;
  cohorts: Record<string, CohortResult>;
  views: ViewResult[];
  stats: { ms: number };
}

// ---------- oncoprint render contract ---------------------------------------
export type TrackKind = "gene" | "clinical" | "derivedEvent" | "heatmap";
export interface Track {
  kind: TrackKind; label: string; cells: number[] | Int32Array;
  /** gene tracks */
  altered?: number; profiled?: number; driverAltered?: number;
  freqPct?: number | null; driverPct?: number | null;
  /** categorical clinical tracks */
  categories?: string[];
  /** numeric clinical + heatmap tracks (cells scaled 0..255; -1 = no data) */
  numeric?: boolean; min?: number; max?: number; center?: number | null;
  gene?: string; profileType?: string; note?: string;
}
export interface GroupRange { name: string; start: number; count: number; patients?: number }
export interface Contract {
  study: string; studies?: string[]; unit: "patient";
  groups: GroupRange[];
  columns: string[];
  tracks: Track[];
  conventions: {
    cna: string; notProfiled: string; frequencyDenominator: string;
    annotation: string; lineGap: number; sort: string[];
  };
  stats: { nColumns: number; ms: number };
  /** set by the MCP app's display-resolution downsampler */
  bucketed?: boolean; bucketSizes?: number[];
}

export interface OncoprintSpec {
  study?: string; studies?: string[];
  genes: string[]; clinical?: string[]; heatmap?: HeatmapSpec[]; sort?: string[];
  derivedEvents?: { label: string; expression: CohortDef }[];
  cohort?: { dsl: CohortDef } | null;
  layout?: { groupBy: { kind: "cohorts"; groups: { name: string; dsl: CohortDef }[] } } | null;
  conventions?: { lineGap?: number };
  /** "<profileType>|<gene>" -> pooled reference, supplied by the analysis layer */
  zReference?: Record<string, ZReference>;
}

// ---------- explore ---------------------------------------------------------
interface FacetBase {
  attribute: string; per: "patient" | "sample"; patients: number;
  /** from clinical_attribute_meta — the portal's own declarations */
  displayName?: string; description?: string;
  /** the portal orders charts by this and hides priority 0 by default */
  priority?: number;
  /** distinct values in the cohort (categorical: decides pie vs ranked list) */
  distinct?: number;
}
/** Discriminated on `kind` so consumers narrow instead of asserting. */
export type ClinicalFacet =
  | (FacetBase & {
      kind: "cat";
      values: { v: string; n: number }[];
      /** set when re-queried against the draft minus its own clauses */
      disjunctive?: true;
    })
  | (FacetBase & {
      kind: "num"; min: number; max: number; median: number;
      /** histogram, cBioPortal-style: outlier bins plus fixed-width interior bins */
      bins?: NumericBin[];
      /** values that are not numbers (the portal's "NA" bar) */
      naCount?: number;
    });

/** one bar of a numeric histogram */
export interface NumericBin {
  /** "<=" and ">" mark the outlier bins; interior bins have neither */
  special?: "<=" | ">";
  start?: number;
  end?: number;
  count: number;
}
/**
 * A row in one of the three gene tables (Mutated / CNA / SV), mirroring
 * cBioPortal's study-view semantics: counts are SAMPLES, the frequency
 * denominator is samples profiled for THAT gene in the relevant alteration
 * type, and CNA rows are split per alteration (AMP / HOMDEL).
 */
export interface GeneTableRow {
  gene: string;
  /** distinct samples with such an alteration in this gene */
  altered: number;
  /** number of alteration events (a sample may carry several) */
  events: number;
  /** samples profiled for this gene = panel-profiled + whole-exome */
  profiled: number;
  /** altered / profiled, as a percentage */
  freqPct: number | null;
  /** CNA only: 2 = amplification, -2 = deep deletion, plus its cytoband */
  cna?: number;
  cytoband?: string;
}

/** one row per selected study: how the current draft distributes across them */
export interface StudyBreakdownRow {
  study: string; n: number;
  /** which instance holds it (federation) */
  instance: string; instanceLabel: string;
}
/**
 * A filter computed from the SHAPE of the data rather than a study's vocabulary,
 * so it means the same thing in every study that has the underlying table.
 */
export interface DerivedFacet {
  metric: "followupMonths" | "historyMonths" | "alteredGenes";
  label: string; unit: string; note: string;
  /** how many patients the metric could be computed for at all */
  covered: number;
  buckets: { label: string; n: number; gte?: number; lt?: number }[];
}
export interface ExploreResult {
  study: string; studies?: string[]; draftCount: number | null;
  studyBreakdown?: StudyBreakdownRow[];
  clinical: ClinicalFacet[];
  events: { type: string; n: number }[];
  derived?: DerivedFacet[];
  /** legacy combined list — kept so existing consumers keep working */
  genes: { gene: string; n: number }[];
  /** portal-equivalent gene tables (samples, panel-aware denominators) */
  mutatedGenes?: GeneTableRow[];
  cnaGenes?: GeneTableRow[];
  svGenes?: GeneTableRow[];
  /** total distinct genes behind each table, before the display cap */
  geneTotals?: { mutated: number; cna: number; sv: number };
  /** molecular data types with sample counts (the portal's genomic-data chart) */
  dataTypes?: { profile: string; label: string; alterationType: string; n: number }[];
  /** per-attribute numeric stats, used to derive shared bins when federating */
  numStats?: { attribute: string; per: "patient" | "sample"; min: number; max: number; q1: number; q3: number; allInts: boolean; n: number }[];
  /** cohort size in both units, as the portal's header reports it */
  totals?: { patients: number; samples: number };
  caseLists: { id: string; name: string; n: number }[];
  profiles: string[]; gaProfiles: string[];
  stats: { ms: number; perStudy?: Record<string, number | null> };
}
