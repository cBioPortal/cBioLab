// Analysis-document engine: evaluate named cohorts (DSL v2) and produce view results.
// Document: { study: "<default>", cohorts: {name: def}, views: [{kind, ...}] }
// A cohort may override with "study" or "studies": [...] — it is evaluated per study
// (compilers stay single-study) and members are unioned as fully-qualified patient ids
// ("<study>_<patient>"). Views fetch data per involved study and join on those ids.
// Deliberately deferred: cross-study patient dedup and attribute harmonization.
import { chQuery, DB, STUDY, PRIMARY } from "./ch.ts";
import { sq } from "./compiler.ts";
import { compileCohortDef, describeCohortDef } from "./cohort2.ts";
import { genomicEventsSql, coverageSql, buildContract, PIDS_SQL } from "./oncoprint.ts";
import { buildAnnotationIndex } from "./annotation.ts";
import { fisherExact, kaplanMeier, logRank, benjaminiHochberg, cochranMantelHaenszel, log2OddsRatio,
  chiSquareTest, welchT, varianceFromMoments } from "./stats.ts";
import { contractToSvg } from "./oncoprint-svg.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, ViewResult, CompareRow, CompareCell, ChRow, OncoprintView, CompareView, LogRank, CooccurrenceView, CooccurRow, ClinicalView, ClinicalRow } from "./types.ts";
import type { PidsCarrier } from "./oncoprint.ts";
import {
  resolverFor, isPatientLevel, expandSurvivalCounts, studyRouting, restrictedStudies,
  type Resolver, type GeneCounts, type SurvivalCount, type Instance, type PairCounts, type AttrStats
} from "./federation.ts";

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

let _studySet: Set<string> | null = null;
/** Every study any configured instance holds (federation-aware). */
export async function validStudies(): Promise<Set<string>> {
  if (_studySet) return _studySet;
  _studySet = new Set((await studyRouting()).keys());
  return _studySet;
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

export async function runAnalysis(doc: AnalysisDoc): Promise<AnalysisResult> {
  const t0 = Date.now();
  const docStudy = await resolveStudy(doc.study);
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const names = Object.keys(doc.cohorts || {}).slice(0, 6);
  if (!names.length) throw new Error("document has no cohorts");

  // ---- evaluate cohorts: per study, union fully-qualified members ---------
  const cohorts: Record<string, { studies: string[]; members: Set<string>; perStudy: Record<string, { sql: string; count: number; mode: string }>; count: number; text: string }> = {};
  const resolvers: Record<string, Resolver> = {}; // study -> its instance's resolver
  for (const name of names) {
    const def = doc.cohorts[name];
    const studies = [];
    for (const s of cohortStudies(def, docStudy)) studies.push(await resolveStudy(s, docStudy));
    const members = new Set<string>(); // "<study>_<pid>" — patient-level instances only
    const perStudy: Record<string, { sql: string; count: number; mode: string }> = {};
    // per-study evaluation in parallel; each study is answered by its instance's
    // resolver, which may or may not be permitted to return member ids
    const evals = await Promise.all(studies.map(async (s) => {
      const { profiles, gaProfiles } = await studyProfiles(s);
      const res = await resolverFor(s, { oncokbPin: pin, profiles, gaProfiles });
      resolvers[s] = res;
      const sql = res.cohortSql(def);
      if (isPatientLevel(res)) return { s, res, sql, pids: await res.members(def), count: -1 };
      return { s, res, sql, pids: null, count: await res.count(def) };
    }));
    for (const { s, res, sql, pids, count } of evals) {
      if (pids) for (const p of pids) members.add(s + "_" + p);
      perStudy[s] = { sql, count: pids ? pids.length : count, mode: res.instance.mode };
    }
    cohorts[name] = {
      studies, members, perStudy,
      count: Object.values(perStudy).reduce((n, x) => n + x.count, 0),
      text: describeCohortDef(def) +
        (studies.length > 1 ? " — across " + studies.length + " studies" :
         studies[0] !== docStudy ? " — in " + studies[0] : "")
    };
  }
  const involved = [...new Set(Object.values(cohorts).flatMap((c) => c.studies))];

  // ---- views --------------------------------------------------------------
  const views: ViewResult[] = [];
  for (const view of (doc.views || []).slice(0, 6)) {
    const vNames = (view.cohorts && view.cohorts.length ? view.cohorts : names).filter((n) => cohorts[n]);
    const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];

    if (view.kind === "compare") {
      const genes = ((view as CompareView).genes || []).map((g) => String(g).toUpperCase().trim()).filter((g) => GENE_RE.test(g)).slice(0, 20);
      if (!genes.length) { views.push({ kind: "compare", error: "compare view needs genes" }); continue; }
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
      const perSite = new Map<string, Map<string, SurvivalCount[]>>(); // cohort -> study -> triples
      for (const n of vNames) perSite.set(n, new Map());
      await Promise.all(vNames.flatMap((n) =>
        cohorts[n].studies.map(async (st) => {
          perSite.get(n)!.set(st, await resolvers[st].survivalCounts(doc.cohorts[n]));
        })));
      const pointsFor = (n: string, st?: string) => expandSurvivalCounts(
        st ? (perSite.get(n)!.get(st) || []) : [...perSite.get(n)!.values()].flat());
      const curves = vNames.map((n) => {
        const data = pointsFor(n);
        return { cohort: n, ...kaplanMeier(data), missing: cohorts[n].count - data.length };
      });
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
      views.push({ kind: "survival", cohorts: vNames, curves,
        ...(logrank ? { logrank } : {}), ...(logrankPooled ? { logrankPooled } : {}),
        caveat: "OS from each study's own baseline (left truncation applies" +
          (vStudies.length > 1 ? "; baselines are NOT harmonized across studies" : "") + "); status '0:...' treated as censored." +
          (logrankPooled
            ? " The log-rank test is STRATIFIED by study (" + logrank!.strata + " strata contributed events): each study is" +
              " compared only against itself, so a difference in case mix between studies cannot masquerade as a difference" +
              " between cohorts. The pooled p is shown alongside — where the two disagree, the stratified one is the honest answer." +
              " Every site contributes only (months, event, n) counts; no patient-level survival time crosses an instance boundary."
            : logrank
              ? " Log-rank on a single study, so no stratification applies."
              : " Log-rank needs exactly two cohorts.") });

    } else if (view.kind === "clinical") {
      const attrs = ((view as ClinicalView).attributes || [])
        .map((a) => String(a).trim()).filter((a) => /^[A-Za-z0-9_]{1,64}$/.test(a)).slice(0, 20);
      if (!attrs.length) { views.push({ kind: "clinical", error: "clinical view needs attributes" }); continue; }
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
        note: "Categorical attributes are compared with a Pearson chi-squared over the full value vocabulary;" +
          " numeric ones with Welch's unequal-variance t-test computed from (n, Σx, Σx²) — those three totals are" +
          " ADDITIVE across sites, so the pooled mean and variance are exact from per-site aggregates and no" +
          " individual value is ever transmitted. Counting unit follows the attribute: patients for patient-level," +
          " samples for sample-level. q-values are Benjamini–Hochberg across the " + tested.length + " tested attributes." +
          (vStudies.length > 1 ? " Counts are pooled across " + vStudies.length + " studies without harmonizing vocabularies; an attribute the studies type differently is refused rather than merged." : "") });

    } else if (view.kind === "cooccurrence") {
      // Co-occurrence is a property of ONE cohort, not a comparison between two,
      // so it reads the first cohort in the view and says which.
      const genes = ((view as CooccurrenceView).genes || []).map((g) => String(g).toUpperCase().trim())
        .filter((g) => GENE_RE.test(g));
      const uniq = [...new Set(genes)].slice(0, COOCCUR_GENE_LIMIT);
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
          error: "no participating instance permits patient-level access, and an oncoprint's columns are patients — " +
            withheld.join(", ") + " answer with aggregates only. Compare and survival still cover all " +
            (shownPts + withheldPts).toLocaleString() + " patients." });
        continue;
      }
      const multi = okStudies.length > 1;
      const genes = ((view as OncoprintView).genes || []).slice(0, 12);
      // federated: each group carries a {study: sql} map; each cohort contributes
      // only the studies it was actually evaluated in
      const contract = await buildContract({
        study: okStudies[0],
        studies: okStudies,
        genes,
        clinical: (view as OncoprintView).clinical || [],
        heatmap: (view as OncoprintView).heatmap || [],
        sort: (view as OncoprintView).sort,
        derivedEvents: [],
        layout: { groupBy: { kind: "cohorts" as const, groups: vNames.map((n) => ({ name: n, dsl: {
          [PIDS_SQL]: multi
            ? Object.fromEntries(okStudies.filter((s) => cohorts[n].perStudy[s]).map((s) => [s, cohorts[n].perStudy[s].sql]))
            : cohorts[n].perStudy[okStudies[0]].sql
        } as PidsCarrier })) } },
        conventions: { lineGap: 90 }
      });
      views.push({ kind: "oncoprint", cohorts: vNames, svg: contractToSvg(contract, 1200),
        genes: contract.tracks.filter((t) => t.kind === "gene").map((t) => ({ gene: t.label, driverPct: t.driverPct ?? null, anyPct: t.freqPct ?? null })),
        nColumns: contract.stats.nColumns, annotation: contract.conventions.annotation,
        ...(multi || withheld.length ? { studies: okStudies,
          note: (multi
            ? "cross-study oncoprint" + (okStudies.length <= 2 ? " (" + okStudies.join(", ") + ")" : " across " + okStudies.length + " studies") +
              ": duplicate patients across studies appear as separate columns; clinical tracks merge attribute values by name without harmonization; the Study track shows each column's origin"
            : "") +
            (withheld.length
              ? (multi ? " — " : "") + "columns cover " + shownPts.toLocaleString() + " of " +
                (shownPts + withheldPts).toLocaleString() + " patients: " + withheld.join(", ") +
                " answer with aggregates only, so their patients cannot be drawn as columns (compare and survival above include them)"
              : "") } : {}) });
    } else {
      // unreachable for well-typed documents, but documents arrive as untrusted
      // JSON from clients/chat/MCP, so an unknown kind must still be reported
      views.push({ kind: String((view as { kind?: unknown }).kind ?? "unknown"), error: "unknown view kind" });
    }
  }

  return {
    study: docStudy, involvedStudies: involved, oncokbPin: pin,
    cohorts: Object.fromEntries(names.map((n) => [n, {
      count: cohorts[n].count, text: cohorts[n].text,
      studies: cohorts[n].studies,
      sql: Object.entries(cohorts[n].perStudy).map(([s, x]) => "-- " + s + "\n" + x.sql).join("\n\n-- UNION (federated at the analysis layer)\n\n")
    }])),
    views,
    stats: { ms: Date.now() - t0 }
  };
}
