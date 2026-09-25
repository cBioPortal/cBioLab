// Analysis-document engine: evaluate named cohorts (DSL v2) and produce view results.
// Document: { study: "<default>", cohorts: {name: def}, views: [{kind, ...}] }
// A cohort may override with "study" or "studies": [...] — it is evaluated per study
// (compilers stay single-study) and its size is the SUM of per-study counts. No
// patient identifier is fetched here: views ask each study for aggregates, and the
// oncoprint — the one view whose output is patients — carries the cohort SQL and
// re-derives its columns inside the owning database.
// Deliberately deferred: cross-study patient dedup and attribute harmonization.
import { chQuery, DB, STUDY, PRIMARY } from "./ch.ts";
import { sq } from "./compiler.ts";
import { compileCohortDef, describeCohortDef } from "./cohort2.ts";
import { genomicEventsSql, coverageSql, buildContract, PIDS_SQL } from "./oncoprint.ts";
import { geneSymbols } from "./gene-tracks.ts";
import type { PlotView } from "./types.ts";
import { buildAnnotationIndex } from "./annotation.ts";
import { fisherExact, kaplanMeier, logRank, benjaminiHochberg, cochranMantelHaenszel, log2OddsRatio,
  chiSquareTest, welchT, varianceFromMoments, pearsonFromMoments, regressionFromMoments, fisherZMeta,
  applyCutoff, toIncidence, coxRegression, type Moments, type CoxRow } from "./stats.ts";
import { contractToSvg } from "./oncoprint-svg.ts";
import { buildLollipopGene, fetchProteinInfo } from "./lollipop.ts";
import { viewToSvg } from "./view-svg.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, ViewResult, CompareRow, CompareCell, ChRow, OncoprintView, CompareView, LogRank, CooccurrenceView, CooccurRow, ClinicalView, ClinicalRow, SurvivalView, CoexpressionView, CoexprRow, HotspotsView, HotspotGene, ZReference, ViewParticipation, CourseView, CourseSeries, CoursePoint, SequenceView, SequenceResult, SequencePanel, SequenceNodeKind, TemplateDoc, CoxView, CoxCoefficient, CoxCovariate } from "./types.ts";
import type { PidsCarrier } from "./oncoprint.ts";
import {
  resolverFor, isPatientLevel, hasFederatedPlot, expandSurvivalCounts, studyRouting, restrictedStudies,
  type Resolver, type GeneCounts, type SurvivalCount, type Instance, type PairCounts, type AttrStats, type PairMoments, type ProfileMoments,
  type TimelineSpan, type CourseCount, type CourseOpts, type SequenceOpts, type SequenceFlow, type FederatedPlotCapable, legendFor } from "./federation.ts";
import { DEFAULT_BINS, CATEGORY_CAP, POINTS_CAP, tukey, axisLabel, validateAxis, coverageNote, type PlotData, type PlotGroup, type AxisKind } from "./plot.ts";
import { canonicalEventName, foldEventNames, foldNote } from "./event-names.ts";
import { resolveParams } from "./params.ts";

async function oncokbPin(): Promise<string | null> {
  try {
    const r = await chQuery(
      "SELECT oncokb_version FROM oncokb_annotation.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1");
    return r.data[0]?.oncokb_version || null;
  } catch { return null; }
}

const GENE_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
/** 12 genes = 66 pairs; beyond this the multiplicity correction eats the signal */
const COOCCUR_GENE_LIMIT = 12;

/**
 * A request past a view's limit is refused, naming the limit, rather than cut to its first N:
 * a document (or a chat/MCP client writing one) that asks for 25 genes and silently gets 20
 * reads the result as an answer about all 25.
 */
function overLimit(what: string, max: number, given: number): string | null {
  return given > max ? what + " takes at most " + max + "; this asks for " + given + " — remove " + (given - max) +
    " rather than have the rest silently ignored" : null;
}

export interface CoxColumn { axisIndex: number; label: string; reference?: string; level?: string }
/**
 * Dummy-codes Cox covariates into fit columns: a numeric covariate (clinical number, or a
 * molecular value) is a single column as-is. A categorical one becomes one column per
 * non-reference level, where the reference is the covariate's declared `reference` (see
 * CoxCovariate) if it names an observed level, else the most-frequent one — same rule either
 * way, just which level goes first. Pulled out of the Cox branch below so it's a pure
 * function testable without a database.
 */
export function buildCoxColumns(covariates: CoxCovariate[], kindsFinal: AxisKind[], rows: { values: (number | string)[] }[]): CoxColumn[] {
  const columns: CoxColumn[] = [];
  covariates.forEach((cov, ci) => {
    if (kindsFinal[ci] === "num") {
      columns.push({ axisIndex: ci, label: axisLabel(cov) });
    } else {
      const counts = new Map<string, number>();
      for (const r of rows) { const v = String(r.values[ci]); counts.set(v, (counts.get(v) || 0) + 1); }
      const byFreq = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || (a < b ? -1 : 1));
      // A declared reference (must be an observed level, or it's ignored rather than
      // silently matching nothing) goes first; everything else keeps its frequency order.
      const declared = cov.reference;
      const levels = declared && counts.has(declared) ? [declared, ...byFreq.filter((l) => l !== declared)] : byFreq;
      const reference = levels[0];
      for (const level of levels.slice(1)) columns.push({ axisIndex: ci, label: axisLabel(cov) + ": " + level, reference, level });
    }
  });
  return columns;
}

const _profileCache = new Map<string, { profiles: string[]; gaProfiles: string[] }>(); // per-study
export async function studyProfiles(study: string): Promise<{ profiles: string[]; gaProfiles: string[] }> {
  if (_profileCache.has(study)) return _profileCache.get(study)!;
  const { peerForStudy } = await import("./federation-remote.ts");
  if (peerForStudy(study)) return { profiles: [], gaProfiles: [] }; // the peer owns its own profile inventory
  const conn = (await studyRouting()).get(study) || PRIMARY;
  const profiles = (await chQuery(
    "SELECT DISTINCT profile_type FROM " + conn.db + ".genetic_alteration_derived WHERE cancer_study_identifier = " + sq(study), conn)).data.map((r) => r.profile_type);
  const gaProfiles = (await chQuery(
    "SELECT DISTINCT replaceOne(profile_stable_id, " + sq(study + "_") + ", '') AS pt FROM " + conn.db + ".generic_assay_profile_entity_derived WHERE profile_stable_id LIKE " + sq(study + "_%"), conn)).data.map((r) => r.pt);
  const out = { profiles, gaProfiles };
  _profileCache.set(study, out);
  return out;
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
  if (peerForStudy(study)) return study; // held by a peer; only it can validate
  const set = await validStudies();
  if (!set.has(study)) {
    if (restrictedStudies.has(study))
      throw new Error("study '" + study.slice(0, 60) + "' is consortium/private-access and is excluded from this deployment");
    throw new Error("unknown study '" + study.slice(0, 60) + "'");
  }
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
 * The default, "svg", is what MCP and the in-app chat need.
 */
export interface RunOpts { oncoprint?: "svg" | "spec" }

export async function runAnalysis(template: AnalysisDoc | TemplateDoc, opts: RunOpts = {}): Promise<AnalysisResult> {
  const t0 = Date.now();
  // Parameters are resolved FIRST, so everything downstream — compilers,
  // validators, provenance — sees an ordinary document and cannot tell a
  // template from one written out by hand.
  const { doc, params: usedParams, unused: unusedParams } = resolveParams(template);
  const docStudy = await resolveStudy(doc.study);
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const names = Object.keys(doc.cohorts || {});
  if (!names.length) throw new Error("document has no cohorts");
  { const e = overLimit("an analysis document", 6, names.length); if (e) throw new Error(e.replace("at most 6", "at most 6 cohorts")); }
  { const e = overLimit("an analysis document", 6, (doc.views || []).length); if (e) throw new Error(e.replace("at most 6", "at most 6 views")); }

  // ---- evaluate cohorts: per study, sum the counts ------------------------
  const cohorts: Record<string, { studies: string[]; perStudy: Record<string, { sql: string; count: number; mode: string }>; count: number; text: string }> = {};
  const resolvers: Record<string, Resolver> = {}; // study -> its instance's resolver
  for (const name of names) {
    const def = doc.cohorts[name];
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
      const count = await res.count(def);
      return { s, res, sql: res.cohortSql(def), count };
    }));
    for (const { s, res, sql, count } of evals) {
      perStudy[s] = { sql, count, mode: res.instance.mode };
    }
    cohorts[name] = {
      studies, perStudy,
      count: Object.values(perStudy).reduce((n, x) => n + x.count, 0),
      text: describeCohortDef(def) +
        (studies.length > 1 ? " — across " + studies.length + " studies" :
         studies[0] !== docStudy ? " — in " + studies[0] : "")
    };
  }
  const involved = [...new Set(Object.values(cohorts).flatMap((c) => c.studies))];

  // ---- views --------------------------------------------------------------
  // Every view records which studies answered it and in what mode, so a reader
  // never has to infer from prose whether patient-level data was involved.
  const participationFor = (studies: string[], requiresPatientLevel: boolean): ViewParticipation => {
    const per = studies.map((s) => {
      const inst = resolvers[s] ? resolvers[s].instance : null;
      return {
        study: s,
        mode: (inst ? inst.mode : "patient-level") as "patient-level" | "aggregate-only",
        instance: inst ? inst.label : "unknown",
        ...(inst && inst.id === "peer" ? { remote: true } : {})
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
  for (const view of (doc.views || [])) {
    const vNames = (view.cohorts && view.cohorts.length ? view.cohorts : names).filter((n) => cohorts[n]);
    const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
    const mark = queryMark(), pushedBefore = views.length, viewT0 = Date.now();

    if (view.kind === "compare") {
      const genes = geneSymbols((view as CompareView).genes);
      if (!genes.length) { views.push({ kind: "compare", error: "compare view needs genes" }); continue; }
      { const e = overLimit("a compare view", 20, genes.length); if (e) { views.push({ kind: "compare", error: e.replace("at most 20", "at most 20 genes") }); continue; } }
      // Every participant answers with per-gene counts computed in its own
      // database; the analysis layer only sums. Identical arithmetic whether the
      // instance is patient-level or aggregate-only — which is what makes mixed
      // federation possible at all.
      const tally = new Map<string, GeneCounts>(); // "cohort|gene" -> summed counts
      const perSite: { cohort: string; study: string; counts: GeneCounts[] }[] = [];
      await Promise.all(vNames.flatMap((n) =>
        cohorts[n].studies.map(async (st) => {
          const counts = await resolvers[st].geneCounts(doc.cohorts[n], genes);
          perSite.push({ cohort: n, study: st, counts });
          for (const c of counts) {
            const k = n + "|" + c.gene;
            const cur = tally.get(k) || { gene: c.gene, profiled: 0, altered: 0, driver: 0 };
            cur.profiled += c.profiled; cur.altered += c.altered; cur.driver += c.driver;
            tally.set(k, cur);
          }
        })));
      const aggOnly = vStudies.filter((st) => !isPatientLevel(resolvers[st]));
      const annSource = (await buildAnnotationIndex([], genes, vStudies.length === 1 ? vStudies[0] : vStudies)).source;
      const rows: CompareRow[] = genes.map((g) => {
        const cells: CompareCell[] = vNames.map((n) => {
          const t = tally.get(n + "|" + g) || { gene: g, profiled: 0, altered: 0, driver: 0 };
          const profiled = t.profiled, any = t.altered, driver = t.driver;
          return { cohort: n, profiled, any, driver,
            anyPct: profiled ? Math.round(1000 * any / profiled) / 10 : null,
            driverPct: profiled ? Math.round(1000 * driver / profiled) / 10 : null };
        });
        const row: CompareRow = { gene: g, cells };
        if (vNames.length === 2) {
          const [x, y] = cells;
          row.pAny = fisherExact(x.any, x.profiled - x.any, y.any, y.profiled - y.any);
          row.pDriver = fisherExact(x.driver, x.profiled - x.driver, y.driver, y.profiled - y.driver);
        }
        return row;
      });
      if (vNames.length === 2) rows.sort((a, b) => (a.pAny ?? 1) - (b.pAny ?? 1));
      views.push({ kind: "compare", cohorts: vNames, annotation: annSource, rows,
        participation: participationFor(vStudies, false),
        ...(vStudies.length > 1 ? { studies: vStudies,
          note: "cross-study comparison" + (vStudies.length <= 2 ? " (" + vStudies.join(", ") + ")" : " across " + vStudies.length + " studies") +
            ": denominators are per-study panel-aware; patient overlap across studies is NOT deduplicated" +
            "; counts are POOLED across studies, so the p-value is unstratified — site composition differences can invert a pooled association (Simpson's paradox), and a stratified test (Cochran–Mantel–Haenszel) would be the principled statistic" +
            (aggOnly.length ? "; " + aggOnly.join(", ") + " contributed aggregate counts only (no patient-level access)" : "") } : {}) });

    } else if (view.kind === "survival") {
      // Each participant returns (months, event, n) triples for its own patients:
      // aggregate, id-free, and poolable into an exact combined KM curve.
      // Triples are kept PER STUDY rather than merged on arrival, because the
      // log-rank statistic is additive over strata — keeping the site dimension
      // is what makes the stratified test available.
      const endpoint = String((view as SurvivalView).endpoint || "OS").toUpperCase().trim();
      if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) {
        views.push({ kind: "survival", error: "bad survival endpoint '" + endpoint.slice(0, 40) + "'" }); continue;
      }
      const rawCutoff = (view as SurvivalView).cutoffMonths;
      let cutoffMonths: number | undefined;
      if (rawCutoff != null) {
        const c = Number(rawCutoff);
        if (!Number.isFinite(c) || c <= 0 || c > 1200) {
          views.push({ kind: "survival", endpoint, error: "bad cutoffMonths '" + String(rawCutoff).slice(0, 40) + "': must be a positive number of months (max 1200)" });
          continue;
        }
        cutoffMonths = c;
      }
      const rawTick = (view as SurvivalView).tickMonths;
      let tickMonths: number | undefined;
      if (rawTick != null) {
        const t = Number(rawTick);
        if (!Number.isFinite(t) || t <= 0 || t > 600) {
          views.push({ kind: "survival", endpoint, error: "bad tickMonths '" + String(rawTick).slice(0, 40) + "': must be a positive number of months" });
          continue;
        }
        tickMonths = t;
      }
      const display: "survival" | "incidence" = (view as SurvivalView).display === "incidence" ? "incidence" : "survival";
      const rawAnchor = (view as SurvivalView).anchor;
      const anchor = rawAnchor && rawAnchor.eventType
        ? { eventType: String(rawAnchor.eventType).slice(0, 120),
            ...(rawAnchor.key ? { key: String(rawAnchor.key).slice(0, 120), value: String(rawAnchor.value ?? "") } : {}),
            ...(rawAnchor.occurrence === "LAST" ? { occurrence: "LAST" as const } : { occurrence: "FIRST" as const }) }
        : null;
      const perSite = new Map<string, Map<string, SurvivalCount[]>>(); // cohort -> study -> triples
      for (const n of vNames) perSite.set(n, new Map());
      await Promise.all(vNames.flatMap((n) =>
        cohorts[n].studies.map(async (st) => {
          perSite.get(n)!.set(st, await resolvers[st].survivalCounts(doc.cohorts[n], endpoint, anchor));
        })));
      // An EMPTY COHORT also yields no rows, and must not be reported as a
      // missing endpoint — that sends the reader (or a model) off to conclude the
      // study lacks OS when it does not. Separate the two causes before blaming
      // either.
      const cohortTotal = vNames.reduce((n, cn) => n + cohorts[cn].count, 0);
      if (cohortTotal === 0) {
        views.push({ kind: "survival", endpoint, cohorts: vNames,
          error: "nothing to plot: " + (vNames.length === 1 ? "cohort “" + vNames[0] + "” is" : "all cohorts are") +
            " empty. The endpoint is not the problem — check the cohort definition." });
        continue;
      }
      // A study with patients but nothing for this endpoint must be named, not
      // silently dropped — its patients would otherwise just be missing.
      const silent = vStudies.filter((st) =>
        vNames.some((n) => (cohorts[n].perStudy[st]?.count || 0) > 0) &&
        vNames.every((n) => !(perSite.get(n)!.get(st) || []).length));
      let endpointHelp = "";
      if (silent.length) {
        const declared = await Promise.all(silent.map(async (st) =>
          ({ st, eps: await resolvers[st].survivalEndpoints().catch(() => [] as string[]) })));
        // One study is not a federation: "1 of 1 study … participating" reads as though the
        // analysis were pooling sites, so a single study gets a plain statement instead.
        if (vStudies.length === 1) {
          const { st, eps } = declared[0];
          views.push({ kind: "survival", endpoint,
            error: eps.length
              ? st + " has no " + endpoint + " data (no " + endpoint + "_MONTHS/" + endpoint + "_STATUS). It does declare " +
                eps.join(", ") + " — pick one of those as the endpoint."
              : st + " has no survival data: it declares no <X>_MONTHS/<X>_STATUS pair, so there is no endpoint to plot." });
          continue;
        }
        const avail = declared.map(({ st, eps }) => st + ": " + (eps.join(", ") || "none declared"));
        endpointHelp = " " + silent.length + " of " + vStudies.length + " stud" + (silent.length === 1 ? "y has" : "ies have") +
          " no " + endpoint + " data and contribute" + (silent.length === 1 ? "s" : "") + " no patients here (" + avail.join("; ") + ").";
        if (silent.length === vStudies.length) {
          views.push({ kind: "survival", endpoint,
            error: "no participating study defines " + endpoint + "_MONTHS/" + endpoint + "_STATUS." + endpointHelp });
          continue;
        }
      }
      const pointsFor = (n: string, st?: string) => {
        const data = expandSurvivalCounts(
          st ? (perSite.get(n)!.get(st) || []) : [...perSite.get(n)!.values()].flat());
        return cutoffMonths != null ? applyCutoff(data, cutoffMonths) : data;
      };
      const curvesRaw = vNames.map((n) => {
        const data = pointsFor(n);
        return { cohort: n, ...kaplanMeier(data), missing: cohorts[n].count - data.length };
      });
      const curves = display === "incidence" ? curvesRaw.map((c) => toIncidence(c)) : curvesRaw;
      // Two cohorts is the case the log-rank test is defined for, matching the
      // compare view's Fisher p.
      let logrank: LogRank | undefined, logrankPooled: LogRank | undefined;
      let sites: string[] = [];
      if (vNames.length === 2) {
        const [A, B] = vNames;
        sites = [...new Set([...perSite.get(A)!.keys(), ...perSite.get(B)!.keys()])];
        const pooledTest = logRank([{ a: pointsFor(A), b: pointsFor(B) }]);
        if (sites.length > 1) {
          logrank = logRank(sites.map((st) => ({ a: pointsFor(A, st), b: pointsFor(B, st) })));
          logrankPooled = pooledTest;   // shown for contrast: the two can disagree
        } else {
          logrank = pooledTest;
        }
      }
      // How long after the anchor patients actually became observable. A long
      // tail here is a warning about the anchor itself — "first Diagnosis" in a
      // study that records prior unrelated cancers can sit decades back.
      let entryMonths: { median: number; p90: number; max: number } | undefined;
      if (anchor) {
        const es: number[] = [];
        for (const byStudy of perSite.values())
          for (const rows of byStudy.values())
            for (const r of rows) if (r.entry != null) for (let i = 0; i < r.n; i++) es.push(r.entry);
        if (es.length) {
          es.sort((x, y) => x - y);
          const at = (q: number) => Math.round(es[Math.floor(q * (es.length - 1))] * 10) / 10;
          entryMonths = { median: at(0.5), p90: at(0.9), max: at(1) };
        }
      }
      const beyondCutoff = cutoffMonths != null
        ? vNames.reduce((sum, n) => sum + expandSurvivalCounts([...perSite.get(n)!.values()].flat())
            .filter((r) => r.t > cutoffMonths!).length, 0)
        : 0;
      views.push({ kind: "survival", cohorts: vNames, curves, endpoint,
        ...(entryMonths ? { entryMonths } : {}),
        ...(anchor ? { anchoredTo: anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : ""), truncated: true } : {}),
        ...(cutoffMonths != null ? { cutoffMonths } : {}), ...(tickMonths != null ? { tickMonths } : {}),
        ...(display === "incidence" ? { display } : {}),
        participation: participationFor(vStudies, false),
        ...(logrank ? { logrank } : {}), ...(logrankPooled ? { logrankPooled } : {}),
        caveat: (display === "incidence"
          ? "Cumulative incidence (1 - survival) shown, not survival. "
          : "") +
          (cutoffMonths != null
            ? "Administratively censored at " + cutoffMonths + " months" +
              (beyondCutoff ? " (" + beyondCutoff + " patient" + (beyondCutoff === 1 ? "" : "s") + " still under observation past this point)" : "") +
              ". "
            : "") +
          (anchor
          ? endpoint + " re-anchored to " + anchor.occurrence!.toLowerCase() + " " + anchor.eventType +
            (anchor.key ? " where " + anchor.key + "=" + anchor.value : "") +
            ". LEFT TRUNCATION IS APPLIED: each patient enters the risk set only when the study could first observe them" +
            " (its timeline day 0), not at the anchor — without that, everyone would appear to survive from the anchor to" +
            " their entry, which is exactly what put them in the study. Patients whose anchor event falls after day 0," +
            " or who have no such event, are excluded rather than given a negative follow-up time" +
            (entryMonths
              ? ". Patients became observable a median of " + entryMonths.median + " months after the anchor" +
                " (90th percentile " + entryMonths.p90 + ", longest " + entryMonths.max + ") — a long tail here means the" +
                " anchor is matching earlier events than you may intend"
              : "")
          : endpoint + " from each study's own baseline (left truncation applies") +
          (anchor ? "" : (vStudies.length > 1 ? "; baselines are NOT harmonized across studies" : "") + ")") +
          " Status '0:...' treated as censored." +
          endpointHelp +
          (logrankPooled
            ? " The log-rank test is STRATIFIED by study (" + logrank!.strata + " strata contributed events): each study is" +
              " compared only against itself, so a difference in case mix between studies cannot masquerade as a difference" +
              " between cohorts. The pooled p is shown alongside — where the two disagree, the stratified one is the honest answer." +
              " Every site contributes only (months, event, n) counts; no patient-level survival time crosses an instance boundary."
            : logrank
              ? " Log-rank on a single study, so no stratification applies."
              : " Log-rank needs exactly two cohorts.") });

    } else if (view.kind === "cox") {
      // Multivariate Cox: unlike survival/compare, this is fit from real per-patient rows
      // within each LOCAL study rather than pooled aggregate counts, so an aggregate-only or
      // remote participant simply cannot contribute (isPatientLevel gates it) — see the PR
      // notes for why that tradeoff is fine here.
      const cx = view as CoxView;
      const endpoint = String(cx.endpoint || "OS").toUpperCase().trim();
      if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) {
        views.push({ kind: "cox", error: "bad survival endpoint '" + endpoint.slice(0, 40) + "'" }); continue;
      }
      const covariates = Array.isArray(cx.covariates) ? cx.covariates : [];
      if (!covariates.length) { views.push({ kind: "cox", endpoint, error: "a cox view needs at least one covariate" }); continue; }
      { const e = overLimit("a cox view", 8, covariates.length); if (e) { views.push({ kind: "cox", endpoint, error: e.replace("at most 8", "at most 8 covariates") }); continue; } }
      try { covariates.forEach((c, i) => validateAxis(c, "covariate " + (i + 1))); }
      catch (e) { views.push({ kind: "cox", endpoint, error: (e as Error).message }); continue; }
      const rawCutoff = cx.cutoffMonths;
      let cutoffMonths: number | undefined;
      if (rawCutoff != null) {
        const c = Number(rawCutoff);
        if (!Number.isFinite(c) || c <= 0 || c > 1200) {
          views.push({ kind: "cox", endpoint, error: "bad cutoffMonths '" + String(rawCutoff).slice(0, 40) + "': must be a positive number of months (max 1200)" });
          continue;
        }
        cutoffMonths = c;
      }
      const cohortTotal = vNames.reduce((n, cn) => n + cohorts[cn].count, 0);
      if (cohortTotal === 0) {
        views.push({ kind: "cox", endpoint, cohorts: vNames,
          error: "nothing to fit: " + (vNames.length === 1 ? "cohort “" + vNames[0] + "” is" : "all cohorts are") + " empty." });
        continue;
      }

      const excludedRemote: { study: string; patients: number }[] = [];
      type RawCoxRow = { t: number; event: number; values: (number | string)[]; study: string };
      const rawRows: RawCoxRow[] = [];
      let kinds: AxisKind[] | null = null;
      let patientLevelTotal = 0;
      for (const n of vNames) {
        for (const st of cohorts[n].studies) {
          const res = resolvers[st];
          if (!isPatientLevel(res)) {
            excludedRemote.push({ study: st, patients: cohorts[n].perStudy[st]?.count || 0 });
            continue;
          }
          patientLevelTotal += cohorts[n].perStudy[st]?.count || 0;
          const { rows, kinds: k } = await res.coxRows(doc.cohorts[n], endpoint, covariates);
          if (!kinds) kinds = k;
          for (const r of rows) rawRows.push({ ...r, study: st });
        }
      }
      if (!rawRows.length) {
        views.push({ kind: "cox", endpoint, cohorts: vNames,
          error: excludedRemote.length && patientLevelTotal === 0
            ? "no patient-level participant could answer this — " + excludedRemote.map((e) => e.study).join(", ") +
              (excludedRemote.length === 1 ? " is" : " are") + " aggregate-only, and multivariate Cox needs patient-level covariates"
            : "no patient had both a " + endpoint + " measurement and every requested covariate defined" });
        continue;
      }
      const kindsFinal = kinds!;

      // administrative censoring, same semantics as the KM view
      const rowsCut = cutoffMonths != null
        ? rawRows.map((r) => r.t > cutoffMonths! ? { ...r, t: cutoffMonths!, event: 0 } : r)
        : rawRows;

      const columns = buildCoxColumns(covariates, kindsFinal, rowsCut);
      if (!columns.length) {
        views.push({ kind: "cox", endpoint, cohorts: vNames,
          error: "every covariate had only one observed level across these patients — there is nothing to estimate a hazard ratio against" });
        continue;
      }
      if (columns.length > 20) {
        views.push({ kind: "cox", endpoint, cohorts: vNames,
          error: "these covariates expand to " + columns.length + " terms (capped at 20) — narrow a high-cardinality categorical covariate first" });
        continue;
      }
      const toX = (r: RawCoxRow): number[] => columns.map((col) =>
        kindsFinal[col.axisIndex] === "num" ? Number(r.values[col.axisIndex]) : (String(r.values[col.axisIndex]) === col.level ? 1 : 0));
      const coxInput: CoxRow[] = rowsCut
        .filter((r) => Number.isFinite(r.t) && r.t >= 0)
        .map((r) => ({ t: r.t, event: r.event, x: toX(r), ...(cx.stratifyByStudy ? { stratum: r.study } : {}) }));

      let fit;
      try { fit = coxRegression(coxInput); }
      catch (e) { views.push({ kind: "cox", endpoint, cohorts: vNames, error: (e as Error).message }); continue; }

      const missing = patientLevelTotal - fit.n;
      const coefficients: CoxCoefficient[] = columns.map((col, i) => ({
        label: col.label, ...(col.reference ? { reference: col.reference } : {}),
        beta: fit.beta[i], se: fit.se[i], hr: fit.hr[i], ciLow: fit.ciLow[i], ciHigh: fit.ciHigh[i], p: fit.p[i]
      }));
      const coxResult: ViewResult = { kind: "cox", cohorts: vNames, endpoint,
        ...(cutoffMonths != null ? { cutoffMonths } : {}),
        cox: { coefficients, n: fit.n, events: fit.events, ...(excludedRemote.length ? { excludedRemote } : {}) },
        participation: participationFor(vStudies, false),
        caveat: "Cox proportional-hazards regression (Efron ties) on " + fit.n + " patients, " + fit.events + " events, " +
          columns.length + " term" + (columns.length === 1 ? "" : "s") + "." +
          (missing > 0 ? " " + missing + " patient" + (missing === 1 ? "" : "s") + " from patient-level participants lacked the endpoint or a covariate and were excluded." : "") +
          (cutoffMonths != null ? " Administratively censored at " + cutoffMonths + " months." : "") +
          (cx.stratifyByStudy
            ? " Stratified by study: each study fits its own baseline hazard, so a case-mix difference between studies cannot masquerade as a covariate effect."
            : vStudies.length > 1 ? " Pooled across studies WITHOUT stratifying — a case-mix difference between studies could be absorbed into a covariate's estimated effect; consider stratifyByStudy." : "") +
          (vStudies.length > 1 ? " Clinical-attribute vocabularies and declared types are NOT harmonized across studies." : "") +
          (excludedRemote.length
            ? " " + excludedRemote.map((e) => e.study + " (" + e.patients + " patients)").join(", ") +
              " could not contribute: aggregate-only participants have no patient-level covariates to fit on."
            : "") +
          " Computed from real per-patient rows within each local study — not pooled aggregate counts across untrusted remote peers, unlike KM/log-rank." };
      // Rendered here, by the SAME renderer the chat and MCP use — the app draws the
      // forest plot as this SVG rather than a second, hand-rolled chart (the pattern
      // the clinical course and treatment-sequence views already follow).
      coxResult.svg = viewToSvg(coxResult) || undefined;
      views.push(coxResult);

    } else if (view.kind === "course") {
      const cv = view as CourseView;
      const binMonths = Math.max(1, Math.min(24, Math.floor(Number(cv.binMonths) || 3)));
      const from = Math.max(-240, Math.min(0, Math.floor(Number(cv.fromMonths ?? -12))));
      const to = Math.max(1, Math.min(600, Math.floor(Number(cv.toMonths ?? 60))));
      const anchor = cv.anchor && cv.anchor.eventType
        ? { ...cv.anchor, occurrence: cv.anchor.occurrence === "LAST" ? "LAST" as const : "FIRST" as const }
        : null;

      // Day 0 is not a shared baseline across studies — it is birth in one study
      // and first sequencing in another, and nothing in the schema says which.
      // Refuse rather than draw a confident average of incomparable clocks.
      if (!anchor && vStudies.length > 1) {
        views.push({ kind: "course", cohorts: vNames, studies: vStudies,
          error: "aligning on day 0 is only meaningful within a single study, and this view spans " +
            vStudies.length + " (" + vStudies.join(", ") + "). Day 0 is a different moment in each — " +
            "birth in some studies, first sequencing in others — and the database does not record which. " +
            "Set an anchor event (e.g. {\"eventType\":\"Treatment\",\"occurrence\":\"FIRST\"}) so every patient " +
            "is lined up on the same clinical landmark." });
        continue;
      }

      // Structural probe: powers the degenerate gate AND decides band-vs-mark
      // without consulting any event NAME.
      const spans = new Map<string, TimelineSpan[]>();
      await Promise.all(vStudies.map(async (st) => {
        spans.set(st, await resolvers[st].timelineSpan(doc.cohorts[vNames[0]]).catch(() => [] as TimelineSpan[]));
      }));
      const allSpans = [...spans.values()].flat();

      // 17 of the 131 studies with timeline rows put every event on one day.
      // Those must say so, not render an empty chart.
      const usable = vStudies.filter((st) => (spans.get(st) || []).some((s) => s.days > 1));
      if (!usable.length) {
        const what = allSpans.length
          ? " The timeline holds " + allSpans.map((s) => s.eventType + " (" + s.patients + " patients)").join(", ") +
            ", but every event sits on a single day, so there is no course to plot."
          : " No timeline events were found for this cohort at all.";
        views.push({ kind: "course", cohorts: vNames, studies: vStudies,
          error: "this cohort's timeline carries no temporal information." + what });
        continue;
      }

      // Fold spellings, and let structure pick the measure.
      const folded = foldEventNames(allSpans.map((s) => ({ name: s.eventType, n: s.patients })));
      const wanted = [...new Set((cv.eventTypes || []).map(canonicalEventName).filter(Boolean))];
      { const e = overLimit("a course view", 6, wanted.length);
        if (e) { views.push({ kind: "course", cohorts: vNames, studies: vStudies, error: e.replace("at most 6", "at most 6 event types") }); continue; } }
      if (!wanted.length) {
        views.push({ kind: "course", cohorts: vNames, studies: vStudies,
          error: "a course view needs at least one event type. This cohort has: " +
            (folded.map((f) => f.label).join(", ") || "no timeline events") });
        continue;
      }
      const unknown = wanted.filter((w) => !folded.some((f) => f.canonical === w));
      if (unknown.length === wanted.length) {
        views.push({ kind: "course", cohorts: vNames, studies: vStudies,
          error: "none of these event types occur in this cohort: " + unknown.join(", ") +
            ". Available: " + (folded.map((f) => f.label).join(", ") || "none") });
        continue;
      }
      const measured = wanted.filter((w) => folded.some((f) => f.canonical === w));
      const intervalOf = new Map(folded.map((f) => [f.canonical,
        allSpans.filter((s) => canonicalEventName(s.eventType) === f.canonical)
          .reduce((n, s) => n + s.intervalEvents, 0) > 0]));

      const opts: CourseOpts = { anchor, eventTypes: measured, binMonths, from: Math.floor(from / binMonths), to: Math.floor(to / binMonths) };
      const per = new Map<string, CourseCount[]>();   // cohort -> merged counts
      await Promise.all(vNames.map(async (n) => {
        const useStudies = cohorts[n].studies.filter((st) => usable.includes(st));
        const parts = await Promise.all(useStudies.map((st) =>
          resolvers[st].eventCourse(doc.cohorts[n], opts).catch(() => [] as CourseCount[])));
        per.set(n, parts.flat());
      }));

      // Merge by summing per (bin, state) — each study contributes its own
      // observable patients and its own events, so sums are exact.
      const course: CourseSeries[] = [];
      for (const n of vNames) {
        const rows = per.get(n) || [];
        const risk = new Map<number, number>(), hit = new Map<string, number>();
        for (const r of rows) {
          if (r.eventType === "") risk.set(r.bin, (risk.get(r.bin) || 0) + r.n);
          else { const k = r.eventType + " " + r.bin; hit.set(k, (hit.get(k) || 0) + r.n); }
        }
        for (const et of measured) {
          const f = folded.find((x) => x.canonical === et)!;
          const points: CoursePoint[] = [];
          for (let b = opts.from; b <= opts.to; b++) {
            const atRisk = risk.get(b) || 0;
            const nn = hit.get(et + " " + b) || 0;
            points.push({ t: b * binMonths, atRisk, n: nn,
              pct: atRisk > 0 ? Math.round((1000 * nn) / atRisk) / 10 : null });
          }
          course.push({ cohort: n, eventType: f.label, variants: f.variants,
            isInterval: !!intervalOf.get(et), points });
        }
      }

      const note = foldNote(folded.filter((f) => measured.includes(f.canonical)));
      const dropped = vStudies.filter((st) => !usable.includes(st));
      // Offer every event type the cohort actually has, with the two structural
      // facts that decide whether it is worth plotting.
      const eventOptions = folded.map((f) => {
        const mine = allSpans.filter((s2) => canonicalEventName(s2.eventType) === f.canonical);
        const pts = mine.reduce((n, s2) => n + s2.patients, 0);
        const evs = mine.reduce((n, s2) => n + s2.events, 0);
        return { canonical: f.canonical, label: f.label, patients: pts,
                 perPatient: pts ? Math.round((10 * evs) / pts) / 10 : 0,
                 hasDurations: !!intervalOf.get(f.canonical) };
      });
      const courseResult: ViewResult = { kind: "course", cohorts: vNames, studies: vStudies, course,
        courseAxis: { binMonths, from: opts.from * binMonths, to: opts.to * binMonths },
        eventOptions,
        participation: participationFor(vStudies, false),
        caveat:
          (anchor
            ? "Aligned on " + (anchor.occurrence === "LAST" ? "last " : "first ") + anchor.eventType +
              (anchor.key ? " where " + anchor.key + "=" + anchor.value : "") +
              " — time 0 is that event, so every patient is lined up on the same clinical landmark." +
              " Patients with no such event are absent from every bin."
            : "Aligned on " + vStudies[0] + "'s own day 0, which is that study's baseline and is NOT" +
              " comparable to any other study's.") +
          " THE DENOMINATOR IS NOT THE WHOLE COHORT: each bin is over the patients still under observation" +
          " in it, from their first recorded event to their last contact (the later of their last recorded" +
          " event and their OS follow-up where the study declares one). Without that, a curve would fall" +
          " simply because follow-up ran out." +
          " Follow-up ending at the last recorded event biases the tail upward — by construction a patient" +
          " has an event on their last observed day." +
          " Bins are half-open [t, t+" + binMonths + "mo)." +
          (measured.some((et) => intervalOf.get(et))
            ? " Event types carrying real durations are drawn as a state the patient is IN during the bin;" +
              " the rest as an event that HAPPENED in it. That is read off the data, not the event's name."
            : " These event types carry no durations, so each point is the share with such an event in that bin.") +
          (note ? " " + note : "") +
          (unknown.length ? " Not found in this cohort, so not plotted: " + unknown.join(", ") + "." : "") +
          (dropped.length ? " Excluded for having no temporal information: " + dropped.join(", ") + "." : "") +
          (vStudies.length > 1 ? " Event vocabularies are NOT harmonized across studies beyond case." : "") };
      // Rendered here, by the SAME renderer the chat and MCP use, so the web app
      // cannot drift into showing a second, subtly different figure — the debt
      // the survival and lollipop views still carry.
      const tCourse = Date.now();
      // 720 is the module default and close to the app column width, so the
      // caption renders near 1:1 rather than being scaled down to unreadable.
      courseResult.svg = viewToSvg(courseResult) || undefined;
      courseResult.renderMs = Date.now() - tCourse;
      views.push(courseResult);

    } else if (view.kind === "sequence") {
      const sv = view as SequenceView;
      const labelKey = String(sv.labelKey || "SUBTYPE");
      const eventType = String(sv.eventType || "treatment");
      const lineGap = Math.max(1, Math.min(3650, Math.floor(Number(sv.lineGap) || 90)));
      const maxSteps = Math.max(2, Math.min(6, Math.floor(Number(sv.maxSteps) || 3)));
      const topN = Math.max(2, Math.min(14, Math.floor(Number(sv.topN) || 8)));
      // Two panels at most: a third Sankey shrinks every ribbon past reading.
      const panelNames = vNames.slice(0, 2);
      const allStudies = [...new Set(panelNames.flatMap((n) => cohorts[n].studies))];
      const opts: SequenceOpts = { eventType, labelKey, exclude: (sv.exclude || []).map(String), lineGap, maxSteps };

      // What ELSE could label a line here, and how granular is each? Fetched
      // alongside the data so the UI can offer the choice, and so a bad key can
      // be diagnosed rather than just returning nothing.
      const [rawByCohort, keyRows] = await Promise.all([
        Promise.all(panelNames.map(async (n) => (await Promise.all(cohorts[n].studies.map((st) =>
          resolvers[st].treatmentSequence(doc.cohorts[n], opts).catch(() => [] as SequenceFlow[])))).flat())),
        Promise.all(allStudies.map((st) =>
          resolvers[st].sequenceKeys(doc.cohorts[panelNames[0]], eventType).catch(() => []))).then((r) => r.flat())
      ]);
      const keyOptions = [...new Map(keyRows.map((k) => [k.key, k])).values()]
        .sort((a, b) => b.patients - a.patients);
      const chosen = keyOptions.find((k) => k.key === canonicalEventName(labelKey));

      if (!rawByCohort.some((r) => r.length)) {
        views.push({ kind: "sequence", cohorts: panelNames, studies: allStudies,
          error: keyOptions.length
            ? "no therapy lines found: '" + eventType + "' events carry no attribute '" + labelKey +
              "'. Keys available on those events: " +
              keyOptions.slice(0, 8).map((k) => k.label + " (" + k.patients.toLocaleString() + " patients, " + k.values + " values)").join(", ")
            : "no '" + eventType + "' events with attributes were found for this cohort, so there are no lines to sequence.",
          ...(keyOptions.length ? { sequence: { labelKey, lineGap, steps: maxSteps, foldedLabels: 0, truncated: false, keyOptions, panels: [] } } : {}) });
        continue;
      }
      // A key with one value cannot separate anything. Say so rather than
      // drawing one enormous box: in MSK-CHORD, TREATMENT_TYPE is exactly this.
      if (chosen && chosen.values <= 1) {
        views.push({ kind: "sequence", cohorts: panelNames, studies: allStudies,
          sequence: { labelKey, lineGap, steps: maxSteps, foldedLabels: 0, truncated: false, keyOptions, panels: [] },
          error: "'" + labelKey + "' takes only one value in this cohort (" + chosen.label +
            "), so every line would carry the same label and the diagram would say nothing. Try: " +
            keyOptions.filter((k) => k.values > 1).slice(0, 5)
              .map((k) => k.label + " (" + k.values + " values)").join(", ") });
        continue;
      }
      const truncated = rawByCohort.some((r) => r.length >= 2000);

      // Merge per cohort, then rank labels ACROSS ALL PANELS so a regimen keeps
      // one identity and one colour in both — the comparison is the point.
      const mergedPer = rawByCohort.map((raw) => {
        const m = new Map<string, number>();
        for (const f of raw) {
          const k = f.step + "\u0000" + f.from + "\u0000" + f.to + "\u0000" + f.fate;
          m.set(k, (m.get(k) || 0) + f.n);
        }
        return m;
      });
      const weight = new Map<string, number>();
      for (const m of mergedPer) for (const [k, n] of m) {
        const from = k.split("\u0000")[1];
        weight.set(from, (weight.get(from) || 0) + n);
      }
      const keep = new Set([...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([l]) => l));
      const foldedLabels = [...weight.keys()].filter((l) => !keep.has(l)).length;
      const fold = (l: string) => keep.has(l) ? l : "other";
      const kindOf = (fate: number): SequenceNodeKind =>
        fate === 0 ? "regimen" : fate === 1 ? "stopped" : "censored";
      const nodeKey = (column: number, kind: SequenceNodeKind, label: string) =>
        column + "\u0000" + kind + "\u0000" + label;

      const panels: SequencePanel[] = panelNames.map((cohortName, pi) => {
        const flowMap = new Map<string, number>();
        for (const [k, n] of mergedPer[pi]) {
          const [step, from, to, fate] = k.split("\u0000");
          const kind = kindOf(Number(fate));
          const target = kind === "regimen" ? fold(to) : "";
          const key = step + "\u0000" + fold(from) + "\u0000" + target + "\u0000" + kind;
          flowMap.set(key, (flowMap.get(key) || 0) + n);
        }
        const flows = [...flowMap.entries()].map(([k, n]) => {
          const [step, from, to, kind] = k.split("\u0000");
          return { column: Number(step), from, to, n, kind: kind as SequenceNodeKind };
        }).sort((a, b) => a.column - b.column || b.n - a.n);

        // A node is as big as what leaves it; a terminal is as big as what
        // arrives. Both terminals get real nodes, so nobody leaves the diagram.
        const outSum = new Map<string, number>(), inSum = new Map<string, number>();
        for (const f of flows) {
          const src = nodeKey(f.column, "regimen", f.from);
          const dst = nodeKey(f.column + 1, f.kind, f.to);
          outSum.set(src, (outSum.get(src) || 0) + f.n);
          inSum.set(dst, (inSum.get(dst) || 0) + f.n);
        }
        const nodes = [...new Set([...outSum.keys(), ...inSum.keys()])].map((k) => {
          const [column, kind, label] = k.split("\u0000");
          return { column: Number(column), label, kind: kind as SequenceNodeKind,
                   n: outSum.get(k) ?? inSum.get(k) ?? 0 };
        }).filter((x) => x.n > 0).sort((a, b) => a.column - b.column || b.n - a.n);

        const started = flows.filter((f) => f.column === 1).reduce((n, f) => n + f.n, 0);
        const censored = flows.filter((f) => f.kind === "censored").reduce((n, f) => n + f.n, 0);
        return { cohort: cohortName, nodes, flows, started, censored };
      });

      const p0 = panels[0];
      const censPct = p0.started ? Math.round((1000 * p0.censored) / p0.started) / 10 : 0;
      const otherN = p0.nodes.filter((n) => n.column === 1 && n.label === "other").reduce((t, n) => t + n.n, 0);
      const otherPct = p0.started ? Math.round((1000 * otherN) / p0.started) / 10 : 0;
      const sequence: SequenceResult = { labelKey, lineGap, steps: maxSteps, foldedLabels, truncated, keyOptions, panels };
      const seqResult: ViewResult = { kind: "sequence", cohorts: panelNames, studies: allStudies, sequence,
        participation: participationFor(allStudies, false),
        caveat:
          "Therapies are grouped into LINES before being sequenced: records less than " + lineGap +
          " days apart belong to the same line, and a line is labelled by its whole combination" +
          " (sorted, so 'A + B' and 'B + A' are one regimen). That grouping is the point \u2014 a patient" +
          " here has a median of 6 treatment records and 4 distinct agents, and combination therapy is" +
          " several records describing ONE decision, not several lines." +
          " Lines are labelled by " + labelKey + "." +
          " ENDING A PATH IS SPLIT IN TWO, because the difference matters more than anything else here:" +
          " 'no further line' means the study kept watching for at least " + lineGap + " days (one line gap," +
          " the same rule that defines a line) and saw no further therapy; 'record ends here' means it did not," +
          " so nothing can be concluded about that patient. " + censPct + "% of paths end censored \u2014 reading" +
          " those as patients who finished treatment would be a claim about the record-keeping dressed up as" +
          " one about the patient. Neither terminal is an outcome measure." +
          (sv.exclude && sv.exclude.length
            ? " Excluded from every line, by this document rather than by the engine: " + sv.exclude.join(", ") + "."
            : "") +
          (foldedLabels ? " " + foldedLabels + " less common regimen" + (foldedLabels === 1 ? "" : "s") +
            " folded into 'other', which is " + otherPct + "% of first-line patients in the first panel \u2014" +
            " combination regimens have a genuinely long tail, so 'other' is real diversity rather than a" +
            " rounding bucket. Raise topN to split it further." : "") +
          (truncated ? " The aggregate hit its row cap, so the rarest regimens are incomplete." : "") +
          (allStudies.length > 1 ? " Regimen vocabularies are NOT harmonized across studies beyond case." : "") +
          (panels.length > 1
            ? " Both panels share one scale and one colour per regimen, so their heights are directly comparable."
            : vNames.length > 1 ? " Only cohort \u201c" + panelNames[0] + "\u201d is shown." : "") +
          " " + panels.map((x) => x.cohort + ": " + x.started.toLocaleString() + " with a first line").join("; ") + "." };
      const tSeq = Date.now();
      seqResult.svg = viewToSvg(seqResult) || undefined;
      seqResult.renderMs = Date.now() - tSeq;
      views.push(seqResult);

    } else if (view.kind === "hotspots") {
      const hv = view as HotspotsView;
      const uniq = geneSymbols(hv.genes);
      if (!uniq.length) { views.push({ kind: "hotspots", error: "hotspots view needs genes" }); continue; }
      { const e = overLimit("a hotspots view", 12, uniq.length); if (e) { views.push({ kind: "hotspots", error: e.replace("at most 12", "at most 12 genes") }); continue; } }
      const minCount = Math.max(1, Math.min(1000, Math.floor(Number(hv.minCount) || 1)));
      const cn = vNames[0];
      const studies = cohorts[cn].studies;
      // the sites' counts and the proteins (length, Pfam domains) are independent, so both at once
      const [reports, proteins] = await Promise.all([
        Promise.all(studies.map((st) => resolvers[st].lollipopCounts(doc.cohorts[cn], uniq, minCount))),
        Promise.all(uniq.map((g) => fetchProteinInfo(g)))
      ]);
      const hotspots: HotspotGene[] = uniq.map((gene, i) => buildLollipopGene(gene, reports, proteins[i]))
        .filter((h) => h.mutated > 0);
      const f = (n: number) => n.toLocaleString("en-US");
      const unpositioned = hotspots.reduce((n, h) => n + h.unpositioned, 0);
      const withheld = hotspots.reduce((n, h) => n + h.withheld, 0);
      const observed = hotspots.filter((h) => h.lengthSource === "observed").map((h) => h.gene);
      const annotated = reports.every((r) => r.annotated);
      const hr: ViewResult = { kind: "hotspots", cohorts: [cn], hotspots, studies,
        participation: participationFor(studies, false),
        note: "Mutations in “" + cn + "” by protein position, as cBioPortal's mutation tab draws them: one stem per codon" +
          " (the stored protein start position), its height the number of distinct patient + protein change pairs there." +
          " Colour is the codon's dominant mutation type, putative drivers before VUS" +
          (annotated ? " (driver = OncoKB oncogenic, pinned; the portal also counts hotspots and custom annotations)." : " (no OncoKB pin, so every mutation is coloured as a driver, as the portal does with annotation off).") +
          " VUS and germline mutations are included, as they are by default on the portal." +
          (unpositioned ? " " + f(unpositioned) + " mutation" + (unpositioned === 1 ? " has" : "s have") + " no protein position (or one past the protein) and " +
            (unpositioned === 1 ? "is" : "are") + " not drawn; the portal drops these without saying so." : "") +
          (observed.length ? " Genome Nexus could not be reached for " + observed.join(", ") + ", so the axis runs to the highest codon seen and no domains are drawn." : "") +
          (minCount > 1
            ? " A suppression floor of " + minCount + " patients per change was applied BY EACH SITE before returning anything" +
              (withheld ? ", withholding " + f(withheld) + " mutation" + (withheld === 1 ? "" : "s") : "") + "."
            : " NOTE: with no suppression floor set (minCount), a change carried by a single patient is reported —" +
              " the most disclosive aggregate this system produces. Set minCount to have each site withhold rare changes at source.") +
          (studies.length > 1 ? " Counts sum across studies; a patient enrolled in more than one is not deduplicated." : "") };
      hr.svg = viewToSvg(hr, { width: 960 }) || undefined;
      views.push(hr);

    } else if (view.kind === "plot") {
      const pv = view as PlotView;
      const cn = vNames[0];
      const sites = cohorts[cn].studies;
      const unit = pv.unit === "sample" ? "sample" as const : "patient" as const;
      const spec = { x: pv.x, y: pv.y, unit,
        ...(pv.colorBy ? { colorBy: pv.colorBy } : {}), ...(pv.ringBy ? { ringBy: pv.ringBy } : {}) };
      const bins: [number, number] = Array.isArray(pv.bins) && pv.bins.length === 2
        ? [Number(pv.bins[0]), Number(pv.bins[1])] : DEFAULT_BINS;
      try {
        if (sites.length === 1) {
          const r0 = resolvers[sites[0]];
          const data = await r0.plot(doc.cohorts[cn], { ...spec, bins: pv.bins ? bins : undefined });
          // The points behind a box come only from a participant entitled to see cases, and only
          // when there are few enough to be a drawing. isPatientLevel is a type guard, so asking an
          // aggregate-only participant for them is a compile error rather than a review catch.
          if (data.shape === "box" && pv.points !== false && isPatientLevel(r0)) {
            const pts = await r0.plotPoints(doc.cohorts[cn], spec);
            if (pts.length) {
              data.points = pts;
              data.overlay = "points";
              // the key describes what is drawn, so it is built from the points themselves
              if (pv.colorBy) data.legend = legendFor(pts.map((x) => x.c || ""));
              if (pv.ringBy) data.legend = [...(data.legend || []), ...legendFor(pts.map((x) => x.r || ""), true)];
            }
          }
          const shapeNote = data.shape === "box" && data.overlay === "violin"
              ? "Drawn as a density per group: " + data.n.toLocaleString("en-US") + " values is past what a cloud of dots can show, " +
                "and the quartiles are over every one of them."
              : data.shape === "box" && data.overlay === "points"
              ? "Every value is drawn over its box; the jitter is fixed per case, so the figure does not move between renderings."
              : data.shape === "scatter" && data.n > 5000
              ? "Drawn as density: " + data.n.toLocaleString("en-US") + " " + (unit === "sample" ? "samples" : "patients") +
                " counted into " + (data.bins || []).length.toLocaleString("en-US") + " cells. The coefficients are over every " +
                (unit === "sample" ? "sample" : "patient") + ", not over what you can see."
              : undefined;
          // what the pair left out leads: cases missing either axis are not on the figure at all
          const pr: ViewResult = {
            kind: "plot", plot: data, cohorts: [cn], studies: sites,
            participation: participationFor(sites, false),
            note: [coverageNote(data, unit), shapeNote].filter(Boolean).join(" ") || undefined
          };
          // drawn on the server, like every view but the oncoprint, so chat and MCP get the figure
          const tPlot = Date.now();
          pr.svg = viewToSvg(pr, { width: 960 }) || undefined;
          pr.renderMs = Date.now() - tPlot;
          views.push(pr);
        } else {
          // Federated: each site answers a smaller, self-contained question (its own extent, its
          // own bin counts against a shared grid, its own six sums, its own contingency cells or
          // box quartiles) and this pools them — the same division of labour co-expression's
          // pairMoments already uses. A participant that cannot answer these yet (a remote MCP
          // peer, today) is named rather than silently skipped.
          const missing = sites.filter((s) => !hasFederatedPlot(resolvers[s]));
          if (missing.length) {
            views.push({ kind: "plot", error: "a federated plot needs every participant to support it, and " +
              missing.join(", ") + " does not yet (a remote peer over MCP, most likely)." });
            continue;
          }
          const fr = resolvers as Record<string, Resolver & FederatedPlotCapable>;
          const { xk, yk, shape, xLabel, yLabel } = await fr[sites[0]].plotAxisKinds(spec);
          if (shape === "waterfall") throw new Error("an ordered-cases axis (a waterfall) is not implemented yet; give both axes a source");
          const label = { x: { label: xLabel, kind: xk }, y: { label: yLabel, kind: yk } };
          const scaleNote = sites.length + " studies pooled (" + sites.join(", ") + ")";
          let data: PlotData;

          if (shape === "scatter") {
            const extents = await Promise.all(sites.map((s) => fr[s].plotExtent(doc.cohorts[cn], spec, xk, yk)));
            const have = extents.filter((e) => e.n > 0);
            const n = have.reduce((a, e) => a + e.n, 0);
            if (!n) { data = { shape, n: 0, ...label, note: "no " + unit + " has a value on both axes" }; }
            else {
              // The shared scale every site's bin counts get re-queried against — see
              // plotBinsSql's `extent` parameter. Pooled exactly (min of mins, max of maxes),
              // unlike a quartile, an extent has no approximation to caveat.
              const extent = { x0: Math.min(...have.map((e) => e.x0)), x1: Math.max(...have.map((e) => e.x1)),
                y0: Math.min(...have.map((e) => e.y0)), y1: Math.max(...have.map((e) => e.y1)) };
              const [binParts, momentParts] = await Promise.all([
                Promise.all(sites.map((s) => fr[s].plotBinCounts(doc.cohorts[cn], spec, xk, yk, bins, extent))),
                Promise.all(sites.map((s) => fr[s].plotMoments(doc.cohorts[cn], spec, xk, yk)))
              ]);
              const cellCounts = new Map<string, number>();
              for (const part of binParts) for (const c of part) {
                const key = c.bx + "," + c.by;
                cellCounts.set(key, (cellCounts.get(key) || 0) + c.n);
              }
              const pooledM = momentParts.reduce((a, m) => ({ n: a.n + m.n, sx: a.sx + m.sx, sy: a.sy + m.sy,
                sxy: a.sxy + m.sxy, sxx: a.sxx + m.sxx, syy: a.syy + m.syy }),
                { n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 } as Moments);
              const corr = pearsonFromMoments(pooledM), reg = regressionFromMoments(pooledM);
              data = { shape, n, ...label, extent, grid: bins,
                bins: [...cellCounts.entries()].map(([k, cn2]) => {
                  const [bx, by] = k.split(",").map(Number); return { bx, by, n: cn2 };
                }),
                stats: { pearson: corr.r, spearman: null, slope: reg.slope, intercept: reg.intercept,
                  pPearson: corr.r != null ? corr.p : null, pSpearman: null },
                note: scaleNote + ". Each site reports six sums (n, Σx, Σy, Σxy, Σx², Σy²), exact and additive, for" +
                  " Pearson's r and the regression line; the bin grid uses one shared scale (each site's own extent," +
                  " pooled) so cells sum correctly. Spearman rank correlation is not reported for a federated plot: it" +
                  " needs the pooled GLOBAL ranking, which per-site aggregates cannot reconstruct exactly." };
            }
          } else if (shape === "table") {
            const parts = await Promise.all(sites.map((s) => fr[s].plotTableCells(doc.cohorts[cn], spec, xk, yk)));
            const cellCounts = new Map<string, number>();
            for (const part of parts) for (const c of part) {
              const key = c.cx + "" + c.cy;
              cellCounts.set(key, (cellCounts.get(key) || 0) + c.n);
            }
            const cells = [...cellCounts.entries()].map(([k, n2]) => {
              const [cx, cy] = k.split(""); return { cx, cy, n: n2 };
            }).sort((a, b) => b.n - a.n);
            const n = cells.reduce((a, c) => a + c.n, 0);
            const kx = new Set(cells.map((c) => c.cx)).size, ky = new Set(cells.map((c) => c.cy)).size;
            if (!n) { data = { shape, n: 0, ...label, note: "no " + unit + " has a value on both axes" }; }
            else if (kx > CATEGORY_CAP || ky > CATEGORY_CAP)
              throw new Error("this pair has " + Math.max(kx, ky) + " distinct categories on one axis and " + CATEGORY_CAP +
                " is the most a contingency table stays readable (and testable) at; narrow the cohort or pick another attribute");
            else data = { shape, n, ...label, cells,
              note: scaleNote + ". Contingency counts are exact sums — a category means the same thing whichever" +
                " site records it, so there is no shared-scale question here the way there is for a numeric axis." };
          } else {
            // box: numeric axis grouped by the categorical one, pooled per group
            const parts = await Promise.all(sites.map((s) => fr[s].plotBoxRows(doc.cohorts[cn], spec, xk, yk)));
            const byGroup = new Map<string, { n: number; lo: number; hi: number; q1w: number; medw: number; q3w: number }>();
            for (const rows of parts) for (const r of rows) {
              const cur = byGroup.get(r.g) || { n: 0, lo: r.lo, hi: r.hi, q1w: 0, medw: 0, q3w: 0 };
              // n/lo/hi are exact; q1/median/q3 are size-weighted across sites, the same
              // approximation Explore's federated numeric histograms already use and disclose —
              // it shifts where an outlier bar falls, never a count.
              byGroup.set(r.g, { n: cur.n + r.n, lo: Math.min(cur.lo, r.lo), hi: Math.max(cur.hi, r.hi),
                q1w: cur.q1w + r.q1 * r.n, medw: cur.medw + r.median * r.n, q3w: cur.q3w + r.q3 * r.n });
            }
            if (byGroup.size > CATEGORY_CAP)
              throw new Error("more than " + CATEGORY_CAP + " groups on the categorical axis; narrow the cohort or pick another attribute");
            const groups: PlotGroup[] = [...byGroup.entries()].map(([g, a]) => {
              const q1 = a.q1w / a.n, median = a.medw / a.n, q3 = a.q3w / a.n;
              const t = tukey(q1, q3, a.lo, a.hi);
              return { g, n: a.n, lo: a.lo, hi: a.hi, q1, median, q3, loWhisker: t.loWhisker, hiWhisker: t.hiWhisker };
            });
            const n = groups.reduce((a, g) => a + g.n, 0);
            data = { shape, n, ...label, groups, overlay: "none",
              note: scaleNote + ". Counts and extremes per group sum exactly; the quartiles are a size-weighted" +
                " approximation across sites (it can shift where an outlier bar falls, never a count). A federated" +
                " box does not draw a density behind it — that needs the same shared-scale binning a scatter does," +
                " not yet built for this shape — so points are shown when an entitled site has few enough to draw." };
            // Points, unlike a density, just concatenate: each entitled site's own case-level
            // rows are already independent of any shared scale. A site that may not disclose
            // cases contributes none, the same rule the oncoprint's columns follow.
            if (pv.points !== false) {
              const perSite = await Promise.all(sites.map((s) =>
                isPatientLevel(resolvers[s]) ? resolvers[s].plotPoints(doc.cohorts[cn], spec) : Promise.resolve([])));
              const pts = perSite.flat();
              if (pts.length && pts.length <= POINTS_CAP) {
                data.points = pts; data.overlay = "points";
                if (pv.colorBy) data.legend = legendFor(pts.map((x) => x.c || ""));
                if (pv.ringBy) data.legend = [...(data.legend || []), ...legendFor(pts.map((x) => x.r || ""), true)];
              }
            }
          }

          // each site counts its own cases and their axes; the sums are exact
          const covs = await Promise.all(sites.map((s) => fr[s].plotCoverage(doc.cohorts[cn], spec, xk, yk).catch(() => null)));
          if (covs.every(Boolean)) data.coverage = covs.reduce<{ total: number; nx: number; ny: number }>(
            (a, c) => ({ total: a.total + c!.total, nx: a.nx + c!.nx, ny: a.ny + c!.ny }), { total: 0, nx: 0, ny: 0 });
          const pr: ViewResult = { kind: "plot", plot: data, cohorts: [cn], studies: sites,
            participation: participationFor(sites, false), note: [coverageNote(data, unit), data.note].filter(Boolean).join(" ") || undefined };
          const tPlot = Date.now();
          pr.svg = viewToSvg(pr, { width: 960 }) || undefined;
          pr.renderMs = Date.now() - tPlot;
          views.push(pr);
        }
      } catch (e) {
        views.push({ kind: "plot", error: String((e as Error).message || e) });
      }
    } else if (view.kind === "coexpression") {
      const v = view as CoexpressionView;
      const profileType = String(v.profileType || "").trim();
      const uniq = geneSymbols(v.genes);
      { const e = overLimit("a coexpression view", COOCCUR_GENE_LIMIT, uniq.length);
        if (e) { views.push({ kind: "coexpression", error: e.replace("at most " + COOCCUR_GENE_LIMIT, "at most " + COOCCUR_GENE_LIMIT + " genes") }); continue; } }
      if (!profileType) { views.push({ kind: "coexpression", error: "coexpression view needs a profileType (e.g. rna_seq_v2_mrna_median_Zscores)" }); continue; }
      if (uniq.length < 2) { views.push({ kind: "coexpression", error: "coexpression needs at least 2 distinct genes" }); continue; }
      const pairs: [string, string][] = [];
      for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) pairs.push([uniq[i], uniq[j]]);
      const cn = vNames[0];
      const byStudy = new Map<string, PairMoments[]>();
      await Promise.all(cohorts[cn].studies.map(async (st) => {
        byStudy.set(st, await resolvers[st].pairMoments(doc.cohorts[cn], pairs, profileType).catch(() => []));
      }));
      const sites = [...byStudy.keys()];
      const rows: CoexprRow[] = pairs.map(([a, b]) => {
        const parts = sites
          .map((st) => ({ st, m: (byStudy.get(st) || []).find((x) => x.a === a && x.b === b) }))
          .filter((x): x is { st: string; m: PairMoments } => !!x.m && x.m.n > 0);
        const total = parts.reduce((acc, { m }) => ({
          n: acc.n + m.n, sx: acc.sx + m.sx, sy: acc.sy + m.sy,
          sxy: acc.sxy + m.sxy, sxx: acc.sxx + m.sxx, syy: acc.syy + m.syy
        }), { n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 });
        const pooled = pearsonFromMoments(total);
        const row: CoexprRow = { a, b, r: pooled.r, n: pooled.n, p: pooled.p, q: 1 };
        if (parts.length > 1) {
          const per = parts.map(({ st, m }) => ({ study: st, ...pearsonFromMoments(m) }));
          const meta = fisherZMeta(per.map((x) => ({ r: x.r, n: x.n })));
          row.perStudy = per.map((x) => ({ study: x.study, r: x.r, n: x.n }));
          row.rMeta = meta.r; row.pMeta = meta.p; row.sites = meta.sites;
        }
        return row;
      });
      const tested = rows.filter((r) => r.r != null);
      benjaminiHochberg(tested.map((r) => r.pMeta ?? r.p)).forEach((q, i) => { tested[i].q = q; });
      rows.sort((x, y) => Math.abs(y.r ?? 0) - Math.abs(x.r ?? 0));
      views.push({ kind: "coexpression", cohorts: [cn], coexpression: rows, studies: cohorts[cn].studies,
        participation: participationFor(cohorts[cn].studies, false),
        note: "Pearson correlation on “" + profileType + "” within “" + cn + "”, over the patients with BOTH values" +
          " (values averaged per patient, matching the heatmap convention). Each site reports six sums — n, Σx, Σy," +
          " Σxy, Σx², Σy² — and nothing else; those sums are additive, so the pooled correlation is EXACT rather than" +
          " an approximation of a centralized one." +
          (sites.length > 1
            ? " Two answers are given because they ask different questions: r pools every patient into one population," +
              " while r(meta) combines the per-study correlations by Fisher z, weighted by study size — the latter asks" +
              " whether the genes move together WITHIN a study, which differing study means can otherwise mask."
            : "") +
          " q-values are Benjamini–Hochberg across the " + tested.length + " pairs with a defined correlation." });

    } else if (view.kind === "clinical") {
      const attrs = ((view as ClinicalView).attributes || [])
        .map((a) => String(a).trim()).filter((a) => /^[A-Za-z0-9_]{1,64}$/.test(a));
      if (!attrs.length) { views.push({ kind: "clinical", error: "clinical view needs attributes" }); continue; }
      { const e = overLimit("a clinical view", 20, attrs.length); if (e) { views.push({ kind: "clinical", error: e.replace("at most 20", "at most 20 attributes") }); continue; } }
      if (vNames.length < 2) { views.push({ kind: "clinical", error: "clinical comparison needs at least 2 cohorts" }); continue; }
      // cohort -> study -> that site's description of each attribute
      const stats = new Map<string, AttrStats[]>();  // "cohort|study"
      await Promise.all(vNames.flatMap((n) =>
        cohorts[n].studies.map(async (st) => {
          stats.set(n + "|" + st, await resolvers[st].attributeStats(doc.cohorts[n], attrs));
        })));
      const rows: ClinicalRow[] = [];
      for (const attribute of attrs) {
        const pick = (n: string, st: string) => (stats.get(n + "|" + st) || []).find((x) => x.attribute === attribute);
        const all = vNames.flatMap((n) => cohorts[n].studies.map((st) => pick(n, st))).filter((x): x is AttrStats => !!x);
        if (!all.length) { rows.push({ attribute, per: "patient", kind: "cat", cells: [], skipped: "no participating study reports this attribute" }); continue; }
        const refused = all.find((x) => x.skipped);
        if (refused) { rows.push({ attribute, per: refused.per, kind: refused.kind, cells: [], skipped: refused.skipped }); continue; }
        // Sites disagreeing on the TYPE of an attribute is a real possibility and
        // is refused, not resolved by majority — silently dropping the dissenting
        // study's patients would understate the cohort with no way to notice.
        const kinds = [...new Set(all.map((x) => x.kind))];
        if (kinds.length > 1) {
          rows.push({ attribute, per: all[0].per, kind: all[0].kind, cells: [],
            skipped: "the participating studies disagree on its type (" + kinds.join(" vs ") + "); comparing them would mean discarding one side's patients" });
          continue;
        }
        const kind = kinds[0], per = all[0].per;
        if (kind === "cat") {
          const cells = vNames.map((n) => {
            const merged = new Map<string, number>();
            for (const st of cohorts[n].studies)
              for (const v of pick(n, st)?.values || []) merged.set(v.v, (merged.get(v.v) || 0) + v.n);
            const values = [...merged].map(([v, c]) => ({ v, n: c })).sort((x, y) => y.n - x.n);
            return { cohort: n, n: values.reduce((s, x) => s + x.n, 0), top: values.slice(0, 5), values };
          });
          const vocab = [...new Set(cells.flatMap((c) => c.values.map((v) => v.v)))];
          const table = cells.map((c) => vocab.map((v) => c.values.find((x) => x.v === v)?.n || 0));
          const t = chiSquareTest(table);
          rows.push({ attribute, per, kind, test: "chi-squared",
            cells: cells.map(({ cohort, n, top }) => ({ cohort, n, top })),
            distinct: vocab.length, p: t.p, df: t.df, statistic: t.chi2, minExpected: t.minExpected, q: 1 });
        } else {
          const cells = vNames.map((n) => {
            let n0 = 0, sum = 0, sumsq = 0, mn = Infinity, mx = -Infinity;
            for (const st of cohorts[n].studies) {
              const s = pick(n, st); if (!s || !s.n) continue;
              n0 += s.n!; sum += s.sum!; sumsq += s.sumsq!;
              mn = Math.min(mn, s.min!); mx = Math.max(mx, s.max!);
            }
            const variance = varianceFromMoments(n0, sum, sumsq);
            return { cohort: n, n: n0, mean: n0 ? Math.round((sum / n0) * 1e3) / 1e3 : null,
              sd: Math.round(Math.sqrt(variance) * 1e3) / 1e3,
              min: Number.isFinite(mn) ? mn : null, max: Number.isFinite(mx) ? mx : null, variance };
          });
          const row: ClinicalRow = { attribute, per, kind, q: 1,
            cells: cells.map(({ variance, ...c }) => c) };
          if (vNames.length === 2) {
            const [x, y] = cells;
            const w = welchT(x.n, x.mean ?? 0, x.variance, y.n, y.mean ?? 0, y.variance);
            row.test = "Welch t"; row.statistic = w.t; row.df = w.df; row.p = w.p;
          } else {
            row.skipped = "a numeric attribute is tested only for exactly 2 cohorts";
          }
          rows.push(row);
        }
      }
      const tested = rows.filter((r) => r.p != null);
      benjaminiHochberg(tested.map((r) => r.p!)).forEach((q, i) => { tested[i].q = q; });
      rows.sort((a, b) => (a.p ?? 2) - (b.p ?? 2));
      views.push({ kind: "clinical", cohorts: vNames, clinical: rows, studies: vStudies,
        participation: participationFor(vStudies, false),
        note: "Categorical attributes are compared with a Pearson chi-squared over the full value vocabulary;" +
          " numeric ones with Welch's unequal-variance t-test computed from (n, Σx, Σx²) — those three totals are" +
          " ADDITIVE across sites, so the pooled mean and variance are exact from per-site aggregates and no" +
          " individual value is ever transmitted. Counting unit follows the attribute: patients for patient-level," +
          " samples for sample-level. q-values are Benjamini–Hochberg across the " + tested.length + " tested attributes." +
          (vStudies.length > 1 ? " Counts are pooled across " + vStudies.length + " studies without harmonizing vocabularies; an attribute the studies type differently is refused rather than merged." : "") });

    } else if (view.kind === "cooccurrence") {
      // Co-occurrence is a property of ONE cohort, not a comparison between two,
      // so it reads the first cohort in the view and says which.
      const uniq = geneSymbols((view as CooccurrenceView).genes);
      { const e = overLimit("a co-occurrence view", COOCCUR_GENE_LIMIT, uniq.length);
        if (e) { views.push({ kind: "cooccurrence", error: e.replace("at most " + COOCCUR_GENE_LIMIT, "at most " + COOCCUR_GENE_LIMIT + " genes") }); continue; } }
      if (uniq.length < 2) { views.push({ kind: "cooccurrence", error: "co-occurrence needs at least 2 distinct genes" }); continue; }
      const pairs: [string, string][] = [];
      for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) pairs.push([uniq[i], uniq[j]]);
      const cn = vNames[0];
      const byStudy = new Map<string, PairCounts[]>();
      await Promise.all(cohorts[cn].studies.map(async (st) => {
        byStudy.set(st, await resolvers[st].pairCounts(doc.cohorts[cn], pairs));
      }));
      const sites = [...byStudy.keys()];
      const find = (st: string, a: string, b: string) =>
        (byStudy.get(st) || []).find((r) => r.a === a && r.b === b);
      const rows: CooccurRow[] = pairs.map(([a, b]) => {
        const parts = sites.map((st) => find(st, a, b)).filter((x): x is PairCounts => !!x);
        const sum = (f: (x: PairCounts) => number) => parts.reduce((n, x) => n + f(x), 0);
        const both = sum((x) => x.both), onlyA = sum((x) => x.onlyA),
              onlyB = sum((x) => x.onlyB), neither = sum((x) => x.neither);
        const row: CooccurRow = {
          a, b, both, onlyA, onlyB, neither, profiled: both + onlyA + onlyB + neither,
          log2Odds: log2OddsRatio(both, onlyA, onlyB, neither),
          p: fisherExact(both, onlyA, onlyB, neither),
          q: 1, tendency: null
        };
        if (sites.length > 1) {
          // Each site is a stratum: the association is asked WITHIN each study and
          // combined, so differing case mix cannot manufacture (or hide) a pair.
          const cmh = cochranMantelHaenszel(parts.map((x) => ({ a: x.both, b: x.onlyA, c: x.onlyB, d: x.neither })));
          row.pStratified = cmh.p; row.oddsRatioMH = cmh.oddsRatio; row.strata = cmh.tables;
        }
        const lor = row.oddsRatioMH != null ? Math.log2(row.oddsRatioMH) : row.log2Odds;
        row.tendency = lor == null || !Number.isFinite(lor) || lor === 0 ? null
          : lor > 0 ? "co-occurrence" : "mutual exclusivity";
        return row;
      });
      // A pair no panel covers is not a null result — it is an unasked question.
      // Drop it from the ranking (it would otherwise sit there as p=1 with four
      // zeros, indistinguishable from "tested, found nothing") and name it.
      const unassessable = rows.filter((r) => r.profiled === 0);
      const assessable = rows.filter((r) => r.profiled > 0);
      // multiplicity is real here: 12 genes is 66 simultaneous tests
      const primary = assessable.map((r) => r.pStratified ?? r.p);
      benjaminiHochberg(primary).forEach((q, i) => { assessable[i].q = q; });
      assessable.sort((x, y) => (x.pStratified ?? x.p) - (y.pStratified ?? y.p));
      rows.length = 0; rows.push(...assessable);
      views.push({ kind: "cooccurrence", cohorts: [cn], rows: undefined, pairs: rows,
        studies: cohorts[cn].studies,
        participation: participationFor(cohorts[cn].studies, false),
        note: "Pairwise co-occurrence within “" + cn + "”" +
          (vNames.length > 1 ? " (the first cohort in this view; co-occurrence describes one cohort, not a contrast)" : "") +
          ". Denominators are the patients profiled for BOTH genes, computed per study against that study's own panels" +
          " — a pair is never scored on patients whose panel could not have detected it." +
          (sites.length > 1
            ? " With " + sites.length + " studies the reported test is STRATIFIED by study (Cochran–Mantel–Haenszel):" +
              " each study contributes a 2×2 and the coordinator combines them, so a pair cannot be manufactured by" +
              " differing case mix between sites. The pooled Fisher p is shown alongside."
            : " Two-sided Fisher exact test.") +
          " q-values are Benjamini–Hochberg across the " + assessable.length + " assessable pairs." +
          (unassessable.length
            ? " " + unassessable.length + " of " + pairs.length + " pairs are NOT assessable here — no panel in this cohort" +
              " covers both genes, so there is no denominator to test on (" +
              unassessable.slice(0, 4).map((r) => r.a + "/" + r.b).join(", ") +
              (unassessable.length > 4 ? ", …" : "") + "). They are omitted rather than reported as a null result."
            : "") +
          " Every site returns four counts per pair and nothing else." });

    } else if (view.kind === "oncoprint") {
      // Oncoprint columns ARE patients, so an instance that will not disclose
      // member ids cannot contribute columns. Render what is permitted and say
      // exactly what was left out — never silently narrow the cohort.
      const okStudies = vStudies.filter((st) => isPatientLevel(resolvers[st]));
      const withheld = vStudies.filter((st) => !isPatientLevel(resolvers[st]));
      const withheldPts = vNames.reduce((n, cn) =>
        n + withheld.reduce((m, st) => m + (cohorts[cn].perStudy[st]?.count || 0), 0), 0);
      const shownPts = vNames.reduce((n, cn) =>
        n + okStudies.reduce((m, st) => m + (cohorts[cn].perStudy[st]?.count || 0), 0), 0);
      if (!okStudies.length) {
        views.push({ kind: "oncoprint", cohorts: vNames, studies: vStudies,
          participation: participationFor(vStudies, true),
          error: "no participating instance permits patient-level access, and an oncoprint's columns are patients — " +
            withheld.join(", ") + " answer with aggregates only. Compare and survival still cover all " +
            (shownPts + withheldPts).toLocaleString() + " patients." });
        continue;
      }
      const multi = okStudies.length > 1;
      const genes = (view as OncoprintView).genes || [];
      { const e = overLimit("an oncoprint view", 12, genes.length) || overLimit("an oncoprint view", 3, ((view as OncoprintView).derivedCohorts || []).length);
        if (e) { views.push({ kind: "oncoprint", error: e.replace("at most 12", "at most 12 gene rows").replace("at most 3", "at most 3 derived-cohort rows") }); continue; } }
      // Federated z-score reference: a heatmap track marked reference:"federation"
      // is scored against a distribution pooled from EVERY participating study,
      // including the aggregate-only ones that contribute no columns. Each of
      // those returns three totals per gene — n, sum, sum of squares — so a site
      // that will not disclose a patient still shapes what the drawn columns mean.
      const heatSpecs = (view as OncoprintView).heatmap || [];
      const zReference: Record<string, ZReference> = {};
      for (const h of heatSpecs) {
        if (h.reference !== "federation" || /^vaf$/i.test(h.profileType)) continue;
        const hGenes = h.genes && h.genes.length ? geneSymbols(h.genes) : geneSymbols(genes);
        if (!hGenes.length) continue;
        const per = await Promise.all(vStudies.map(async (st) => ({
          st, m: await resolvers[st].profileMoments(null, hGenes, h.profileType).catch(() => [] as ProfileMoments[])
        })));
        for (const gene of hGenes) {
          let n = 0, sum = 0, sumsq = 0; const contributing: string[] = [];
          for (const { st, m } of per) {
            const g = m.find((x) => x.gene === gene);
            if (!g || !g.n) continue;
            n += g.n; sum += g.sum; sumsq += g.sumsq; contributing.push(st);
          }
          if (n < 3) continue;                       // too little to define a reference
          const sd = Math.sqrt(varianceFromMoments(n, sum, sumsq));
          if (!(sd > 0)) continue;                   // a constant reference cannot z-score anything
          zReference[h.profileType + "|" + gene] = { mean: sum / n, sd, n, studies: contributing };
        }
      }
      // federated: each group carries a {study: sql} map; each cohort contributes
      // only the studies it was actually evaluated in
      // The spec is built here either way: this is where the permitted studies, the
      // federated z-reference and the cohort definitions are known.
      const oncoSpec = {
        study: okStudies[0],
        studies: okStudies,
        genes,
        clinical: (view as OncoprintView).clinical || [],
        heatmap: (view as OncoprintView).heatmap || [],
        sort: (view as OncoprintView).sort,
        display: (view as OncoprintView).display,
        unit: (view as OncoprintView).unit,
        overlays: (view as OncoprintView).overlays,
        ...(Object.keys(zReference).length ? { zReference } : {}),
        // document cohorts the view asked to draw as binary rows; the engine refuses them
        // across studies and in sample mode, which are exactly the cases where "is this
        // patient in that cohort" has no single answer per column
        derivedEvents: ((view as OncoprintView).derivedCohorts || [])
          .filter((n) => doc.cohorts[n])
          .map((n) => ({ label: n, expression: doc.cohorts[n] })),
        conventions: { lineGap: 90 }
      };
      const note = (multi
        ? "cross-study oncoprint" + (okStudies.length <= 2 ? " (" + okStudies.join(", ") + ")" : " across " + okStudies.length + " studies") +
          ": duplicate patients across studies appear as separate columns; clinical tracks merge attribute values by name without harmonization; the Study track shows each column's origin"
        : "") +
        (withheld.length
          ? (multi ? " — " : "") + "columns cover " + shownPts.toLocaleString() + " of " +
            (shownPts + withheldPts).toLocaleString() + " patients: " + withheld.join(", ") +
            " answer with aggregates only, so their patients cannot be drawn as columns (compare and survival above include them)"
          : "");
      const oncoShared = { kind: "oncoprint" as const, cohorts: vNames,
        participation: participationFor(vStudies, true),
        ...(multi || withheld.length ? { studies: okStudies, note } : {}) };

      if (opts.oncoprint === "spec") {
        // The web app draws the figure itself from the binary contract, so the run
        // returns what to ask for rather than a picture: the cohort DEFINITIONS travel
        // (compiled SQL never leaves the server), and the client posts this to
        // /api/oncoprint. Nothing is queried for this view here.
        views.push({ ...oncoShared, spec: { ...oncoSpec,
          layout: { groupBy: { kind: "cohorts" as const, groups: vNames.map((n) => ({ name: n, dsl: doc.cohorts[n] })) } } } });
      } else {
        const oncoLog: { label: string; sql: string; ms?: number; study?: string }[] = [];
        const tQuery = Date.now();
        const contract = await buildContract({ ...oncoSpec,
          layout: { groupBy: { kind: "cohorts" as const, groups: vNames.map((n) => ({ name: n, dsl: {
            [PIDS_SQL]: multi
              ? Object.fromEntries(okStudies.filter((s) => cohorts[n].perStudy[s]).map((s) => [s, cohorts[n].perStudy[s].sql]))
              : cohorts[n].perStudy[okStudies[0]].sql
          } as PidsCarrier })) } }
        }, { log: oncoLog });
        const oncoQueryMs = Date.now() - tQuery;
        const tRender = Date.now();
        const oncoSvg = contractToSvg(contract, 1200);
        const oncoRenderMs = Date.now() - tRender;
        views.push({ ...oncoShared, svg: oncoSvg,
          renderMs: oncoRenderMs,
          queries: oncoLog.map((q) => ({ study: q.study || okStudies[0], label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) })),
          genes: contract.tracks.filter((t) => t.kind === "gene").map((t) => ({ gene: t.label, driverPct: t.driverPct ?? null, anyPct: t.freqPct ?? null })),
          nColumns: contract.stats.nColumns, annotation: contract.conventions.annotation });
        void oncoQueryMs;
      }
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
  // by position rather than being threaded through every branch above.
  (doc.views || []).forEach((v, i) => {
    const note = v.note;
    if (views[i] && typeof note === "string" && note.trim()) views[i].annotationNote = note.trim();
  });

  return {
    study: docStudy, involvedStudies: involved, oncokbPin: pin,
    // Echoed so a reader can see WHICH values produced these numbers, the same
    // reason the OncoKB pin is echoed. `unusedParams` catches a rename that
    // missed a reference: the run succeeds, so nothing else would say so.
    ...(Object.keys(usedParams).length ? { params: usedParams } : {}),
    ...(unusedParams.length ? { unusedParams } : {}),
    cohorts: Object.fromEntries(names.map((n) => [n, {
      count: cohorts[n].count, text: cohorts[n].text,
      studies: cohorts[n].studies,
      sql: Object.entries(cohorts[n].perStudy).map(([s, x]) => "-- " + s + "\n" + x.sql).join("\n\n-- combined at the analysis layer: each study is evaluated separately against its own\n" +
        "-- instance and the counts are ADDED; patient overlap across studies is not deduplicated.\n\n")
    }])),
    views,
    stats: { ms: Date.now() - t0 }
  };
}
