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
  | ProteinPositionLeaf | SplitLeaf
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
 * A lock is one set: the cohort's patients are its main list, and beside them, as named parts, the
 * patients' samples ("samples") and each arm's patients (`part`, "arm:<split> / <arm>").
 */
export interface LockedMembers {
  /** the stored set holding the patients */
  set: string;
  /** the part of `set` holding them, for an arm; absent for the cohort itself */
  part?: string;
  n: number;
  /** how many samples those patients had then, kept in the set's "samples" part — what "new samples
   *  since" is measured against. Locks made before parts name a separate sample-level set here. */
  samples?: string;
  nSamples?: number;
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
 * Pan-cancer forest: one exposure's hazard ratio within each stratum of the cohort (a cancer type,
 * a study, or a cohort), each from its own Cox fit, pooled by a DerSimonian–Laird random-effects
 * meta-analysis (and the fixed-effect estimate beside it). Fit from per-patient rows within each
 * local study, the same boundary as `cox`.
 */
export interface ForestView {
  note?: string;
  kind: "forest"; cohorts?: string[];
  /** the exposure, as a plot axis: a gene's alteration (not profiled is left out, never unaltered), a numeric or categorical attribute */
  exposure: PlotAxis;
  /** a categorical exposure's level counted as exposed (default for an alteration axis: any alteration) */
  exposed?: string;
  /** a numeric exposure: exposed when the value is at least this */
  threshold?: number;
  /** endpoint prefix (default OS), and the cox view's escape hatch for other column names */
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** what a row is: a categorical attribute (default CANCER_TYPE), "study", or "cohort" (the view's cohorts) */
  strata?: string;
  /** adjust each stratum's fit for these (default none) */
  covariates?: CoxCovariate[];
  /** a stratum with fewer patients or events than these is pooled into "Other" (defaults 30 and 10) */
  minPatients?: number; minEvents?: number;
  /** at most this many strata are drawn, the largest; the rest pool into "Other" (default 30) */
  maxStrata?: number;
  /** what happens to the small strata: pooled into one "Other" row (default) or left out, listed */
  small?: "pool" | "drop";
}
export interface ForestRow {
  label: string; n: number; events: number; exposed: number; exposedEvents: number;
  beta: number; se: number; hr: number; ciLow: number; ciHigh: number; p: number;
  /** the row's share of the random-effects weight */
  weight: number;
  /** an "Other" row: the strata it pools */
  pooled?: string[];
}
export interface ForestPooled { hr: number; ciLow: number; ciHigh: number; p: number; beta: number; se: number }
export interface ForestResult {
  exposure: string; exposedLabel: string; endpoint: string; strata: string; covariates: string[];
  rows: ForestRow[];
  /** strata that are not rows, and why */
  left: { label: string; n: number; events: number; reason: string }[];
  /** pooled estimates; null with fewer than two rows */
  fixed: ForestPooled | null; random: ForestPooled | null;
  tau2: number; q: number; qDf: number; qP: number; i2: number;
  /** patients with a time, the exposure and the stratum (and every covariate) */
  n: number; events: number;
  notProfiled: number; missing: number;
  excludedRemote?: { study: string; patients: number }[];
}
/**
 * Covariate-adjusted alteration enrichment between two cohorts: for every gene mutated in at least
 * a minimum share of the patients profiled for it, a logistic regression of altered on cohort and
 * covariates, reported as the adjusted odds ratio for the first cohort beside the raw one. Fit from
 * per-patient rows inside each local study (patient-level participants only).
 */
export interface AdjustedView {
  note?: string;
  kind: "adjusted"; cohorts?: string[];
  /** clinical attributes adjusted for (default none): a number as recorded, a category against its commonest value */
  covariates?: string[];
  /** count every called mutation (default), or only OncoKB drivers */
  measure?: "any" | "driver";
  /** genes tested: mutated in at least this share of the patients profiled for them, both cohorts together (default 0.05) */
  minShare?: number;
  /** and in at least this many patients (default 10) */
  minAltered?: number;
  /** genes named on the volcano (default 12) */
  label?: number;
}
export interface AdjustedGene {
  gene: string;
  /** per cohort, in the view's order: patients altered, and patients profiled for the gene with every covariate */
  altered: [number, number]; profiled: [number, number];
  /** unadjusted odds ratio (null with an empty cell) and its two-sided Fisher p */
  rawOr: number | null; fisherP: number;
  /** the cohort term's adjusted odds ratio, Wald 95% CI and p; q is Benjamini–Hochberg over the genes fit */
  or: number; ciLow: number; ciHigh: number; p: number; q: number;
  /** a covariate category that would separate was merged into its reference for this gene */
  merged?: boolean;
}
export interface AdjustedResult {
  groups: [string, string]; covariates: string[]; measure: "any" | "driver"; minShare: number; minAltered: number;
  /** per cohort: patients with a mutation panel, and of those with every covariate (the ones fit) */
  patients: { cohort: string; withPanel: number; used: number }[];
  /** genes fit, by adjusted p */
  rows: AdjustedGene[];
  /** genes that passed the share threshold but could not be fit, and why */
  failed: { gene: string; reason: string }[];
  significant: number;
  labels: string[];
  excludedRemote?: { study: string; patients: number }[];
}
/**
 * Clinical actionability from the version-pinned OncoKB store: each sequenced patient's highest
 * sensitive therapeutic level (1, 2, 3A, 3B, 4) and any resistance level (R1, R2) over their
 * alterations, as shares per cohort (optionally per group of an attribute), and for patients with
 * a sample on each side of `pairBy` the concordance of their highest level between the two. Counts only.
 */
export interface ActionabilityView {
  note?: string;
  kind: "actionability"; cohorts?: string[];
  /** split each cohort by a categorical attribute (e.g. CANCER_TYPE); default none */
  groupBy?: string;
  /** with groupBy, the largest groups drawn (default 8); the rest are pooled into a disclosed "Other" */
  top?: number;
  /** the two sides compared for concordance (default SAMPLE_TYPE Primary against Metastasis); null turns it off */
  pairBy?: { attribute: string; a: string[]; b: string[] } | null;
}
/** patients per highest level: [1, 2, 3A, 3B, 4, none], and with a resistance level [R1, R2] */
export interface ActionLevels { sequenced: number; levels: number[]; resistance: number[] }
export interface ActionabilityPanel extends ActionLevels {
  cohort: string;
  /** the cohort's patients, sequenced or not */
  patients: number;
  groups?: (ActionLevels & { label: string })[];
  /** groups past `top`, pooled into the last group */
  pooled?: string[];
  /** patients with a sequenced sample on each side: table[a][b] over the six highest levels, and how many differ */
  concordance?: { pairs: number; table: number[][]; discordant: number };
}
export interface ActionabilityResult {
  pin: string; levels: string[]; groupBy: string | null; top: number;
  pairBy: { attribute: string; a: string[]; b: string[] } | null;
  panels: ActionabilityPanel[];
  /** the alteration types the store has levels for at this pin */
  storeTypes: string[];
  excluded?: { study: string; reason: string }[];
}
/**
 * Driver-negative analysis: one cohort split into patients with an OncoKB driver in a canonical
 * driver list, patients with none who were profiled for every listed gene, and those not fully
 * profiled (neither); then every other gene's alteration frequency compared between the first two.
 * Counts only.
 */
export interface DrivernegativeView {
  note?: string;
  kind: "drivernegative"; cohorts?: string[];
  /** the canonical drivers (default the NSCLC set: EGFR, KRAS, ALK, ROS1, BRAF, MET, RET, ERBB2, NTRK1–3) */
  drivers?: string[];
  /** what is compared between the groups (default mutation; sv counts either fusion partner) */
  alteration?: "mutation" | "sv" | "cna";
  /** count every alteration (default), or only OncoKB drivers */
  measure?: "any" | "driver";
  /** genes altered in fewer patients than this, both groups together, are not tested (default 5) */
  minAltered?: number;
  /** genes named on the volcano (default 12) */
  label?: number;
}
export interface DrivernegativeGene {
  gene: string; cytoband?: string;
  /** [driver-negative, driver-positive] patients altered, and profiled for the gene */
  altered: [number, number]; profiled: [number, number];
  log2Ratio: number | null; p: number; q: number;
}
export interface DrivernegativeResult {
  drivers: string[]; alteration: string; measure: "any" | "driver"; minAltered: number;
  /** the cohort's patients, those sequenced for mutations, and the three groups of those */
  patients: number; sequenced: number; positive: number; negative: number; unprofiled: number;
  tested: number; untested: number; significant: number;
  /** the most significant genes (≤300) */
  rows: DrivernegativeGene[];
  labels: string[];
  excluded?: { study: string; reason: string }[];
}
/**
 * A plot: two axes over the same cases. The shape — scatter, box, contingency — follows from
 * what the axes are, exactly as it does in the portal, rather than being asked for.
 */
export interface PlotView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "plot"; x: PlotAxis; y: PlotAxis; cohorts?: string[];
  /** what a point is (default "sample"); patient mode combines a patient's samples (mean, common value or "Multiple", any alteration) */
  unit?: "patient" | "sample";
  /** the grid a scatter is binned onto (default 240 x 160) */
  bins?: [number, number];
  /**
   * Every case is a point when there are at most POINTS_CAP (10,000) of them and the reader may see cases
   * (default true); false draws the density alone at any size.
   */
  allPoints?: boolean;
  /**
   * Subsets of the plotted cohort's cases drawn in colour over the plot, in order (at most 4): the
   * outliers (past the cap: a box's values beyond its whiskers, a scatter's sparse cells), the
   * extremes on an axis, the cases furthest from the fitted line, or a cohort's cases. Default
   * [{rule:"outliers"}]; [] draws none. A case in two layers is drawn by the first. Every layer
   * shares one POINTS_CAP budget; a cohort layer past it is drawn as density cells or boxes.
   */
  points?: PointLayerSpec[];
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
  note?: string; kind: "clinical"; attributes: string[]; cohorts?: string[]; splitBy?: SplitBy }
export interface CoexpressionView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "coexpression"; genes: string[]; profileType: string; cohorts?: string[] }
export interface HotspotsView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string; kind: "hotspots"; genes: string[]; cohorts?: string[]; minCount?: number;
  /**
   * The cells of the Driver/VUS × alteration class grid left out of the plot ("missense.vus",
   * "truncating.driver", …): the grid beside it selects them. Applied where the figure is drawn,
   * so a change re-runs nothing; the counts in the grid stay whole.
   */
  hide?: string[] }
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
  /** distinct labels kept before the rest fold into "other" (default 8) */
  topN?: number;
  /** which treatment records form lines: "systemic" (default), "all", or class names — lib/treatment-lines.ts */
  lineClasses?: "systemic" | "all" | string[];
}
/**
 * Cohort attrition: for each cohort, the patients remaining after each successive clause of its
 * `all`, CONSORT-style — so a reader sees which criterion removed whom before trusting any
 * downstream number. Counts only; every participant can answer.
 */
export interface AttritionView {
  /** the analyst's own one-line annotation, drawn above the figure (plain text, never markdown) */
  note?: string;
  kind: "attrition"; cohorts?: string[];
}
export interface AttritionStep {
  /** the clause, in the same plain language as the cohort readback */
  label: string;
  /** patients left after this clause and every clause above it */
  n: number;
  /** removed by this clause alone, given the ones above it */
  excluded: number;
  /** n as a share of the study base, one decimal */
  pctOfBase: number | null;
}
export interface AttritionPanel { cohort: string; base: number; steps: AttritionStep[]; studies: string[] }
/**
 * Genome-wide copy-number frequency: the share of each cohort's segmented samples gained or lost
 * in every bin along the genome, from the copy-number SEGMENTS (not the per-gene calls), with a
 * per-bin Fisher test when exactly two cohorts are drawn. Counts only.
 */
export interface GenomeView {
  note?: string;
  kind: "genome"; cohorts?: string[];
  /** bin width in megabases, 1-50 (default 2) */
  binMb?: number;
  /** |log2 segment mean| at or past which a bin is gained / lost (default 0.2) */
  threshold?: number;
  /** draw chromosome X too (default false: its log ratio mostly records sex) */
  includeX?: boolean;
}
export interface GenomeSeries {
  cohort: string;
  /** the cohort's samples, and how many of them have any segment at all */
  samples: number; segmented: number;
  /** per bin, aligned with GenomeResult.bins */
  profiled: number[]; gain: number[]; loss: number[];
}
export interface GenomeResult {
  build: "hg19" | "hg38"; binMb: number; threshold: number; includeX: boolean;
  /** every bin, in genome order: its chromosome and start (bp) */
  bins: { chrom: string; start: number }[];
  series: GenomeSeries[];
  /** exactly two cohorts: Benjamini–Hochberg q per bin (null where either cohort has no sample) */
  test?: { gainQ: (number | null)[]; lossQ: (number | null)[]; significantGain: number; significantLoss: number };
  /** studies left out because they could not answer (a remote peer, or no segments at all) */
  excluded?: { study: string; reason: string }[];
}
/**
 * Oncogenic signalling pathways: for each pathway (the ten of Sanchez-Vega et al. 2018, and/or
 * the document's own gene sets), the share of each cohort with at least one member altered —
 * over the union of the members' panels, the oncoprint's merged-row rule — and its most-altered
 * member genes, each with its own panel-aware denominator. Counts only.
 */
export interface PathwaysView {
  note?: string;
  kind: "pathways"; cohorts?: string[];
  /** which of the ten canonical pathways to draw (default: all ten) */
  pathways?: string[];
  /** the document's own gene sets, drawn after the canonical ones: ≤4 sets of ≤40 genes */
  sets?: { name: string; genes: string[] }[];
  /** count OncoKB drivers only (default, as the paper curated oncogenic events) or any alteration */
  measure?: "driver" | "any";
  /** member genes drawn per pathway, the rest pooled and counted (default 6, max 12) */
  topGenes?: number;
}
export interface PathwayCell { cohort: string; profiled: number; altered: number; pct: number | null }
export interface PathwayRow {
  name: string; source: "Sanchez-Vega 2018" | "document";
  /** member genes, and how many were profiled in at least one cohort */
  genes: number; profiledGenes: number;
  cells: PathwayCell[];
  /** two cohorts: two-sided Fisher p, and BH q across the pathways drawn */
  p?: number; q?: number;
  top: { gene: string; role: "OG" | "TSG" | null; cells: PathwayCell[]; q?: number }[];
  /** member genes altered somewhere but not among `top` — pooled, never dropped */
  otherAltered: number;
  /** member genes no cohort was profiled for */
  notProfiled: string[];
}
export interface PathwaysResult {
  measure: "driver" | "any"; rows: PathwayRow[];
  excluded?: { study: string; reason: string }[];
}
/**
 * Differential expression between exactly two cohorts on one molecular profile: every gene's
 * Welch t-test from per-cohort moments (n, Σv, Σv² — additive, so exact across sites), drawn as
 * a volcano, and preranked GSEA of that t ranking against MSigDB gene sets.
 */
export interface DiffexprView {
  note?: string;
  kind: "diffexpr"; cohorts?: string[];
  /** the profile to compare on (mRNA z-scores, RNA-seq, protein, methylation…) */
  profileType: string;
  /** compare log2(v + 1) rather than v; defaults to true for a non-z-score RNA-seq profile */
  log2?: boolean;
  /** MSigDB sets to test (≤12 names); default every HALLMARK_ set. [] skips enrichment */
  geneSets?: string[];
  /** genes labelled on the volcano (default 12, max 40) */
  label?: number;
}
export interface DiffexprGene { gene: string; nA: number; nB: number; meanA: number; meanB: number; effect: number; t: number; p: number; q: number }
export interface DiffexprResult {
  profileType: string; log2: boolean;
  /** what `effect` is: a difference of means on the compared scale */
  effectLabel: string;
  /** cohorts in order: effect = first − second */
  groups: [string, string];
  tested: number;
  /** genes left out for fewer than 3 patients in a cohort, or no variance in either */
  skipped: number;
  up: number; down: number;
  /** genes at q < 0.05, and the labelled ones, drawn individually (≤1,500, the most significant) */
  points: DiffexprGene[];
  /** every other tested gene, binned on the axes below: [x bin, y bin, count, 0 not significant | 1 higher in the first cohort | 2 in the second] */
  grid: { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number, 0 | 1 | 2][] };
  /** genes q < 0.05 not drawn individually because of the cap */
  pooledSignificant: number;
  labels: string[];
  gsea?: { ranking: string; permutations: number; sets: (import("./stats.ts").GseaResult & { q: number })[]; skipped: string[] };
  excluded?: { study: string; reason: string }[];
}
/**
 * Paired samples: among patients with a sample of each of two kinds (by default primary and
 * metastasis), gene by gene, how often an alteration is on both, only the first or only the
 * second — counted only where BOTH sides were profiled for the gene — with an exact McNemar test
 * of whether discordance runs one way. Counts only.
 *
 * Without `genes` it scans: every gene altered in some paired patient is tested, and the `top`
 * most discordant are drawn — the way to ask "what is acquired after treatment" without
 * guessing the genes first.
 */
export interface PairSides { attribute: string; a: string | string[]; b: string | string[] }
export interface PairedView {
  note?: string;
  kind: "paired"; cohorts?: string[];
  /** the genes to test; omitted or empty scans every gene altered in a paired patient */
  genes?: string[];
  /** with no `genes`: how many of the most discordant genes to draw (default 20, at most 40) */
  top?: number;
  /**
   * a sample-level attribute and the values on each side (default SAMPLE_TYPE: Primary / Metastasis).
   * `studies` gives a study its own attribute and values — studies label the same two kinds of
   * sample differently (PRE-TX / POST-TX, pre-treatment / post-treatment) — and the counts are
   * pooled across them; a study not listed uses the attribute and values at the top.
   */
  pairBy?: Partial<PairSides> & {
    studies?: Record<string, PairSides>;
    /** what to call each side in the figure and text (default: its values) */
    labels?: { a: string; b: string };
  };
  /** count OncoKB drivers only (default) or any alteration */
  measure?: "driver" | "any";
}
export interface PairedGene {
  gene: string;
  /** patients with each side profiled for this gene */
  pairs: number; both: number; aOnly: number; bOnly: number; neither: number;
  /** both ÷ (both + aOnly + bOnly): of the patients altered anywhere, altered on both sides */
  concordance: number | null;
  /** exact McNemar p on aOnly vs bOnly, and BH q across the genes of this cohort */
  p: number; q: number;
}
export interface PairedPanel {
  cohort: string; patients: number; aSamples: number; bSamples: number; genes: PairedGene[];
  /** a scan: the genes with at least one discordant patient, which q is taken across (only `genes` are drawn) */
  tested?: number;
}
export interface PairedResult {
  /** the sides as each answering study resolved them; `labels` names them in the figure and text */
  pairBy: { attribute: string; a: string[]; b: string[] };
  perStudy?: Record<string, { attribute: string; a: string[]; b: string[] }>;
  labels: { a: string; b: string };
  /** present when the view scanned rather than testing named genes */
  scan?: { top: number };
  measure: "driver" | "any";
  panels: PairedPanel[];
  excluded?: { study: string; reason: string }[];
}
/**
 * Alterations acquired under therapy: patients with a dated sample on or before a treatment start
 * and another after it, per gene, altered after but not before (acquired), before but not after
 * (lost), on both (shared) or neither — among patients whose two samples' panels both cover the gene.
 */
export interface AcquiredView {
  note?: string;
  kind: "acquired"; cohorts?: string[];
  /** the treatment start: the FIRST event of this type, with key = value when given (default Treatment, any) */
  anchor?: { eventType: string; key?: string; value?: string };
  /** the genes to test (at most 30); omitted or empty scans every gene altered in at least `minPost` after-samples */
  genes?: string[];
  /** a scan: the fewest patients altered after treatment for a gene to be tested (default 3) */
  minPost?: number;
  /** a scan: how many genes to draw, most significant first (default 20, at most 40) */
  top?: number;
  /** the before-sample is the last on or before the start, at most this many days before it (default: any) */
  preWindowDays?: number;
  /** the after-sample is the first at least this many days after the start (default 30) */
  minGapDays?: number;
  /** the timeline event types that date a sample (default Sample acquisition, Sequencing, Specimen) and the attribute naming it (default SAMPLE_ID) */
  sampleEvents?: string[]; sampleKey?: string;
  /** any alteration (default) or OncoKB oncogenic only */
  measure?: "driver" | "any";
}
export interface AcquiredGene {
  gene: string;
  /** patients whose before- and after-sample both cover the gene */
  pairs: number; acquired: number; lost: number; shared: number; neither: number;
  /** exact McNemar p on acquired vs lost, and BH q across the genes tested in this cohort */
  p: number; q: number;
}
export interface AcquiredPanel {
  cohort: string;
  /** the funnel: anchored, with a dated sample, with one before, with one after, with both */
  anchored: number; dated: number; withPre: number; withPost: number; patients: number;
  /** among the pairs: median days from the before-sample to the start, from the start to the after-sample, and the pairs' spacing (quartiles) */
  preDays: number | null; postDays: number | null; gapDays: { q1: number; median: number; q3: number } | null;
  genes: AcquiredGene[];
  /** a scan: the genes tested (altered after in at least minPost patients), which q is taken across */
  tested?: number;
}
export interface AcquiredResult {
  anchoredTo: string;
  preWindowDays: number | null; minGapDays: number;
  sampleEvents: string[]; sampleKey: string;
  measure: "driver" | "any";
  scan?: { top: number; minPost: number };
  panels: AcquiredPanel[];
  excluded?: { study: string; reason: string }[];
}
/**
 * ctDNA against tissue: patients with a plasma (cfDNA) sample and a tissue sample, per gene covered
 * by both, altered in both, tissue only, plasma only or neither; plasma's positive percent
 * agreement with tissue as the reference; the share of plasma patients with any alteration
 * detected; and overall survival by ctDNA detected or not.
 */
export interface CtdnaView {
  note?: string;
  kind: "ctdna"; cohorts?: string[];
  /** the genes (at most 30); omitted, the `top` (default 15, at most 30) most altered in the paired patients */
  genes?: string[]; top?: number;
  /** the sample attribute classing samples (default SAMPLE_CLASS) and its plasma (default cfDNA, ctDNA) and tissue (default Tumor) values */
  attribute?: string; plasma?: string[]; tissue?: string[];
  /** samples on these panels count as plasma whatever the attribute says (e.g. ["ACCESS129"]) */
  plasmaPanels?: string[];
  /** keep only samples the timeline dates within this many days of a sample of the other kind (default: no dates needed) */
  withinDays?: number;
  sampleEvents?: string[]; sampleKey?: string;
  /** any alteration (default) or OncoKB oncogenic only */
  measure?: "driver" | "any";
}
export interface CtdnaGene {
  gene: string;
  /** patients whose plasma and tissue samples both cover the gene */
  pairs: number; both: number; tissueOnly: number; plasmaOnly: number; neither: number;
  /** positive percent agreement: both ÷ altered in tissue, with its 95% Wilson interval (null when tissue has none) */
  ppa: number | null; ppaLow: number | null; ppaHigh: number | null;
  /** (both + neither) ÷ pairs */
  concordance: number | null;
}
export interface CtdnaPanel {
  cohort: string;
  /** patients with a plasma sample, a tissue sample, both; samples of each kind among those with both */
  plasmaPatients: number; tissuePatients: number; patients: number; plasmaSamples: number; tissueSamples: number;
  /** with withinDays: before the date rule, patients with plasma and tissue; and the classed samples the timeline dated */
  undated?: { plasmaPatients: number; tissuePatients: number; datedSamples: number };
  /** of the plasma patients, those with any (driver) alteration called in plasma, with a 95% Wilson interval */
  detected: number; detectedLow: number | null; detectedHigh: number | null;
  genes: CtdnaGene[];
  /** overall survival of the plasma patients by ctDNA detected or not; null with why when not drawn */
  survival: { curves: (Omit<KmCurve, "cohort"> & { label: string })[]; logrank: LogRank | null; missing: number } | null;
  survivalWhy?: string;
}
export interface CtdnaResult {
  attribute: string; plasma: string[]; tissue: string[]; plasmaPanels: string[];
  withinDays: number | null;
  measure: "driver" | "any";
  /** present when the genes were chosen as the most altered */
  top?: number;
  panels: CtdnaPanel[];
  excluded?: { study: string; reason: string }[];
}
/**
 * Mutual exclusivity and co-occurrence against each tumour's own alteration burden (DISCOVER,
 * Canisius et al. 2016): per sample and gene a background probability fitted from the sample and
 * gene marginals of the whole altered-gene matrix, so that heavily altered tumours are expected to
 * share alterations; each pair's co-altered count tested against its Poisson-binomial null.
 */
export interface ExclusivityView {
  note?: string;
  kind: "exclusivity"; cohorts?: string[];
  /** 2 to 20 genes */
  genes: string[];
  /** estimate the background within each value of this sample attribute (e.g. CANCER_TYPE) */
  stratifyBy?: string;
  /** any alteration (default) or OncoKB oncogenic only */
  measure?: "driver" | "any";
}
export interface ExclusivityPair {
  a: string; b: string;
  /** samples profiled for both genes, those altered in both, and the background's expected number */
  profiled: number; both: number; expected: number;
  /** DISCOVER: lower tail (exclusivity) and upper tail (co-occurrence), BH q in each direction */
  pExclusive: number; qExclusive: number; pCooccur: number; qCooccur: number;
  /** false when the tails came from the refined normal approximation, not the exact distribution */
  exact: boolean;
  /** the plain two-sided Fisher test on the same samples' 2×2, BH across the pairs */
  onlyA: number; onlyB: number; neither: number; fisherP: number; fisherQ: number; log2Odds: number | null;
}
export interface ExclusivityResult {
  cohort: string; genes: string[];
  stratifyBy: string | null; strata: { name: string; samples: number }[];
  measure: "driver" | "any";
  /** samples with a panel, the genes in the background matrix, and how the fit ended */
  samples: number; matrixGenes: number; iterations: number; converged: boolean; maxResidual: number;
  pairs: ExclusivityPair[];
  /** pairs no sample was profiled for both genes of */
  unassessable: string[];
  excluded?: { study: string; reason: string }[];
}
/**
 * Genomic instability from copy-number segments (hg19): per sample, the fraction of the genome
 * altered and arm-level gains and losses, whose count is the aneuploidy score (Taylor et al. 2018);
 * per cohort their distributions, a rank test between cohorts, and each arm's gain/loss frequency.
 */
export interface InstabilityView {
  note?: string;
  kind: "instability"; cohorts?: string[];
  /** |log2 segment mean| at or past which a segment is gained or lost (default 0.2) */
  threshold?: number;
  /** an arm is called when more than this share of its length is past the threshold (default 0.5) */
  armShare?: number;
  /** score chromosome X too (default false: its log ratio mostly records sex) */
  includeX?: boolean;
}
export interface InstabilitySpread { p5: number | null; q1: number | null; median: number | null; q3: number | null; p95: number | null; mean: number | null }
export interface InstabilityPanel {
  cohort: string;
  /** the cohort's samples, those with segments, and those with every scored arm measured */
  samples: number; segmented: number; allArms: number;
  /** samples by aneuploidy score (index = arms altered), and by FGA in 1-point bins (index = percent) */
  score: number[]; fga: number[];
  scoreSpread: InstabilitySpread; fgaSpread: InstabilitySpread;
  /** per arm (in `arms` order): the samples that measured it, and those gaining or losing it */
  arms: { arm: string; measured: number; gain: number; loss: number }[];
}
export interface InstabilityResult {
  build: "hg19"; threshold: number; armShare: number; includeX: boolean;
  arms: string[];
  panels: InstabilityPanel[];
  /** two cohorts: Mann–Whitney; more: Kruskal–Wallis — on the aneuploidy score and on FGA */
  test: { name: "Mann–Whitney U" | "Kruskal–Wallis"; scoreP: number; fgaP: number } | null;
  excluded?: { study: string; reason: string }[];
}
/**
 * Clonality from FACETS allele-specific copy number: for each gene, whether the cohort's
 * mutation calls are clonal or subclonal, how often the mutated locus has lost its other allele,
 * and their cancer-cell fractions; per cohort, whole-genome doubling, purity and ploidy. Only
 * studies with allele-specific copy number can answer. Counts only.
 */
export interface ClonalityView {
  note?: string;
  kind: "clonality"; cohorts?: string[];
  genes: string[];
  /** OncoKB driver mutations only (default) or every mutation call */
  measure?: "driver" | "any";
  /** use only samples whose FACETS_QC is Pass (default true) */
  qc?: boolean;
}
export interface ClonalityGene {
  gene: string;
  /** mutation calls with a FACETS estimate, and the samples they are in */
  calls: number; samples: number;
  clonal: number; subclonal: number; indeterminate: number; uncalled: number;
  /** calls where the locus has no minor allele, of calls where the minor copy number is known */
  loh: number; lohKnown: number;
  /** cancer-cell fraction, ten bins of 0.1 */
  ccf: number[];
  /** two cohorts: Fisher on clonal vs subclonal, BH across genes */
  p?: number; q?: number;
}
export interface ClonalityPanel {
  cohort: string; samples: number; ascnSamples: number; qcPass: number; qcFail: number;
  wgd: { yes: number; no: number };
  /** FACETS purity in 0.05 bins over 0–1, ploidy in 0.25 bins over 0–8 */
  purity: number[]; ploidy: number[];
  genes: ClonalityGene[];
}
export interface ClonalityResult {
  measure: "driver" | "any"; qc: boolean;
  panels: ClonalityPanel[];
  /** two cohorts: Fisher on whole-genome doubling */
  wgdP?: number;
  excluded?: { study: string; reason: string }[];
}
/**
 * Cumulative incidence of a timeline event with death as a competing risk (Aalen–Johansen, with
 * the survival view's left truncation), Gray's test between cohorts, and — beside it — what
 * 1 − Kaplan–Meier would have claimed, which treats the dead as still at risk and so overstates
 * incidence whenever death is common. Counts only: (entry, time, cause) tallies per site.
 */
export interface IncidenceView {
  note?: string;
  kind: "incidence"; cohorts?: string[];
  /** the event of interest: its first occurrence after the anchor */
  event: { eventType: string; attrs?: { key: string; value: string }[]; label?: string };
  /** the clock's start (default: the study's day 0), as in the survival view */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** months at which incidence is read off and compared (default [12, 24, 60]) */
  horizons?: number[];
}
export interface IncidenceCurve {
  cohort: string;
  n: number; events: number; competing: number; censored: number;
  points: { t: number; f1: number; f2: number; se1: number; atRisk: number }[];
  /** patients who could not enter the risk set, by reason */
  excluded: { prior: number; unobserved: number; noFollowup: number; noAnchor: number };
  /** kept, but their first event was recorded after their last follow-up */
  late: number;
}
export interface IncidenceResult {
  eventLabel: string; anchoredTo?: string;
  curves: IncidenceCurve[];
  horizons: { months: number; cells: { cohort: string; f1: number; lo: number; hi: number; naive: number; atRisk: number }[] }[];
  gray?: import("./stats.ts").GrayTest;
  excludedStudies?: { study: string; reason: string }[];
}
/**
 * A lab value's course from a treatment start: % change from each patient's baseline over time
 * (median and interquartile band per bin), the best response and the share responding (e.g.
 * PSA50, PCWG3), and — from a participant entitled to patient-level values — a waterfall.
 */
/**
 * A risk model in the manner of OncoCast (Martin et al., github.com/AxelitoMartin/OncoCast): an
 * elastic-net Cox model of one cohort's survival on the genes mutated in it, fitted `runs` times
 * on random two-thirds of the patients and scored on the held-out third. Each patient's risk score
 * is the mean of the scores they got while held out; the patients are then cut into risk groups at
 * quantiles of that score (no outcome is used to place the cuts) and drawn as Kaplan–Meier curves.
 * Patient-level studies only: a model of individual patients needs their rows.
 */
export interface RiskmodelView {
  note?: string;
  kind: "riskmodel"; cohorts?: string[];
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** "any" mutation (default) or OncoKB drivers only */
  measure?: "any" | "driver";
  /** only genes mutated in at least this many patients are candidates (default 30) */
  minMutated?: number;
  /** a clinical attribute to stratify by (each stratum its own baseline hazard), e.g. CANCER_TYPE */
  strata?: string;
  /** l1 share of the penalty: 1 lasso, 0 ridge (default 0.5, elastic net) */
  alpha?: number;
  /** random splits (default 20, at most 100) */
  runs?: number;
  /** risk groups, cut at equal quantiles of the score (default 3, 2 to 5) */
  groups?: number;
  /** instead of `groups`: the quantiles of the score to cut at, increasing, each strictly between 0 and 1
   *  (1 to 4 of them, so 2 to 5 groups) — e.g. [0.8] for the top fifth against the rest, OncoCast's `cuts` */
  cuts?: number[];
  seed?: number;
  /** clinical attributes always in the model, never penalised (at most 6): numbers as they are,
   *  categories as indicators against the commonest value */
  covariates?: string[];
  /** start each patient's clock at a timeline event (as the survival view), with delayed entry */
  anchor?: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** train on the discovery half of the engine's fixed split only, and report on the validation half */
  validate?: boolean;
  /** the volcano names the genes kept in at least this share of runs (0 to 1, default 0.5); drawn in
   *  the browser from the whole result, so changing it re-runs nothing */
  labelAbove?: number;
  /** Table 1: the risk groups' clinical and genomic makeup, tested across groups. Present, the view
   *  computes it; a list left out is the default (the study's leading attributes; the genes the
   *  model kept most often) */
  describe?: { attributes?: string[]; genes?: string[] };
  /** external validation: another cohort of the document, scored with the fitted ensemble's mean
   *  coefficients and cut at the training risk-group thresholds */
  validateOn?: string;
}

/** A risk model scored on another cohort it never saw (RiskmodelView.validateOn). */
export interface RiskExternal {
  cohort: string; study: string;
  /** patients scored, their events, and those left out with why */
  n: number; events: number;
  cohortPatients: number; rowsReturned: number;
  notProfiled: number; noStratum: number; noAnchor: number; anchorAfterStart: number; noFollowUp: number;
  /** patients whose panels do not cover every gene the model weighs: never scored as wild-type */
  notCovered: number;
  /** the model's genes with a non-zero ensemble coefficient, which every scored patient's panels cover */
  modelGenes: number;
  /** Harrell's C-index of the score (within strata), with a seeded bootstrap 95% interval */
  cIndex: number; cIndexLo: number; cIndexHi: number; bootstrap: number;
  /** the training thresholds (raw scores) the groups are cut at */
  cuts: number[];
  groups: { name: string; curve: Omit<KmCurve, "cohort">; hr: number | null; ciLow: number | null; ciHigh: number | null; p: number | null }[];
  logrank: LogRankK | null;
}

/** Why a Table 1 row differs between the risk groups by construction, or is the model's stratum. */
export type RiskTable1Role = "in the model" | "outcome" | "stratum" | null;

interface RiskTable1Test {
  /** null when the row cannot be tested (the reason in `untested`) */
  test: "chi-squared" | "Kruskal-Wallis" | null; statistic: number | null; df: number | null; p: number | null;
  /** Benjamini–Hochberg across the tested rows that are not in the model or the outcome; null for those */
  q: number | null;
  untested?: string;
}

export type RiskTable1Row =
  | ({ kind: "cat"; name: string; per: "patient" | "sample"; role: RiskTable1Role;
      /** every value recorded among the groups' patients, commonest first, with its count per group */
      levels: { value: string; counts: number[] }[];
      /** per group, patients with no value recorded */
      missing: number[];
      /** patients whose samples hold more than one value (counted under their first sample's) */
      multiValued: number; minExpected: number | null } & RiskTable1Test)
  | ({ kind: "num"; name: string; per: "patient" | "sample"; role: RiskTable1Role;
      perGroup: { n: number; median: number | null; q1: number | null; q3: number | null; missing: number }[];
      multiValued: number } & RiskTable1Test)
  | ({ kind: "gene"; name: string; role: RiskTable1Role;
      /** per group: patients with the gene mutated, patients whose panels cover it, and those whose do not */
      perGroup: { altered: number; profiled: number; notProfiled: number }[]; minExpected: number | null } & RiskTable1Test)
  | { kind: "skipped"; name: string; what: "attribute" | "gene"; skipped: string };

export interface RiskTable1 {
  /** the patients described: the same as the groups' curves */
  reportedOn: "held-out scores" | "validation half";
  groups: { name: string; n: number }[];
  /** the gene rows count mutations as the model does */
  measure: "any" | "driver";
  /** what the table holds, as a document would name it — what "Add to document" writes */
  describe: { attributes: string[]; genes: string[] };
  /** the default lists were used (no list named in the view) */
  defaults: { attributes: boolean; genes: boolean };
  rows: RiskTable1Row[];
  /** attributes the default rule considered and left out, with why */
  omitted: { name: string; why: string }[];
  /** rows in the Benjamini–Hochberg family */
  tested: number;
}

export interface RiskmodelResult {
  study: string;
  /** patients modelled, their events, and those left out with why */
  n: number; events: number;
  notProfiled: number; noStratum: number; neverHeldOut: number;
  noCovariate: number; noAnchor: number; anchorAfterStart: number; noFollowUp: number;
  /** "Treatment (FIRST)" etc. when the clock starts at a timeline event */
  anchoredTo: string | null;
  /** the always-in covariates as fitted columns (a category's indicator per non-reference level), with
   *  the share of runs they ended non-zero in (always 1 unless no variation) and their mean coefficient */
  covariates: { name: string; meanCoef: number; hr: number }[];
  /** with `validate`: the patients trained on (discovery) and reported on (validation) */
  validation: { discovery: number; validation: number; validationEvents: number; cIndex: number } | null;
  /** what the groups, table and refit below are computed on */
  reportedOn: "held-out scores" | "validation half";
  /** genes every patient was sequenced for (mutations), and of those the candidates */
  genesCovered: number; candidates: number; minMutated: number;
  strata: string | null; strataLevels: number;
  alpha: number; runs: number; seed: number; measure: "any" | "driver";
  /** test-set C-index across runs */
  cIndex: { median: number; q1: number; q3: number; values: number[] };
  /** candidates kept in at least one run, by how often: share of runs, mean coefficient where kept, patients mutated */
  features: { gene: string; selected: number; meanCoef: number; hr: number; mutated: number }[];
  groups: { name: string; from: number | null; to: number | null; curve: Omit<KmCurve, "cohort">;
    /** Kaplan-Meier survival at 12 and 36 months; null past the group's follow-up */
    at12: number | null; at36: number | null;
    /** hazard ratio against the lowest-risk group (null for that group), 95% Wald interval, p */
    hr: number | null; ciLow: number | null; ciHigh: number | null; p: number | null }[];
  logrank: LogRankK | null;
  /** a Cox model of the outcome on the risk score alone (per standard deviation of the score) */
  refit: { hr: number; ciLow: number; ciHigh: number; p: number } | null;
  /** the scores' distribution, for the histogram: bin edges and counts (raw scores) */
  histogram: { edges: number[]; counts: number[] };
  /** OncoCast's 0–10 risk score: (raw − min) / (max − min) × 10, min and max the lowest and highest of
   *  the held-out scores the cuts are placed on (with `validate`, the discovery half's — so a
   *  validation patient can fall below 0 or above 10) */
  scale: { min: number; max: number };
  /** the volcano's label threshold, as the view asked (default 0.5) */
  labelAbove: number;
  /** the quantiles the view chose to cut at; null when the groups are `groups` equal quantiles */
  cutsChosen: number[] | null;
  /** the held-out score (raw) at each whole percentile 0…100 of the scores the cuts are placed on,
   *  the rank a cut at that quantile starts from — what the risk-groups dialog places its handles by */
  percentiles: number[];
  /** with `describe`: Table 1, the groups' makeup */
  table1?: RiskTable1;
  /** with `validateOn`: the model scored on that cohort */
  external?: RiskExternal;
}

export interface TxendpointsView {
  note?: string;
  kind: "txendpoints"; cohorts?: string[];
  /** the clock's start: a treatment record (event type, key = value), its first occurrence unless LAST */
  anchor: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** ttnt time to next treatment (default), tot time on treatment, rwpfs real-world progression-free survival */
  endpoint?: "ttnt" | "tot" | "rwpfs";
  /** treatment lines (lib/treatment-lines.ts): days without therapy that start a new line (default 90), and which records form lines */
  lineGap?: number; lineClasses?: "systemic" | "all" | string[];
  /** rwpfs: the progression event (default event type Diagnosis, key PROGRESSION, values Y / Yes), and an optional probability floor */
  progression?: { eventType?: string; key?: string; values?: string[]; probabilityKey?: string; minProbability?: number };
  /** tot: a living patient whose stop lies within this many days of the last follow-up is censored as still on treatment (default 30) */
  ongoingDays?: number;
  /** administrative censoring, months */
  cutoffMonths?: number;
}
export interface TxendpointsCurve extends Omit<KmCurve, "cohort"> {
  cohort: string;
  /** the median's 95% interval (Greenwood, log scale), null where the band never reaches 0.5 */
  medianLo: number | null; medianHi: number | null;
  /** the cohort's patients, those anchored, and those left out with why */
  cohortPatients: number; anchored: number;
  excluded: { noAnchor: number; noFollowup: number; noStop: number };
  /** patients whose timeline runs past their last follow-up (the clock check) */
  late: number;
}
export interface TxendpointsResult {
  endpoint: "ttnt" | "tot" | "rwpfs"; endpointLabel: string; anchoredTo: string;
  lineGap: number; lineClasses: string;
  progression?: { eventType: string; key: string; values: string[]; probabilityKey?: string; minProbability?: number };
  ongoingDays?: number; cutoffMonths?: number;
  curves: TxendpointsCurve[];
  /** k-group log-rank over the cohorts, stratified by study where several answer */
  logrank: LogRankK | null;
  /** why there is no test */
  noTest?: string;
  excludedStudies?: { study: string; reason: string }[];
}

export interface MultistateView {
  note?: string;
  kind: "multistate"; cohorts?: string[];
  /** the progression event (default event type Diagnosis, key PROGRESSION, values Y / Yes), and an optional probability floor */
  progression?: { eventType?: string; key?: string; values?: string[]; probabilityKey?: string; minProbability?: number };
  /** patients with a progression on or before day 0: start in the progression state (include, default) or are left out (exclude) */
  prevalent?: "include" | "exclude";
  /** months at which the state occupation is tabled (default [12, 24, 60]) */
  horizons?: number[];
  /** administrative censoring, months */
  cutoffMonths?: number;
}
/** a transition of the illness–death model: 01 start → progression, 02 start → death, 12 progression → death */
export type MultistateTransitionKey = "01" | "02" | "12";
export interface MultistateRate {
  key: MultistateTransitionKey; events: number; personMonths: number;
  /** events per 100 person-months in the state left, with its 95% interval (log scale, Poisson) */
  rate: number; lo: number | null; hi: number | null;
}
export interface MultistateCohort {
  cohort: string;
  /** the cohort's patients; those in the model (n), and of them those starting in the progression state */
  cohortPatients: number; n: number; prevalent: number;
  excluded: { noFollowup: number; prevalent: number };
  /** in the model: patients with no record of the progression key at all, a progression only on or after the end of follow-up, a Sequencing event on day 0, a timeline past follow-up */
  notAssessed: number; afterEnd: number; seq0: number; late: number;
  /** censored in the start and in the progression state */
  censored: { start: number; progression: number };
  rates: MultistateRate[];
  /** Aalen–Johansen state occupation: p0 alive without progression, p1 alive after progression, p2 dead */
  occupation: { t: number; p0: number; p1: number; p2: number }[];
  /** Nelson–Aalen cumulative hazard per transition, with its 95% interval (log scale) */
  cumhaz: Record<MultistateTransitionKey, { t: number; h: number; lo: number; hi: number }[]>;
  /** curves are drawn to here: the last time at least 10 of the cohort's patients are still followed */
  drawnTo: number;
  /** occupation at each horizon, with the number still followed; null past drawnTo */
  atHorizon: { months: number; p0: number | null; p1: number | null; p2: number | null; atRisk: number }[];
}
export interface MultistateCox {
  key: MultistateTransitionKey;
  /** each cohort's hazard ratio against the first (a Cox model per transition, stratified by study) */
  rows: { cohort: string; hr: number; lo: number; hi: number; p: number }[];
  n: number; events: number;
  /** why it was not fitted */
  noFit?: string;
}
export interface MultistateResult {
  progression: { eventType: string; key: string; values: string[]; probabilityKey?: string; minProbability?: number };
  prevalent: "include" | "exclude"; horizons: number[]; cutoffMonths?: number;
  /** the figures' time axis end: the latest cohort's drawnTo */
  tMax: number;
  /** "first sequencing" when day 0 is a Sequencing event for most patients, else "the timeline's day 0" */
  origin: string;
  cohorts: MultistateCohort[];
  /** reference cohort for the hazard ratios */
  reference: string;
  cox: MultistateCox[];
  excludedStudies?: { study: string; reason: string }[];
}

export interface PredictiveView {
  note?: string;
  kind: "predictive"; cohorts?: string[];
  /** the exposure: patients with a timeline event of this type (and key = value) are exposed, the rest unexposed */
  exposure: { eventType: string; key?: string; value?: string };
  /** the candidate biomarkers (at most 20); each is fitted alone, over the patients profiled for it */
  genes: string[];
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** "any" mutation (default) or OncoKB drivers only */
  measure?: "any" | "driver";
  /** clinical attributes adjusted for (at most 6): numbers as they are, categories as indicators against the commonest level */
  covariates?: string[];
  /** a gene is fitted only with at least this many mutated patients in each exposure group (default 5) */
  minMutated?: number;
}
export interface PredictiveEffect { hr: number; ciLow: number; ciHigh: number; p: number }
export interface PredictiveGene {
  gene: string;
  /** patients profiled for the gene (and with every covariate), by exposure, and those of them mutated */
  exposed: number; unexposed: number; mutatedExposed: number; mutatedUnexposed: number; events: number;
  /** the gene's hazard ratio among the exposed and among the unexposed, and their ratio (the interaction); null when not fitted */
  inExposed: PredictiveEffect | null; inUnexposed: PredictiveEffect | null; interaction: PredictiveEffect | null;
  /** Benjamini–Hochberg over the fitted genes' interaction p */
  q: number | null;
  /** why the gene was not fitted */
  skipped?: string;
}
export interface PredictiveResult {
  exposure: string; endpoint: string; measure: "any" | "driver";
  /** patients with a survival time and every covariate, and how many of them are exposed */
  n: number; exposed: number; events: number;
  /** patients left out: no mutation panel on record, a covariate missing */
  notProfiled: number; noCovariate: number;
  covariates: string[]; minMutated: number;
  /** the fits' baseline hazard is stratified by these (cohort and study, when several) */
  strata: number;
  genes: PredictiveGene[];
}

export interface CutpointView {
  note?: string;
  kind: "cutpoint"; cohorts?: string[];
  /** the numeric marker (default TMB_NONSYNONYMOUS): the patient's value, or a sample attribute's value on the patient's first sample */
  attribute?: string;
  endpoint?: string; monthsAttribute?: string; statusAttribute?: string;
  /** permutations of the marker for the corrected p (default 1000, 100 to 5000), and their seed (default 1) */
  permutations?: number; seed?: number;
  /** a categorical attribute: a cut-point per stratum (its largest values, at most 8, each with at least minStratum patients) */
  stratifyBy?: string; minStratum?: number;
}
export interface CutpointScan {
  /** patients with a survival time and a marker value, and their events */
  n: number; events: number;
  /** the chosen cut: high is marker > cut */
  cut: number;
  /** the share of patients at or below it */
  lowShare: number;
  /** the maximally selected standardized log-rank statistic (z², chi-squared scale) at the cut, and its permutation-corrected p */
  maxStat: number; permP: number;
  /** the ordinary log-rank test of the two groups at the cut, as if the cut had been fixed in advance */
  naiveChi2: number; naiveP: number;
  /** the 95th percentile of the permutation distribution of the maximum: the statistic a cut must pass to be significant at 0.05 */
  critical95: number;
  /** high against low, Cox */
  hr: { hr: number; ciLow: number; ciHigh: number; p: number } | null;
  low: { n: number; events: number; median: number | null }; high: { n: number; events: number; median: number | null };
  /** candidate cuts scanned and the statistic at each */
  candidates: { cut: number; stat: number }[];
}
export interface CutpointResult extends CutpointScan {
  attribute: string; endpoint: string; permutations: number; seed: number;
  /** cohort patients with a survival time but no marker value */
  noValue: number;
  curves: { low: Omit<KmCurve, "cohort">; high: Omit<KmCurve, "cohort"> };
  strata?: {
    attribute: string; minStratum: number;
    rows: ({ stratum: string } & Omit<CutpointScan, "candidates">)[];
    /** strata not scanned: too small, past the eighth, or no value */
    omitted: { values: number; patients: number };
  };
}

export interface LabsView {
  note?: string;
  kind: "labs"; cohorts?: string[];
  /** the test, as its event attribute names it (e.g. "PSA", "CEA") */
  test: string;
  /** where lab results live (defaults: event type Lab_Test, the test in TEST, the value in RESULT) */
  eventType?: string; testKey?: string; resultKey?: string;
  /** the clock's start: the treatment whose effect is read */
  anchor: { eventType: string; key?: string; value?: string; occurrence?: "FIRST" | "LAST" };
  /** baseline is the last value this many days before, or on, the anchor (default 90) */
  baselineDays?: number;
  /** the window, in weeks around the anchor (default −12 to 52), and its bin width (default 4) */
  fromWeeks?: number; toWeeks?: number; binWeeks?: number;
  /** a responder's best fall from baseline, in percent (default 50, PCWG3's PSA50) */
  responseDrop?: number;
}
export interface LabsPanel {
  cohort: string;
  /** the denominators: anchored, with a baseline, with a positive baseline, with a value after the anchor */
  anchored: number; baseline: number; positiveBaseline: number; evaluable: number;
  /** per bin: its start in weeks, the patients measured, and the quartiles of % change */
  course: { week: number; n: number; q1: number | null; median: number | null; q3: number | null }[];
  /** best % change after the anchor, in 2-point bins centred on −100, −98, … +300 (the last holds everything above) */
  best: number[];
  responders: number;
  /** each patient's best % change, sorted — present only from patient-level participants */
  waterfall?: number[];
  /** patients whose best could not be drawn as a bar (an aggregate-only participant's) */
  waterfallWithheld?: number;
  /** evaluable patients whose bars were cut by the waterfall's bar limit (drawn ones are the lowest) */
  waterfallCapped?: number;
}
export interface LabsResult {
  test: string; anchoredTo: string; responseDrop: number;
  fromWeeks: number; toWeeks: number; binWeeks: number; baselineDays: number;
  panels: LabsPanel[];
  /** two cohorts: Fisher on responders */
  responseP?: number;
  excluded?: { study: string; reason: string }[];
}
/**
 * Cancer Types Summary (cBioPortal's results-view tab): for a gene list, the share of the cohort's
 * samples altered in at least one of the genes, per cancer type (or any sample attribute, or per
 * study), split by kind of alteration. Each group's denominator is its samples profiled for at least
 * one of the genes. Counts only.
 */
export interface CancertypesView {
  note?: string;
  kind: "cancertypes"; cohorts?: string[];
  genes: GeneTrackSpec[];
  /** a sample attribute to group by, or "study" (default "CANCER_TYPE") */
  groupBy?: string;
  /** count OncoKB drivers only, or any alteration (default) */
  measure?: "driver" | "any";
  /** groups with fewer profiled samples than this are pooled into one "other" bar (default 10) */
  minSamples?: number;
  /** draw percentages (default) or counts */
  show?: "frequency" | "count";
  /** count patients (default, as the portal does — a patient counts in each group a sample of theirs is in) or samples */
  unit?: "patient" | "sample";
}
export interface CancertypesGroup {
  key: string; label: string;
  /** the group's units (patients or samples), profiled or not */
  samples: number;
  profiled: number; altered: number;
  mutation: number; amp: number; homdel: number; sv: number; multiple: number;
  /** units profiled for each data type at all (any gene) — the portal's "+" rows */
  profiledFor?: { mutation: number; cna: number; sv: number };
}
export interface CancertypesPanel {
  cohort: string; samples: number; profiled: number; altered: number;
  groups: CancertypesGroup[];
  /** groups under the size floor, pooled into one — counted, never dropped */
  pooled?: CancertypesGroup & { count: number };
  /** the same, one gene at a time (the portal's per-gene tabs) */
  perGene?: { gene: string; groups: CancertypesGroup[]; pooled?: CancertypesGroup & { count: number } }[];
}
export interface CancertypesResult {
  groupBy: string; measure: "driver" | "any"; genes: string[]; minSamples: number; show: "frequency" | "count";
  unit: "patient" | "sample";
  panels: CancertypesPanel[];
  excluded?: { study: string; reason: string }[];
}
/**
 * Overlap (cBioPortal's group-comparison Overlap tab): how the cohorts' patients intersect, as an
 * UpSet plot — every combination of cohorts with how many patients are in exactly those. Counts only.
 */
export interface OverlapView {
  note?: string;
  kind: "overlap"; cohorts?: string[];
}
export interface OverlapResult {
  /** the cohorts, in bit order, with each one's own size in patients and in their samples */
  sets: { name: string; size: number; samples?: number }[];
  /** patients (and their samples) in exactly the named cohorts and no other, largest first */
  intersections: { members: string[]; n: number; samples?: number }[];
  /** patients in at least one cohort */
  union: number;
  excluded?: { study: string; reason: string }[];
}
/**
 * Genomic-alteration enrichment (cBioPortal's group-comparison Genomic Alterations tab): every gene's
 * frequency of one alteration type in each cohort, counted in samples over the samples profiled for
 * that gene, with a test per gene and Benjamini–Hochberg across all genes tested. Counts only.
 */
export interface EnrichmentView {
  note?: string;
  kind: "enrichment"; cohorts?: string[];
  /** which alteration (default mutation); "cna" is amplification or deep deletion */
  alteration?: "mutation" | "cna" | "amp" | "homdel" | "sv";
  /** count OncoKB drivers only, or any alteration (default) */
  measure?: "driver" | "any";
  /** genes altered in fewer samples than this, across all cohorts, are not tested (default 5) */
  minAltered?: number;
  /** genes named on the volcano (default 12) */
  label?: number;
}
export interface EnrichmentGene {
  gene: string;
  /** in the study's reference genome, when known */
  cytoband?: string;
  cells: { cohort: string; altered: number; profiled: number; pct: number | null }[];
  /** two cohorts: log2 of the first cohort's altered share over the second's; null when either is zero */
  log2Ratio?: number | null;
  p: number; q: number;
  /** the cohort with the highest altered share */
  enrichedIn: string;
}
export interface EnrichmentResult {
  alteration: string; measure: "driver" | "any"; groups: string[];
  tested: number; untested: number; significant: number; minAltered: number;
  test: string;
  /** the most significant genes (≤300), the rest summarised in `grid` */
  rows: EnrichmentGene[];
  /** two cohorts: every other tested gene binned on the volcano's axes, [x bin, y bin, count] */
  grid?: { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number][] };
  labels: string[];
  excluded?: { study: string; reason: string }[];
}
/**
 * Generic-assay comparison (cBioPortal's group-comparison tabs for mutational signatures, arm-level
 * copy number, treatment response and every other generic assay): every entity of one generic-assay
 * profile compared between cohorts. Numeric profiles by Welch's t (two cohorts) or Welch's ANOVA;
 * categorical ones by chi-squared on values × cohorts; Benjamini–Hochberg across the entities.
 * Counts and moments only.
 */
export interface AssaysView {
  note?: string;
  kind: "assays"; cohorts?: string[];
  /** the generic-assay profile, as the genericAssay clause names it (e.g. mutational_signatures_contribution_v2) */
  profileType: string;
  /** an entity with fewer measured samples than this in any cohort is not tested (default 3) */
  minN?: number;
  /** entities named on the volcano (default 12) */
  label?: number;
}
export interface AssaysEntity {
  entity: string; name: string;
  /** numeric: n, mean and SD per cohort; categorical: n and the count of each value */
  cells: { cohort: string; n: number; mean?: number | null; sd?: number | null; values?: Record<string, number> }[];
  /** numeric, two cohorts: first cohort's mean minus the second's */
  diff?: number;
  statistic: number; p: number; q: number;
  /** numeric: the cohort with the highest mean; categorical: the cohort and value most over-represented */
  higherIn: string;
  value?: string;
}
export interface AssaysResult {
  profileType: string; profileName: string; assayType: string;
  datatype: "numeric" | "categorical";
  /** what one value describes */
  unit: "samples" | "patients";
  groups: string[];
  tested: number; untested: number; significant: number; minN: number;
  test: string;
  /** categorical: every value seen, in order of frequency; missing ones (NA, blank) are counted apart */
  values?: string[];
  /** values left out: non-numeric entries of a numeric profile (a limit like ">8", NA), or NA/blank in a categorical one */
  missing: number;
  /** the most significant entities (≤300), the rest summarised in `grid` */
  rows: AssaysEntity[];
  grid?: { xMax: number; yMax: number; nx: number; ny: number; cells: [number, number, number][] };
  labels: string[];
  excluded?: { study: string; reason: string }[];
}
/**
 * Composition: what each case is made of — cell types, cell states, signature contributions — as
 * parts of a whole, compared between cohorts (the stacked-bar panels of single-cell studies). The
 * parts are every entity of one generic-assay profile, or a list of numeric clinical attributes
 * (custom: uploads included). Each cohort's mean composition and every (cohort, part) enrichment
 * against the view's other cohorts come from sums computed in the database; the per-case bars are
 * drawn only where a participant may show cases.
 */
export interface CompositionView {
  note?: string;
  kind: "composition"; cohorts?: string[];
  /** a generic-assay profile whose entities are the parts (e.g. cell_type_relative_counts) */
  profileType?: string;
  /** with profileType: only these of its entities, in this order */
  entities?: string[];
  /** numeric clinical attributes that are the parts, in this order (2–16); custom: names allowed */
  attributes?: string[];
  /** attributes only: one bar per patient (default) or per sample */
  unit?: "patient" | "sample";
  /** divide each case's parts by their sum, so every bar is a whole (default true) */
  normalize?: boolean;
  /** the part cases are ordered by, highest first (default the first part) */
  sort?: string;
}
export interface CompositionPart {
  /** the entity or attribute it reads */
  id: string;
  /** how the figure names it: the entity's name, or the attribute with the parts' shared prefix taken off */
  name: string;
}
export interface CompositionCell {
  cohort: string; part: string;
  n: number; mean: number; sd: number | null;
  /** this cohort against the view's other cohorts pooled: log2 of the ratio of means (each + 0.001) */
  log2?: number;
  /** Welch's t on the same split, and Benjamini–Hochberg across every (cohort, part) tested */
  p?: number; q?: number;
}
export interface CompositionResult {
  source: "genericAssay" | "clinical";
  /** the profile, or "clinical attributes" */
  sourceName: string;
  unit: "samples" | "patients";
  normalize: boolean;
  parts: CompositionPart[];
  sort: string;
  /** per cohort: cases with every part, cases left out (some part missing, or a part below zero, or all zero) */
  groups: { cohort: string; n: number; incomplete: number; invalid: number;
    /** Shannon entropy (natural log) of the normalised parts, mean and SD over the cohort's cases */
    entropy: { mean: number; sd: number | null } | null;
    /** the cases' own compositions, sorted by `sort`, highest first; absent when they may not be shown */
    cases?: number[][];
    /** why `cases` is absent */
    casesWhy?: string;
  }[];
  cells: CompositionCell[];
  tested: number; significant: number;
  excluded?: { study: string; reason: string }[];
}
/**
 * Genome-wide co-expression (cBioPortal's results-view Co-expression tab): one gene's expression
 * against every gene's in a profile, over one cohort's patients — Spearman's ρ (ranked by it, as
 * the portal ranks) and Pearson's r, each with a p, and Benjamini–Hochberg over ρ. Sums only.
 */
export interface CorrelatesView {
  note?: string;
  kind: "correlates"; cohorts?: string[];
  /** the query gene */
  gene: string;
  /** the query gene's profile */
  profileType: string;
  /** the profile every other gene is read from (default: the same one) — e.g. protein against mRNA */
  otherProfile?: string;
  /** genes listed in each direction (default 100, at most 250) */
  show?: number;
  /** a gene with fewer patients having both values is not tested (default 10) */
  minN?: number;
}
export interface CorrelatesGene {
  gene: string; n: number;
  /** in the study's reference genome, when known */
  cytoband?: string;
  /** Spearman's ρ with its p (the t approximation scipy uses, or the Fisher-z meta p across studies) and BH q */
  rho: number | null; rhoP: number; q: number;
  /** Pearson's r and its p, from the pooled sums */
  r: number | null; p: number;
}
export interface CorrelatesResult {
  gene: string; profileType: string; otherProfile: string; cohort: string;
  tested: number; untested: number; significant: number; minN: number;
  /** "rank" when ρ is one study's; "meta" when ρ combines several studies' by Fisher z */
  rhoFrom: "rank" | "meta";
  /** the most positively and most negatively correlated genes, by ρ */
  positive: CorrelatesGene[]; negative: CorrelatesGene[];
  /** ρ of every gene tested, in bins of 0.05 from −1 to 1: [bin low edge, count] */
  histogram: [number, number][];
  excluded?: { study: string; reason: string }[];
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
/**
 * The clinical data table (cBioPortal's Clinical Data tab): one row per sample — or per patient —
 * of each cohort, with every clinical attribute the study records; searchable, filterable,
 * sortable, paged, and downloadable whole as CSV. Its rows are patients, so only a patient-level
 * participant contributes them; the rest are named with how many patients they hold.
 */
export interface TableView extends TableQuery {
  note?: string;
  kind: "table"; cohorts?: string[];
  /** a row per sample (default, with its patient's attributes too) or per patient */
  unit?: "sample" | "patient";
  /** older spelling of `columns`: the attribute columns shown */
  attributes?: string[];
  /** rows per page (default 25, at most 1000); every page and the download are slices of one order */
  rows?: number;
}
export interface TableResult extends TableRows<string> {
  unit: "sample" | "patient";
}
/**
 * The mutation table (cBioPortal's Mutations tab, under the lollipop): one gene's mutations in each
 * cohort, a row per call with the portal's columns; searchable, filterable, sortable, paged, and
 * downloadable whole. Its rows name samples, so only a patient-level participant contributes them.
 */
export interface MutationsView extends TableQuery {
  note?: string;
  kind: "mutations"; cohorts?: string[];
  gene: string;
  /** rows per page (default 25, at most 1000); every page and the download are slices of one order */
  rows?: number;
}
export interface MutationsResult extends TableRows<string | number | null> {
  gene: string;
  /** the OncoKB version the annotation column reads, or null when none is pinned */
  oncokbPin: string | null;
}
/**
 * One patient's clinical timeline (cBioPortal's patient-view Timeline), with the list of the
 * cohorts' patients to choose them from. The list is a table view (lib/table-query.ts: paged,
 * searched, filtered, sorted, downloadable); the timeline is the chosen patient's events as tracks
 * (lib/timeline-tracks.ts). Both name a patient, so only a patient-level participant contributes.
 */
export interface TimelineView extends TableQuery {
  note?: string;
  kind: "timeline"; cohorts?: string[];
  /** the patient whose timeline is drawn; with none, the list's first row */
  patient?: { study: string; id: string };
  /** track uids drawn collapsed (their events folded into one row), e.g. "treatment.Chemo" */
  collapsed?: string[];
  /** draw every year rather than cutting runs of four or more empty years to one mark (default false) */
  expandGaps?: boolean;
  /** patients per page of the list (default 25, at most 1000) */
  rows?: number;
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
  /** the instance that holds this patient: its label, and whether it answered over MCP */
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
/** One of the alterations view's tables as the spec holds it: its query, and its page size. */
export interface AlterationTableQuery extends TableQuery {
  /** rows per page (default 25, at most 1000) */
  rows?: number;
}
/**
 * One patient's genomic alterations as cBioPortal's patient view lists them — three tables in one
 * view: Mutations, Copy Number Alterations and Structural Variants — with the list of the cohort's
 * patients to choose them from. The list and each table is a table view (lib/table-query.ts: paged,
 * searched, filtered, sorted, downloadable), with its own query. All of them name a patient, so only
 * a patient-level participant contributes.
 */
export interface AlterationsView extends TableQuery {
  note?: string;
  kind: "alterations"; cohorts?: string[];
  /** the patient whose alterations are listed; with none, the list's first row */
  patient?: { study: string; id: string };
  /** patients per page of the list (default 25, at most 1000) */
  rows?: number;
  /** each table's own query (the top-level columns/search/filters/sort are the patient list's) */
  mutations?: AlterationTableQuery;
  cna?: AlterationTableQuery;
  sv?: AlterationTableQuery;
}
export interface AlterationsResult extends TableRows<string | number | null> {
  /** the patient listed, with their samples (none on a page request), or null when the list is empty */
  patient: { study: string; id: string; samples: PatientSample[]; source?: { label: string; remote: boolean } } | null;
  /** where that patient falls in the list's order, and the patients either side (as the timeline's) */
  position?: TimelineResult["position"];
  /** the patient's three tables; on a page or values request, only the one asked for */
  tables: Partial<Record<"mutations" | "cna" | "sv", TableRows<string | number | null>>>;
  /** the OncoKB version the annotation columns read, or null when none is pinned */
  oncokbPin: string | null;
}
import type { PlotAxis, PlotData } from "./plot.ts";
import type { PointLayerSpec } from "./plot-layers.ts";
import type { ProfileInfo } from "./profile-catalog.ts";
export type { PlotAxis, PlotData };
export type View = CompareView | SurvivalView | OncoprintView | CooccurrenceView | ClinicalView | CoexpressionView | HotspotsView | CourseView | SequenceView | PlotView | CoxView | LogisticView | ForestView | AdjustedView | ActionabilityView | DrivernegativeView
  | AttritionView | GenomeView | PathwaysView | DiffexprView | PairedView | ClonalityView | IncidenceView | LabsView | AcquiredView | CtdnaView | ExclusivityView | TxendpointsView | MultistateView | PredictiveView | CutpointView | InstabilityView
  | CancertypesView | OverlapView | EnrichmentView | AssaysView | CompositionView | CorrelatesView | TableView | MutationsView | RiskmodelView | TimelineView | AlterationsView;
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
export interface CohortResult {
  count: number; text: string; studies: string[]; sql: string;
  /** for a locked cohort or arm: when, how many it froze, and how far the data has moved since */
  lock?: LockDrift;
}
export interface LockDrift {
  /** the locked cohort that holds the lock (this name, or the cohort a split arm belongs to) */
  cohort: string;
  at: string;
  dataVersion?: string;
  /** patients frozen, and of those how many the data still holds */
  n: number;
  present: number;
  /** what the definition selects now, and how that differs from the frozen patients */
  now: number;
  entered: number;
  left: number;
  /** samples the frozen patients have now that they did not have when locked; null when not measured */
  newSamples: number | null;
  /** why the movement could not be measured (the frozen patients still answered) */
  error?: string;
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
  /** every change at this codon, by raw rows then name — the label and tooltip read these; each with its
   *  protein impact class and driver status, so a selection can leave it out (no class: a site on older code) */
  changes: { change: string; n: number; rows: number; impact?: string; driver?: boolean }[];
  /** the raw rows here by mutation type and driver status — the colour, recomputed when cells are hidden */
  types?: { mtype: string; driver: boolean; rows: number }[];
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
/**
 * One place an analysis's data came from: a database of this deployment, or a peer it reached
 * over MCP, with the studies it answered for and what it reported about itself (lib/provenance.ts).
 */
export interface AnalysisSource {
  /** as this deployment names it */
  label: string;
  /** a peer reached over MCP (the simulated one included) */
  remote: boolean;
  /** that peer's MCP endpoint */
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
    arms: { name: string; count: number; text: string; sql: string }[];
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
export interface ViewResultFields {
  compare: {
    rows?: CompareRow[];
  };
  survival: {
    curves?: KmCurve[];
    /** which endpoint was used */
    endpoint?: string;
    /** the event the clock was reset to */
    anchoredTo?: string;
    /** delayed entry was applied */
    truncated?: boolean;
    /** how long after the anchor patients became observable */
    entryMonths?: { median: number; p90: number; max: number };
    /** administrative censoring applied, echoed for the renderers */
    cutoffMonths?: number;
    /** requested x-axis tick spacing, echoed for the renderers */
    tickMonths?: number;
    /** which curve was drawn */
    display?: "survival" | "incidence";
    logrank?: LogRank; logrankPooled?: LogRank;
    /** 3+ cohorts: the k-group generalization (tests whether the groups differ AT ALL) */
    logrankK?: LogRankK; logrankKPooled?: LogRankK;
  };
  cox: {
    cox?: CoxResult;
    /** which endpoint was fitted */
    endpoint?: string;
  };
  logistic: {
    logistic?: LogisticResult;
  };
  forest: {
    forest?: ForestResult;
  };
  adjusted: {
    adjusted?: AdjustedResult;
  };
  actionability: {
    actionability?: ActionabilityResult;
  };
  drivernegative: {
    drivernegative?: DrivernegativeResult;
  };
  course: {
    course?: CourseSeries[];
    /** bin width and window actually used, in months */
    courseAxis?: { binMonths: number; from: number; to: number };
    /**
     * every event type this cohort's timeline actually holds, so the UI
     * can offer the choice without a round trip. `perPatient` and `hasDurations`
     * are what separate a clinical event from an administrative marker — a type
     * with exactly one event per patient and no duration (Sequencing, Sample
     * acquisition) is a filing record, not a course.
     */
    eventOptions?: { canonical: string; label: string; patients: number; perPatient: number; hasDurations: boolean }[];
  };
  sequence: {
    sequence?: SequenceResult;
  };
  hotspots: {
    hotspots?: HotspotGene[];
    /** the cells the view hides, as applied to its figure (`hotspots` itself stays whole, so the app can re-filter it) */
    hide?: string[];
  };
  plot: {
    /** a plot's aggregated contract: bins, groups or cells — never points */
    plot?: PlotData;
  };
  coexpression: {
    coexpression?: CoexprRow[];
    /** a plot's aggregated contract: bins, groups or cells — never points */
    plot?: PlotData;
  };
  clinical: {
    clinical?: ClinicalRow[];
  };
  cooccurrence: {
    pairs?: CooccurRow[];
  };
  oncoprint: {
    /**
     * only for `runAnalysis(doc, {oncoprint:"spec"})`: what to POST to
     * /api/oncoprint to get the figure. Carries cohort DEFINITIONS, never compiled SQL.
     */
    spec?: OncoprintSpec;
    svg?: string; nColumns?: number;
    genes?: { gene: string; driverPct: number | null; anyPct: number | null }[];
  };
  attrition: {
    attrition?: AttritionPanel[];
  };
  genome: {
    genome?: GenomeResult;
  };
  pathways: {
    pathways?: PathwaysResult;
  };
  diffexpr: {
    diffexpr?: DiffexprResult;
  };
  paired: {
    paired?: PairedResult;
  };
  acquired: {
    acquired?: AcquiredResult;
  };
  ctdna: {
    ctdna?: CtdnaResult;
  };
  exclusivity: {
    exclusivity?: ExclusivityResult;
  };
  instability: {
    instability?: InstabilityResult;
  };
  clonality: {
    clonality?: ClonalityResult;
  };
  incidence: {
    incidence?: IncidenceResult;
  };
  labs: {
    labs?: LabsResult;
  };
  txendpoints: {
    txendpoints?: TxendpointsResult;
  };
  multistate: {
    multistate?: MultistateResult;
  };
  predictive: {
    predictive?: PredictiveResult;
  };
  cutpoint: {
    cutpoint?: CutpointResult;
  };
  riskmodel: {
    riskmodel?: RiskmodelResult;
  };
  cancertypes: {
    cancertypes?: CancertypesResult;
  };
  overlap: {
    overlap?: OverlapResult;
  };
  enrichment: {
    enrichment?: EnrichmentResult;
  };
  assays: {
    assays?: AssaysResult;
  };
  composition: {
    composition?: CompositionResult;
  };
  correlates: {
    correlates?: CorrelatesResult;
  };
  table: {
    table?: TableResult;
  };
  timeline: {
    timeline?: TimelineResult;
  };
  mutations: {
    mutations?: MutationsResult;
  };
  alterations: {
    alterations?: AlterationsResult;
  };
}
/**
 * Each kind's main field: what every DRAWN result of that kind carries (one that neither failed
 * nor waits for cohorts). The oncoprint has none: it carries its figure or its spec, by request.
 */
export interface ViewResultMain {
  compare: "rows"; survival: "curves"; cox: "cox"; logistic: "logistic"; forest: "forest"; adjusted: "adjusted"; actionability: "actionability"; drivernegative: "drivernegative"; course: "course"; sequence: "sequence";
  hotspots: "hotspots"; plot: "plot"; coexpression: "coexpression"; clinical: "clinical"; cooccurrence: "pairs";
  oncoprint: never; attrition: "attrition"; genome: "genome"; pathways: "pathways"; diffexpr: "diffexpr";
  paired: "paired"; clonality: "clonality"; incidence: "incidence"; labs: "labs"; riskmodel: "riskmodel";
  cancertypes: "cancertypes"; overlap: "overlap"; enrichment: "enrichment"; assays: "assays";
  composition: "composition"; correlates: "correlates"; table: "table"; timeline: "timeline";
  mutations: "mutations"; alterations: "alterations"; acquired: "acquired"; ctdna: "ctdna"; exclusivity: "exclusivity"; txendpoints: "txendpoints"; multistate: "multistate"; predictive: "predictive"; cutpoint: "cutpoint"; instability: "instability";
}
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
  /** where the data came from: each database or MCP peer, and the studies it answered for */
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
  of: string; split: string; parentCount: number;
  children: { name: string; label: string; role: "arm" | "other" | "notEvaluable"; count: number }[];
  /** sum of the children's counts; equals parentCount when the split is exact */
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
  /** every profile as the studies describe them (genetic_profile), for a plot axis's Data picker */
  profileCatalog?: ProfileInfo[];
  stats: { ms: number; perStudy?: Record<string, number | null> };
}
