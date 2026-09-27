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
  /**
   * Resolve `value` from a live percentile of this attribute's distribution instead of a literal
   * number — e.g. `{op:">=", percentile:0.8}` = "at or above the 80th percentile" ("top 20%").
   * Requires `op` (not `values`/`range`) and must not be combined with an explicit `value`.
   * Resolved once per document, before compilation (lib/analysis.ts's resolveCohortPercentiles),
   * so cohort2.ts's compiler always sees an ordinary, already-numeric op+value leaf — `percentile`
   * is gone by the time it gets there, exactly like a `$param` is gone after lib/params.ts.
   */
  percentile?: number;
  /**
   * The reference population the percentile is computed against: another cohort's name in this
   * same document. Omit for the whole study. That cohort must not itself use `percentile` — no
   * chaining — and must resolve to a single study, same as the cohort this leaf lives in.
   */
  percentileOf?: string;
}
/**
 * An explicit, cross-study list of ids. Each id is "<study>:<bare-id>" — the
 * legacy portal's own study-qualified id convention, chosen over the
 * database's internal "<study>_<bare-id>" join key specifically because a
 * bare id may itself contain underscores (a colon cannot appear in a study
 * id or a stable id, so splitting on it is unambiguous). Compiled once per
 * study (cohorts already fan out that way for any `studies: [...]`
 * definition) — ids for other studies are simply inert in that compile, not
 * an error, so one list can span as many studies as it likes. Never sent to
 * a remote or aggregate-only participant: see carriesPatientIds in
 * lib/federation.ts.
 */
export interface SampleListLeaf { kind: "sampleList"; ids: string[] }
export interface PatientListLeaf { kind: "patientList"; ids: string[] }
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
/**
 * A patient carries a mutation in `gene` whose protein position falls in
 * `range` — the stored proteinPosStart, same column the lollipop draws from,
 * never parsed from the change string. For splitting a cohort by where along
 * a protein a mutation falls (e.g. an N-terminal/C-terminal truncating-domain
 * split) when a study doesn't deposit that split as its own clinical
 * attribute. Position-only by design: AND it with an `oql` leaf
 * (`{"kind":"oql","q":"APC: TRUNC"}`) to also restrict by mutation type,
 * rather than this leaf growing a second, parallel type taxonomy.
 *
 * Not a partition: a patient with two separate qualifying mutations on
 * either side of a cutoff matches BOTH an N-terminal and a C-terminal
 * leaf, the same way the CNA amp/del "overlap" is a real, disclosed
 * count rather than an error (see GeneStateFacet.overlap). Two
 * "disjoint" cohorts built from complementary ranges can both count
 * such a patient, so their sizes may not add up to the ungrouped total.
 */
export interface ProteinPositionLeaf {
  kind: "proteinPosition"; gene: string; range: ClinicalRange;
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
  | OqlLeaf | ClinicalLeaf | EventLeaf | SampleListLeaf | PatientListLeaf | ProfiledLeaf
  | CaseListLeaf | GenomicDataLeaf | GenericAssayLeaf | AlterationLeaf | DerivedLeaf
  | ProteinPositionLeaf
  /** back-compat: the flat v1 event shape, accepted without a `kind` */
  | EventLeafFields;

export type Clause = Leaf | { any: Leaf[] } | { not: Leaf | { any: Leaf[] } };

/** Narrow a clause to a clinical leaf (clauses may also be any/not groups). */
export function isClinicalLeaf(c: Clause | null | undefined): c is ClinicalLeaf {
  return !!c && (c as ClinicalLeaf).kind === "clinical" && !!(c as ClinicalLeaf).attribute;
}

export interface CohortDef {
  all?: Clause[];
  /**
   * Name of another cohort in the same document whose `all` clauses this one inherits — spliced
   * in ahead of this cohort's own, so editing the parent updates every child instead of relying
   * on copy-pasted clauses staying in sync by hand. Resolved (and cycles rejected) before
   * anything is compiled — by the time a compiler or the readback sees this def, `extends` is
   * gone and `all` already holds the full, flattened list. Only combines `all`; other fields
   * (study, studies, lineGap, notes) are always the child's own, never inherited.
   */
  extends?: string;
  /** evaluate in another study */
  study?: string;
  /** union across studies (federated; members stay study-qualified) */
  studies?: string[];
  lineGap?: number;
  /** v1 sugar: a bare event definition */
  a?: EventSelector; b?: EventSelector | null; rel?: EventRel; priorGuard?: boolean;
  /** the analyst's own prose about this cohort: why it's defined this way, what to read */
  notes?: string;
}

/**
 * Auto-split ONE existing named cohort into an arm per distinct value of a categorical clinical
 * attribute, live from the data — instead of hand-writing one cohort per value. Lives on a VIEW,
 * not a cohort: the synthetic arms it produces are not added to the document's own named-cohort
 * map (so they don't compete for the 16-cohort cap or clutter the Cohorts tab), but each arm
 * still carries full provenance — its own compiled SQL and count — attached to that view's own
 * result (ViewResult.splitBy). Resolved once per view, live, before that view's own queries run
 * (lib/cohort-splitby.ts), the same "resolve once before compilation" shape as `extends` and a
 * clinical leaf's `percentile`.
 */
export interface SplitBy {
  /** which existing named cohort to split */
  cohort: string;
  /** a categorical clinical attribute; a numeric one is refused (use a percentile cutoff on a
   *  cohort instead — this splits into groups, it doesn't threshold a continuous value) */
  attribute: string;
  /** at most this many arms, INCLUDING a pooled "Other" if the attribute has more distinct
   *  values than this (default 8) — never silently drops a value, always discloses what got
   *  pooled and why, the same "+N more" idiom the oncoprint legend and sequence view use */
  maxArms?: number;
  /** an arm with fewer than this many matching patients pools into "Other" instead of standing
   *  alone (default 10 — the same floor the survival view's log-rank guard uses: below it, a
   *  group's own statistics are too unstable to read as a real arm) */
  minCount?: number;
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
  kind: "compare"; genes: string[]; cohorts?: string[]; splitBy?: SplitBy;
}
export interface SurvivalView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "survival"; cohorts?: string[]; splitBy?: SplitBy;
  /** endpoint prefix: OS (default), PFS, DFS, DSS… reads <X>_MONTHS/<X>_STATUS */
  endpoint?: string;
  /**
   * Override the <endpoint>_MONTHS/<endpoint>_STATUS naming convention with the exact clinical
   * attribute names, for a study whose outcome columns don't follow it (some do not — e.g.
   * PFS_MONTHS_FIRST_LINE_TX/PROGRESSION_STATUS). Both must be given together; `endpoint`, if
   * also given, is then just a display label, not something column names are derived from.
   */
  monthsAttribute?: string; statusAttribute?: string;
  /**
   * Re-anchor the clock to a timeline event instead of the study's day 0.
   * Delayed entry is applied automatically — without it, anchoring earlier than
   * day 0 manufactures immortal time.
   */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** administratively censor everyone still at risk past this month; truncates the plot too */
  cutoffMonths?: number;
  /** x-axis tick spacing in months (default: 12, or 24 past 60mo of plotted range) */
  tickMonths?: number;
  /** draw 1 - S(t), cumulative incidence, instead of survival (default "survival") */
  display?: "survival" | "incidence";
}
/**
 * A Cox covariate is exactly a plot axis: clinical, molecular, or a gene's alteration
 * status — plus, only here, an optional declared reference level for a categorical
 * covariate. Without it the most-frequent observed level becomes the reference (see
 * runAnalysis's Cox branch), which silently decided which direction a hazard ratio points;
 * a mutated/wild-type covariate came out "not-mutated vs mutated" whenever mutants were the
 * majority, backwards from how a paper usually reports it. `reference` must name a level the
 * data actually has — an unobserved value falls back to the frequency default rather than
 * silently doing nothing.
 */
export type CoxCovariate = PlotAxis & { reference?: string };
/**
 * Multivariate Cox proportional-hazards regression: several covariates at once, each
 * reported as a hazard ratio with a confidence interval (drawn as a forest plot), rather than
 * KM's one categorical split. Fit from real per-patient rows within each LOCAL study — unlike
 * survival/compare, this does not pool aggregate counts across remote peers, so a participant
 * without patient-level access simply cannot contribute to it (see CoxResult.excludedRemote).
 */
export interface CoxView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "cox"; cohorts?: string[]; splitBy?: SplitBy;
  /** endpoint prefix: OS (default), PFS, DFS, DSS… reads <X>_MONTHS/<X>_STATUS */
  endpoint?: string;
  /** same escape hatch as SurvivalView.monthsAttribute/statusAttribute, for the same reason */
  monthsAttribute?: string; statusAttribute?: string;
  /** one or more covariates to fit simultaneously; each becomes one or more forest-plot rows */
  covariates: CoxCovariate[];
  /** fit separate baseline hazards per study rather than pooling them (default false) */
  stratifyByStudy?: boolean;
  /**
   * Fit each named cohort as its own separate Cox model — its own coefficients, its own chosen
   * reference levels, its own N/events — instead of pooling every cohort's patients into one
   * fit (default false). Unlike `stratifyByStudy` (one shared model, a per-study baseline
   * hazard via Cox's `stratum`), this produces N independent models: the right tool when the
   * covariate EFFECT itself, not just the baseline hazard, might differ between cohorts (e.g.
   * a gene's hazard ratio in NSCLC vs in CRC). A no-op when only one cohort is named.
   */
  stratifyByCohort?: boolean;
  /** administratively censor everyone still at risk past this month, same semantics as SurvivalView */
  cutoffMonths?: number;
}
export interface CoxCoefficient {
  /** covariate name, or "<covariate>: <level>" for a categorical level */
  label: string;
  /** the baseline level this coefficient is measured against, for a categorical covariate */
  reference?: string;
  /** this coefficient's own level (the non-reference side), for a categorical covariate */
  level?: string;
  /** which entry of the view's `covariates` array this came from — lets the UI group a
   *  categorical covariate's coefficients back together to offer its observed levels as a
   *  reference-level picker, without re-deriving them from raw rows */
  axisIndex?: number;
  beta: number; se: number; hr: number; ciLow: number; ciHigh: number; p: number;
}
export interface CoxResult {
  coefficients: CoxCoefficient[];
  n: number; events: number;
  /** studies whose patients were left out of the fit for lacking patient-level access */
  excludedRemote?: { study: string; patients: number }[];
  /**
   * Present only when the view asked for `stratifyByCohort` (and named 2+ cohorts): one
   * independent Cox fit per cohort, in place of the single pooled fit above (`coefficients`
   * here is then empty; `n`/`events` are the sum across cohorts, for the header only). Each
   * cohort's `coefficients` chose its OWN reference levels from what IT observed, so the same
   * covariate can read against a different reference in different cohorts — real information,
   * not an inconsistency to paper over.
   */
  byCohort?: { cohort: string; coefficients: CoxCoefficient[]; n: number; events: number;
    excludedRemote?: { study: string; patients: number }[]; error?: string }[];
}
/**
 * Multivariate logistic regression: a BINARY outcome (not time-to-event) regressed on several
 * covariates at once, reported as odds ratios with a forest plot — the same shape as `cox`, but
 * for "did X happen" rather than "when did X happen". Reuses the exact same covariate/dummy-
 * coding machinery as `cox` (buildCoxColumns): a categorical covariate is dummy-coded the same
 * way, with the same reference-level rules (a mutated-vs-not axis defaults to "Not mutated";
 * others default to the most frequent level; `reference` overrides either). Fit from real
 * per-patient rows within each LOCAL study, same boundary as `cox`.
 */
export interface LogisticView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "logistic"; cohorts?: string[]; splitBy?: SplitBy;
  /** the binary outcome, as a plot axis (clinical, molecular, or alteration status) */
  outcome: PlotAxis;
  /**
   * Which observed value of a CATEGORICAL outcome counts as the event (1) — every other observed
   * value is collapsed into "not event" (0), and which values got collapsed is disclosed in the
   * caveat rather than left implicit. Required for a categorical outcome; refused (not guessed)
   * if omitted, or if it names a value the outcome never actually takes. Not used, and must be
   * omitted, for a NUMERIC outcome — that one must already be coded exactly 0/1, refused
   * otherwise (a continuous number silently coerced to 0/1 would be a guess about a threshold
   * nobody asked for).
   */
  outcomeEvent?: string;
  /** one or more covariates to fit simultaneously; each becomes one or more forest-plot rows */
  covariates: CoxCovariate[];
}
export interface LogisticCoefficient {
  /** covariate name, or "<covariate>: <level>" for a categorical level */
  label: string;
  /** the baseline level this coefficient is measured against, for a categorical covariate */
  reference?: string;
  /** this coefficient's own level (the non-reference side), for a categorical covariate */
  level?: string;
  axisIndex?: number;
  beta: number; se: number; or: number; ciLow: number; ciHigh: number; p: number;
}
export interface LogisticResult {
  coefficients: LogisticCoefficient[];
  n: number; events: number;
  /** a categorical outcome's other observed values, collapsed into "not event" — named so that
   *  is a disclosed choice, not a silent one */
  outcomeOther?: string[];
  /** studies whose patients were left out of the fit for lacking patient-level access */
  excludedRemote?: { study: string; patients: number }[];
}
/**
 * A plot: two axes over the same cases. The shape — scatter, box, contingency — follows from
 * what the axes are, exactly as it does in the portal, rather than being asked for.
 */
export interface PlotView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "plot"; x: PlotAxis; y: PlotAxis; cohorts?: string[]; splitBy?: SplitBy;
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
  note?: string; kind: "cooccurrence"; genes: string[]; cohorts?: string[]; splitBy?: SplitBy }
export interface ClinicalView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "clinical"; attributes: string[]; cohorts?: string[]; splitBy?: SplitBy }
export interface CoexpressionView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "coexpression"; genes: string[]; profileType: string; cohorts?: string[]; splitBy?: SplitBy }
export interface HotspotsView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "hotspots"; genes: string[]; cohorts?: string[]; minCount?: number; splitBy?: SplitBy }
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
  kind: "course"; cohorts?: string[]; splitBy?: SplitBy;
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
  /**
   * split each cohort into runs of the primary categorical sort key (default "none"); "pct" labels
   * each run with its altered percentages to its right, "pct-left" to its left
   */
  gaps?: "none" | "gaps" | "pct" | "pct-left";
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
  kind: "oncoprint"; genes: GeneTrackSpec[]; cohorts?: string[]; splitBy?: SplitBy;
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
  kind: "sequence"; cohorts?: string[]; splitBy?: SplitBy;
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
export type View = CompareView | SurvivalView | OncoprintView | CooccurrenceView | ClinicalView | CoexpressionView | HotspotsView | CourseView | SequenceView | PlotView | CoxView | LogisticView;

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
  /**
   * profiled/altered split by alteration type (mutation/cna/structuralVariant) — lets a reader
   * (or the UI) tell "0% altered, fully assayed" apart from "0% altered because this whole type
   * was never assayed for this cohort's study". `any`/`anyPct` above combine all three, matching
   * the oncoprint's "any alteration" convention, and can look like a real negative result even
   * when a whole type contributed zero because it was never checked.
   */
  byType: { mutation: { profiled: number; altered: number }; cna: { profiled: number; altered: number };
    structuralVariant: { profiled: number; altered: number } };
}
export interface CompareRow {
  gene: string; cells: CompareCell[]; pAny?: number; pDriver?: number;
  /** Benjamini–Hochberg across the genes tested in this view, computed separately for
   *  each of pAny/pDriver — only present once 2+ cohorts produce a p-value to correct. */
  qAny?: number; qDriver?: number;
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
/** One drawn stem: a codon, its height (distinct patient + change pairs), and how it is coloured. */
export interface LollipopPosition {
  pos: number; n: number; color: string; impact: string; driver: boolean;
  /** every change at this codon, by raw rows then name — the label and tooltip read these */
  changes: { change: string; n: number; rows: number }[];
}
export interface LollipopDomain { accession: string; name: string; start: number; end: number; color: string }
/**
 * One gene's lollipop, drawn the way cBioPortal's results-page mutation tab draws it (see
 * lib/lollipop.ts): one stem per codon, height = distinct (patient, protein change) pairs.
 */
export interface HotspotGene {
  gene: string;
  /** patients with any mutation in the gene, and distinct (patient, change) pairs */
  mutated: number; mutations: number;
  positions: LollipopPosition[];
  domains: LollipopDomain[];
  proteinLength: number;
  /** genome-nexus: the canonical transcript; observed: the service was unreachable, so the highest codon seen */
  lengthSource: "genome-nexus" | "observed"; transcript?: string;
  /** pairs not drawn because they have no codon (or one past the protein) */
  unpositioned: number;
  /** pairs a site withheld under its suppression floor */
  withheld: number;
  label?: { pos: number; text: string };
  /** the commonest changes, for text summaries (chat, MCP) */
  topChanges: { change: string; pos: number | null; n: number; pct: number }[];
  /** samples with a somatic mutation in the gene, and samples in the cohort */
  somaticSamples: number; cohortSamples: number;
  /**
   * Mutation rows by protein impact type, putative driver vs VUS — the portal's badge tally
   * beside the lollipop. Every row counts, drawn or not; `other` covers silent and unknown types.
   */
  tally: Record<"missense" | "truncating" | "inframe" | "splice" | "fusion" | "other", { driver: number; vus: number }>;
  /** the transcript's other identifiers, as the portal's gene summary lists them */
  ids?: { refseq?: string; ensembl?: string; ccds?: string; uniprotAccession?: string; uniprotName?: string };
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
  /**
   * numeric, single-study views only: exact median/quartiles from the cohort's complete value
   * histogram. Absent (not approximated) when the view spans more than one study, or when the
   * attribute had more distinct values than the histogram cap allows.
   */
  median?: number | null; q1?: number | null; q3?: number | null;
  /** true when the attribute had more distinct values than the histogram cap allows, so median/
   *  IQR (and the rank test, if this cell is one of exactly 2) were refused rather than computed
   *  from a partial distribution — stated, not silently absent */
  histogramTruncated?: boolean;
}
export interface ClinicalRow {
  attribute: string; per: "patient" | "sample"; kind: "cat" | "num";
  cells: ClinicalCell[];
  test?: string; statistic?: number; df?: number; p?: number; q?: number;
  /** Welch's ANOVA (3+ numeric cohorts) only: the denominator degrees of freedom — `df` above
   *  holds df1 (groups − 1), an F-test's other, non-integer, Welch-Satterthwaite-style df */
  df2?: number;
  /**
   * numeric, single-study: a rank-based test alongside the moment-based one (never in place of
   * it) — Mann-Whitney U for exactly 2 cohorts, Kruskal-Wallis for 3+ — a check worth having when
   * the attribute is skewed or has outliers the mean can mislead on. Deliberately not itself part
   * of the q-value correction above, which stays Welch's t/ANOVA only.
   */
  rankStatistic?: number; rankP?: number;
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
/**
 * The k-group generalization (k>2): a (k-1)-df chi-squared from the full covariance matrix,
 * not the single scalar variance the 2-group LogRank carries. df reflects however many groups
 * actually had data — an entirely empty group doesn't inflate it.
 */
export interface LogRankK {
  chi2: number; p: number; df: number;
  observed: number[]; expected: number[];
  groups: number;
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
  /**
   * Present only when the view asked for `splitBy`: the synthetic arms it produced, with full
   * provenance (each arm's own compiled SQL and count) since they aren't in the document's own
   * `cohorts` map (see SplitBy's own comment for why). `cohorts` above already lists their names
   * as this view's drawn cohorts; this is where a reader finds out what each one actually means.
   */
  splitBy?: {
    attribute: string; cohort: string;
    arms: { name: string; count: number; text: string; sql: string }[];
    /** raw values this split saw but pooled into "Other" rather than giving their own arm —
     *  because there were too many to fit `maxArms`, or too few patients to clear `minCount` */
    otherValues?: string[];
  };
  rows?: CompareRow[];                      // compare
  curves?: KmCurve[]; caveat?: string;      // survival
  endpoint?: string;                        // survival: which endpoint was used
  anchoredTo?: string;                      // survival: the event the clock was reset to
  truncated?: boolean;                      // survival: delayed entry was applied
  /** survival: how long after the anchor patients became observable */
  entryMonths?: { median: number; p90: number; max: number };
  cutoffMonths?: number;                    // survival: administrative censoring applied, echoed for the renderers
  tickMonths?: number;                      // survival: requested x-axis tick spacing, echoed for the renderers
  display?: "survival" | "incidence";       // survival: which curve was drawn
  logrank?: LogRank; logrankPooled?: LogRank;
  /** survival, 3+ cohorts: the k-group generalization (tests whether the groups differ AT ALL) */
  logrankK?: LogRankK; logrankKPooled?: LogRankK;
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
  cox?: CoxResult;                          // multivariate Cox
  logistic?: LogisticResult;                // multivariate logistic regression
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
  /**
   * The same altered/profiled/freqPct/driverPct, but sliced to one column group
   * (see Contract.groups) instead of pooled across all of them — the text/provenance
   * side of what the figure already draws with a group boundary. Present only on gene
   * tracks when the oncoprint has more than one group; absent (not zero-length) for a
   * single-group oncoprint, where a per-group breakdown would just repeat the pooled row.
   */
  byGroup?: { group: string; altered: number; profiled: number; freqPct: number | null; driverPct: number | null }[];
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
