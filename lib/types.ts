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

export type Leaf =
  | OqlLeaf | ClinicalLeaf | EventLeaf | PatientsLeaf | ProfiledLeaf
  | CaseListLeaf | GenomicDataLeaf | GenericAssayLeaf | AlterationLeaf
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
  oncokbPin?: string | null;
  profiles?: string[];
  gaProfiles?: string[];
  lineGap?: number;
}

// ---------- analysis document ----------------------------------------------
export interface CompareView {
  kind: "compare"; genes: string[]; cohorts?: string[];
}
export interface SurvivalView { kind: "survival"; cohorts?: string[] }
export interface HeatmapSpec { profileType: string; genes?: string[] }
export interface OncoprintView {
  kind: "oncoprint"; genes: string[]; cohorts?: string[];
  clinical?: string[]; heatmap?: HeatmapSpec[]; sort?: string[];
}
export type View = CompareView | SurvivalView | OncoprintView;

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
export interface ViewResult {
  kind: string; error?: string; note?: string; studies?: string[];
  cohorts?: string[]; annotation?: string;
  rows?: CompareRow[];                      // compare
  curves?: KmCurve[]; caveat?: string;      // survival
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
}

// ---------- explore ---------------------------------------------------------
interface FacetBase { attribute: string; per: "patient" | "sample"; patients: number }
/** Discriminated on `kind` so consumers narrow instead of asserting. */
export type ClinicalFacet =
  | (FacetBase & {
      kind: "cat";
      values: { v: string; n: number }[];
      /** set when re-queried against the draft minus its own clauses */
      disjunctive?: true;
    })
  | (FacetBase & { kind: "num"; min: number; max: number; median: number });
export interface ExploreResult {
  study: string; studies?: string[]; draftCount: number | null;
  clinical: ClinicalFacet[];
  events: { type: string; n: number }[];
  genes: { gene: string; n: number }[];
  caseLists: { id: string; name: string; n: number }[];
  profiles: string[]; gaProfiles: string[];
  stats: { ms: number; perStudy?: Record<string, number | null> };
}
