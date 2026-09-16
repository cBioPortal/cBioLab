// Shared domain types for the cbio-lab DSL and engine.
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
export interface GeneStateFacet {
  gene: string;
  type: "MUTATION" | "CNA";
  /** always "patient": the unit the draft filter selects in */
  per: "patient";
  /** patients in the cohort, the base of the notProfiled slice */
  total: number;
  /** patients with at least one sample on a panel covering this gene */
  profiled: number;
  states: { state: "altered" | "amp" | "del" | "unaltered" | "notProfiled"; label: string; n: number }[];
  /**
   * Patients with a call for this gene who are on NO panel covering it — a
   * source-data inconsistency, not a state a reader can select. genie_public has
   * 7 for EGFR. They are counted in `notProfiled` (no panel of theirs covers
   * the gene) and reported here so the contradiction is visible rather than
   * quietly folded into the altered slice, where it would break the partition.
   */
  alteredUnprofiled?: number;
  /**
   * Patients counted in BOTH Amplified and Deleted — amplified in one sample,
   * deleted in another. These four CNA states are selectable conditions, not a
   * partition, and this is by how much they over-sum. EGFR in genie_public has
   * exactly one.
   */
  overlap?: number;
}

export interface ProfiledLeaf {
  kind: "profiled"; type: "MUTATION" | "CNA" | "SV";
  /**
   * Narrow to samples profiled for THIS GENE — the panel they were run on
   * actually covers it. Without this, "profiled for mutations" includes samples
   * whose panel omits the gene, and a cohort built as "profiled AND NOT altered"
   * would call them wild-type for a gene nobody tested. That is the same error
   * the panel-aware denominator exists to prevent, so the gene-specific
   * alteration facets always set it.
   */
  gene?: string;
}
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
 *
 * "lines" and "treatmentSpan" are the exception: they read a study's own
 * event-type vocabulary on purpose (there is no vocabulary-free way to ask
 * "how many lines of treatment"), so they carry the event type they mean —
 * see lib/cohort2.ts's derivedMetricSql for why that is safe to allow here.
 */
export interface DerivedLeaf {
  kind: "derived";
  metric: "followupMonths" | "historyMonths" | "alteredGenes" | "lines" | "treatmentSpan";
  range: { gte?: number; gt?: number; lte?: number; lt?: number };
  /** required for "lines" and "treatmentSpan"; meaningless for the other three */
  eventType?: string;
  /** "lines" only — records within this many days belong to one line (default 90) */
  lineGap?: number;
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
import type { GeneTrackSpec } from "./gene-tracks.ts";
export type { GeneTrackSpec };

export interface CompareView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "compare"; genes: string[]; cohorts?: string[];
}
export interface SurvivalView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
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
/**
 * A plot: two axes over the same cases. The shape — scatter, box, contingency — follows from
 * what the axes are, exactly as it does in the portal, rather than being asked for.
 */
export interface PlotView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "plot"; x: PlotAxis; y: PlotAxis; cohorts?: string[];
  /** what a point is (default "sample"); patient mode averages a patient's samples */
  unit?: "patient" | "sample";
  /** the grid a scatter is binned onto (default 240 x 160) */
  bins?: [number, number];
  /**
   * Draw the values over a box plot's boxes when there are few enough of them and the study is
   * one this participant may see cases in (default true). Above the cap, or from an
   * aggregate-only participant, the same values are drawn as a density instead.
   */
  points?: boolean;
  /**
   * Colour the values by a category, as the portal's "Color samples by" does: `colorBy` fills
   * each point, `ringBy` rings it, so a case that is both amplified and mutated stays legible.
   * Above the points cap the fill splits the density instead.
   */
  colorBy?: PlotAxis;
  ringBy?: PlotAxis;
}
export interface CooccurrenceView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "cooccurrence"; genes: string[]; cohorts?: string[] }
export interface ClinicalView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "clinical"; attributes: string[]; cohorts?: string[] }
export interface CoexpressionView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "coexpression"; genes: string[]; profileType: string; cohorts?: string[] }
export interface HotspotsView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "hotspots"; genes: string[]; cohorts?: string[]; minCount?: number }
/**
 * The clinical course: what fraction of the still-observable cohort is in each
 * event state, over time relative to an anchor.
 *
 * `anchor` is optional for a single study (its own day 0 is a consistent
 * baseline) but REQUIRED once more than one study participates: day 0 means
 * different things in different studies — birth in one, first sequencing in
 * another — and the database records nowhere which it is, so aligning on raw
 * day 0 across studies compares incomparable clocks.
 */
export interface CourseView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "course"; cohorts?: string[];
  /** canonical event names to measure; case is folded (lib/event-names.ts) */
  eventTypes: string[];
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** bin width in months (default 3) */
  binMonths?: number;
  /** window in months relative to the anchor (default -12 to 60) */
  fromMonths?: number; toMonths?: number;
}
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
/** A sort key: "genomic" (staircase), "id", or a track label; "-label" or {dir:"desc"} descends. */
export type SortKeySpec = string | { track: string; dir?: "asc" | "desc" };
/**
 * How the figure is drawn. Every viewing option lives here rather than in browser
 * state, so a shared link, the server SVG, the CLI and the Python package all
 * reproduce the same picture. Unknown keys are rejected loudly.
 */
export interface DisplaySpec {
  /** draw columns with no alteration in any gene track (default true) */
  showUnaltered?: boolean;
  /** whitespace between columns once they are wide enough (default true) */
  whitespace?: boolean;
  /** split each cohort into runs of the primary categorical sort key (default "none") */
  gaps?: "none" | "gaps" | "pct";
  /** category keys under the figure (default "all") */
  clinicalLegends?: "all" | "none";
  /** colour each mutation class separately (default true); off draws them all as one */
  colorByType?: boolean;
  /**
   * Drop alterations the annotation source does not call drivers (default false). This changes
   * the NUMBERS, not only the picture: the hidden alterations leave the altered fraction too,
   * which is why it lives in the spec and the contract reports how many went.
   */
  hideVUS?: boolean;
  /** driver calls: the pinned OncoKB store, or none at all (default "oncokb") */
  annotate?: "oncokb" | "none";
  /** unaltered cells drawn white rather than grey, for print (default false) */
  whiteBackground?: boolean;
  /** partial override of lib/oncoprint-style.ts (Phase 1b) */
  style?: Record<string, unknown>;
  /** per-track, per-category colours: {trackLabel: {value: "#rrggbb"}} (Phase 1b) */
  colors?: Record<string, Record<string, string>>;
}
export type ResolvedDisplay = Required<Pick<DisplaySpec, "showUnaltered" | "whitespace" | "gaps" | "clinicalLegends" | "colorByType" | "hideVUS" | "annotate" | "whiteBackground">>
  & Pick<DisplaySpec, "style" | "colors">;
export interface OncoprintView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  /** rows: a gene symbol, or {label?, genes} for one merged row over several genes */
  kind: "oncoprint"; genes: GeneTrackSpec[]; cohorts?: string[];
  clinical?: string[]; heatmap?: HeatmapSpec[]; sort?: SortKeySpec[]; display?: DisplaySpec;
  /** what a column is (default "patient"); "sample" draws every sample of the cohort's patients */
  unit?: "patient" | "sample";
  /** mRNA / protein evidence drawn into the gene cells (see OncoprintSpec.overlays) */
  overlays?: { kind: "mrna" | "protein"; profileType: string; threshold?: number }[];
  /**
   * Document cohorts drawn as binary rows: a column is filled when that patient is in the
   * cohort. Any cohort definition can be a row, which is what this engine has that the portal
   * does not. Single-study and patient-level, like the definitions themselves.
   */
  derivedCohorts?: string[];
}
/**
 * Treatment sequences: what follows what, as lines of therapy.
 *
 * `exclude` drops label values that are not therapies. It is a parameter rather
 * than an engine rule because such markers are not structurally distinguishable
 * from real treatments — in MSK-CHORD the SUBTYPE `Prior Medications to MSK`
 * carries no duration, but neither do `Radiation Therapy` or `Investigational`.
 * Putting the choice in the document keeps it visible to whoever reads the result.
 */
export interface SequenceView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "sequence"; cohorts?: string[];
  /** event type carrying therapies (default: treatment) */
  eventType?: string;
  /** attribute key labelling each therapy (default: SUBTYPE) */
  labelKey?: string;
  exclude?: string[];
  /** days with no therapy that begin a new line (default 90) */
  lineGap?: number;
  /** lines to follow (default 3) */
  maxSteps?: number;
  /** distinct labels kept before the rest fold into "other" (default 6) */
  topN?: number;
}
import type { PlotAxis, PlotData } from "./plot.ts";
export type { PlotAxis, PlotData };
export type View = CompareView | SurvivalView | OncoprintView | CooccurrenceView | ClinicalView | CoexpressionView | HotspotsView | CourseView | SequenceView | PlotView;

/**
 * A document AS AUTHORED, before parameters are resolved. Any value in it may be
 * the string "$name" instead of the type the engine will eventually see — a
 * `genes` field really can hold `"$genes"` until lib/params.ts substitutes it.
 *
 * `AnalysisDoc` deliberately describes the RESOLVED document, so that everything
 * downstream of resolveParams() is typed as tightly as before and cannot quietly
 * accept a reference where a value is required.
 */
export type TemplateDoc = Omit<AnalysisDoc, "views"> & {
  views?: Array<View | Record<string, unknown>>;
};

export interface AnalysisDoc {
  study?: string;
  cohorts: Record<string, CohortDef>;
  views?: View[];
  /**
   * Template parameters. A value anywhere in the document that is exactly
   * "$name" is replaced by the value declared here — see lib/params.ts. Lets one
   * saved workspace be re-pointed at different genes or a different study
   * without editing the same list in five places.
   */
  params?: Record<string, unknown>;
  /** the analyst's own prose about this workspace: what it is for, what to read */
  notes?: string;
  /** a name, when this document has been saved as a workspace */
  title?: string;
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
  /** the analyst's own annotation, carried through from the view spec */
  annotationNote?: string;
  participation?: ViewParticipation;
  /** wall-clock for this view alone, in ms (its queries run concurrently) */
  ms?: number;
  /** of that, time spent rendering on the SERVER (the oncoprint's SVG) */
  renderMs?: number;
  /**
   * Oncoprint only, and only for `runAnalysis(doc, {oncoprint:"spec"})`: what to POST to
   * /api/oncoprint to get the figure. Carries cohort DEFINITIONS, never compiled SQL.
   */
  spec?: OncoprintSpec;
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
  coexpression?: CoexprRow[];
  /** a plot's aggregated contract: bins, groups or cells — never points */
  plot?: PlotData;               // co-expression
  hotspots?: HotspotGene[];                 // hotspots / lollipop
  course?: CourseSeries[];                  // clinical course
  sequence?: SequenceResult;                // treatment sequences
  /** course: bin width and window actually used, in months */
  courseAxis?: { binMonths: number; from: number; to: number };
  /**
   * course: every event type this cohort's timeline actually holds, so the UI
   * can offer the choice without a round trip. `perPatient` and `hasDurations`
   * are what separate a clinical event from an administrative marker — a type
   * with exactly one event per patient and no duration (Sequencing, Sample
   * acquisition) is a filing record, not a course.
   */
  eventOptions?: { canonical: string; label: string; patients: number; perPatient: number; hasDurations: boolean }[];
  svg?: string; nColumns?: number;          // oncoprint
  genes?: { gene: string; driverPct: number | null; anyPct: number | null }[];
}
/**
 * Therapy transitions, ready to draw: nodes in columns, flows between them.
 * One panel per cohort, sharing one scale and one colour assignment so two
 * cohorts can be compared without re-reading the legend.
 */
export interface SequenceResult {
  labelKey: string; lineGap: number; steps: number;
  foldedLabels: number; truncated: boolean;
  /** other attribute keys that could label a line, with how granular each is */
  keyOptions?: { key: string; label: string; patients: number; values: number }[];
  panels: SequencePanel[];
}
/**
 * `kind` distinguishes the two ways a path can end, which the label text alone
 * cannot: a regimen name is study data and could say anything.
 *   regimen  — a real line of therapy
 *   stopped  — observed for at least one line gap and began no further line
 *   censored — the record simply ends, so nothing can be concluded
 */
export type SequenceNodeKind = "regimen" | "stopped" | "censored";
export interface SequencePanel {
  cohort: string;
  nodes: { column: number; label: string; n: number; kind: SequenceNodeKind }[];
  /** `kind` describes the TARGET of the flow */
  flows: { column: number; from: string; to: string; n: number; kind: SequenceNodeKind }[];
  /** patients with a first line */
  started: number;
  /** of those, how many end in a censored terminal at any column */
  censored: number;
}

/** One cohort x event-type line of the clinical course. */
export interface CourseSeries {
  cohort: string;
  /** display spelling of the event type; `variants` records what folded into it */
  eventType: string; variants: string[];
  /** true when this event type carries real durations, so it reads as a state */
  isInterval: boolean;
  points: CoursePoint[];
}
export interface CoursePoint {
  /** months from the anchor at the START of the half-open bin */
  t: number;
  /** patients still under observation in this bin — the denominator */
  atRisk: number;
  /** patients in this state during the bin */
  n: number;
  /** n / atRisk as a percentage, null when nobody was observable */
  pct: number | null;
}
export interface AnalysisResult {
  study: string; involvedStudies: string[]; oncokbPin: string | null;
  /** the parameters this run resolved, and any declared but never referenced */
  params?: Record<string, unknown>;
  unusedParams?: string[];
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
  /** a merged gene row: the symbols it pools, in order. Absent on a single-gene row. */
  members?: string[];
  freqPct?: number | null; driverPct?: number | null;
  /** categorical clinical tracks */
  categories?: string[];
  /** numeric clinical + heatmap tracks (cells scaled 0..255; -1 = no data) */
  numeric?: boolean; min?: number; max?: number; center?: number | null;
  gene?: string; profileType?: string; note?: string;
}
export interface GroupRange { name: string; start: number; count: number; patients?: number }
export interface Contract {
  study: string; studies?: string[]; unit: "patient" | "sample";
  groups: GroupRange[];
  columns: string[];
  tracks: Track[];
  conventions: {
    cna: string; notProfiled: string; frequencyDenominator: string;
    /** what one column is, and what was collapsed or expanded to make it */
    column?: string;
    annotation: string; lineGap: number; sort: string[];
  };
  /** resolved viewing options — renderers read these, never their own defaults */
  display: ResolvedDisplay;
  /** ms: total; queryMs: fetching rows; assembleMs: turning them into this contract */
  stats: { nColumns: number; ms: number; queryMs?: number; assembleMs?: number;
    /** cells whose only alterations were of unknown significance, dropped by display.hideVUS */
    hiddenVus?: number };
  /** the SQL this contract was built from, when the caller asked for provenance */
  queries?: { label: string; sql: string; ms?: number; study?: string }[];
  /** set by the MCP app's display-resolution downsampler */
  bucketed?: boolean; bucketSizes?: number[];
}

export interface OncoprintSpec {
  study?: string; studies?: string[];
  /** rows: a gene symbol, or {label?, genes} for one merged row over several genes */
  genes: GeneTrackSpec[]; clinical?: string[]; heatmap?: HeatmapSpec[]; sort?: SortKeySpec[]; display?: DisplaySpec;
  /** what a column is (default "patient") */
  unit?: "patient" | "sample";
  /**
   * Molecular evidence drawn INTO the gene cells rather than as tracks: mRNA as an outline,
   * protein as thin bars. Values at or beyond ±threshold (default 2, the portal's z-score rule)
   * set the high/low bit. Expression is not an alteration, so it never enters the altered %.
   */
  overlays?: { kind: "mrna" | "protein"; profileType: string; threshold?: number }[];
  derivedEvents?: { label: string; expression: CohortDef }[];
  cohort?: { dsl: CohortDef } | null;
  layout?: { groupBy: { kind: "cohorts"; groups: { name: string; dsl: CohortDef }[] } } | null;
  conventions?: { lineGap?: number };
  /** study -> database name on the same instance, for studies outside the default database */
  dbs?: Record<string, string>;
  /** "<profileType>|<gene>" -> pooled reference, supplied by the analysis layer */
  zReference?: Record<string, ZReference>;
}

// ---------- explore ---------------------------------------------------------
interface FacetBase {
  /**
   * How many of the participating studies carry this attribute. 1 for a single
   * study. Lets the UI separate attributes the selection SHARES from one study's
   * own vocabulary — across 64 studies the union reaches 1,634 facets, in which
   * the handful every study has are lost among the rest.
   */
  studyCount?: number;
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
  metric: "followupMonths" | "historyMonths" | "alteredGenes" | "lines" | "treatmentSpan";
  label: string; unit: string; note: string;
  /** how many patients the metric could be computed for at all */
  covered: number;
  buckets: { label: string; n: number; gte?: number; lt?: number }[];
  /**
   * Counted against the draft MINUS this metric's own clauses, so the buckets
   * you did not pick stay visible and selectable. The total therefore does not
   * match the draft total — the UI says so, as it does for clinical facets.
   */
  disjunctive?: true;
  /**
   * Echoed back for "lines"/"treatmentSpan" so the reader can build a matching
   * {kind:"derived",...} clause without re-deriving which event type this
   * facet was computed from — see DerivedLeaf.
   */
  eventType?: string;
  lineGap?: number;
}

/** A reader-requested derived facet beyond the fixed three — see buildDerivedFacets. */
export interface ExtraDerivedRequest {
  metric: "lines" | "treatmentSpan";
  eventType: string;
  lineGap?: number;
}
export interface ExploreResult {
  study: string; studies?: string[]; draftCount: number | null;
  studyBreakdown?: StudyBreakdownRow[];
  clinical: ClinicalFacet[];
  events: { type: string; n: number }[];
  derived?: DerivedFacet[];
  /** legacy combined list — kept so existing consumers keep working */
  genes: { gene: string; n: number }[];
  /**
   * Per-gene alteration facets — the portal's "EGFR: Somatic mutations" and
   * "EGFR: Copy-number alterations" charts. Counted in PATIENTS, because that is
   * the unit a click filters in; the gene tables beside them count samples, and
   * each says which it is.
   *
   * `notProfiled` is the reason these exist. A patient whose panels omit the
   * gene is not wild-type for it and must not land in the unaltered slice.
   */
  geneFacets?: GeneStateFacet[];
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
