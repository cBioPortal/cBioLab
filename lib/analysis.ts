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
import { fisherExact, kaplanMeier } from "./stats.ts";
import { contractToSvg } from "./oncoprint-svg.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, ViewResult, CompareRow, CompareCell, ChRow, OncoprintView, CompareView } from "./types.ts";
import type { PidsCarrier } from "./oncoprint.ts";
import {
  resolverFor, isPatientLevel, expandSurvivalCounts, studyRouting,
  type Resolver, type GeneCounts, type SurvivalCount, type Instance
} from "./federation.ts";

async function oncokbPin(): Promise<string | null> {
  try {
    const r = await chQuery(
      "SELECT oncokb_version FROM oncokb_annotation.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1");
    return r.data[0]?.oncokb_version || null;
  } catch { return null; }
}

const GENE_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

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
  if (!set.has(study)) throw new Error("unknown study '" + study.slice(0, 60) + "'");
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
      const pooled = new Map<string, SurvivalCount[]>(); // cohort -> triples
      await Promise.all(vNames.flatMap((n) =>
        cohorts[n].studies.map(async (st) => {
          const cs = await resolvers[st].survivalCounts(doc.cohorts[n]);
          pooled.set(n, [...(pooled.get(n) || []), ...cs]);
        })));
      const curves = vNames.map((n) => {
        const data = expandSurvivalCounts(pooled.get(n) || []);
        return { cohort: n, ...kaplanMeier(data), missing: cohorts[n].count - data.length };
      });
      views.push({ kind: "survival", cohorts: vNames, curves,
        caveat: "OS from each study's own baseline (left truncation applies" +
          (vStudies.length > 1 ? "; baselines are NOT harmonized across studies" : "") + "); status '0:...' treated as censored." });

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
