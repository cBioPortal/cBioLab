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
  /** matched at the level the study records it: a sample attribute selects the matching samples,
   *  a patient attribute every sample of the matching patients */
  attribute: string;
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
 *
 * `set` instead of `ids` names a stored id set (lib/id-set-store.ts) by its id: the same list,
 * kept on the server, so the document carries a uuid however many ids the set holds. `label` and
 * `n` are its name and size as the page wrote them, for the cohort's pill; never compiled — the
 * readback names the set from the store. `part` names one of a lock's other lists in that set
 * (a split arm's patients, "arm:<split> / <arm>"); the engine writes it, from a cohort's `lock`.
 */
export interface SampleListLeaf { kind: "sampleList"; ids?: string[]; set?: string; part?: string; label?: string; n?: number }
export interface PatientListLeaf { kind: "patientList"; ids?: string[]; set?: string; part?: string; label?: string; n?: number }
/**
 * A fixed, engine-owned half of the study's patients: a salted hash of the study-qualified
 * patient id decides the half, so the partition is reproducible, identical for every caller,
 * and never passes through the client as an id list.
 */
export interface SplitLeaf { kind: "split"; part: "discovery" | "validation" }
/**
 * The samples with a row in an upload: a value in any of its columns (blank cells are not
 * stored); a patient-level row selects every sample of its patient. `dataset` names the upload as its attributes do, "custom:<name>", pinned by the
 * document's `uploads` like any of its attributes.
 */
export interface UploadLeaf { kind: "upload"; dataset: string }
export interface GeneStateFacet {
  gene: string;
  type: "MUTATION" | "CNA";
  /** always "sample": an alteration is called per sample, the unit the draft filter selects in */
  per: "sample";
  /** samples in the cohort, the base of the notProfiled slice */
  total: number;
  /** samples on a panel covering this gene */
  profiled: number;
  states: { state: "altered" | "amp" | "del" | "unaltered" | "notProfiled"; label: string; n: number }[];
  /**
   * Samples with a call for this gene that are on NO panel covering it — a
   * source-data inconsistency, not a state a reader can select. genie_public has
   * 7 for EGFR. They are counted in `notProfiled` (their panel does not cover
   * the gene) and reported here so the contradiction is visible rather than
   * quietly folded into the altered slice, where it would break the partition.
   */
  alteredUnprofiled?: number;
  /**
   * Samples counted in BOTH Amplified and Deleted. These four CNA states are selectable conditions, not a
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
  /**
   * Profiled for EVERY one of these genes: the same as one `gene` clause per gene, AND-ed, in a
   * single clause, so "unaltered in a gene list" fits a cohort's clauses however long the list
   * (the Results page's Unaltered group). Give `gene` or `genes`, not both.
   */
  genes?: string[];
}
export interface CaseListLeaf { kind: "caseList"; id: string }
export interface GenomicDataLeaf {
  kind: "genomicData"; gene: string; profileType: string;
  range?: ClinicalRange; values?: (string | number)[];
}
export interface GenericAssayLeaf {
  kind: "genericAssay"; profileType: string; entity: string;
  range?: ClinicalRange; values?: (string | number)[];
  /** any value at all: the sample (or, for a patient-level profile, the patient) was measured for the entity (a split's "evaluable" condition) */
  measured?: boolean;
}
/**
 * A sample carries a mutation in `gene` whose protein position falls in
 * `range` — the stored proteinPosStart, same column the lollipop draws from,
 * never parsed from the change string. For splitting a cohort by where along
 * a protein a mutation falls (e.g. an N-terminal/C-terminal truncating-domain
 * split) when a study doesn't deposit that split as its own clinical
 * attribute. Position-only by design: AND it with an `oql` leaf
 * (`{"kind":"oql","q":"APC: TRUNC"}`) to also restrict by mutation type,
 * rather than this leaf growing a second, parallel type taxonomy.
 *
 * Not a partition: a sample with two separate qualifying mutations on
 * either side of a cutoff matches BOTH an N-terminal and a C-terminal
 * leaf, the same way the CNA amp/del "overlap" is a real, disclosed
 * count rather than an error (see GeneStateFacet.overlap). Two
 * "disjoint" cohorts built from complementary ranges can both count
 * such a sample, so their sizes may not add up to the ungrouped total.
 */
export interface ProteinPositionLeaf {
  kind: "proteinPosition"; gene: string; range: ClinicalRange;
}
/** deprecated alias, translated to OQL internally */
export interface AlterationLeaf {
  kind: "alteration"; gene: string;
  driver?: "driverOnly" | (string & {}); types?: ("MUT" | "CNA" | "SV")[];
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
  | ProteinPositionLeaf | SplitLeaf | UploadLeaf
  /** back-compat: the flat v1 event shape, accepted without a `kind` */
  | EventLeafFields;

export type Clause = Leaf | { any: Leaf[] } | { not: Leaf | { any: Leaf[] } };

/** Narrow a clause to a clinical leaf (clauses may also be any/not groups). */
export function isClinicalLeaf(c: Clause | null | undefined): c is ClinicalLeaf {
  return !!c && (c as ClinicalLeaf).kind === "clinical" && !!(c as ClinicalLeaf).attribute;
}

export interface CohortDef {
  all?: Clause[];
  /** splits of this cohort into arms that never overlap and add up to it — see SplitDef */
  splits?: Record<string, SplitDef>;
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
  /**
   * Where this definition was copied from: a saved cohort (its id, which survives a rename), its
   * name then, and the hash of its definition then (lib/cohort-hash.ts). Provenance only — the
   * engine never reads it; the page compares it with the saved cohort to offer an update.
   */
  from?: CohortSource;
  /** frozen to the patients it selected when it was locked (lib/cohort-lock.ts) */
  lock?: CohortLock;
}

export interface CohortSource { saved: string; name: string; hash: string; savedAt?: string }

/**
 * A cohort's (or a split arm's) members when it was locked, in a stored id set (lib/id-set-store.ts).
 * A lock is one sample-level set: the cohort's samples are its main list, and beside them, as named
 * parts, each arm's samples (`part`, "arm:<split> / <arm>").
 */
export interface LockedMembers {
  /** the stored set holding the samples */
  set: string;
  /** the part of `set` holding them, for an arm; absent for the cohort itself */
  part?: string;
  /** samples frozen, and the patients they belong to */
  n: number;
  nPatients: number;
}

/**
 * A cohort frozen to what its definition selected at one moment (lib/cohort-lock.ts). The engine
 * evaluates the stored set; the definition is kept, and still run beside it, to say how far the
 * data has moved since.
 */
export interface CohortLock extends LockedMembers {
  /** when it was locked (ISO 8601) */
  at: string;
  /** the warehouse's data version then, and the OncoKB release the definition was read against */
  dataVersion?: string;
  oncokbPin?: string | null;
  /** each split arm's own frozen members, keyed by its name under this cohort ("<split> / <arm>") */
  children?: Record<string, LockedMembers>;
}

/**
 * One arm of a split: a name and the clause a patient must match to be in it. Arms are tested in
 * order and the first match wins, so a patient is in exactly one arm. An arm may itself be split.
 */
export interface SplitArm { name: string; where: Clause; notes?: string; splits?: Record<string, SplitDef> }
/**
 * A split of a cohort, stored on that cohort (`cohorts[name].splits[split]`, or on an arm): child
 * cohorts that are disjoint and together exactly the parent, resolved before compilation by
 * lib/cohort-partitions.ts. Each arm becomes the cohort "<cohort> / <split> / <arm>"; patients
 * matching no arm go to "<cohort> / <split> / Other"; patients for whom an arm's condition cannot
 * be decided (not profiled for the gene, no value recorded) go to a named "Not profiled: …" /
 * "No … recorded" child instead of being counted as not matching it.
 */
export interface SplitDef {
  arms: SplitArm[];
  /** name of the remainder child (default "Other") */
  other?: string;
  /** splits of the remainder */
  otherSplits?: Record<string, SplitDef>;
  notes?: string;
  source?: PartitionDef["source"];
}
/** One arm of a split, as the engine works with it: no nested splits (those are flattened). */
export interface PartitionArm { name: string; where: Clause; notes?: string }
/**
 * A split as the engine and the page work with it: flattened out of the cohort tree
 * (lib/partition-arms.ts flattenSplits), keyed by "<owner> / <split>", knowing what it splits.
 */
export interface PartitionDef {
  /** the cohort it splits: a named cohort, or an arm (or remainder) of another split */
  of: string;
  /** its own name, as stored on the cohort (the flat key is "<of> / <split>") */
  split: string;
  arms: PartitionArm[];
  /** name of the remainder child (default "Other") */
  other?: string;
  notes?: string;
  /**
   * How the arms were produced, when a tool wrote them from the data (e.g. one arm per value of
   * an attribute). Provenance only: the engine runs the arms as written, so the document alone
   * determines the children.
   */
  source?: { attribute?: string; gene?: string; oql?: string[]; minCount?: number; median?: boolean;
    /** a generic-assay entity the arms read */
    assay?: { profileType: string; entity: string };
    /** values seen but given no arm of their own (too few patients, or past the arm limit), up to 50 */
    otherValues?: string[];
    /** the attribute had more values than were ranked, so otherValues does not list them all */
    otherValuesTruncated?: boolean };
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
  /**
   * Exactly one of `attribute`/`gene`/`oql` must be given — three different sources of grouping,
   * all producing the same kind of ephemeral, view-scoped arms.
   */
  /** a categorical clinical attribute; a numeric one is refused (use a percentile cutoff on a
   *  cohort instead — this splits into groups, it doesn't threshold a continuous value) */
  attribute?: string;
  /**
   * A gene symbol: splits into exactly two arms (mutated / not mutated via OQL) rather than a
   * live-discovered value distribution — no query needed to know the group names in advance,
   * unlike `attribute`. Sugar for the single-gene case of `oql` below, with its complement
   * ("Not mutated") auto-generated — `oql` itself never auto-generates a complement, since with
   * an arbitrary list of queries there's no single obvious "everything else" to name that way.
   * `maxArms`/`minCount` don't apply here (always exactly 2) and are refused if given alongside
   * `gene`, to avoid silently implying a knob that does nothing.
   */
  gene?: string;
  /**
   * One or more portal-OQL queries (1-8 — the same limit the compiler's own `{any:[...]}` clause
   * enforces everywhere else, since the Other arm and the overlap check both need every query to
   * fit inside one such clause; the same subset lib/oql.ts compiles for a cohort's own
   * `{kind:"oql"}` leaf) — one arm per query, named from the query text itself, so this reaches
   * anything OQL can express: a specific mutation type, a driver-only call, a multi-gene
   * co-alteration ("TP53: MUT; KRAS: MUT"), copy number, and so on — not just plain mutation
   * status. A patient matching more than one query appears in EVERY arm it matches — arms are
   * NOT forced into a partition — and the total overlap is disclosed, not hidden; a patient
   * matching none of them falls into a disclosed "Other" arm, same as attribute mode's leftover
   * values. `maxArms`/`minCount` don't apply (you named the arms yourself; there's no
   * data-discovered long tail to cap or pool) and are refused if given alongside `oql`.
   */
  oql?: string[];
  /** at most this many arms, INCLUDING a pooled "Other" if the attribute has more distinct
   *  values than this (default 8) — never silently drops a value, always discloses what got
   *  pooled and why, the same "+N more" idiom the oncoprint legend and sequence view use.
   *  `attribute` mode only. */
  maxArms?: number;
  /** an arm with fewer than this many matching patients pools into "Other" instead of standing
   *  alone (default 10 — the same floor the survival view's log-rank guard uses: below it, a
   *  group's own statistics are too unstable to read as a real arm). `attribute` mode only. */
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
import type { TableQuery, ColumnValues } from "./table-query.ts";
export type { TableQuery, ColumnValues, ColumnFilter, TextFilterOp } from "./table-query.ts";
export type { GeneTrackSpec };
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
export interface IncidenceCurve {
  cohort: string;
  n: number; events: number; competing: number; censored: number;
  points: { t: number; f1: number; f2: number; se1: number; atRisk: number }[];
  /** patients who could not enter the risk set, by reason */
  excluded: { prior: number; unobserved: number; noFollowup: number; noAnchor: number };
  /** kept, but their first event was recorded after their last follow-up */
  late: number;
}
/**
 * What every table view's result shares (lib/table-query.ts): every column (the download's), the
 * ones shown, the query as applied, one page of the rows the query keeps — searched, filtered and
 * sorted together across every cohort and study — and how many it keeps of how many in all.
 */
export interface TableRows<V> {
  /** every column the table holds, in download order; each row's values align with these */
  columns: { id: string; name: string; numeric: boolean }[];
  /** the ids shown, in order, and those shown when the query names none */
  shown: string[]; defaults: string[];
  /** the view's search, filters and sort as applied (columns as given) */
  query: TableQuery;
  /** one page of the query's single order; values align with `columns` */
  rows: { cohort: string; study: string; patient: string; sample: string; values: V[] }[];
  /** where this page starts in that order, and the page size the view asks for */
  offset: number; pageSize: number;
  /** per cohort and study: rows the query keeps (`total`) and every row (`all`) — what the download pages through */
  lists: { cohort: string; study: string; total: number; all: number }[];
  /** rows the query keeps, and every row the table holds */
  total: number; all: number;
  /** set when the studies live in several databases: each database's rows are sorted together and listed in turn */
  instances?: number;
  /** studies that may not disclose patients, with how many of each cohort's patients they hold */
  excluded?: { study: string; reason: string; patients: number }[];
  /** the values one column takes, when the request asked for them (RunOpts.values) — what its filter offers */
  values?: ColumnValues;
}
/** One clinical event, as the study records it: days from diagnosis, and its attributes in order. */
export interface PatientEvent { type: string; start: number; end: number | null; attrs: [string, string][] }
/** One of the patient's samples and its recorded sample type. */
export interface PatientSample { id: string; type: string }
/** Everything the timeline figure needs about one patient, and who answered for it. */
export interface PatientTimeline {
  study: string; patient: string;
  events: PatientEvent[];
  samples: PatientSample[];
  /** the instance that holds this patient: its label, and whether it answered via federation */
  source: { label: string; remote?: boolean };
}
export interface TimelineResult extends TableRows<string | number | null> {
  /** the drawn patient, or null when the list is empty */
  patient: PatientTimeline | null;
  /**
   * Where the drawn patient falls in the list's order (its search, filters and sort), with the
   * patients either side — what prev / next step to. Null when the list's query leaves it out.
   */
  position?: { index: number; prev: { study: string; id: string } | null; next: { study: string; id: string } | null } | null;
}
import type { PlotAxis, PlotData } from "./plot.ts";
import type { ProfileInfo } from "./profile-catalog.ts";
export type { PlotAxis, PlotData };
/**
 * Every view kind's spec, by kind. lib/types.ts names no kind: each adds its own entry from its folder
 * (lib/views/<kind>/types.ts, `declare module "../../types.ts"`), as it does to ViewResultFields and
 * ViewResultMain below.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by each kind's declaration merging
export interface ViewSpecs {}
export type View = ViewSpecs[keyof ViewSpecs];
/** every view kind the document language has; a comparison against anything else is a type error */
export type ViewKind = View["kind"];

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
  /** the document's version (lib/doc-version.ts); written by everything that writes a document */
  dsl?: string;
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
  /**
   * Server-stored custom data this document pins: the name its attributes use
   * (`custom:<as>/<COLUMN>`) -> a stored dataset at one version (lib/custom-store.ts). A pinned
   * version never changes, so whoever may read it gets the same rows. A name with no pin is a
   * local upload, sent by the browser that holds it.
   */
  uploads?: { as: string; dataset: string; version: number }[];
  /** every cohort was locked at once, at this moment (lib/cohort-lock.ts): the analysis as of then */
  locked?: { at: string; dataVersion?: string; oncokbPin?: string | null };
}

// ---------- results ---------------------------------------------------------
/** A cohort's size: its patients (the owners of its samples) and its samples. */
export interface CohortSizes { patients: number; samples: number }
export interface CohortResult {
  /** patients: the owners of the cohort's samples */
  count: number;
  /** the cohort's samples */
  samples: number;
  text: string; studies: string[]; sql: string;
  /** for a locked cohort or arm: when, how many it froze, and how far the data has moved since */
  lock?: LockDrift;
}
export interface LockDrift {
  /** the locked cohort that holds the lock (this name, or the cohort a split arm belongs to) */
  cohort: string;
  at: string;
  dataVersion?: string;
  /** samples frozen, and of those how many the data still holds */
  n: number;
  present: number;
  /** what the definition selects now, in samples, and how that differs from the frozen samples */
  now: number;
  entered: number;
  left: number;
  /** why the movement could not be measured (the frozen patients still answered) */
  error?: string;
}
export interface KmPoint { t: number; s: number }
export interface KmCurve {
  cohort: string; points: KmPoint[]; median: number | null;
  n: number; events: number; missing?: number;
  /** the number at risk at each whole month from 0 (index = month), through the last follow-up */
  atRisk?: number[];
  /** patients whose follow-up ended at or before their entry: never at risk, so left out of n */
  unobserved?: number;
}
export interface Cmh {
  chi2: number; p: number; df: number;
  /** Mantel-Haenszel common odds ratio, null when undefined */
  oddsRatio: number | null;
  /** strata that carried information */
  tables: number;
}
/**
 * How each study behind a view answered. The distinction the whole system turns
 * on: an aggregate-only participant returns counts and never an identifier, so a
 * view built entirely from such participants moved no patient-level data at all.
 */
/**
 * One place an analysis's data came from: a database of this deployment, or a peer it reached
 * through its federation API, with the studies it answered for and what it reported about itself (lib/provenance.ts).
 */
export interface AnalysisSource {
  /** as this deployment names it */
  label: string;
  /** a peer reached through its federation API (the simulated one included) */
  remote: boolean;
  /** that peer's federation API */
  url?: string;
  /** what the peer calls itself, from its own answers — not this deployment's label for it */
  reportedName?: string;
  /** the commit the answering code runs, as it reports it */
  build?: string;
  /** when the peer first answered during this run */
  answeredAt?: string;
  /** each study it answered for, with when that study's data was last imported */
  studies: { study: string; imported: string | null }[];
}

/** What a peer reports about itself in every federated answer (lib/provenance.ts). */
export interface PeerSource {
  name: string;
  build: string;
  /** the study answered for, and when its data was last imported there */
  study?: string;
  imported?: string | null;
}

export interface ViewParticipation {
  /** `source` indexes the result's `sources` */
  studies: { study: string; mode: "patient-level" | "aggregate-only"; instance: string; remote?: boolean; source?: number }[];
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
/** What every view's result carries, whatever its kind. */
export interface ViewResultCommon {
  error?: string; note?: string; studies?: string[];
  /** a view that names no cohorts yet: the page draws it waiting for one, and nothing ran for it */
  empty?: true;
  /** the analyst's own annotation, carried through from the view spec */
  annotationNote?: string;
  participation?: ViewParticipation;
  /** wall-clock for this view alone, in ms (its queries run concurrently) */
  ms?: number;
  /** of that, time spent rendering on the SERVER (the oncoprint's SVG) */
  renderMs?: number;
  /** the aggregate queries that produced THIS view's numbers, in order */
  queries?: { study: string; label: string; sql: string; ms?: number; remote?: boolean }[];
  /** what was computed from those queries' rows, built from the values the computation used (lib/method.ts) */
  method?: import("./method.ts").MethodRecord;
  cohorts?: string[]; annotation?: string;
  /**
   * Present only when the view asked for `splitBy`: the synthetic arms it produced, with full
   * provenance (each arm's own compiled SQL and count) since they aren't in the document's own
   * `cohorts` map (see SplitBy's own comment for why). `cohorts` above already lists their names
   * as this view's drawn cohorts; this is where a reader finds out what each one actually means.
   */
  splitBy?: {
    /** echoes exactly one of the view's own splitBy.attribute/gene/oql */
    attribute?: string; gene?: string; oql?: string[]; cohort: string;
    /** `count` in patients, `samples` in samples */
    arms: { name: string; count: number; samples: number; text: string; sql: string }[];
    /** raw values this split saw but pooled into "Other" rather than giving their own arm —
     *  because there were too many to fit `maxArms`, or too few patients to clear `minCount`
     *  (attribute mode), or matched none of the given queries (oql mode). Never set for gene
     *  mode — its two arms (mutated / not) are already a complete partition by construction. */
    otherValues?: string[];
    /** patients counted toward more than one of the NAMED arms above (never "Other", which is
     *  disjoint from them by construction) — arms are not forced into a partition, so this
     *  discloses by how much they overlap rather than leaving it to be discovered by the arm
     *  counts not summing to the base cohort. 0/undefined when there's no overlap to report. */
    overlapCount?: number;
  };
  /** what a reader must know to read the numbers right */
  caveat?: string;
}
/**
 * Each view kind's own result fields, beside the common ones. A result of one kind has only its
 * kind's fields: code that reads another kind's does not compile. They are optional because a
 * refused, failed or waiting view carries none of them.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by each kind's declaration merging
export interface ViewResultFields {}
/**
 * Each kind's main field: what every DRAWN result of that kind carries (one that neither failed
 * nor waits for cohorts). The oncoprint has none: it carries its figure or its spec, by request.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by each kind's declaration merging
export interface ViewResultMain {}
/** a result that was drawn: no error, not waiting, and its main field present */
type Drawn<K extends ViewKind> = { error?: undefined; empty?: undefined } & ViewResultFields[K]
  & { [F in ViewResultMain[K]]-?: NonNullable<ViewResultFields[K][F & keyof ViewResultFields[K]]> };
/** a result that was not: refused or failed (`error`), or waiting for cohorts (`empty`) */
type NotDrawn<K extends ViewKind> = ({ error: string } | { empty: true }) & ViewResultFields[K];
/** A view's result: the common fields, its kind's own (ViewResultFields), and `kind` to tell which. */
export type ViewResultOf<K extends ViewKind> = ViewResultCommon & { kind: K } & (Drawn<K> | NotDrawn<K>);
/**
 * Any view's result. Checking `kind` narrows it to that kind's ViewResultOf. The one value outside
 * ViewKind: runAnalysis echoes a kind it does not know, with error "unknown view kind".
 */
export type ViewResult = { [K in ViewKind]: ViewResultOf<K> }[ViewKind];
/**
 * A result carrying only common fields (a refusal, an error, a view waiting for cohorts), for a kind
 * known only at run time. Valid for every kind, but TypeScript cannot check an object against all
 * of them at once, so this is the one place that says so.
 */
/** a result of kind K that was drawn: its main field present (ViewResultMain) */
export type DrawnResultOf<K extends ViewKind> = Extract<ViewResultOf<K>, { error?: undefined; empty?: undefined }>;
/** v was drawn: after this, its kind's main field (ViewResultMain) is known to be present. */
export function isDrawn<R extends ViewResult>(v: R): v is Extract<R, { error?: undefined; empty?: undefined }> {
  return !v.error && !v.empty;
}
export function plainResult(kind: ViewKind, fields: ViewResultCommon = {}): ViewResult {
  return { ...fields, kind } as ViewResult;
}
export interface AnalysisResult {
  study: string; involvedStudies: string[]; oncokbPin: string | null;
  /** where the data came from: each database or federation peer, and the studies it answered for */
  sources?: AnalysisSource[];
  /** the parameters this run resolved, and any declared but never referenced */
  params?: Record<string, unknown>;
  unusedParams?: string[];
  cohorts: Record<string, CohortResult>;
  /** each split's children with their counts, and whether they add up to the cohort it splits;
   *  keyed "<cohort> / <split>" */
  splits?: Record<string, PartitionResult>;
  /** present when the document was written in an older version and upgraded to run */
  upgraded?: import("./doc-version.ts").DocUpgrade;
  views: ViewResult[];
  stats: { ms: number };
}
export interface PartitionResult {
  /** the parent's patients and samples */
  of: string; split: string; parentCount: number; parentSamples: number;
  /** `count` in patients, `samples` in samples */
  children: { name: string; label: string; role: "arm" | "other" | "notEvaluable"; count: number; samples: number }[];
  /** sum of the children's samples; equals parentSamples when the split is exact (arms are disjoint in samples) */
  sum: number;
  conserved: boolean;
  /** arm conditions this engine cannot check evaluability for — Other may hold unknowns */
  unchecked: string[];
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
  /**
   * A "Profiled for <type>" row: category 0 is "Yes" and a cell without a value means "No".
   * Renderers draw it in the style's `glyph.profiled` colour.
   */
  profiledFor?: string;
  /** numeric clinical + heatmap tracks (cells scaled 0..255; -1 = no data) */
  numeric?: boolean; min?: number; max?: number; center?: number | null;
  /** draw a numeric track as bars (barBand in the style), as the portal draws numeric clinical attributes */
  bar?: boolean;
  /** the cells scale log(value + |min| + 1) rather than the value (the portal's rule for mutation counts) */
  logScale?: boolean;
  /** zoomed out, a bucket shows its largest value rather than the mean: the row points at exceptions */
  peak?: boolean;
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
    hiddenVus?: number;
    /** calls on a cell no panel covers (off-panel), not drawn: the cell stays not profiled; absent when none */
    offPanel?: number };
  /** the SQL this contract was built from, when the caller asked for provenance */
  queries?: { label: string; sql: string; ms?: number; study?: string; remote?: boolean }[];
  /** set by the MCP app's display-resolution downsampler */
  bucketed?: boolean; bucketSizes?: number[];
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

/**
 * One entity of a generic-assay profile as an Explore chart: a histogram of its numbers, or its
 * values' counts. Counted in PATIENTS with a value in the bar, the unit a click filters in (a
 * genericAssay clause keeps a patient with any sample in range), so a patient whose samples fall
 * in two bars is in both. Over the selected studies that hold the profile (`studies`).
 */
export interface AssayFacet {
  profileType: string; entity: string;
  /** the entity's display name, where the study gives one */
  name?: string;
  kind: "num" | "cat";
  /** what is counted: samples, as on the portal, or patients for a patient-level profile; absent on an error */
  unit?: "sample" | "patient";
  /** the cohort's samples (or patients) in the studies holding the profile, and those with a value */
  total: number; measured: number;
  bins?: NumericBin[];
  min?: number; max?: number; median?: number;
  values?: { v: string; n: number }[];
  studies: string[];
  /** counted against the draft without its own clauses on this entity */
  disjunctive?: true;
  /** why there is nothing to draw */
  error?: string;
}

/** one bar of a numeric histogram, as cBioPortal lays it out (lib/data-binner.ts) */
export interface NumericBin {
  /** "<=" the bar of values at or below `end`, ">" those above `start`; an interior bar has neither */
  special?: "<=" | ">";
  /** an interior bar is (start, end]; start = end is a bar of that one value */
  start?: number;
  end?: number;
  /** a value that is not a number ("Negative", "UNKNOWN"), drawn as its own bar */
  value?: string;
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
  /** distinct samples with such an alteration in this gene — the portal's "#", off-panel calls included */
  altered: number;
  /**
   * those of them whose call is ON a panel covering the gene (genomic_event_derived.off_panel is
   * false; a whole-exome call always is) — the frequency's numerator, as on cBioPortal's study view.
   * An off-panel call is a gene its sample's panel does not cover, so that sample is not in
   * `profiled`; counting it would set a numerator against a denominator it is not part of.
   * Absent from a peer that predates it, which then reads as `altered`.
   */
  alteredOnPanel?: number;
  /** number of alteration events (a sample may carry several) */
  events: number;
  /** samples profiled for this gene = panel-profiled + whole-exome */
  profiled: number;
  /** alteredOnPanel / profiled, as a percentage */
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

/**
 * A derived facet a caller asks Explore for — see buildDerivedFacets. Explore computes only the
 * facets asked for. "lines" and "treatmentSpan" also name the event type they are built on.
 */
export interface DerivedRequest {
  metric: DerivedFacet["metric"];
  eventType?: string;
  lineGap?: number;
}
export interface ExploreResult {
  study: string; studies?: string[]; draftCount: number | null;
  studyBreakdown?: StudyBreakdownRow[];
  clinical: ClinicalFacet[];
  events: { type: string; n: number }[];
  derived?: DerivedFacet[];
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
  /** one entity of a generic-assay profile per chart the reader asked for (AssayFacet) */
  assayFacets?: AssayFacet[];
  /** portal-equivalent gene tables (samples, panel-aware denominators) */
  mutatedGenes?: GeneTableRow[];
  cnaGenes?: GeneTableRow[];
  svGenes?: GeneTableRow[];
  /** total distinct genes behind each table, before the display cap */
  geneTotals?: { mutated: number; cna: number; sv: number };
  /** molecular data types with sample counts (the portal's genomic-data chart) */
  dataTypes?: { profile: string; label: string; alterationType: string; n: number }[];
  /** per-attribute numeric stats, used to derive shared bins when federating */
  /** cohort size in both units, as the portal's header reports it */
  totals?: { patients: number; samples: number };
  caseLists: { id: string; name: string; n: number }[];
  profiles: string[]; gaProfiles: string[];
  /** every profile as the studies describe them (genetic_profile), for a plot axis's Data picker */
  profileCatalog?: ProfileInfo[];
  stats: { ms: number; perStudy?: Record<string, number | null> };
}
