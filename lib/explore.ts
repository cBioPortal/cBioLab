// Faceted study explorer: what exists, in what numbers — optionally conditioned on a
// draft cohort so every count narrows as clauses are added (study-view-style feedback).
// Everything returned is designed to be clickable into a DSL clause.
import { chQuery, PRIMARY, ensureChContext, registerChExternal, type ChConn } from "./ch.ts";
import { sq } from "./compiler.ts";
import { derivedMetricSql, basePatientsSql, type DerivedMetric } from "./cohort2.ts";
import { compileCohortDef } from "./cohort2.ts";

import type { ExploreResult, ClinicalFacet, CohortDef, ChRow, StudyBreakdownRow, GeneTableRow, GeneStateFacet, NumericBin, DerivedFacet, DerivedRequest } from "./types.ts";
import { clinicalValueFoldSql } from "./event-names.ts";
import { clinicalTable, clinicalMetaTable, ATTR_NAME_RE, customAttributesFor } from "./custom-data.ts";

/**
 * cBioPortal's linear bin intervals (LinearDataBinner). The binner picks the
 * smallest interval that divides the range into at most ~20 bins.
 */
const BIN_INTERVALS = [0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5,
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const BIN_INTERVALS_DISCRETE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const TARGET_BINS = 20;
/** how many numeric attributes get a histogram (each costs two grouped queries per study) */
const NUM_HISTOGRAM_LIMIT = 14;
/** values returned per categorical facet (a pie shows a few; a ranked list more) */
/**
 * Safety bound on values per facet, NOT a display choice — the UI scrolls, so
 * there is no reason to trim for the screen. Measured on MSK-CHORD: fetching
 * every categorical value is 78ms vs 89ms capped at 20 (LIMIT n BY costs more
 * than it saves) and 47KB vs 20KB, against a page that already ships 165KB.
 * Only 6 of 41 categorical attributes exceed 20 values and the largest is 189.
 * The bound exists so one pathological free-text attribute cannot blow up the
 * payload; a facet that hits it says so.
 */
const FACET_VALUE_LIMIT = 200;

/**
 * Above this many patients a resolved cohort is not worth shipping with every query, and the
 * compiled predicate goes back inline. The ceiling is about payload, not correctness: both
 * forms select the same patients, and the fallback is what this code always did.
 *
 * 50,000 ids is ~500KB of TSV per query. Measured against ClickHouse Cloud, an external table
 * of 244KB (the whole of MSK-CHORD) costs no more wall clock than one of 18KB, so the bound is
 * deliberately generous; what it exists to stop is a loose filter over a 240k-patient study
 * turning every facet query into a multi-megabyte upload.
 */
const COHORT_EXTERNAL_LIMIT = Number(process.env.EXPLORE_COHORT_EXTERNAL_LIMIT || 50000);

/** ClickHouse external-table name holding one study's resolved draft cohort. */
const cohortTable = (study: string) => "_cohort_" + study.replace(/[^A-Za-z0-9_]/g, "_");

/** The studies as a WHERE term: equality for one (what the pinned denominators were measured against), else IN. */
const studyIn = (studies: string[]) => studies.length === 1
  ? "cancer_study_identifier = " + sq(studies[0])
  : "cancer_study_identifier IN (" + studies.map(sq).join(",") + ")";

/**
 * A patient set is a parenthesised subquery of study-qualified ids (`patient_unique_id` is the
 * study prefix and the patient's stable id); every draft condition below is made from one.
 * `studyPatients` turns one study's `pid`s (a table, or a parenthesised definition) into such ids.
 */
const studyPatients = (study: string, src: string) => "SELECT concat(" + sq(study + "_") + ", pid) FROM " + src;
/** Rows of the patients in `set`; nothing when there is no set. */
const inPatients = (set: string) => set ? "\n  AND patient_unique_id IN " + set : "";
/** The same for a table with no patient column (sample_to_gene_panel_derived), through sample_derived. */
const inPatientsSamples = (set: string, db: string, studies: string[]) => set
  ? "\n  AND sample_unique_id IN (SELECT sample_unique_id FROM " + db + ".sample_derived WHERE " + studyIn(studies) + inPatients(set) + ")"
  : "";
/** A definition's patients in these studies, each study's compiled on its own: "" for no clauses. */
type DefCtx = { oncokbPin?: string | null; profilesByStudy?: Map<string, { profiles?: string[]; gaProfiles?: string[] }> };
function patientSet(studies: string[], db: string, def: CohortDef | null | undefined, ctx: DefCtx): string {
  if (!def || !Array.isArray(def.all) || !def.all.length) return "";
  return "(" + studies.map((s) => studyPatients(s, "(" + compileCohortDef(def, { oncokbPin: ctx.oncokbPin, ...(ctx.profilesByStudy?.get(s) || {}), study: s, db }) + ")"))
    .join("\n    UNION ALL ") + ")";
}
/** One study's DefCtx, for a caller holding that study's oncokbPin and profiles. */
const oneStudyCtx = (study: string, c: { oncokbPin?: string | null; profiles?: string[]; gaProfiles?: string[] } = {}): DefCtx =>
  ({ oncokbPin: c.oncokbPin, profilesByStudy: new Map([[study, { profiles: c.profiles, gaProfiles: c.gaProfiles }]]) });
/** The draft without the clauses `own` picks out — what a facet is counted against when it is itself filtered on. */
const draftWithout = (draft: CohortDef, own: (c: NonNullable<CohortDef["all"]>[number]) => boolean): CohortDef =>
  ({ ...draft, all: (draft.all || []).filter((c) => !own(c)) });
/** Rows split by their `s` (study) column, each list in row order. */
function groupByStudy(rows: ChRow[]): Map<string, ChRow[]> {
  const m = new Map<string, ChRow[]>();
  for (const r of rows) { const k = String(r.s); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
  return m;
}

/**
 * The draft cohort, resolved ONCE per study per request.
 *
 * The compiled definition is a set expression over patient ids, and it used to be spliced into
 * every facet query — so a four-clause draft was re-evaluated ~30 times to answer one screen,
 * measured at 2x the cost of the same query unfiltered. Here it is evaluated once and the
 * resulting ids ride along as an external table, which also sidesteps the 256KB `max_query_size`
 * wall that an inlined id list hits at ~22,000 patients (measured: 15,872 ids still fit, the
 * whole of MSK-CHORD at 24,950 does not — the same ceiling recorded in docs/PERFORMANCE.md).
 *
 * Returns the cohort as a patient set (inPatients / inPatientsSamples make its conditions), and
 * the ids it uploaded, which the multi-study path pools into one table per connection.
 */
async function resolveCohort(
  study: string, db: string, dsql: string, conn: ChConn
): Promise<{ set: string; count: number; pids?: string[] }> {
  const table = cohortTable(study);
  // One extra row tells us the cohort is over the bound without a second counting pass.
  const r = await chQuery<ChRow>(
    "SELECT DISTINCT pid FROM (" + dsql + ") LIMIT " + (COHORT_EXTERNAL_LIMIT + 1), conn);
  const pids = r.data.map((x) => String(x.pid));

  if (pids.length > COHORT_EXTERNAL_LIMIT || !registerChExternal(
    { name: table, structure: "pid String", data: pids.length ? pids.join("\n") + "\n" : "" }
  )) {
    // Too large to ship, or no request context to hold it (MCP, scripts, tests): read the
    // definition itself, and pay one counting query for the size we did not learn.
    const c = await chQuery<ChRow>("SELECT uniqExact(pid) AS n FROM (" + dsql + ")", conn);
    return { set: "(" + studyPatients(study, "(" + dsql + ")") + ")", count: Number(c.data[0].n) };
  }
  return { set: "(" + studyPatients(study, table) + ")", pids, count: pids.length };
}

/**
 * Bin edges for a numeric attribute, reproducing the portal's algorithm:
 * IQR-based outlier bounds clamped to the data range, a "nice" interval, and
 * edges anchored to multiples of it. Returns the interior edges; anything
 * below the first or above the last becomes a "<=" / ">" outlier bar.
 */
export function numericBinEdges(
  dataMin: number, dataMax: number, q1: number, q3: number, allIntegers: boolean
): { edges: number[]; interval: number } {
  if (!(dataMax > dataMin)) return { edges: [], interval: 0 };
  const iqr = q3 - q1;
  const lowerOutlier = Math.max(dataMin, q1 - 1.5 * iqr);
  const upperOutlier = Math.min(dataMax, q3 + 1.5 * iqr);
  const min = Math.max(dataMin, lowerOutlier), max = Math.min(dataMax, upperOutlier);
  const list = allIntegers ? BIN_INTERVALS_DISCRETE : BIN_INTERVALS;
  const interval = list.find((i) => (max - min) / i <= TARGET_BINS) ?? list[list.length - 1];
  let start = min + interval - (min % interval);
  if (start - interval > lowerOutlier) start -= interval;
  const end = (max + interval < upperOutlier) ? max : max - interval;
  const edges: number[] = [];
  // guard against pathological ranges producing thousands of bars
  for (let d = start; d <= end && edges.length <= TARGET_BINS + 4; d += interval) {
    edges.push(Math.round(d * 1e6) / 1e6);
  }
  return { edges, interval };
}

/** display cap per gene table; totals report the full count behind it */
const GENE_TABLE_LIMIT = 500;
/** how many genes may carry their own alteration facet at once */
const GENE_FACET_LIMIT = 6;
import { isClinicalLeaf } from "./types.ts";
import { finiteSql } from "./sql-number.ts";


export interface ExploreArgs {
  study: string; draft?: CohortDef | null; oncokbPin?: string | null; profiles?: string[];
  gaProfiles?: string[]; conn?: ChConn; geneSearch?: string; skipBins?: boolean; skipGenes?: boolean;
  attributes?: string[]; geneCharts?: string[];
  /** the derived facets to compute; none when omitted */
  derived?: DerivedRequest[];
  /** the draft's cohort, already resolved by a caller that needed it first (the pooled gene pass) */
  resolved?: Awaited<ReturnType<typeof resolveCohort>>;
  /** this study's rows of the facet queries, fetched for every study on its connection at once */
  prefetched?: Prefetched;
}

/**
 * A request boundary, so the resolved cohort (and the reader's abort signal, when the caller
 * supplied one) is visible to every query this produces. Inherited when there already is one,
 * which is how a federated request keeps all its studies in a single context.
 */
export function buildExplore(args: ExploreArgs): Promise<ExploreResult> {
  return ensureChContext(() => buildExploreOne(args));
}

async function buildExploreOne({ study, draft, oncokbPin, profiles, gaProfiles, conn = PRIMARY, geneSearch, skipBins, skipGenes, attributes, geneCharts, derived: derivedReq, resolved, prefetched }: ExploreArgs): Promise<ExploreResult> {
  const db = conn.db;
  const t0 = Date.now();
  let cond = "", panelSampleCond = "", draftSet = "", draftCount = null;
  if (draft && Array.isArray(draft.all) && draft.all.length) {
    const dsql = compileCohortDef(draft, { oncokbPin, profiles, gaProfiles, study, db });
    // Resolved once here; every facet query below then reads the cohort rather than
    // recomputing it. `count` is the same number the old uniqExact query returned.
    const c = resolved ?? await resolveCohort(study, db, dsql, conn);
    draftSet = c.set;
    cond = inPatients(c.set);
    panelSampleCond = inPatientsSamples(c.set, db, [study]);
    draftCount = c.count;
  }
  // Derived facets are independent of everything below, so start them here and
  // collect at the end — serially they cost ~400ms on a ~600ms page, overlapped
  // they cost almost nothing.
  const derivedP = buildDerivedFacets(db, study, conn, cond, draft,
    { oncokbPin, profiles, gaProfiles }, derivedReq);
  // The facet queries, shared with the federated path, which fetches them for every study on a
  // connection at once and hands each study its rows; a study alone is the list of length one.
  const pre = prefetched ?? (await prefetchFacets({ studies: [study], db, conn, attributes,
    set: draftSet })).get(study)!;

  // how many patients this study contributes under the current draft (or in total)
  const studyN = draftCount ?? Number(pre.totals.pts);
  const studyBreakdown: StudyBreakdownRow[] = [
    { study, n: studyN, instance: conn.id, instanceLabel: conn.label }
  ];
  // both units, as the portal's study-view header reports them: facets are
  // counted in their natural unit, so the header anchors what each one means
  const totalsRow = pre.totals;
  const totals = { patients: Number(totalsRow.pts), samples: Number(totalsRow.smp) };

  // ---- attribute metadata: the portal's own declarations -----------------
  // datatype here is DECLARED, not sniffed from values, which is what the study
  // view uses to decide pie-vs-histogram. priority drives chart ordering, and

  // priority 0 means "available but hidden by default" in the portal.
  const metaRows = { data: pre.meta };
  const meta = new Map(metaRows.data.map((r) => [r.a, r]));

  // ---- clinical attributes: classify categorical vs numeric --------------
  const cls = { data: pre.cls };
  // Declared datatype wins; the old value-sniffing survives only as a fallback
  // for attributes with no metadata row, so nothing is silently discarded.
  const declaredNumeric = (r: ChRow): boolean => isNumericAttr(r, meta);
  const numAttrs = cls.data.filter(declaredNumeric);
  const catAttrs = cls.data.filter((r) => !declaredNumeric(r));

  const catValues = pre.catValues;
  // Disjunctive faceting (draftedClinical): the multi-study path counts these for every study at
  // once and hands each study its rows; a study alone counts its own.
  const disjValues = new Map<string, { v: string; n: number }[]>(); // "per|attr" -> [{v,n}]
  for (const { key, per, attr, rest } of draftedClinical(draft)) {
    const rows = pre.disjunctive?.get(key) ?? (await valueCounts({ studies: [study], db, conn, attrs: [attr], per,
      set: patientSet([study], db, rest, oneStudyCtx(study, { oncokbPin, profiles, gaProfiles })) })).get(study) ?? [];
    disjValues.set(key, rows.map((x) => ({ v: x.v, n: Number(x.n) })));
  }

  // each attribute's values, grouped once ("type|attribute"), in the order the query returned them
  const valuesOf = new Map<string, { v: string; n: number }[]>();
  for (const x of catValues) {
    const k = x.type + "|" + x.a, l = valuesOf.get(k), row = { v: x.v, n: Number(x.n) };
    if (l) l.push(row); else valuesOf.set(k, [row]);
  }
  const clinical: ClinicalFacet[] = [
    ...catAttrs.map((r): ClinicalFacet => ({
      attribute: r.a, per: r.type as "patient" | "sample", kind: "cat", patients: Number(r.np),
      distinct: Number(r.nv),
      values: disjValues.get(r.type + "|" + r.a) || valuesOf.get(r.type + "|" + r.a) || [],
      disjunctive: disjValues.has(r.type + "|" + r.a) || undefined
    })),
    ...numAttrs.map((r): ClinicalFacet => ({
      attribute: r.a, per: r.type as "patient" | "sample", kind: "num", patients: Number(r.np),
      min: Number(r.mn), max: Number(r.mx), median: Number(r.md), naCount: Number(r.na)
    }))
  ].map((f) => {
    const m = meta.get(f.attribute);
    return m ? {
      ...f,
      displayName: m.display_name || undefined,
      description: m.description || undefined,
      priority: Number(m.priority) || 0
    } : f;
  }).sort((x, y) => {
    // portal ordering: declared priority first, then coverage, then name (so ties hold still)
    const pd = (y.priority ?? 0) - (x.priority ?? 0);
    return pd || y.patients - x.patients || x.attribute.localeCompare(y.attribute);
  });

  // ---- numeric histograms (cBioPortal study-view bins) --------------------
  if (!skipBins) {
    const numFacets = clinical.filter((c): c is Extract<ClinicalFacet, { kind: "num" }> => c.kind === "num").slice(0, NUM_HISTOGRAM_LIMIT);
    const edgesByAttr: Record<string, { edges: number[]; interval: number }> = {};
    for (const f of numFacets) {
      const src = numAttrs.find((r) => r.a === f.attribute);
      if (src) edgesByAttr[f.attribute] = numericBinEdges(Number(src.mn), Number(src.mx), Number(src.q1), Number(src.q3), String(src.allints) === "1");
    }
    await fillHistograms({ facets: numFacets.filter((f) => edgesByAttr[f.attribute]), edgesByAttr,
      groups: [{ conn, studies: [study], cond }], cohort: totals });
  }

  // ---- timeline event types ----------------------------------------------
  const ev = { data: pre.events };

  // ---- gene tables: built for this ONE study by the shared builder ---------
  // The federated path calls the same builder once for every study on a
  // connection instead of once per study; `skipGenes` is how it tells this
  // pass not to duplicate that work. See geneTables() below.
  const { mutatedGenes, cnaGenes, svGenes, geneTotals } = skipGenes
    ? { mutatedGenes: [], cnaGenes: [], svGenes: [],
        geneTotals: { mutated: 0, cna: 0, sv: 0 } }
    : await geneTables({ studies: [study], db, conn, geneSearch, cond, panelSampleCond });

  // ---- molecular data types (portal: molecular-profile sample counts) -----
  // Samples with data of each type. The three that our DSL can filter on
  // (mutation / CNA / SV) become `profiled` clauses when clicked.
  const dt = { data: pre.dataTypes };
  const dataTypes = dt.data.map((r) => ({
    profile: r.profile, label: r.label, alterationType: r.atype, n: Number(r.n)
  }));

  // ---- case lists (draft-conditioned, like every other facet) ------------
  const lists = { data: pre.lists };

  // ---- derived facets ------------------------------------------------------
  // Only the ones the caller asked for. Computed from dates and gene symbols, never from a study's event-type names
  // or attribute keys, which vary study to study (this database spells the same
  // concept "Treatment" in 87 studies and "TREATMENT" in 10). A study without
  // the underlying table simply yields no buckets and the facet is omitted.
  const derived = await derivedP;
  // Per-gene alteration facets for whatever genes the reader has asked to chart.
  // Their base is this study's cohort size in PATIENTS, which is what the
  // notProfiled slice is measured against.
  const geneFacets = await geneStateFacets({
    genes: geneCharts || [], study, db, conn, cond, total: studyN,
    draft, ctx: { oncokbPin, profiles, gaProfiles }
  });

  return {
    study, draftCount, studyBreakdown,
    clinical, derived,
    events: ev.data.map((r) => ({ type: r.t, n: Number(r.n) })),
    caseLists: lists.data.map((r) => ({ id: r.id.replace(study + "_", ""), name: r.name, n: Number(r.n) })),
    mutatedGenes, cnaGenes, svGenes, geneTotals, geneFacets, totals, dataTypes,
    numStats: numAttrs.map((r) => ({ attribute: r.a, per: r.type as "patient" | "sample", min: Number(r.mn), max: Number(r.mx), q1: Number(r.q1), q3: Number(r.q3), allInts: String(r.allints) === "1", n: Number(r.np) })),
    profiles: profiles || [], gaProfiles: gaProfiles || [],
    stats: { ms: Date.now() - t0 }
  };
}

/** Bucket edges are ours, not the study's — stated in each facet's note. */
type DerivedSpec = {
  metric: DerivedMetric;
  label: string; unit: string; note: string;
  cuts: { label: string; gte?: number; lt?: number }[];
  /** "lines" and "treatmentSpan" only — see DerivedMetricParams */
  eventType?: string; lineGap?: number;
};
const DERIVED_SPECS: DerivedSpec[] = [
  { metric: "followupMonths", label: "Follow-up after day 0", unit: "months",
    note: "how far the timeline runs past its own day 0 — the observability an outcome or absence question depends on",
    cuts: [{ label: "< 6mo", lt: 6 }, { label: "6–12mo", gte: 6, lt: 12 }, { label: "1–2y", gte: 12, lt: 24 },
           { label: "2–5y", gte: 24, lt: 60 }, { label: "> 5y", gte: 60 }] },
  { metric: "historyMonths", label: "History before day 0", unit: "months",
    note: "how much of the disease course predates the study's own clock — large values mean much of the patient's course is unobserved here",
    cuts: [{ label: "none", lt: 0.5 }, { label: "< 6mo", gte: 0.5, lt: 6 }, { label: "6–24mo", gte: 6, lt: 24 },
           { label: "2–5y", gte: 24, lt: 60 }, { label: "> 5y", gte: 60 }] },
  { metric: "alteredGenes", label: "Distinct altered genes", unit: "genes",
    note: "genes with a mutation, high-level CNA or fusion in this patient; panel size bounds it, so it is not comparable across studies with different panels",
    cuts: [{ label: "1", lt: 2 }, { label: "2", gte: 2, lt: 3 }, { label: "3–5", gte: 3, lt: 6 },
           { label: "6–10", gte: 6, lt: 11 }, { label: "> 10", gte: 11 }] }
];

/**
 * A requested facet filled out to a full spec. "lines" and "treatmentSpan" need
 * an eventType supplied by the caller, because there is no study-independent way
 * to know which timeline event stands for "a therapy" here; the other three are
 * the same everywhere (DERIVED_SPECS).
 */
function derivedSpec(req: DerivedRequest): DerivedSpec | null {
  const fixed = DERIVED_SPECS.find((s) => s.metric === req.metric);
  if (fixed) return fixed;
  const et = String(req.eventType || "").trim();
  if (!et || (req.metric !== "lines" && req.metric !== "treatmentSpan")) return null;
  if (req.metric === "treatmentSpan") return {
    metric: "treatmentSpan", eventType: et,
    label: "Time in '" + et + "' records", unit: "months",
    note: "span from the first to the last '" + et + "' record — the study's own clock for treatment, not a claim about continuous exposure",
    cuts: [{ label: "< 3mo", lt: 3 }, { label: "3–12mo", gte: 3, lt: 12 }, { label: "1–2y", gte: 12, lt: 24 },
           { label: "> 2y", gte: 24 }]
  };
  const gap = Math.max(1, Math.min(3650, Math.floor(Number(req.lineGap) || 90)));
  return {
    metric: "lines", eventType: et, lineGap: gap,
    label: "Lines of '" + et + "'", unit: "lines",
    note: "'" + et + "' records grouped into lines by a " + gap + "-day gap — the same scheme the treatment-sequence view uses; changing the gap changes the count",
    cuts: [{ label: "1", lt: 2 }, { label: "2", gte: 2, lt: 3 }, { label: "3", gte: 3, lt: 4 }, { label: "4+", gte: 4 }]
  };
}

/**
 * Does this top-level clause constrain the given derived metric — either as a
 * bare leaf, or as an `any` group of buckets of that one metric?
 *
 * The group form matters: clicking two buckets of one metric ORs them into
 * `{any:[...]}`, and a check that only recognised the bare leaf treated that as
 * somebody else's clause, applied it, and collapsed the facet to the two chosen
 * buckets — the disappearing-options bug, back again by another route.
 *
 * eventType must match too, for "lines"/"treatmentSpan": a clause naming a
 * different event type is a different metric that happens to share a name.
 */
function isDerivedClauseFor(c: unknown, metric: string, eventType?: string): boolean {
  const l = c as { kind?: string; metric?: string; eventType?: string; any?: unknown[] };
  const matches = (y: { kind?: string; metric?: string; eventType?: string } | null | undefined) =>
    !!y && y.kind === "derived" && y.metric === metric && (y.eventType || "") === (eventType || "");
  if (!l) return false;
  if (matches(l)) return true;
  return Array.isArray(l.any) && l.any.length > 0 && l.any.every((x) => matches(x as never));
}

async function buildDerivedFacets(
  db: string, study: string, conn: ChConn, cond: string,
  draft?: CohortDef | null,
  ctx?: { oncokbPin?: string | null; profiles?: string[]; gaProfiles?: string[] },
  requested?: DerivedRequest[]
): Promise<DerivedFacet[]> {
  const specs = (requested || []).map(derivedSpec).filter((s): s is DerivedSpec => !!s);
  const out: DerivedFacet[] = [];
  await Promise.all(specs.map(async (spec) => {
    const per = derivedMetricSql(spec.metric, study, db, { eventType: spec.eventType, lineGap: spec.lineGap });
    const cases = spec.cuts.map((c, i) => {
      const t: string[] = [];
      if (c.gte != null) t.push("v >= " + c.gte);
      if (c.lt != null) t.push("v < " + c.lt);
      return "    " + (t.length ? t.join(" AND ") : "1") + ", " + i;
    }).join(",\n");
    // Disjunctive faceting, as the clinical facets get: a metric already
    // constrained in the draft is counted against the draft MINUS its own
    // clauses. Without this, selecting "2y+ follow-up" re-counts every bucket
    // under that very filter, the other four come back empty, and the zero-count
    // filter below then deletes them — so the options vanish and the selection
    // cannot be widened or changed without clearing it.
    const ownClauses = (draft && Array.isArray(draft.all))
      ? draft.all.filter((c) => isDerivedClauseFor(c, spec.metric, spec.eventType)) : [];
    let gateCond = cond, disjunctive = false;
    if (ownClauses.length) {
      disjunctive = true;
      gateCond = inPatients(patientSet([study], db, draftWithout(draft!, (c) => isDerivedClauseFor(c, spec.metric, spec.eventType)), oneStudyCtx(study, ctx)));
    }
    const gate = gateCond
      ? "  WHERE pid IN (SELECT pid FROM (" + basePatientsSql(study, db) + gateCond + "))\n"
      : "";
    const sql =
      "SELECT b, count() AS n FROM (\n" +
      "  SELECT pid, multiIf(\n" + cases + ",\n    " + spec.cuts.length + ") AS b\n" +
      "  FROM (\n" + per + "\n  )\n" + gate +
      ")\nGROUP BY b ORDER BY b";
    try {
      const r = await chQuery<ChRow>(sql, conn);
      const byIdx = new Map(r.data.map((x) => [Number(x.b), Number(x.n)]));
      const buckets = spec.cuts.map((c, i) => ({ label: c.label, n: byIdx.get(i) || 0,
        ...(c.gte != null ? { gte: c.gte } : {}), ...(c.lt != null ? { lt: c.lt } : {}) }))
        .filter((b) => b.n > 0);
      const covered = buckets.reduce((s2, b) => s2 + b.n, 0);
      if (covered > 0) out.push({ metric: spec.metric, label: spec.label, unit: spec.unit, note: spec.note,
        covered, buckets, ...(disjunctive ? { disjunctive: true as const } : {}),
        ...(spec.eventType ? { eventType: spec.eventType } : {}), ...(spec.lineGap != null ? { lineGap: spec.lineGap } : {}) });
    } catch { /* a study without the underlying table contributes no facet */ }
  }));
  return specs.map((s2) => out.find((o) => o.metric === s2.metric && (o.eventType || "") === (s2.eventType || "")))
    .filter((x): x is DerivedFacet => !!x);
}

// ---- gene tables ----------------------------------------------------------
/**
 * The Mutated / CNA / SV tables, and the legacy combined gene list, for one or
 * more studies **on a single connection**.
 *
 * WHY A LIST OF STUDIES. Explore over 546 studies ran this block once per
 * study: 13 of its ~17 round trips, ~7,100 queries for one page load, and 137s
 * of wall clock. Both the numerator and the denominator are additive over
 * samples (docs/PERFORMANCE.md §1), so putting the studies in one IN list
 * returns exactly the arithmetic that merging per-study results produces — at
 * ~2.3s of query time for all 546 rather than ~7,100 round trips.
 *
 * Pooling also CORRECTS the per-study merge. Each study's table is truncated at
 * GENE_TABLE_LIMIT and the merge sums only the parts that survived that cut, so
 * a gene ranking outside some study's top-N lost that study's PROFILED samples
 * along with its (small) altered count, and the frequency came out biased high.
 * Pooled, every selected study contributes to the denominator whether or not the
 * gene ranks in it. Pinned by test/denominator.test.ts and npm run check:denominators.
 *
 * Safe because `sample_unique_id` is unique across studies — measured 408,055
 * rows and 408,055 distinct values in sample_derived — so `uniqExact` over a
 * pooled scan still counts each sample exactly once.
 *
 * One study is just the list of length one, which is the ONLY implementation of
 * the panel-aware denominator: there is no second copy to drift.
 */
export async function geneTables({ studies, db, conn, geneSearch, cond = "", panelSampleCond = "" }: {
  studies: string[]; db: string; conn: ChConn; geneSearch?: string;
  cond?: string; panelSampleCond?: string;
}): Promise<Pick<ExploreResult, "mutatedGenes" | "cnaGenes" | "svGenes" | "geneTotals">> {

  // ---- gene tables: Mutated / CNA / SV, cBioPortal study-view semantics ----
  // Counts are SAMPLES. The denominator is samples profiled for THAT gene in the
  // relevant alteration type, computed the way the portal does it:
  //   profiled(gene) = panel-profiled(gene)  +  whole-exome sample count
  // The WES panel is excluded from the join on purpose: it enumerates ~45k genes,
  // so joining it multiplies every WES sample by that many rows (47.8M for one
  // TCGA study). The portal splits it into a scalar for exactly this reason.
  const geneTable = async (
    variantType: "mutation" | "cna" | "structural_variant",
    alterationType: "MUTATION_EXTENDED" | "COPY_NUMBER_ALTERATION" | "STRUCTURAL_VARIANT"
  ): Promise<{ rows: GeneTableRow[]; total: number }> => {
    const isCna = variantType === "cna";
    const where =
      "WHERE " + studyIn(studies) + "\n" +
      "  AND variant_type = " + sq(variantType) +
      // the portal excludes uncalled mutations: they exist only to show read support
      (variantType === "mutation" ? "\n  AND mutation_status != 'UNCALLED'" : "") +
      (geneSearch ? "\n  AND positionCaseInsensitive(hugo_gene_symbol, " + sq(geneSearch) + ") > 0" : "") +
      cond;

    const [altered, panelProfiled, wes, distinct] = await Promise.all([
      chQuery<ChRow>(
        "SELECT hugo_gene_symbol AS g," + (isCna ? " cna_alteration AS cna, any(cna_cytoband) AS cytoband," : "") + "\n" +
        "       uniqExact(sample_unique_id) AS altered, uniqExactIf(sample_unique_id, NOT off_panel) AS on_panel, count() AS events\n" +
        "FROM " + db + ".genomic_event_derived\n" + where + "\n" +
        "GROUP BY g" + (isCna ? ", cna" : "") + "\n" +
        "ORDER BY altered DESC, g ASC LIMIT " + GENE_TABLE_LIMIT, conn),
      // Aggregate samples PER PANEL first, then join panels to their genes. The
      // naive sample-level join costs 13s on a 290k-sample study; collapsing to
      // ~100 panel rows first gives the identical answer in ~250ms.
      //
      // DISTINCT SAMPLES, never rows. This table carries one row per (sample,
      // panel, genetic_profile), and a study that publishes two profiles of the
      // same alteration type — a discrete AND a linear CNA profile, which every
      // TCGA study does — lists each sample twice. Counting rows doubled the
      // denominator and so HALVED every CNA frequency: brca_tcga reported MYC
      // amplification at 229/2160 = 10.6% where the truth is 229/1080 = 21.2%.
      // Measured across the database: 101 of 353 studies with CNA panels are
      // affected, 0 of 540 for mutations and 0 of 221 for structural variants.
      chQuery<ChRow>(
        "WITH pc AS (\n" +
        "  SELECT gene_panel_id, uniqExact(sample_unique_id) AS n\n" +
        "  FROM " + db + ".sample_to_gene_panel_derived\n" +
        "  WHERE " + studyIn(studies) + "\n" +
        "    AND alteration_type = " + sq(alterationType) + " AND gene_panel_id != 'WES'" +
        panelSampleCond + "\n" +
        "  GROUP BY gene_panel_id\n" +
        ")\n" +
        // Summing across the panels that carry the gene leaves one residual: a
        // sample on two DIFFERENT panels for the same alteration type is counted
        // once per panel. Deduplicating that needs the sample-level join this
        // CTE exists to avoid, and it is rare — 328 samples across the whole
        // database against 37,666 cured by counting distinct above.
        "SELECT gptg.gene AS g, sum(pc.n) AS n\n" +
        "FROM " + db + ".gene_panel_to_gene_derived gptg\n" +
        "INNER JOIN pc ON pc.gene_panel_id = gptg.gene_panel_id\n" +
        "WHERE gptg.gene_panel_id IN (SELECT gene_panel_id FROM pc)\n" +
        "GROUP BY g", conn),
      // distinct samples for the same reason as the panel counts above
      chQuery<ChRow>(
        "SELECT uniqExact(sample_unique_id) AS n\n" +
        "FROM " + db + ".sample_to_gene_panel_derived\n" +
        "WHERE " + studyIn(studies) + "\n" +
        "  AND alteration_type = " + sq(alterationType) + " AND gene_panel_id = 'WES'" +
        panelSampleCond, conn),
      chQuery<ChRow>(
        "SELECT uniqExact(hugo_gene_symbol) AS n FROM " + db + ".genomic_event_derived\n" + where, conn)
    ]);

    const panelMap = new Map<string, number>(panelProfiled.data.map((r) => [r.g, Number(r.n)]));
    const wesN = Number(wes.data[0]?.n || 0);
    const rows = altered.data.map((r): GeneTableRow => {
      const profiled = (panelMap.get(r.g) || 0) + wesN;
      const alt = Number(r.altered), onPanel = Number(r.on_panel);
      return {
        gene: r.g, altered: alt, alteredOnPanel: onPanel, events: Number(r.events), profiled,
        freqPct: profiled ? Math.round(1000 * onPanel / profiled) / 10 : null,
        ...(isCna ? { cna: Number(r.cna), cytoband: r.cytoband } : {})
      };
    });
  return { rows, total: Number(distinct.data[0]?.n || 0) };
};

const [mut, cna, sv] = await Promise.all([
  geneTable("mutation", "MUTATION_EXTENDED"),
  geneTable("cna", "COPY_NUMBER_ALTERATION"),
  geneTable("structural_variant", "STRUCTURAL_VARIANT")
]);
const mutatedGenes = mut.rows, cnaGenes = cna.rows, svGenes = sv.rows;
const geneTotals = { mutated: mut.total, cna: cna.total, sv: sv.total };

  return { mutatedGenes, cnaGenes, svGenes, geneTotals };
}

// ---- per-gene alteration facets ------------------------------------------
/**
 * The portal's per-gene charts — "EGFR: Somatic mutations: Mutated vs Not
 * Mutated" and "EGFR: Copy-number alterations" — as facets you can filter on.
 *
 * WHY THEY EARN THEIR PLACE. Every other view of a gene here reports a ratio:
 * altered over profiled. A ratio cannot show what it left out. These name the
 * three states a patient can actually be in, and the third one is the point:
 *
 *   altered       the gene is called in at least one of their samples
 *   unaltered     profiled for this gene, and not called
 *   not profiled  no sample of theirs was ever run on a panel covering it
 *
 * The last is not wild-type and must never be pooled with it. In genie_public,
 * 4,676 patients sit on panels that omit EGFR and 61,640 on panels that omit
 * FAT1 — a "wild-type" slice that swallowed them would be wrong by that much.
 *
 * COUNTED IN PATIENTS, not samples, because that is the unit a click filters in.
 * The gene tables on the same page count samples and say so; a facet whose
 * number moved when you clicked it would be worse than the inconsistency.
 *
 * `profiled` resolves through the same panel tables as the gene-table
 * denominator, WES as a separate term for the same reason (it enumerates ~45k
 * genes; joining it multiplied one TCGA study to 47.8M rows).
 */
/**
 * Does this top-level clause constrain the given gene, as the gene-status facet
 * itself would have added it?
 *
 * Matched narrowly on purpose: a `profiled` leaf naming the gene, or an OQL leaf
 * whose query is exactly that one gene, either of them possibly negated. A
 * merged multi-gene OQL clause ("EGFR: MUT; KRAS: MUT") does NOT match and stays
 * applied — dropping it would quietly relax somebody else's constraint.
 */
function isGeneClauseFor(c: unknown, gene: string): boolean {
  const leaf = (x: unknown): boolean => {
    const l = x as { kind?: string; gene?: string; q?: string };
    if (!l) return false;
    if (l.kind === "profiled") return String(l.gene || "").toUpperCase() === gene;
    if (l.kind === "oql") {
      const m = /^\s*([A-Za-z0-9.-]+)\s*:/.exec(String(l.q || ""));
      return !!m && m[1].toUpperCase() === gene && !String(l.q).includes(";");
    }
    return false;
  };
  const c2 = c as { not?: unknown };
  return leaf(c) || (!!c2 && leaf(c2.not));
}

async function geneStateFacets(opts: {
  genes: string[]; study: string; db: string; conn: ChConn;
  cond: string; total: number;
  draft?: CohortDef | null;
  ctx?: { oncokbPin?: string | null; profiles?: string[]; gaProfiles?: string[] };
}): Promise<GeneStateFacet[]> {
  const { study, db, conn, total, draft } = opts;
  const genes = [...new Set(opts.genes.map((g) => String(g).toUpperCase().trim()))]
    .filter((g) => /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(g)).slice(0, GENE_FACET_LIMIT);
  if (!genes.length) return [];

  /**
   * "Was this sample run on an assay covering this gene?" — as a predicate to
   * embed, not a subquery that projects patient ids.
   *
   * Two reasons for that shape. It is the idiom already used by
   * `panelSampleCond` above, and a standalone `SELECT DISTINCT
   * patient_unique_id` trips test/boundary.test.ts, which forbids any explore
   * query from projecting a bare identifier outside an aggregate. That guard
   * cannot tell a subquery from a result set, and loosening it to admit this one
   * would be how it stops catching the thing it exists for.
   *
   * An earlier version aliased the panel join and textually rewrote the draft
   * predicate to match, which produced `sd.sd.patient_unique_id` and a 400 on
   * every drafted request. Nothing is rewritten here.
   */
  /**
   * DISJUNCTIVE FACETING, the same rule the clinical and derived facets follow.
   * A gene already constrained in the draft is counted against the draft MINUS
   * its own clauses — otherwise clicking "Mutated" leaves the facet reading
   * 100% mutated and 0 everywhere else, and there is no way to see the
   * alternatives or widen the choice. That is the disappearing-options bug, and
   * it arrives by default unless this is done.
   */
  const condFor = (gene: string): string | null => {
    if (!draft || !Array.isArray(draft.all) || !draft.all.length) return null;
    const rest = draftWithout(draft, (c) => isGeneClauseFor(c, gene));
    if (rest.all!.length === draft.all.length) return null;       // nothing of this gene's: use opts.cond
    return inPatients(patientSet([study], db, rest, oneStudyCtx(study, opts.ctx)));   // "" when only this gene's
  };

  /**
   * The cohort size under a given predicate. `notProfiled` is total minus
   * profiled, so the two MUST be counted under the same one — a base carried
   * over from the full draft while the states were counted without this gene's
   * clauses would make the slice a difference of two different cohorts.
   */
  const baseTotal = async (c: string): Promise<number> => Number((await chQuery<ChRow>(
    "SELECT uniqExact(patient_unique_id) AS n FROM " + db + ".sample_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + c, conn)).data[0]?.n || 0);

  const panelPred = (gene: string, alterationType: string) =>
    "\n  AND sample_unique_id IN (SELECT sample_unique_id FROM " + db + ".sample_to_gene_panel_derived\n" +
    "    WHERE cancer_study_identifier = " + sq(study) + " AND alteration_type = " + sq(alterationType) + "\n" +
    "      AND (gene_panel_id = 'WES' OR gene_panel_id IN (\n" +
    "        SELECT gene_panel_id FROM " + db + ".gene_panel_to_gene_derived WHERE gene = " + sq(gene) + ")))";

  /** patients with at least one sample profiled for this gene, under `c` */
  const profiledOf = (gene: string, alterationType: string, c: string) =>
    "SELECT uniqExact(patient_unique_id) AS n\n" +
    "FROM " + db + ".sample_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + panelPred(gene, alterationType) + c;

  const resolved = await Promise.all(genes.map(async (gene) => {
    const own = condFor(gene);
    if (own === null) return { gene, cond: opts.cond, total };
    return { gene, cond: own, total: await baseTotal(own) };
  }));

  const out = await Promise.all(resolved.flatMap(({ gene, cond, total }) => [
    // mutations: altered / unaltered / not profiled
    (async (): Promise<GeneStateFacet> => {
      const [prof, alt] = await Promise.all([
        chQuery<ChRow>(profiledOf(gene, "MUTATION_EXTENDED", cond), conn),
        chQuery<ChRow>(
          // The call must come from a sample the assay actually covered.
          // Counting altered patients independently and clamping to the profiled
          // total put 7 EGFR-mutant patients who are on no EGFR-covering panel
          // into both the mutated and the not-profiled slice: the states still
          // summed to the cohort, and were still wrong. `all_altered` is kept
          // only to report that contradiction rather than bury it.
          "SELECT uniqExact(patient_unique_id) AS all_altered,\n" +
          "       uniqExactIf(patient_unique_id, sample_unique_id IN (\n" +
          "         SELECT sample_unique_id FROM " + db + ".sample_to_gene_panel_derived\n" +
          "         WHERE cancer_study_identifier = " + sq(study) + " AND alteration_type = 'MUTATION_EXTENDED'\n" +
          "           AND (gene_panel_id = 'WES' OR gene_panel_id IN (\n" +
          "             SELECT gene_panel_id FROM " + db + ".gene_panel_to_gene_derived WHERE gene = " + sq(gene) + ")))) AS in_panel\n" +
          "FROM " + db + ".genomic_event_derived\n" +
          "WHERE cancer_study_identifier = " + sq(study) + " AND variant_type = 'mutation'\n" +
          "  AND mutation_status != 'UNCALLED' AND hugo_gene_symbol = " + sq(gene) + cond, conn)
      ]);
      const profiled = Number(prof.data[0]?.n || 0);
      const altered = Number(alt.data[0]?.in_panel || 0);
      const orphan = Math.max(0, Number(alt.data[0]?.all_altered || 0) - altered);
      return {
        gene, type: "MUTATION", per: "patient", total, profiled,
        ...(orphan ? { alteredUnprofiled: orphan } : {}),
        states: [
          { state: "altered", label: "Mutated", n: altered },
          { state: "unaltered", label: "Not mutated", n: Math.max(0, profiled - altered) },
          { state: "notProfiled", label: "Not profiled", n: Math.max(0, total - profiled) }
        ]
      };
    })(),
    // CNA: amplified / deleted / diploid / not profiled
    (async (): Promise<GeneStateFacet> => {
      const [prof, calls, anyCall] = await Promise.all([
        chQuery<ChRow>(profiledOf(gene, "COPY_NUMBER_ALTERATION", cond), conn),
        chQuery<ChRow>(
          "SELECT cna_alteration AS c, uniqExact(patient_unique_id) AS n\n" +
          "FROM " + db + ".genomic_event_derived\n" +
          "WHERE cancer_study_identifier = " + sq(study) + " AND variant_type = 'cna'\n" +
          "  AND abs(cna_alteration) >= 2 AND hugo_gene_symbol = " + sq(gene) +
          panelPred(gene, "COPY_NUMBER_ALTERATION") + cond + "\n" +
          "GROUP BY c", conn),
        // The UNION of the two calls, asked for directly. Diploid cannot be
        // profiled minus amp minus del: a patient amplified in one sample and
        // deleted in another is in both counts, and subtracting both removes
        // them twice. EGFR in genie_public has exactly one such patient, which
        // is how this was caught — the facet said 152,241 and the clause the
        // click builds selected 152,242.
        chQuery<ChRow>(
          "SELECT uniqExact(patient_unique_id) AS n FROM " + db + ".genomic_event_derived\n" +
          "WHERE cancer_study_identifier = " + sq(study) + " AND variant_type = 'cna'\n" +
          "  AND abs(cna_alteration) >= 2 AND hugo_gene_symbol = " + sq(gene) +
          panelPred(gene, "COPY_NUMBER_ALTERATION") + cond, conn)
      ]);
      const profiled = Number(prof.data[0]?.n || 0);
      const amp = Number(calls.data.find((r) => Number(r.c) === 2)?.n || 0);
      const del = Number(calls.data.find((r) => Number(r.c) === -2)?.n || 0);
      const anyAltered = Number(anyCall.data[0]?.n || 0);
      // Amplified and Deleted OVERLAP at patient level, so these four states are
      // a list of selectable conditions and not a partition — the counts can
      // sum past the cohort by the overlap. Reported rather than hidden, since a
      // reader adding them up deserves to know why they do not reconcile.
      const overlap = Math.max(0, amp + del - anyAltered);
      return {
        gene, type: "CNA", per: "patient", total, profiled,
        ...(overlap ? { overlap } : {}),
        states: [
          { state: "amp", label: "Amplified", n: amp },
          { state: "del", label: "Deleted", n: del },
          { state: "unaltered", label: "Diploid", n: Math.max(0, profiled - anyAltered) },
          { state: "notProfiled", label: "Not profiled", n: Math.max(0, total - profiled) }
        ]
      };
    })()
  ]));
  return out.filter((f) => f.profiled > 0 || f.total > 0);
}

// ---- federated explore: several studies at once ---------------------------
// Runs buildExplore per study and merges by name — counts are summed with the
// project-wide policy: patient overlap across studies is NOT deduplicated and
// clinical vocabularies are NOT harmonized (merging by attribute name is the
// whole harmonization). Numeric medians are patient-weighted approximations;
// min/max are exact. An attribute classified differently across studies takes
// the kind of the study with the most patients for it.
export interface ExploreFederatedArgs {
  studies: string[]; draft?: CohortDef | null; oncokbPin?: string | null;
  profilesByStudy: Map<string, { profiles: string[]; gaProfiles: string[] }>;
  connByStudy?: Map<string, ChConn>; geneSearch?: string; attributes?: string[]; geneCharts?: string[];
  derived?: DerivedRequest[];
}

/** One context for the whole federated request, so pass 2 can still see pass 1's cohorts. */
export function buildExploreFederated(args: ExploreFederatedArgs): Promise<ExploreResult> {
  return ensureChContext(() => buildExploreFederatedInner(args));
}

async function buildExploreFederatedInner({ studies, draft, oncokbPin, profilesByStudy, connByStudy, geneSearch, attributes, geneCharts, derived }: ExploreFederatedArgs): Promise<ExploreResult> {
  // Every query below runs once per CONNECTION over all its studies, not once per study
  // (docs/PERFORMANCE.md §3b): the counts are additive over study-qualified ids, so a pooled count
  // is the per-study sum — and, for the gene tables, a better one, since no study's denominator is
  // lost to its own top-N cut. Studies on another instance get their own pass; a remote peer is
  // asked separately by the route.
  const groups = byConnection(studies, connByStudy);
  // A draft is resolved once per study up front: the pooled passes read every study's cohort, and
  // each study's own pass (disjunctive values, derived facets) reuses it.
  const resolvedByStudy = new Map<string, Awaited<ReturnType<typeof resolveCohort>>>();
  if (draft && Array.isArray(draft.all) && draft.all.length) await Promise.all(studies.map(async (s) => {
    const conn = connByStudy?.get(s) || PRIMARY;
    const dsql = compileCohortDef(draft, { oncokbPin, ...(profilesByStudy.get(s) || {}), study: s, db: conn.db });
    resolvedByStudy.set(s, await resolveCohort(s, conn.db, dsql, conn));
  }));
  // The pooled queries read the draft as ONE uploaded table per connection of study-qualified
  // ids, not a UNION over every study's own table: at 551 studies that union, and the 551 tables
  // uploaded with each statement, made every pooled query 2-5x slower than without a draft.
  const setOf = new Map<ConnGroup, string>(groups.map((g) => [g, pooledCohortSet(g, resolvedByStudy, draft, { oncokbPin, profilesByStudy })]));
  const condOf = (g: ConnGroup) => inPatients(setOf.get(g)!);

  // Pass 1: each study's facets from the pooled facet queries, WITHOUT histograms — each study's
  // own quartiles would give it different bin edges, and bars over different ranges cannot be
  // summed — beside the pooled gene tables.
  const prefetched = new Map<string, Prefetched>();
  const prefetchP = Promise.all(groups.map(async (g) => {
    const m = await prefetchFacets({ studies: g.studies, db: g.conn.db, conn: g.conn, attributes, set: setOf.get(g)!,
      // Pooled only where the rest of the draft is empty — the common case, a single clicked
      // attribute. Otherwise the rest is each study's compiled definition, and one statement
      // evaluating all of them measured slower than a query per study in parallel (§3c).
      disjunctive: draftedClinical(draft).filter((d) => !d.rest.all?.length).map(({ key, per, attr }) => ({ key, per, attr, set: "" })) });
    for (const [st, p] of m) prefetched.set(st, p);
  }));
  const partsP = prefetchP.then(() => Promise.all(studies.map(s =>
    buildExplore({ study: s, draft, oncokbPin, geneSearch, skipBins: true, skipGenes: true, attributes, geneCharts, derived,
      conn: connByStudy?.get(s) || PRIMARY, ...(profilesByStudy.get(s) || {}), resolved: resolvedByStudy.get(s), prefetched: prefetched.get(s) }))));
  // Pass 2: ONE set of edges per attribute from the pooled statistics, binned over every study at
  // once, so the bars line up and add. It needs the studies' facets, not the gene tables, so it
  // runs beside them rather than after.
  const binsP = partsP.then(async (parts) => {
    const facets = mergeExplore(parts, !!draft);
    const edgesByAttr = sharedBinEdges(parts);
    const numFacets = facets.clinical.filter(
      (c): c is Extract<ClinicalFacet, { kind: "num" }> => c.kind === "num" && !!edgesByAttr[c.attribute]).slice(0, NUM_HISTOGRAM_LIMIT);
    await fillHistograms({ facets: numFacets, edgesByAttr, cohort: facets.totals || { patients: 0, samples: 0 },
      groups: groups.map((g) => ({ ...g, cond: condOf(g) })) });
    return new Map(numFacets.filter((f) => f.bins).map((f) => [f.per + "|" + f.attribute, { bins: f.bins!, naCount: f.naCount }]));
  });
  const [parts, geneParts, bins] = await Promise.all([
    partsP,
    Promise.all(groups.map(async (grp) => {
      const { conn, studies: ss } = grp;
      const cond = condOf(grp);
      const g = await geneTables({ studies: ss, db: conn.db, conn, geneSearch, cond,
        panelSampleCond: inPatientsSamples(setOf.get(grp)!, conn.db, ss) });
      // A gene-only participant. It names no study and holds no patients or
      // facets, so every other field merges as a zero and it adds nothing to
      // the study breakdown. Feeding it through the SAME mergeExplore as the
      // per-study parts is the point: the rule for summing altered and profiled
      // before dividing then has exactly one implementation, whether the parts
      // came from studies, from connections, or from a remote peer.
      return { study: "", studies: [], draftCount: null, clinical: [], events: [],
        caseLists: [], profiles: [], gaProfiles: [], stats: { ms: 0 }, ...g } as ExploreResult;
    })),
    binsP,
  ]);
  const merged = mergeExplore([...parts, ...geneParts], !!draft);
  for (const f of merged.clinical) {
    const b = f.kind === "num" ? bins.get(f.per + "|" + f.attribute) : undefined;
    if (b && f.kind === "num") { f.bins = b.bins; f.naCount = b.naCount; }
  }
  return merged;
}

type ConnGroup = { conn: ChConn; studies: string[] };
/** The studies grouped by the connection (and database) that holds them, in first-seen order. */
function byConnection(studies: string[], connByStudy?: Map<string, ChConn>): ConnGroup[] {
  const groups = new Map<string, ConnGroup>();
  for (const s of studies) {
    const conn = connByStudy?.get(s) || PRIMARY;
    const k = conn.id + "|" + conn.db;
    if (!groups.has(k)) groups.set(k, { conn, studies: [] });
    groups.get(k)!.studies.push(s);
  }
  return [...groups.values()];
}

/**
 * Histograms for `facets` against the given edges, counted over every group's studies (one query
 * per facet per connection, pooledHistograms) and summed by bin. `cohort` is everyone the counts
 * are drawn from, so a facet's NA bar is the rest of it.
 */
async function fillHistograms(opts: {
  facets: Extract<ClinicalFacet, { kind: "num" }>[];
  edgesByAttr: Record<string, { edges: number[]; interval: number }>;
  groups: (ConnGroup & { cond: string })[];
  cohort: { patients: number; samples: number };
}): Promise<void> {
  const { facets, edgesByAttr, groups, cohort } = opts;
  if (!facets.length) return;
  const pooled = await Promise.all(groups.map((g) => pooledHistograms({
    facets, studies: g.studies, db: g.conn.db, conn: g.conn, edgesByAttr, cond: g.cond })));
  for (const f of facets) {
    const { edges, interval } = edgesByAttr[f.attribute];
    if (edges.length < 2) continue;
    const key = f.per + "|" + f.attribute;
    const count = (b: number) => pooled.reduce((n, g) => n + (g.get(key)?.bins.get(b) || 0), 0);
    const lastEdge = edges[edges.length - 1] + interval;
    // portal bins are (start, end]: a value on an edge belongs to the lower bar
    const bins: NumericBin[] = [];
    if (count(-1)) bins.push({ special: "<=", end: edges[0], count: count(-1) });
    edges.forEach((e, i) => bins.push({ start: e, end: Math.round((e + interval) * 1e6) / 1e6, count: count(i) }));
    if (count(-2)) bins.push({ special: ">", start: lastEdge, count: count(-2) });
    f.bins = bins;
    const counted = pooled.reduce((n, g) => n + (g.get(key)?.counted || 0), 0);
    f.naCount = Math.max(0, (f.per === "sample" ? cohort.samples : cohort.patients) - counted);
  }
}

/** Declared datatype wins; value-sniffing is the fallback for an attribute with no metadata row. */
function isNumericAttr(r: ChRow, meta: Map<unknown, ChRow>): boolean {
  const m = meta.get(r.a);
  if (m) return String(m.datatype).toUpperCase() === "NUMBER";
  return Number(r.numratio) >= 0.9 && Number(r.nv) > 10;
}

/** One study's rows of Explore's facet queries, as buildExploreOne would have fetched them. */
interface Prefetched { totals: ChRow; meta: ChRow[]; cls: ChRow[]; catValues: ChRow[]; events: ChRow[]; dataTypes: ChRow[]; lists: ChRow[];
  /** a drafted attribute's values without its own clauses, keyed "per|attribute" (draftedClinical) */
  disjunctive?: Map<string, ChRow[]> }

/**
 * Disjunctive faceting: an attribute the draft constrains has its values counted against the
 * draft MINUS its own clauses — otherwise a selected attribute collapses to its chosen value and
 * can never be OR-extended. Each such attribute ("per|attribute"), and the draft without it.
 */
function draftedClinical(draft: CohortDef | null | undefined): { key: string; per: string; attr: string; rest: CohortDef }[] {
  if (!draft || !Array.isArray(draft.all)) return [];
  const keys = new Set<string>();
  for (const c of draft.all) if (isClinicalLeaf(c)) keys.add((c.per === "sample" ? "sample|" : "patient|") + c.attribute);
  return [...keys].map((key) => {
    const [per, attr] = [key.split("|")[0], key.split("|").slice(1).join("|")];
    const rest = draftWithout(draft, (c) => isClinicalLeaf(c) && c.attribute === attr && (c.per === "sample" ? "sample" : "patient") === per);
    return { key, per, attr, rest };
  });
}

/**
 * Explore's per-study facet queries for every study on one connection at once: each the same
 * statement as buildExploreOne's, with the study added to its GROUP BY and its per-study LIMIT
 * written as LIMIT … BY study, then split back into one Prefetched per study so every later step
 * (classification, disjunctive values, the merge) is unchanged.
 */
async function prefetchFacets(opts: {
  studies: string[]; db: string; conn: ChConn; attributes?: string[];
  /** the draft as a patient set (resolveCohort, pooledCohortSet), or "" */
  set: string;
  /** drafted attributes to count without their own clauses, each with the rest of the draft as such a set */
  disjunctive?: { key: string; per: string; attr: string; set: string }[];
}): Promise<Map<string, Prefetched>> {
  const { studies, db, conn, set } = opts;
  const IN = "(" + studies.map(sq).join(",") + ")";
  const cond = set ? "\n  AND patient_unique_id IN " + set : "";
  const attrAllow = [...new Set((opts.attributes || []).map(String).filter((a) => ATTR_NAME_RE.test(a)))].slice(0, 60);
  if (attrAllow.length) for (const s of studies) for (const c of customAttributesFor(s)) if (!attrAllow.includes(c.attribute)) attrAllow.push(c.attribute);
  const [totals, meta, cls, events, dataTypes, lists] = await Promise.all([
    chQuery<ChRow>(
      "SELECT cancer_study_identifier AS s, uniqExact(patient_unique_id) AS pts, uniqExact(sample_unique_id) AS smp\n" +
      "FROM " + db + ".sample_derived\nWHERE cancer_study_identifier IN " + IN + cond + "\nGROUP BY s", conn),
    chQuery<ChRow>(
      "SELECT cs.cancer_study_identifier AS s, cam.attr_id AS a, cam.datatype AS datatype, cam.display_name AS display_name,\n" +
      "       cam.description AS description, cam.priority AS priority, cam.patient_attribute AS patient_attribute\n" +
      "FROM " + clinicalMetaTable(db) + " cam\n" +
      "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
      "WHERE cs.cancer_study_identifier IN " + IN, conn).catch(() => ({ data: [] as ChRow[] })),
    chQuery<ChRow>(
      "SELECT cancer_study_identifier AS s, type, attribute_name AS a, uniqExact(" + clinicalValueFoldSql("attribute_value") + ") AS nv,\n" +
      "  countIf(" + finiteSql("attribute_value") + " IS NOT NULL) / count() AS numratio,\n" +
      "  uniqExact(if(type = 'sample', sample_unique_id, patient_unique_id)) AS np,\n" +
      "  min(" + finiteSql("attribute_value") + ") AS mn, max(" + finiteSql("attribute_value") + ") AS mx,\n" +
      "  quantileExact(0.5)(" + finiteSql("attribute_value") + ") AS md,\n" +
      "  quantileExact(0.25)(" + finiteSql("attribute_value") + ") AS q1,\n" +
      "  quantileExact(0.75)(" + finiteSql("attribute_value") + ") AS q3,\n" +
      "  countIf(" + finiteSql("attribute_value") + " IS NULL) AS na,\n" +
      "  countIf(" + finiteSql("attribute_value") + " = round(" + finiteSql("attribute_value") + ")) = countIf(" + finiteSql("attribute_value") + " IS NOT NULL) AS allints\n" +
      "FROM " + clinicalTable(db, attrAllow.length ? attrAllow : "all") + "\n" +
      "WHERE cancer_study_identifier IN " + IN + " AND attribute_value != ''" + cond +
      (attrAllow.length ? "\n  AND attribute_name IN (" + attrAllow.map(sq).join(",") + ")" : "") + "\n" +
      "GROUP BY s, type, a ORDER BY np DESC LIMIT 250 BY s", conn),
    chQuery<ChRow>(
      "SELECT cs.cancer_study_identifier AS s, ce.event_type AS t, uniqExact(ce.patient_id) AS n\n" +
      "FROM " + db + ".clinical_event ce\n" +
      "JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
      "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "WHERE cs.cancer_study_identifier IN " + IN +
      (set ? "\n  AND concat(cs.cancer_study_identifier, '_', p.stable_id) IN " + set : "") + "\n" +
      "GROUP BY s, t ORDER BY n DESC", conn),
    chQuery<ChRow>(
      "SELECT sd.cancer_study_identifier AS s, replaceOne(gp.stable_id, concat(sd.cancer_study_identifier, '_'), '') AS profile,\n" +
      "       any(gp.name) AS label, gp.genetic_alteration_type AS atype, uniqExact(sp.sample_id) AS n\n" +
      "FROM " + db + ".sample_profile sp\n" +
      "JOIN " + db + ".sample_derived sd ON sp.sample_id = sd.internal_id\n" +
      "JOIN " + db + ".genetic_profile gp ON sp.genetic_profile_id = gp.genetic_profile_id\n" +
      "WHERE sd.cancer_study_identifier IN " + IN +
      (set ? "\n  AND sd.patient_unique_id IN " + set : "") + "\n" +
      "GROUP BY gp.stable_id, sd.cancer_study_identifier, atype ORDER BY n DESC", conn),
    chQuery<ChRow>(
      "SELECT cs.cancer_study_identifier AS s, sl.stable_id AS id, any(sl.name) AS name, uniqExact(p.stable_id) AS n\n" +
      "FROM " + db + ".sample_list sl\n" +
      "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = sl.cancer_study_id\n" +
      "JOIN " + db + ".sample_list_list sll ON sll.list_id = sl.list_id\n" +
      "JOIN " + db + ".sample s ON s.internal_id = sll.sample_id\n" +
      "JOIN " + db + ".patient p ON p.internal_id = s.patient_id\n" +
      "WHERE cs.cancer_study_identifier IN " + IN +
      (set ? "\n  AND concat(cs.cancer_study_identifier, '_', p.stable_id) IN " + set : "") + "\n" +
      "GROUP BY s, id ORDER BY n DESC LIMIT 10 BY s", conn),
  ]);
  const metaRows = groupByStudy(meta.data);
  const metaOf = new Map(studies.map((st) => [st, new Map((metaRows.get(st) || []).map((r) => [r.a, r]))]));
  // the value lists read each study's categorical attributes, so they wait for the classification
  const catKeys = new Set<string>();
  for (const r of cls.data) if (!isNumericAttr(r, metaOf.get(String(r.s))!)) catKeys.add(r.s + "|" + r.type + "|" + r.a);
  const catNames = [...new Set(cls.data.filter((r) => catKeys.has(r.s + "|" + r.type + "|" + r.a)).map((r) => String(r.a)))];
  const values = [...(await valueCounts({ studies, db, conn, attrs: catNames, set })).values()].flat()
    .filter((r) => catKeys.has(r.s + "|" + r.type + "|" + r.a));
  const disj = await Promise.all((opts.disjunctive || []).map(async (d) =>
    [d.key, await valueCounts({ studies, db, conn, attrs: [d.attr], per: d.per, set: d.set })] as const));
  const [tot, cl, vals, ev, dt, li] = [totals.data, cls.data, values, events.data, dataTypes.data, lists.data].map(groupByStudy);
  return new Map(studies.map((st) => [st, {
    totals: tot.get(st)?.[0] || { pts: "0", smp: "0" },
    meta: metaRows.get(st) || [], cls: cl.get(st) || [], catValues: vals.get(st) || [],
    events: ev.get(st) || [], dataTypes: dt.get(st) || [], lists: li.get(st) || [],
    // every study gets each key, empty where it has no such values, as its own query would give
    ...(disj.length ? { disjunctive: new Map(disj.map(([k, m]) => [k, m.get(st) || []])) } : {}),
  }]));
}


/**
 * The value lists of `attrs` for these studies, by study: each value folded (Female / FEMALE are
 * one row, counted with uniqExact at the folded level, so a patient with one sample spelled each
 * way counts once) under its most frequent spelling, counted in its own unit, the
 * FACET_VALUE_LIMIT most frequent per (study, type, attribute). `per` fixes the type. Serves every
 * value list: the facets', and a drafted attribute's counted without its own clauses.
 */
async function valueCounts(o: { studies: string[]; db: string; conn: ChConn; attrs: string[]; per?: string; set: string }): Promise<Map<string, ChRow[]>> {
  if (!o.attrs.length) return new Map();
  return groupByStudy((await chQuery<ChRow>(
    "SELECT cancer_study_identifier AS s, type, attribute_name AS a,\n" +
    "       topK(1)(attribute_value)[1] AS v,\n" +
    "       " + clinicalValueFoldSql("attribute_value") + " AS vkey,\n" +
    "       uniqExact(if(type = 'sample', sample_unique_id, patient_unique_id)) AS n\n" +
    "FROM " + clinicalTable(o.db, o.attrs) + "\n" +
    "WHERE " + studyIn(o.studies) + " AND attribute_value != ''\n" +
    "  AND attribute_name IN (" + o.attrs.map(sq).join(",") + ")" + (o.per ? " AND type = " + sq(o.per) : "") + inPatients(o.set) + "\n" +
    "GROUP BY s, type, a, vkey ORDER BY n DESC LIMIT " + FACET_VALUE_LIMIT + " BY s, type, a", o.conn)).data);
}

/**
 * A connection's studies' resolved cohorts as one uploaded table of study-qualified ids, and the
 * subquery that reads it — plus, for a study whose cohort was past the external-table bound, its
 * compiled definition beside it. "" with no draft.
 */
function pooledCohortSet(g: ConnGroup, resolved: Map<string, { pids?: string[] }>, draft: CohortDef | null | undefined, ctx: DefCtx): string {
  if (!draft || !Array.isArray(draft.all) || !draft.all.length) return "";
  const uploaded = g.studies.filter((s) => resolved.get(s)?.pids);
  const table = "_cohorts_" + (g.conn.id + "_" + g.conn.db).replace(/[^A-Za-z0-9_]/g, "_");
  const data = uploaded.flatMap((s) => resolved.get(s)!.pids!.map((p) => s + "_" + p)).join("\n");
  if (!uploaded.length || !registerChExternal({ name: table, structure: "uid String", data: data ? data + "\n" : "" }))
    return patientSet(g.studies, g.conn.db, draft, ctx);
  const rest = g.studies.filter((s) => !resolved.get(s)?.pids);
  return "(SELECT uid FROM " + table + (rest.length ? "\n    UNION ALL " + patientSet(rest, g.conn.db, draft, ctx).slice(1, -1) : "") + ")";
}


/**
 * Pass-2 histograms for every study on one connection in one query per facet: the edges are
 * shared (that is what pass 2 is for) and ids are study-qualified, so a pooled count per bin is
 * exactly the sum of the per-study counts. The outlier bars ride in the same scan as bins -1/-2.
 */
async function pooledHistograms(opts: {
  facets: Extract<ClinicalFacet, { kind: "num" }>[]; studies: string[]; db: string; conn: ChConn; cond: string;
  edgesByAttr: Record<string, { edges: number[]; interval: number }>;
}): Promise<Map<string, { bins: Map<number, number>; counted: number }>> {
  const { facets, studies, db, conn, cond, edgesByAttr } = opts;
  const out = new Map<string, { bins: Map<number, number>; counted: number }>();
  await Promise.all(facets.map(async (f) => {
    const { edges, interval } = edgesByAttr[f.attribute];
    if (edges.length < 2) return;
    const lastEdge = edges[edges.length - 1] + interval;
    const unit = f.per === "sample" ? "sample_unique_id" : "patient_unique_id";
    const r = await chQuery<ChRow>(
      "SELECT multiIf(v <= " + edges[0] + ", -1, v > " + lastEdge + ", -2, toInt32(ceil((v - " + edges[0] + ") / " + interval + ")) - 1) AS b,\n" +
      "       uniqExact(id) AS n\n" +
      "FROM (SELECT " + finiteSql("attribute_value") + " AS v, " + unit + " AS id\n" +
      "      FROM " + clinicalTable(db, [f.attribute]) + "\n" +
      "      WHERE cancer_study_identifier IN (" + studies.map(sq).join(",") + ") AND attribute_name = " + sq(f.attribute) +
      "        AND type = " + sq(f.per) + " AND attribute_value != ''" + cond + ")\n" +
      "WHERE v IS NOT NULL\nGROUP BY b", conn);
    const bins = new Map<number, number>(r.data.map((x) => [Number(x.b), Number(x.n)]));
    out.set(f.per + "|" + f.attribute, { bins, counted: r.data.reduce((n, x) => n + Number(x.n), 0) });
  }));
  return out;
}


/**
 * One set of bin edges per numeric attribute, from the pooled statistics.
 * min/max pool exactly; quartiles do not decompose, so they are approximated by
 * a size-weighted mean — the same approximation already used for the median,
 * and it only shifts where the outlier bars fall, never a count.
 */
function sharedBinEdges(parts: ExploreResult[]): Record<string, { edges: number[]; interval: number }> {
  const byAttr = new Map<string, NonNullable<ExploreResult["numStats"]>>();
  for (const p of parts) for (const st of p.numStats || []) {
    if (!byAttr.has(st.attribute)) byAttr.set(st.attribute, []);
    byAttr.get(st.attribute)!.push(st);
  }
  const out: Record<string, { edges: number[]; interval: number }> = {};
  for (const [attr, list] of byAttr) {
    const n = list.reduce((a, x) => a + x.n, 0) || 1;
    const spec = numericBinEdges(
      Math.min(...list.map((x) => x.min)),
      Math.max(...list.map((x) => x.max)),
      list.reduce((a, x) => a + x.q1 * x.n, 0) / n,
      list.reduce((a, x) => a + x.q3 * x.n, 0) / n,
      list.every((x) => x.allInts)
    );
    if (spec.edges.length >= 2) out[attr] = spec;
  }
  return out;
}

/**
 * Merge faceted catalogs from several participants. Every input is already
 * aggregate, and the merge is pure arithmetic — which is exactly why it does
 * not matter whether a part was computed over a local connection or fetched
 * from a remote peer over MCP.
 */
export function mergeExplore(parts: ExploreResult[], hasDraft?: boolean): ExploreResult {
  const t0 = Date.now();
  if (parts.length === 1) return parts[0];
  const draft = hasDraft ?? parts.some((p) => p.draftCount != null);
  const studies = parts.flatMap((p) => p.studies || [p.study]);

  const clin = new Map<string, ClinicalFacet[]>(); // per|attribute -> list of items
  for (const p of parts) for (const a of p.clinical) {
    const k = a.per + "|" + a.attribute;
    if (!clin.has(k)) clin.set(k, []);
    clin.get(k)!.push(a);
  }
  const clinical: ClinicalFacet[] = [...clin.values()].map((items): ClinicalFacet => {
    const kind = items.slice().sort((x, y) => y.patients - x.patients)[0].kind;
    const same = items.filter((i) => i.kind === kind);
    const nums = same.filter((i): i is Extract<ClinicalFacet, { kind: "num" }> => i.kind === "num");
    const cats = same.filter((i): i is Extract<ClinicalFacet, { kind: "cat" }> => i.kind === "cat");
    const patients = same.reduce((s: number, i) => s + i.patients, 0);
    const withMeta = same.find((i) => i.displayName || i.priority != null) || same[0];
    const base = {
      attribute: same[0].attribute, per: same[0].per, patients,
      displayName: withMeta.displayName, description: withMeta.description,
      priority: withMeta.priority, distinct: Math.max(...same.map((i) => i.distinct ?? 0)) || undefined,
      // How many of the participating studies carry this attribute at all. A
      // union across studies reached 1,634 facets, in which the handful every
      // study shares are indistinguishable from one study's private vocabulary.
      studyCount: same.length
    };
    if (kind === "num") {
      return { ...base, kind: "num" as const,
        min: Math.min(...nums.map((i) => i.min)), max: Math.max(...nums.map((i) => i.max)),
        median: Math.round(10 * nums.reduce((s: number, i) => s + i.median * i.patients, 0) / patients) / 10 };
    }
    const vals = new Map<string, number>();
    for (const i of cats) for (const v of i.values) vals.set(v.v, (vals.get(v.v) || 0) + v.n);
    // preserve the disjunctive marker: if any participant re-queried this
    // attribute without its own clauses, the merged totals are on that basis
    const disjunctive = cats.some((i) => i.disjunctive) || undefined;
    return { ...base, kind: "cat" as const, ...(disjunctive ? { disjunctive } : {}),
      values: [...vals.entries()].map(([v, n]) => ({ v, n })).sort((x, y) => y.n - x.n || x.v.localeCompare(y.v)).slice(0, FACET_VALUE_LIMIT) };
  }).sort((x, y) => {
    const pd = (y.priority ?? 0) - (x.priority ?? 0);
    return pd || y.patients - x.patients || x.attribute.localeCompare(y.attribute);
  });

  const sumBy = (arrs: any[][], key: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of arrs.flat()) m.set(r[key], (m.get(r[key]) || 0) + r.n);
    return m;
  };
  // derived facets merge by summing bucket counts — the metric means the same
  // thing in every study, which is the point of deriving it from shape.
  // Keyed by (metric, eventType) rather than iterated from the
  // DERIVED_SPECS list: "lines"/"treatmentSpan" name a caller-chosen event
  // type, so their full spec (label, cuts, ...) isn't known ahead of time —
  // it's read from whichever participant actually computed one instead, and a
  // remote peer that doesn't yet support the request simply contributes none.
  const derivedMerged: DerivedFacet[] = [];
  const derivedKeys = new Set<string>();
  for (const p of parts) for (const d of (p.derived || [])) derivedKeys.add(d.metric + "|" + (d.eventType || ""));
  for (const key of derivedKeys) {
    const sep = key.indexOf("|");
    const metric = key.slice(0, sep), eventType = key.slice(sep + 1);
    const mine = parts.map((p) => (p.derived || []).find((d) => d.metric === metric && (d.eventType || "") === eventType))
      .filter((d): d is DerivedFacet => !!d);
    if (!mine.length) continue;
    const first = mine[0];
    const counts = new Map<string, number>();
    for (const d of mine) for (const b of d.buckets) counts.set(b.label, (counts.get(b.label) || 0) + b.n);
    // The bucket SHAPE (label + edges, in order) is the same across every
    // participant asked for the same spec — take it from whichever one has
    // the most buckets, so a participant that dropped an empty one doesn't
    // truncate the merged shape.
    const shape = mine.slice().sort((a, b) => b.buckets.length - a.buckets.length)[0].buckets;
    const buckets = shape.map((c) => ({ label: c.label, n: counts.get(c.label) || 0,
      ...(c.gte != null ? { gte: c.gte } : {}), ...(c.lt != null ? { lt: c.lt } : {}) })).filter((b) => b.n > 0);
    // Carry the disjunctive marker through the merge, as the clinical facets do:
    // if any participant counted this metric without its own clauses, the merged
    // total is on that basis and the UI has to say so.
    const disjunctive = mine.some((d) => d.disjunctive) || undefined;
    if (buckets.length) derivedMerged.push({ metric: first.metric, label: first.label, unit: first.unit, note: first.note,
      covered: mine.reduce((n, d) => n + d.covered, 0), buckets, ...(disjunctive ? { disjunctive } : {}),
      ...(first.eventType ? { eventType: first.eventType } : {}), ...(first.lineGap != null ? { lineGap: first.lineGap } : {}) });
  }

  const evm = sumBy(parts.map(p => p.events), "type");
  // gene tables: sum altered/events/profiled per (gene, cna) across participants
  const mergeGeneTable = (pick: (p: ExploreResult) => GeneTableRow[] | undefined): GeneTableRow[] => {
    const m = new Map<string, GeneTableRow>();
    for (const p of parts) for (const r of pick(p) || []) {
      const k = r.gene + "|" + (r.cna ?? "");
      const cur = m.get(k);
      if (!cur) { m.set(k, { ...r, alteredOnPanel: r.alteredOnPanel ?? r.altered }); continue; }
      cur.altered += r.altered; cur.events += r.events; cur.profiled += r.profiled;
      cur.alteredOnPanel = (cur.alteredOnPanel ?? 0) + (r.alteredOnPanel ?? r.altered);
      cur.cytoband = cur.cytoband || r.cytoband;
    }
    return [...m.values()]
      .map((r) => ({ ...r, freqPct: r.profiled ? Math.round(1000 * (r.alteredOnPanel ?? r.altered) / r.profiled) / 10 : null }))
      .sort((a, b) => b.altered - a.altered)
      .slice(0, GENE_TABLE_LIMIT);
  };

  // Per-gene facets sum: total, profiled and every state are patient counts over
  // disjoint studies, so the same additivity that lets the gene tables pool
  // applies here. Patients shared between studies are not deduplicated, which is
  // this project's stated policy for every count on this page.
  const gfKey = (f: { gene: string; type: string }) => f.gene + "|" + f.type;
  const gfMap = new Map<string, GeneStateFacet>();
  for (const p of parts) for (const f of p.geneFacets || []) {
    const cur = gfMap.get(gfKey(f));
    if (!cur) { gfMap.set(gfKey(f), { ...f, states: f.states.map((x) => ({ ...x })) }); continue; }
    cur.total += f.total; cur.profiled += f.profiled;
    for (const st of f.states) {
      const c = cur.states.find((x) => x.state === st.state);
      if (c) c.n += st.n; else cur.states.push({ ...st });
    }
  }

  const lm = new Map<string, { id: string; name: string; n: number }>();
  for (const p of parts) for (const l of p.caseLists) {
    const cur = lm.get(l.id) || { id: l.id, name: l.name, n: 0 };
    cur.n += l.n; lm.set(l.id, cur);
  }
  return {
    study: studies.join(" + "),
    studies,
    draftCount: draft ? parts.reduce((s, p) => s + (p.draftCount || 0), 0) : null,
    studyBreakdown: parts.flatMap((p) => p.studyBreakdown || []).sort((a, b) => b.n - a.n),
    clinical,
    ...(derivedMerged.length ? { derived: derivedMerged } : {}),
    events: [...evm.entries()].map(([type, n]) => ({ type, n })).sort((x, y) => y.n - x.n),
    caseLists: [...lm.values()].sort((x, y) => y.n - x.n).slice(0, 10),
    geneFacets: [...gfMap.values()],
    mutatedGenes: mergeGeneTable((p) => p.mutatedGenes),
    cnaGenes: mergeGeneTable((p) => p.cnaGenes),
    svGenes: mergeGeneTable((p) => p.svGenes),
    geneTotals: {
      mutated: Math.max(...parts.map((p) => p.geneTotals?.mutated || 0)),
      cna: Math.max(...parts.map((p) => p.geneTotals?.cna || 0)),
      sv: Math.max(...parts.map((p) => p.geneTotals?.sv || 0))
    },
    totals: {
      patients: parts.reduce((n, p) => n + (p.totals?.patients || 0), 0),
      samples: parts.reduce((n, p) => n + (p.totals?.samples || 0), 0)
    },
    dataTypes: (() => {
      const m = new Map<string, { profile: string; label: string; alterationType: string; n: number }>();
      for (const p of parts) for (const d of p.dataTypes || []) {
        const cur = m.get(d.profile);
        if (cur) cur.n += d.n; else m.set(d.profile, { ...d });
      }
      return [...m.values()].sort((a, b) => b.n - a.n);
    })(),
    profiles: [...new Set(parts.flatMap((p) => p.profiles))],
    gaProfiles: [...new Set(parts.flatMap((p) => p.gaProfiles))],
    // Keyed by each part's OWN study rather than by position: `studies` above is
    // flat-mapped, so any part that is not exactly one study — a pooled
    // gene-only participant, or an already-merged result — slid every
    // subsequent key one place along.
    stats: { ms: Date.now() - t0, perStudy: Object.fromEntries(parts.filter((p) => p.study).map((p) => [p.study, p.draftCount])) }
  };
}
