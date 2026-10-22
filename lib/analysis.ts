// Analysis-document engine: evaluate named cohorts (DSL v2) and produce view results.
// Document: { study: "<default>", cohorts: {name: def}, views: [{kind, ...}] }
// A cohort may override with "study" or "studies": [...] — it is evaluated per study
// (compilers stay single-study) and its size is the SUM of per-study counts. No
// patient identifier is fetched here: views ask each study for aggregates, and the
// oncoprint — the one view whose output is patients — carries the cohort SQL and
// re-derives its columns inside the owning database.
// Deliberately deferred: cross-study patient dedup and attribute harmonization.
import { applyLocks, lockDate, lockSamples } from "./cohort-lock.ts";
import { chQuery, STUDY, PRIMARY, type ChConn } from "./ch.ts";
import { sq } from "./compiler.ts";
import type { ProfileInfo } from "./profile-catalog.ts";
import { describeCohortDef } from "./cohort2.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, PartitionDef, ViewResult, ViewParticipation, TemplateDoc, SplitBy, LockDrift } from "./types.ts";
import { resolveSplitBy, type AttributeDistribution } from "./cohort-splitby.ts";
import { resolverFor, PatientLevelResolver, AggregateResolver, studyRouting, restrictedStudies, studyAccess, type Resolver } from "./federation.ts";
import { cantDraw } from "./view-coverage.ts";
import { describeSources, sourceIndex } from "./provenance.ts";
import { resolveParams } from "./params.ts";
import { resolveExtends } from "./cohort-extends.ts";
import { resolvePartitions, comparableChildren, assertPartitionChildrenFit } from "./cohort-partitions.ts";
import { partitionFromValues, partitionFromGene, partitionFromOql, uniqueName, expandSplits, viewDrawProblem, flattenSplits, withoutSplitTrees, splitKey } from "./partition-arms.ts";
import { upgradeDocument } from "./doc-version.ts";
import { resolveCohortPercentiles } from "./cohort-percentile.ts";
import { ATTR_NAME_RE, assertCustomDataPresent } from "./custom-data.ts";
import { viewRunner } from "./views/index.ts";
import { Untimed, type ViewRun, type RiskFitter } from "./views/run.ts";
import { overLimit } from "./views/shared.ts";

async function oncokbPin(): Promise<string | null> {
  try {
    const r = await chQuery(
      "SELECT oncokb_version FROM oncokb_annotation.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1");
    return r.data[0]?.oncokb_version || null;
  } catch { return null; }
}

const _profileCache = new Map<string, StudyProfiles>(); // per-study
export interface StudyProfiles {
  profiles: string[]; gaProfiles: string[];
  /** every profile as the study describes it (genetic_profile), for what a plot axis may read */
  catalog: ProfileInfo[];
}
/**
 * Each study's profiles, many studies at once (studyProfiles is the list of one), rather than three
 * queries per study one after another —
 * Explore over all 551 studies spent ~30s on that before its first query; this takes ~6s. The two
 * genetic_profile queries run once per connection over every study not yet cached (30-60ms). The
 * profile types stay one query per study, in parallel: genetic_alteration_derived is read by its
 * study key that way, and one pooled DISTINCT over it measured 72s at 551 studies against 5.6s.
 * Fills the same cache studyProfiles reads.
 */
export async function studyProfilesMany(studies: string[]): Promise<Map<string, StudyProfiles>> {
  const { peerForStudy } = await import("./federation-remote.ts");
  const routing = await studyRouting();
  const todo = studies.filter((s) => !_profileCache.has(s));
  const peers = await Promise.all(todo.map((s) => peerForStudy(s)));
  const groups = new Map<string, { conn: ChConn; studies: string[] }>();
  todo.forEach((s, i) => {
    if (peers[i]) { _profileCache.set(s, { profiles: [], gaProfiles: [], catalog: [] }); return; } // the peer owns its own profile inventory
    const conn = routing.get(s) || PRIMARY;
    const k = conn.id + "|" + conn.db;
    if (!groups.has(k)) groups.set(k, { conn, studies: [] });
    groups.get(k)!.studies.push(s);
  });
  await Promise.all([...groups.values()].map(async ({ conn, studies: ss }) => {
    const IN = "(" + ss.map(sq).join(",") + ")";
    const [types, ga, cat] = await Promise.all([
      Promise.all(ss.map(async (s) => (await chQuery(
        "SELECT DISTINCT profile_type FROM " + conn.db + ".genetic_alteration_derived WHERE cancer_study_identifier = " + sq(s), conn))
        .data.map((r) => ({ s, profile_type: r.profile_type })))).then((rows) => ({ data: rows.flat() })),
      // by the study's own id, not a prefix of the profile id, which also matches sibling studies
      chQuery("SELECT DISTINCT cs.cancer_study_identifier AS s, replaceOne(gp.stable_id, concat(cs.cancer_study_identifier, '_'), '') AS pt FROM " + conn.db + ".genetic_profile gp\n" +
        "JOIN " + conn.db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
        "WHERE cs.cancer_study_identifier IN " + IN + " AND gp.genetic_alteration_type = 'GENERIC_ASSAY'", conn),
      chQuery("SELECT cs.cancer_study_identifier AS s, replaceOne(gp.stable_id, concat(cs.cancer_study_identifier, '_'), '') AS profile, gp.genetic_alteration_type AS type, gp.datatype AS datatype,\n" +
        "       gp.name AS name, ifNull(toString(gp.generic_assay_type), '') AS assay, toInt32OrZero(ifNull(toString(gp.sort_order), '')) AS ord\n" +
        "FROM " + conn.db + ".genetic_profile gp\n" +
        "JOIN " + conn.db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
        "WHERE cs.cancer_study_identifier IN " + IN, conn),
    ]);
    const out = new Map<string, StudyProfiles>(ss.map((s) => [s, { profiles: [], gaProfiles: [], catalog: [] }]));
    for (const r of types.data) out.get(String(r.s))?.profiles.push(r.profile_type);
    for (const r of ga.data) out.get(String(r.s))?.gaProfiles.push(r.pt);
    for (const r of cat.data) out.get(String(r.s))?.catalog.push({
      profile: String(r.profile), type: String(r.type), datatype: String(r.datatype), name: String(r.name),
      ...(r.assay ? { assayType: String(r.assay) } : {}), order: Number(r.ord) || 0 });
    for (const [s, p] of out) _profileCache.set(s, p);
  }));
  return new Map(studies.map((s) => [s, _profileCache.get(s)!]));
}

export async function studyProfiles(study: string): Promise<StudyProfiles> {
  return (await studyProfilesMany([study])).get(study)!;
}

/**
 * Every study any configured instance holds (federation-aware).
 *
 * Deliberately NOT memoized here: `studyRouting()` already caches, and only when it got a
 * complete answer. A second cache on top of it could outlive a bad routing map — which is how
 * one cancelled request turned into a process that rejected every study as unknown until it was
 * restarted. Rebuilding the set is a few hundred map keys.
 */
export async function validStudies(): Promise<Set<string>> {
  return new Set((await studyRouting()).keys());
}

export async function resolveStudy(requested?: string | null, fallback?: string | null): Promise<string> {
  const study = String(requested || fallback || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
  const { peerForStudy } = await import("./federation-remote.ts");
  if (await peerForStudy(study)) return study; // held by a peer; only it can validate
  const set = await validStudies();
  if (!set.has(study)) {
    if (restrictedStudies.has(study))
      throw new Error("study '" + study.slice(0, 60) + "' is consortium/private-access and is excluded from this deployment");
    throw new Error("unknown study '" + study.slice(0, 60) + "'");
  }
  // the simulated peer (lib/loopback-peer.ts) holds its own connection's studies and no others
  const { servingAsLoopbackPeer, loopbackConnId } = await import("./loopback-peer.ts");
  if (servingAsLoopbackPeer() && (await studyRouting()).get(study)?.id !== loopbackConnId())
    throw new Error("unknown study '" + study.slice(0, 60) + "' (this peer holds only its own studies)");
  return study;
}

function cohortStudies(def: CohortDef | undefined, docStudy: string): string[] {
  if (def && Array.isArray(def.studies) && def.studies.length) return def.studies;
  if (def && def.study) return [def.study];
  return [docStudy];
}

/**
 * `oncoprint: "spec"` returns what to ask for instead of a rendered picture: the web app
 * fetches the binary contract itself and draws it, so the run does no oncoprint queries.
 * The default, "svg", is what MCP needs.
 */
export interface RunOpts {
  oncoprint?: "svg" | "spec";
  /** a paged view's page (app/api/view-page): rows offset to offset + limit of its one global order */
  page?: { offset: number; limit: number };
  /** a table view's column whose values to return instead of rows (what its filter offers) */
  values?: string;
  /** which of a view's tables `page` or `values` reads, for a view that holds several (the alterations view's "mutations", "cna", "sv") */
  table?: string;
  /**
   * How a local participant's cohort is counted, given its compiled SQL: the Next routes pass a
   * cached one (lib/next-cache.ts), so the per-view requests the page sends do not each count
   * every cohort again. A remote peer always answers for itself.
   */
  count?: (conn: ChConn, cohortSql: string) => Promise<number>;
  /**
   * How a risk model is fitted: the Next routes pass a cached one (lib/next-cache.ts), so a change
   * to a risk model's groups, which the fit does not depend on, refits nothing.
   */
  riskFit?: RiskFitter;
}

/**
 * A categorical attribute's value counts within a cohort, merged across every study the cohort
 * spans. Each study answers for its own patients (attributeStats is on AggregateCapable, so an
 * aggregate-only or remote participant answers too), and disagreeing declared types across
 * studies are refused, not silently merged, as the clinical view's cross-study comparison does.
 */
async function mergedDistribution(cohortName: string, def: CohortDef, studies: string[],
  resolverOf: (s: string) => Promise<Resolver>, attribute: string, opts?: { topValues?: number }): Promise<AttributeDistribution & { partial?: boolean }> {
  const perStudyStats = await Promise.all(studies.map(async (s) => {
    const [stat] = await (await resolverOf(s)).attributeStats(def, [attribute], opts);
    return stat;
  }));
  const skipped = perStudyStats.find((s) => s?.skipped);
  if (skipped) return { kind: "cat", per: "patient", skipped: skipped!.skipped! };
  const kinds = new Set(perStudyStats.map((s) => s?.kind).filter((k) => k != null));
  if (kinds.size > 1)
    return { kind: "cat", per: "patient",
      skipped: "'" + attribute + "' is declared inconsistently (numeric in one study, categorical in another) across “" + cohortName + "”'s studies" };
  const kind = (perStudyStats[0]?.kind ?? "cat") as "cat" | "num";
  const per = (perStudyStats[0]?.per ?? "patient") as "patient" | "sample";
  if (kind === "num") return { kind, per };
  const merged = new Map<string, number>();
  for (const s of perStudyStats) for (const { v, n } of (s?.values || [])) merged.set(v, (merged.get(v) || 0) + n);
  const partial = perStudyStats.some((s) => s?.distinct != null && s.distinct > (s.values || []).length);
  return { kind: "cat", per, values: [...merged.entries()].map(([v, n]) => ({ v, n })), ...(partial ? { partial } : {}) };
}

/** The document's split tree, expanded into ordinary child cohorts (lib/cohort-partitions.ts);
 *  the cohorts handed on carry no `splits` of their own. */
function expandSplitTree(doc: AnalysisDoc) {
  const flat = flattenSplits(doc.cohorts || {});
  return resolvePartitions({ ...doc, cohorts: withoutSplitTrees(doc.cohorts || {}) }, flat);
}

/** how many of a categorical attribute's values a split proposal ranks, per study */
const PARTITION_TOP_VALUES = 100;

export interface PartitionProposalRequest {
  doc: AnalysisDoc | TemplateDoc;
  /** the cohort to split: a named cohort or a partition's child */
  cohort: string;
  attribute?: string; gene?: string; oql?: string[];
  maxArms?: number; minCount?: number;
  /** the partition's name; default "<cohort> by <attribute|gene>" */
  name?: string;
}

/**
 * A document's cohorts as runAnalysis evaluates them — parameters, splits, `extends` and
 * percentiles resolved — for a request about one of its cohorts outside a run (a split's arms, a
 * link to its cells). `paramsDoc` is the document with only its parameters resolved.
 */
export async function resolveDocCohorts(input: unknown): Promise<{ paramsDoc: AnalysisDoc; doc: AnalysisDoc; docStudy: string }> {
  const { doc: paramsDoc } = resolveParams(upgradeDocument(input as AnalysisDoc).doc);
  const { doc: partitionedDoc } = expandSplitTree(paramsDoc as AnalysisDoc);
  const extendsDoc = resolveExtends(applyLocks(partitionedDoc).doc);
  const docStudy = await resolveStudy(extendsDoc.study);
  const doc = await resolveCohortPercentiles(extendsDoc, docStudy, async (study, refDef, attribute, per, p) =>
    (await resolverFor(study, {})).attributeQuantile(refDef, attribute, per, p));
  return { paramsDoc: paramsDoc as AnalysisDoc, doc, docStudy };
}

/**
 * Write a partition's arms from the data, for an author to review and edit: one arm per frequent
 * value of a categorical attribute (the same rule as a view's splitBy), a median split of a
 * numeric one, a gene's mutated / wild-type, or one arm per OQL query. The returned definition
 * is explicit — arms and clauses, no "split by" left to resolve — so the document alone decides
 * what a reader sees, and re-running it later cannot quietly regroup patients.
 */
export async function proposePartition(req: PartitionProposalRequest): Promise<{ name: string; def: PartitionDef; note?: string }> {
  const { paramsDoc, doc, docStudy } = await resolveDocCohorts(req.doc);
  const cohort = String(req.cohort || "");
  const def = doc.cohorts?.[cohort];
  if (!def) throw new Error("no cohort “" + cohort + "” to split; have " + Object.keys(doc.cohorts || {}).join(", "));
  const modes = [req.attribute, req.gene, req.oql].filter((x) => x != null && x !== "").length;
  if (modes !== 1) throw new Error("name exactly one of attribute, gene or oql to split by");
  // a split is named on its cohort, so only that cohort's other splits (and the cohort names its
  // children would collide with) are taken
  const taken = Object.values(flattenSplits((paramsDoc as AnalysisDoc).cohorts || {})).filter((p) => p.of === cohort).map((p) => p.split);
  const free = (n: string) => !taken.includes(n) && !doc.cohorts?.[splitKey(cohort, n)];
  const nameFor = (what: string) => req.name && req.name.trim() ? req.name.trim()
    : uniqueName(what, [...taken, ...Object.keys(doc.cohorts || {}).filter((c) => c.startsWith(cohort + " / ")).map((c) => c.slice(cohort.length + 3))]);
  if (req.name && !free(req.name.trim())) throw new Error("“" + cohort + "” already has a split named “" + req.name.trim() + "”");
  if (req.gene) {
    const p = partitionFromGene(cohort, req.gene);
    const name = nameFor(p.source!.gene!);
    return { name, def: { ...p, split: name } };
  }
  if (req.oql) { const name = nameFor("OQL"); return { name, def: { ...partitionFromOql(cohort, req.oql), split: name } }; }

  const attribute = String(req.attribute).trim();
  if (!ATTR_NAME_RE.test(attribute)) throw new Error("'" + attribute + "' is not a valid attribute name");
  const studies: string[] = [];
  for (const s of cohortStudies(def, docStudy)) studies.push(await resolveStudy(s, docStudy));
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const resolverOf = async (s: string) => { const { profiles, gaProfiles } = await studyProfiles(s); return resolverFor(s, { oncokbPin: pin, profiles, gaProfiles }); };
  // Only the most frequent values can earn an arm, so a long tail is not a reason to refuse. The
  // ranking decides which values get arms; every arm's count comes from evaluating its clause.
  const dist = await mergedDistribution(cohort, def, studies, resolverOf, attribute, { topValues: PARTITION_TOP_VALUES });
  if (dist.skipped) throw new Error("cannot split by '" + attribute + "': " + dist.skipped);
  if (dist.kind === "num") {
    // A median split relative to the cohort being split, through a percentile leaf: the engine
    // resolves the cutoff live from this cohort's own patients.
    if (studies.length > 1) throw new Error("'" + attribute + "' is numeric, and a median split needs a cohort in a single study (“" + cohort + "” spans " + studies.length + ")");
    const name = nameFor(attribute);
    return { name, note: "split at the median of " + attribute + " within “" + cohort + "”",
      def: { of: cohort, split: name, arms: [{ name: attribute + " below median", where: { kind: "clinical", attribute, ...(dist.per === "sample" ? { per: "sample" as const } : {}), op: "<", percentile: 0.5, percentileOf: cohort } }],
        other: attribute + " at or above median", source: { attribute, median: true } } };
  }
  const { def: p, pooled } = partitionFromValues(cohort, attribute, dist.per, dist.values || [], { maxArms: req.maxArms, minCount: req.minCount });
  if (dist.partial && p.source) p.source.otherValuesTruncated = true;
  const name = nameFor(attribute);
  return { name, def: { ...p, split: name },
    ...(pooled.length ? { note: (dist.partial ? "Values" : pooled.length + " value" + (pooled.length === 1 ? "" : "s")) +
      " with fewer patients go to Other: " + pooled.slice(0, 12).join(", ") + (pooled.length > 12 || dist.partial ? ", …" : "") } : {}) };
}

export async function runAnalysis(template: AnalysisDoc | TemplateDoc, opts: RunOpts = {}): Promise<AnalysisResult> {
  const t0 = Date.now();
  // Parameters are resolved FIRST, so everything downstream — compilers,
  // validators, provenance — sees an ordinary document and cannot tell a
  // template from one written out by hand. `extends` is resolved right after,
  // for the same reason: by the time anything else looks at doc.cohorts, every
  // cohort's `all` is already the full, flattened list. Partitions expand into child cohorts
  // that `extends` their parent, so they resolve just before it.
  // A document written in an older version is brought up to date before anything reads it, and
  // the result says so; one written for a newer version is refused (lib/doc-version.ts).
  const { doc: currentDoc, upgrade } = upgradeDocument(template);
  const { doc: paramsDoc, params: usedParams, unused: unusedParams } = resolveParams(currentDoc);
  const authoredNames = Object.keys(paramsDoc.cohorts || {});
  const { doc: partitionedDoc, plans: partitionPlans } = expandSplitTree(paramsDoc);
  // a locked cohort (and each locked arm) is its frozen set from here on; its definition is kept
  // aside, run beside it to say how far the data has moved (lib/cohort-lock.ts)
  const { doc: lockedDoc, live: liveDoc, locked } = applyLocks(partitionedDoc);
  const extendsDoc = resolveExtends(lockedDoc);
  assertPartitionChildrenFit(extendsDoc.cohorts, partitionPlans);
  assertCustomDataPresent(extendsDoc);
  const docStudy = await resolveStudy(extendsDoc.study);
  // A percentile leaf needs a real query (a percentile is a fact about the data, not the
  // document's own JSON), so this runs after extends/params but before anything compiles a
  // cohort — by the time compileCohortDef sees a leaf, `percentile` has already become an
  // ordinary `value`.
  const doc = await resolveCohortPercentiles(extendsDoc, docStudy, async (study, refDef, attribute, per, p) => {
    const res = await resolverFor(study, {});
    return res.attributeQuantile(refDef, attribute, per, p);
  });
  const live = Object.keys(locked).length
    ? await resolveCohortPercentiles(resolveExtends(liveDoc), docStudy, async (study, refDef, attribute, per, p) =>
      (await resolverFor(study, {})).attributeQuantile(refDef, attribute, per, p))
    : null;
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const names = Object.keys(doc.cohorts || {});
  if (!names.length) throw new Error("document has no cohorts");
  // 16, not 6: a real multi-arm workup (e.g. splitting one population by a categorical
  // attribute with several levels, crossed with a base filter) routinely needs a dozen-plus
  // named cohorts, and 6 forced one such analysis into four separate documents. Views stay
  // at 6 — each one issues its own set of queries per cohort, so raising cohorts already
  // multiplies real query cost without also multiplying the view count.
  { const e = overLimit("an analysis document", 16, authoredNames.length); if (e) throw new Error(e.replace("at most 16", "at most 16 cohorts")); }
  // Partition children are counted separately: one split of a 16-cohort document can add a
  // dozen children, and each costs one count per study, not a view's worth of queries.
  { const e = overLimit("an analysis document", 48, names.length); if (e) throw new Error(e.replace("at most 48", "at most 48 cohorts including partition children")); }
  { const e = overLimit("an analysis document", 6, (doc.views || []).length); if (e) throw new Error(e.replace("at most 6", "at most 6 views")); }

  // ---- evaluate cohorts: per study, sum the counts ------------------------
  type EvaledCohort = { studies: string[]; perStudy: Record<string, { sql: string; count: number; mode: string }>; count: number; text: string };
  const cohorts: Record<string, EvaledCohort> = {};
  const resolvers: Record<string, Resolver> = {}; // study -> its instance's resolver
  // Extracted so a splitBy arm (a synthetic cohort, never in `doc.cohorts`/`names`) can be
  // evaluated the exact same way as a named one — same studies/perStudy/count/text shape, same
  // provenance — without duplicating this block.
  const evalCohortDef = async (def: CohortDef): Promise<EvaledCohort> => {
    const studies = [];
    for (const s of cohortStudies(def, docStudy)) studies.push(await resolveStudy(s, docStudy));
    const perStudy: Record<string, { sql: string; count: number; mode: string }> = {};
    // Every instance is asked for a COUNT, including the patient-level ones.
    // Cohort evaluation has no use for identities: the size is a count, and the
    // oncoprint — the only view whose output is patients — carries the cohort SQL
    // (PIDS_SQL) and re-derives membership inside the owning database. So no
    // identifier crosses an instance boundary here for any analysis.
    const evals = await Promise.all(studies.map(async (s) => {
      const { profiles, gaProfiles } = await studyProfiles(s);
      const res = await resolverFor(s, { oncokbPin: pin, profiles, gaProfiles });
      resolvers[s] = res;
      // count() first: a remote peer only learns its own SQL by answering, and
      // cohortSql() reads what it reported.
      const local = res instanceof PatientLevelResolver || res instanceof AggregateResolver;
      const count = local && opts.count ? await opts.count(res.instance.conn, res.cohortSql(def)) : await res.count(def);
      return { s, res, sql: res.cohortSql(def), count };
    }));
    for (const { s, res, sql, count } of evals) {
      perStudy[s] = { sql, count, mode: res.instance.mode };
    }
    return {
      studies, perStudy,
      count: Object.values(perStudy).reduce((n, x) => n + x.count, 0),
      text: describeCohortDef(def) +
        (studies.length > 1 ? " — across " + studies.length + " studies" :
         studies[0] !== docStudy ? " — in " + studies[0] : "")
    };
  };
  for (const name of names) cohorts[name] = await evalCohortDef(doc.cohorts[name]);
  // A locked cohort answers from its frozen patients; its definition is run beside them, so the
  // reader is told how far the data has moved since, never left to notice.
  const drift: Record<string, LockDrift> = {};
  for (const [name, l] of Object.entries(locked)) {
    if (!cohorts[name] || !live) continue;
    const liveDef = live.cohorts[name];
    const d: LockDrift = { cohort: l.cohort, at: l.lock.at, ...(l.lock.dataVersion ? { dataVersion: l.lock.dataVersion } : {}),
      n: l.members.n, present: 0, now: 0, entered: 0, left: 0, newSamples: lockSamples(l.members) ? 0 : null };
    try {
      for (const s of cohorts[name].studies) {
        const res = resolvers[s];
        if (!(res instanceof PatientLevelResolver)) throw new Error(s + " is not held at patient level here");
        const r = await res.lockDrift(doc.cohorts[name], liveDef, lockSamples(l.members));
        d.present += r.present; d.now += r.now; d.entered += r.entered; d.left += r.left;
        if (d.newSamples != null) d.newSamples = r.newSamples == null ? null : d.newSamples + r.newSamples;
      }
    } catch (e) { d.error = "how far the data has moved could not be measured: " + ((e as Error)?.message || e); }
    drift[name] = d;
    const studies = cohorts[name].studies;
    cohorts[name].text = "locked " + lockDate(l.lock.at) + ": " + l.members.n.toLocaleString("en-US") + " patient" + (l.members.n === 1 ? "" : "s") +
      " who were " + describeCohortDef(liveDef) +
      (studies.length > 1 ? " — across " + studies.length + " studies" : studies[0] !== docStudy ? " — in " + studies[0] : "");
  }
  // The children of a partition are disjoint and cover the parent by construction; counting
  // them is the check that the construction held, so a mismatch is reported, never hidden.
  const partitionResults: NonNullable<AnalysisResult["splits"]> = {};
  for (const plan of partitionPlans) {
    const children = plan.children.map((c) => ({ name: c.name, label: c.label, role: c.role, count: cohorts[c.name].count }));
    const sum = children.reduce((n, c) => n + c.count, 0);
    const parentCount = cohorts[plan.of].count;
    partitionResults[plan.name] = { of: plan.of, split: plan.split, parentCount, children, sum, conserved: sum === parentCount, unchecked: plan.unchecked };
  }
  const partitionShapes = partitionPlans.map((p) => ({ name: p.name, of: p.of, comparable: comparableChildren(p) }));
  const generatedNames = new Set(partitionPlans.flatMap((p) => p.children.map((c) => c.name)));
  const involved = [...new Set(Object.values(cohorts).flatMap((c) => c.studies))];

  // ---- views --------------------------------------------------------------
  // Every view records which studies answered it and in what mode, so a reader
  // never has to infer from prose whether patient-level data was involved.
  // each names its source in the result's `sources` (lib/provenance.ts)
  const sourceOf = sourceIndex(involved, resolvers);
  const participationFor = (studies: string[], requiresPatientLevel: boolean): ViewParticipation => {
    const per = studies.map((s) => {
      const inst = resolvers[s] ? resolvers[s].instance : null;
      const source = sourceOf.get(s);
      return {
        study: s,
        mode: (inst ? inst.mode : "patient-level") as "patient-level" | "aggregate-only",
        instance: inst ? inst.label : "unknown",
        ...(inst && inst.id === "peer" ? { remote: true } : {}),
        ...(source != null ? { source } : {})
      };
    });
    return { studies: per, requiresPatientLevel, aggregateOnly: per.filter((x) => x.mode === "aggregate-only").map((x) => x.study) };
  };

  // Provenance for the numbers, not just for the cohort: every resolver logs the
  // aggregate SQL it runs, so each view can report exactly the queries that
  // produced it — including, across the boundary, the ones a peer ran for us.
  const queryMark = (): Record<string, number> =>
    Object.fromEntries(Object.entries(resolvers).map(([s, r]) => [s, r.queries.length]));
  const queriesSince = (mark: Record<string, number>) => {
    const out: { study: string; label: string; sql: string; ms?: number; remote?: boolean }[] = [];
    for (const [s, r] of Object.entries(resolvers))
      for (const q of r.queries.slice(mark[s] ?? 0))
        out.push({ study: s, label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}), ...(q.remote ? { remote: true } : {}) });
    return out;
  };

  const views: ViewResult[] = [];
  const splitByForView: Record<number, NonNullable<ViewResult["splitBy"]>> = {};
  for (let vi = 0; vi < (doc.views || []).length; vi++) {
    const view = (doc.views || [])[vi];
    let vNames: string[];
    const sb = (view as { splitBy?: SplitBy }).splitBy;
    if (sb) {
      const baseName = sb.cohort;
      if (!cohorts[baseName]) {
        views.push({ kind: view.kind, error: "splitBy names cohort “" + baseName + "”, which doesn't exist" });
        continue;
      }
      const baseDef = doc.cohorts[baseName];
      const distributionFor = (attribute: string) =>
        mergedDistribution(baseName, baseDef, cohorts[baseName].studies, async (st) => resolvers[st], attribute);
      try {
        const resolved = await resolveSplitBy(sb, names, baseDef, distributionFor);
        // Every view runner (lib/views/) reads its cohort's DEFINITION via
        // doc.cohorts[n] directly (never through the `cohorts` evaluation-result map, which only
        // holds studies/count/text/sql) — so an arm invisible to doc.cohorts would be invisible
        // to every query too, silently falling back to no filter at all. Writing it here, into
        // this run's own already-resolved `doc` (never the caller's original document — see
        // resolveCohortPercentiles above), makes every runner see it for free with no changes to
        // any of them, while `names`/`result.cohorts` (captured before this point) still don't.
        for (const arm of resolved.arms) { doc.cohorts[arm.name] = arm.def; cohorts[arm.name] = await evalCohortDef(arm.def); }
        // oql mode always includes an "Other" arm (unlike attribute mode, whether it's needed
        // can't be known ahead of a live count) — drop it here if it turns out empty, rather
        // than showing an always-empty bucket.
        let keptArms = resolved.arms;
        if (resolved.otherArmName && cohorts[resolved.otherArmName].count === 0) {
          keptArms = resolved.arms.filter((a) => a.name !== resolved.otherArmName);
          delete cohorts[resolved.otherArmName];
          delete doc.cohorts[resolved.otherArmName];
        }
        vNames = keptArms.map((a) => a.name);
        // Arms are not forced into a partition (a patient can match more than one), so disclose
        // by how much they overlap rather than leaving a reader to notice the arm counts don't
        // sum to the base cohort on their own. Never counts "Other" itself, which is disjoint
        // from the named arms by construction.
        let overlapCount: number | undefined;
        if (resolved.overlapCheckDef) {
          const namedArms = keptArms.filter((a) => a.name !== resolved.otherArmName);
          const sumCount = namedArms.reduce((n, a) => n + cohorts[a.name].count, 0);
          const overlapEval = await evalCohortDef(resolved.overlapCheckDef);
          overlapCount = sumCount - overlapEval.count;
        }
        splitByForView[vi] = {
          ...(resolved.gene ? { gene: resolved.gene } : resolved.oql ? { oql: resolved.oql } : { attribute: resolved.attribute }),
          cohort: baseName,
          arms: keptArms.map((a) => ({
            name: a.name, count: cohorts[a.name].count, text: cohorts[a.name].text,
            sql: Object.entries(cohorts[a.name].perStudy).map(([s, x]) => "-- " + s + "\n" + x.sql).join("\n\n")
          })),
          ...(resolved.otherValues.length ? { otherValues: resolved.otherValues } : {}),
          ...(overlapCount ? { overlapCount } : {})
        };
      } catch (e) {
        views.push({ kind: view.kind, error: (e as Error).message });
        continue;
      }
    } else {
      // A view draws the cohorts it names, whole; a split's name in the list stands for its arms
      // (expandSplits). One that names none is empty, which is a refusal, not "all of them".
      const listed = Array.isArray(view.cohorts) ? view.cohorts : [];
      if (!listed.length) {
        views.push({ kind: view.kind, error: "this view names no cohorts — list the ones it draws in its `cohorts` (this document has " +
          names.filter((n) => !generatedNames.has(n)).map((n) => "“" + n + "”").join(", ") + ")" });
        continue;
      }
      const unknown = listed.filter((n) => !cohorts[n] && !partitionShapes.some((p) => p.name === n));
      if (unknown.length) {
        views.push({ kind: view.kind, error: "this view names " + unknown.map((n) => "“" + n + "”").join(", ") +
          ", which " + (unknown.length === 1 ? "is not a cohort" : "are not cohorts") + " in this document" });
        continue;
      }
      const problem = viewDrawProblem(listed, partitionShapes);
      if (problem) { views.push({ kind: view.kind, error: problem }); continue; }
      vNames = expandSplits(listed, partitionShapes).filter((n) => cohorts[n]);
    }
    const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
    // A view is drawn over every patient of its cohorts or not at all (lib/view-coverage.ts).
    const uncovered = cantDraw(view.kind, vStudies, (st) => resolvers[st] && studyAccess(resolvers[st]));
    if (uncovered) {
      views.push({ kind: view.kind, cohorts: vNames, error: uncovered, participation: participationFor(vStudies, false) });
      continue;
    }
    const mark = queryMark(), pushedBefore = views.length, viewT0 = Date.now();

    const run: ViewRun = { doc, cohorts, resolvers, vNames, vStudies, participationFor, pin, studyProfiles,
      page: opts.page, values: opts.values, table: opts.table, oncoprint: opts.oncoprint, riskFit: opts.riskFit };
    const runner = viewRunner(view.kind);
    if (runner) {
      const out = await runner(view, run);
      // a refusal carries neither timing nor queries
      if (out instanceof Untimed) { views.push(out.result); continue; }
      views.push(out);
    } else {
      // unreachable for well-typed documents, but documents arrive as untrusted
      // JSON from clients/chat/MCP, so an unknown kind must still be reported
      views.push({ kind: String((view as { kind?: unknown }).kind ?? "unknown"), error: "unknown view kind" });
    }
    // Wall-clock for the view, not the sum of its queries — they run
    // concurrently across cohorts and studies, so summing would overstate it.
    const ran = queriesSince(mark), viewMs = Date.now() - viewT0;
    for (let k = pushedBefore; k < views.length; k++) {
      views[k].ms = viewMs;
      // the oncoprint reports its own queries (it does not go through a resolver)
      if (ran.length && !views[k].queries) views[k].queries = ran;
    }
  }

  // An author's note belongs to the VIEW, not to the run, so it is copied across
  // by position rather than being threaded through every view runner.
  (doc.views || []).forEach((v, i) => {
    const note = v.note;
    if (views[i] && typeof note === "string" && note.trim()) views[i].annotationNote = note.trim();
  });
  // Same reason: splitBy's resolved arms are cheaper to attach by position, once, than to
  // thread through every view runner.
  for (const [i, info] of Object.entries(splitByForView)) if (views[+i]) views[+i].splitBy = info;

  return {
    study: docStudy, involvedStudies: involved, oncokbPin: pin,
    sources: await describeSources(involved, resolvers),
    // Echoed so a reader can see WHICH values produced these numbers, the same
    // reason the OncoKB pin is echoed. `unusedParams` catches a rename that
    // missed a reference: the run succeeds, so nothing else would say so.
    ...(Object.keys(usedParams).length ? { params: usedParams } : {}),
    ...(unusedParams.length ? { unusedParams } : {}),
    ...(partitionPlans.length ? { splits: partitionResults } : {}),
    ...(upgrade ? { upgraded: upgrade } : {}),
    cohorts: Object.fromEntries(names.map((n) => [n, {
      count: cohorts[n].count, text: cohorts[n].text,
      studies: cohorts[n].studies,
      ...(drift[n] ? { lock: drift[n] } : {}),
      sql: Object.entries(cohorts[n].perStudy).map(([s, x]) => "-- " + s + "\n" + x.sql).join("\n\n-- combined at the analysis layer: each study is evaluated separately against its own\n" +
        "-- instance and the counts are ADDED; patient overlap across studies is not deduplicated.\n\n")
    }])),
    views,
    stats: { ms: Date.now() - t0 }
  };
}
