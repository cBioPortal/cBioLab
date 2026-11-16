// Survival view: Kaplan-Meier curves pooled exactly from each participant's id-free
// (months, event, n) counts, with log-rank tests, all computed from those grouped rows directly.
import { kaplanMeierCounts, kmMedianCiCounts, logRankCounts, logRankKCounts, applyCutoffCounts, survSubjects, toIncidence, benjaminiHochberg, type SurvCount } from "../../stats.ts";
import type { ViewResult, LogRank, LogRankK } from "../../types.ts";
import type { SurvivalCount, EndpointColumns } from "../../federation.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { ATTR_NAME, askEachSite, answering, plural } from "../shared.ts";
import type { SurvivalView, SurvivalType } from "./types.ts";
import { survivalMethod } from "./method.ts";
import { partitionSurvivalSql, sharedPatientsSql, survivalStatusMetaSql } from "./sql.ts";

export async function runSurvival(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, vStudies, participationFor } = c;
  // Each participant returns (months, event, n) triples for its own patients:
  // aggregate, id-free, and poolable into an exact combined KM curve.
  // Triples are kept PER STUDY rather than merged on arrival, because the
  // log-rank statistic is additive over strata — keeping the site dimension
  // is what makes the stratified test available.
  const endpoint = String((view as SurvivalView).endpoint || "OS").toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) {
    return untimed({ kind: "survival", error: "bad survival endpoint '" + endpoint.slice(0, 40) + "'" });
  }
  // Escape hatch for a study whose outcome columns don't follow the <endpoint>_MONTHS/
  // <endpoint>_STATUS convention (a real gap, not hypothetical — several MSK papers store
  // e.g. PFS_MONTHS_FIRST_LINE_TX/PROGRESSION_STATUS). Both must be given together; endpoint
  // becomes purely a display label rather than something column names are derived from.
  const rawMonthsAttr = (view as SurvivalView).monthsAttribute, rawStatusAttr = (view as SurvivalView).statusAttribute;
  let columns: EndpointColumns | undefined;
  if (rawMonthsAttr != null || rawStatusAttr != null) {
    const monthsAttr = String(rawMonthsAttr || "").trim(), statusAttr = String(rawStatusAttr || "").trim();
    if (!ATTR_NAME.test(monthsAttr) || !ATTR_NAME.test(statusAttr)) {
      return untimed({ kind: "survival", endpoint,
        error: "monthsAttribute and statusAttribute must both be given as valid attribute names (a study attribute, or an uploaded column as custom:<dataset>/<COLUMN>): got '" +
          monthsAttr.slice(0, 40) + "'/'" + statusAttr.slice(0, 40) + "'" });
    }
    columns = { months: monthsAttr, status: statusAttr };
  }
  const columnsLabel = columns ? columns.months + "/" + columns.status : endpoint + "_MONTHS/" + endpoint + "_STATUS";
  const rawCutoff = (view as SurvivalView).cutoffMonths;
  let cutoffMonths: number | undefined;
  if (rawCutoff != null) {
    const c = Number(rawCutoff);
    if (!Number.isFinite(c) || c <= 0 || c > 1200) {
      return untimed({ kind: "survival", endpoint, error: "bad cutoffMonths '" + String(rawCutoff).slice(0, 40) + "': must be a positive number of months (max 1200)" });
    }
    cutoffMonths = c;
  }
  const rawTick = (view as SurvivalView).tickMonths;
  let tickMonths: number | undefined;
  if (rawTick != null) {
    const t = Number(rawTick);
    if (!Number.isFinite(t) || t <= 0 || t > 600) {
      return untimed({ kind: "survival", endpoint, error: "bad tickMonths '" + String(rawTick).slice(0, 40) + "': must be a positive number of months" });
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
  for (const { cohort: n, study: st, answer } of await askEachSite(c, resolvers, (n, _st, r) => r.survivalCounts(doc.cohorts[n], endpoint, anchor, columns)))
    perSite.get(n)!.set(st, answer);
  // An EMPTY COHORT also yields no rows, and must not be reported as a
  // missing endpoint — that sends the reader (or a model) off to conclude the
  // study lacks OS when it does not. Separate the two causes before blaming
  // either.
  const cohortTotal = vNames.reduce((n, cn) => n + cohorts[cn].count, 0);
  if (cohortTotal === 0) {
    return untimed({ kind: "survival", endpoint, cohorts: vNames,
      error: "nothing to plot: " + (vNames.length === 1 ? "cohort “" + vNames[0] + "” is" : "all cohorts are") +
        " empty. The endpoint is not the problem — check the cohort definition." });
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
      return untimed({ kind: "survival", endpoint,
        error: columns
          ? st + " has no data in " + columnsLabel + " (checked because monthsAttribute/statusAttribute were given explicitly)." +
            (eps.length ? " It does declare " + eps.join(", ") + " under the standard naming convention, if that's what was meant instead." : "")
          : eps.length
            ? st + " has no " + endpoint + " data (no " + columnsLabel + "). It does declare " +
              eps.join(", ") + " — pick one of those as the endpoint."
            : st + " has no survival data: it declares no <X>_MONTHS/<X>_STATUS pair, so there is no endpoint to plot." });
    }
    const avail = declared.map(({ st, eps }) => st + ": " + (eps.join(", ") || "none declared"));
    endpointHelp = " " + silent.length + " of " + vStudies.length + " stud" + (silent.length === 1 ? "y has" : "ies have") +
      " no " + (columns ? columnsLabel : endpoint) + " data and contribute" + (silent.length === 1 ? "s" : "") + " no patients here (" + avail.join("; ") + ").";
    if (silent.length === vStudies.length) {
      return untimed({ kind: "survival", endpoint,
        error: "no participating study has data in " + columnsLabel + "." + endpointHelp });
    }
  }
  // A patient in two cohorts is in two curves, and the log-rank test assumes the groups are
  // independent. How many are is always said. With `partitions` (the portal pages, as cBioPortal's
  // Include mode) the curves become the cohorts' overlaps, each patient in exactly one; without it
  // the test is given and called approximate. Asked per study, since ids are study-qualified; a
  // participant that cannot answer is named, not assumed disjoint.
  const opts = view as SurvivalView;
  const { shared, unchecked } = vNames.length >= 2 ? await sharedPatients(c) : { shared: 0, unchecked: [] };
  const split = opts.partitions === true && shared > 0;
  if (split && (columns || anchor)) {
    return untimed({ kind: "survival", endpoint,
      error: "the cohorts share " + plural(shared, "patient") + ", and their overlaps (partitions) are drawn only for a study's own <X>_MONTHS/<X>_STATUS endpoint, without an anchor or explicit columns" });
  }
  if (split && unchecked.length) {
    return untimed({ kind: "survival", endpoint,
      error: "the cohorts share " + plural(shared, "patient") + ", and their overlaps (partitions) cannot be counted at " + unchecked.join(", ") +
        " (" + (unchecked.length === 1 ? "a remote peer, which does not" : "remote peers, which do not") + " answer that yet)" });
  }
  const parts = split ? await partitionCounts(c, endpoint) : null;
  const names = parts ? parts.names : vNames;
  const sites = parts ? parts.perSite : perSite;
  const sizeAt = (n: string, st: string) => parts ? parts.sizes.get(n)!.get(st) || 0 : cohorts[n].perStudy[st]?.count || 0;
  // The rows stay grouped all the way through: the curve, the risk table and the tests read only
  // deaths, censorings and the number at risk at each distinct time, which the rows already give.
  const rowsOf = (rows: SurvivalCount[]): SurvCount[] =>
    rows.map((r) => r.entry == null ? { t: r.months, event: r.event, n: r.n } : { t: r.months, event: r.event, entry: r.entry, n: r.n });
  const countsFor = (n: string, st?: string) => {
    const rows = rowsOf(st ? (sites.get(n)!.get(st) || []) : [...sites.get(n)!.values()].flat());
    return cutoffMonths != null ? applyCutoffCounts(rows, cutoffMonths) : rows;
  };
  const curvesRaw = names.map((n) => {
    const rows = countsFor(n);
    const ci = kmMedianCiCounts(rows);
    const total = vStudies.reduce((k, st) => k + sizeAt(n, st), 0);
    return { cohort: n, ...kaplanMeierCounts(rows), medianCi: { lo: ci.lo, hi: ci.hi }, missing: total - survSubjects(rows) };
  });
  const curves = display === "incidence" ? curvesRaw.map((c) => toIncidence(c)) : curvesRaw;
  // Two cohorts is the case the 2-arm log-rank test is defined for, matching the compare
  // view's Fisher p; 3+ uses the k-group generalization (a (k-1)-df chi-squared from the
  // full covariance matrix) instead of running the 2-arm test pairwise, which would need
  // its own multiple-testing correction and answers a different question ("which PAIRS
  // differ") than "do these groups differ at all".
  //
  // A log-rank test from a handful of patients is not wrong, exactly, but a chi2/p computed
  // from (say) 1 vs 2 patients is statistically vacuous and a fully-formatted number reads
  // as a real result regardless — the same "loud refusal, not a silently thin answer" this
  // codebase applies everywhere else. MIN_ARM_N is a floor below which the test is refused
  // outright; the KM curves themselves still draw (they are descriptive, not a test). With
  // `testAnySize` (the portal pages) the test is given at any size, as cBioPortal gives it, over the
  // groups that have patients.
  const MIN_ARM_N = 10;
  const anySize = opts.testAnySize === true;
  const thinArms = anySize ? [] : curves.filter((c) => c.n < MIN_ARM_N).map((c) => c.cohort + " (n=" + c.n + ")");
  const tested = anySize ? names.filter((_, i) => curves[i].n > 0) : names;
  const fewGroups = names.length >= 2 && tested.length < 2;
  const { logrank, logrankPooled, logrankK, logrankKPooled } = thinArms.length || fewGroups ? {} : logRankOf(tested, sites, countsFor);
  // How long after the anchor patients actually became observable. A long
  // tail here is a warning about the anchor itself — "first Diagnosis" in a
  // study that records prior unrelated cancers can sit decades back.
  let entryMonths: { median: number; p90: number; max: number } | undefined;
  if (anchor) {
    // entry times in order, each standing for its row's n patients; a quantile is the entry of the
    // patient at that rank
    const es: [number, number][] = [];
    for (const byStudy of sites.values())
      for (const rows of byStudy.values())
        for (const r of rows) if (r.entry != null && r.n > 0) es.push([r.entry, r.n]);
    const total = es.reduce((k, [, n]) => k + n, 0);
    if (total) {
      es.sort((x, y) => x[0] - y[0]);
      const at = (q: number) => {
        const rank = Math.floor(q * (total - 1));
        let seen = 0, i = 0;
        while (seen + es[i][1] <= rank) seen += es[i++][1];
        return Math.round(es[i][0] * 10) / 10;
      };
      entryMonths = { median: at(0.5), p90: at(0.9), max: at(1) };
    }
  }
  const unobservedTotal = curvesRaw.reduce((sum, c) => sum + (c.unobserved || 0), 0);
  const beyondCutoff = cutoffMonths != null
    ? names.reduce((sum, n) => sum + survSubjects(rowsOf([...sites.get(n)!.values()].flat())
        .filter((r) => r.t > cutoffMonths!)), 0)
    : 0;
  const typed = (view as SurvivalView).types === true && !columns && !anchor
    ? await survivalTypes(c, endpoint, names, sites, parts ? (e) => partitionCounts(c, e).then((x) => x.perSite) : null, { minArm: anySize ? 0 : MIN_ARM_N }) : null;
  const types = typed && typed.types;
  return { kind: "survival", cohorts: vNames, curves, endpoint,
    ...(types ? { types } : {}),
    ...(entryMonths ? { entryMonths } : {}),
    ...(anchor ? { anchoredTo: anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : ""), truncated: true } : {}),
    ...(cutoffMonths != null ? { cutoffMonths } : {}), ...(tickMonths != null ? { tickMonths } : {}),
    ...(display === "incidence" ? { display } : {}),
    participation: participationFor(vStudies, false),
    ...(logrank ? { logrank } : {}), ...(logrankPooled ? { logrankPooled } : {}),
    ...(logrankK ? { logrankK } : {}), ...(logrankKPooled ? { logrankKPooled } : {}),
    ...(shared > 0 ? { sharedPatients: shared, ...(parts ? { partitioned: true } : {}) } : {}),
    method: survivalMethod({
      endpoint, monthsColumn: columns ? columns.months : endpoint + "_MONTHS", statusColumn: columns ? columns.status : endpoint + "_STATUS",
      queryLabel: "survivalCounts:" + endpoint + (anchor ? "@" + anchor.eventType : ""),
      ...(anchor ? { anchor: anchor.occurrence!.toLowerCase() + " " + anchor.eventType + (anchor.key ? " where " + anchor.key + "=" + anchor.value : "") } : {}),
      ...(cutoffMonths != null ? { cutoffMonths } : {}), beyondCutoff, display,
      ...(parts ? { partitions: { cohorts: vNames, shared, groups: names.map((n) => ({ name: n, patients: vStudies.reduce((k, st) => k + sizeAt(n, st), 0) })) } } : {}),
      cohorts: curvesRaw.map((c) => ({
        name: c.cohort, n: c.n, events: c.events, median: c.median, ...(c.unobserved ? { unobserved: c.unobserved } : {}),
        perStudy: [...sites.get(c.cohort)!.entries()].map(([st, rows]) => ({
          study: st, cohortPatients: sizeAt(c.cohort, st),
          patients: rows.reduce((k, r) => k + r.n, 0), rows: rows.length })),
      })),
      ...(typed ? { types: typed.types.map((x) => ({ endpoint: x.endpoint, title: x.title, patients: x.patients, p: x.p, q: x.q, why: x.why, df: typed.df.get(x.endpoint), stratified: typed.stratified.has(x.endpoint) })),
        typeCounts: typed.rows } : {}),
      counts: names.flatMap((n) => [...sites.get(n)!.entries()].flatMap(([st, rows]) =>
        rows.map((r) => ({ cohort: n, study: st, months: r.months, event: r.event, n: r.n, ...(r.entry != null ? { entry: r.entry } : {}) })))),
      test: logrank
        ? { kind: "logrank", stratified: !!logrankPooled, strata: logrank.strata, chi2: logrank.chi2, df: logrank.df, p: logrank.p,
            ...(logrankPooled ? { pooled: { chi2: logrankPooled.chi2, p: logrankPooled.p } } : {}) }
        : logrankK
          ? { kind: "logrankK", stratified: !!logrankKPooled, strata: logrankK.strata, chi2: logrankK.chi2, df: logrankK.df, p: logrankK.p,
              ...(logrankKPooled ? { pooled: { chi2: logrankKPooled.chi2, p: logrankKPooled.p } } : {}) }
          : { kind: "none", reason: thinArms.length
              ? "Refused: " + thinArms.join(", ") + (thinArms.length === 1 ? " has" : " have") + " fewer than " + MIN_ARM_N + " patients."
              : fewGroups ? fewGroupsNote(endpoint) : "A log-rank test needs at least two cohorts." },
    }),
    caveat: (display === "incidence"
      ? "Cumulative incidence (1 - survival) shown, not survival. "
      : "") +
      (cutoffMonths != null
        ? "Administratively censored at " + cutoffMonths + " months" +
          (beyondCutoff ? " (" + beyondCutoff + " patient" + (beyondCutoff === 1 ? "" : "s") + " still under observation past this point)" : "") +
          ". "
        : "") +
      (unobservedTotal
        ? unobservedTotal.toLocaleString("en-US") + " patient" + (unobservedTotal === 1 ? "" : "s") +
          " whose follow-up ends at or before their entry " + (unobservedTotal === 1 ? "was" : "were") +
          " never at risk and " + (unobservedTotal === 1 ? "is" : "are") + " left out of the curves and the test. "
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
      (unchecked.length ? " Whether the cohorts share patients could not be checked at " + unchecked.join(", ") + " (" +
        (unchecked.length === 1 ? "a remote peer, which does not" : "remote peers, which do not") + " answer that yet); the test below assumes they share none there." : "") +
      (parts ? " Overlapping patients (" + shared.toLocaleString("en-US") + ") are plotted as distinct groups: each curve is the patients" +
        " in exactly the cohorts it names (“Only A, B” are in both A and B and no other), so every patient is in one curve and the" +
        " log-rank test's groups share no one, as cBioPortal draws survival when overlapping samples are included."
        : shared > 0 ? " " + plural(shared, "patient is", "patients are") + " in more than one cohort, so in more than one curve;" +
        " the log-rank test assumes the groups share no one, so its p is approximate." : "") +
      (logrankPooled
        ? " The log-rank test is STRATIFIED by study (" + logrank!.strata + " strata contributed events): each study is" +
          " compared only against itself, so a difference in case mix between studies cannot masquerade as a difference" +
          " between cohorts. The pooled p is shown alongside — where the two disagree, the stratified one is the honest answer." +
          " Every site contributes only (months, event, n) counts; no patient-level survival time crosses an instance boundary."
        : logrank
          ? " Log-rank on a single study, so no stratification applies."
        : logrankKPooled
          ? " The k-group log-rank test (" + logrankK!.groups + " groups, " + logrankK!.df + " df) is STRATIFIED by study (" +
            logrankK!.strata + " strata contributed events): each study is compared only against itself. The pooled p is" +
            " shown alongside — where the two disagree, the stratified one is the honest answer. This tests whether the" +
            " groups differ AT ALL, not which pair does; every site contributes only (months, event, n) counts."
          : logrankK
            ? " " + logrankK.groups + "-group log-rank (" + logrankK.df + " df) on a single study — tests whether the" +
              " groups differ at all, not which pair does. No stratification applies."
            : thinArms.length
              ? " Log-rank not computed: " + thinArms.join(", ") + (thinArms.length === 1 ? " has" : " have") +
                " fewer than " + MIN_ARM_N + " patients — a chi-squared from this few is not a meaningful test, only a" +
                " number shaped like one. The curves above are still drawn; they are descriptive, not a test."
              : fewGroups ? " " + fewGroupsNote(endpoint) : " Log-rank needs at least two cohorts.") };
}

/**
 * The log-rank test over the cohorts' count rows: two-sided for 2 cohorts, the k-group test for 3+;
 * stratified by study when the cohorts span several, with the pooled test beside it for contrast.
 */
function logRankOf(vNames: string[], perSite: Map<string, Map<string, SurvivalCount[]>>, countsFor: (n: string, st?: string) => SurvCount[]):
  { logrank?: LogRank; logrankPooled?: LogRank; logrankK?: LogRankK; logrankKPooled?: LogRankK } {
  const sites = [...new Set(vNames.flatMap((n) => [...perSite.get(n)!.keys()]))];
  if (vNames.length === 2) {
    const [A, B] = vNames;
    const pooled = logRankCounts([{ a: countsFor(A), b: countsFor(B) }]);
    return sites.length > 1
      ? { logrank: logRankCounts(sites.map((st) => ({ a: countsFor(A, st), b: countsFor(B, st) }))), logrankPooled: pooled }
      : { logrank: pooled };
  }
  if (vNames.length >= 3) {
    const pooled = logRankKCounts([{ groups: vNames.map((n) => countsFor(n)) }]);
    return sites.length > 1
      ? { logrankK: logRankKCounts(sites.map((st) => ({ groups: vNames.map((n) => countsFor(n, st)) }))), logrankKPooled: pooled }
      : { logrankK: pooled };
  }
  return {};
}

/** the portal's fixed priorities for the usual endpoints (Survival.tsx); others take their _STATUS attribute's */
const TYPE_PRIORITY: Record<string, number> = { OS: 400, DFS: 300, PFS: 250, DSS: 250 };

/**
 * The survival-type table: for every endpoint the studies declare, each group's patients and the
 * log-rank p by the drawn curves' rules (none when a group is under minArm, fewer than two groups
 * have patients, or there is one group), then BH q over the endpoints tested. The groups are the
 * drawn curves': the cohorts, or their overlaps (`partsFor`). No cutoff applies, as on the portal.
 * The drawn endpoint's rows are reused.
 */
async function survivalTypes(c: ViewRun, drawn: string, names: string[], drawnRows: Map<string, Map<string, SurvivalCount[]>>,
  partsFor: ((endpoint: string) => Promise<Map<string, Map<string, SurvivalCount[]>>>) | null,
  rule: { minArm: number }): Promise<{ types: SurvivalType[]; rows: { endpoint: string; cohort: string; study: string; months: number; event: number; n: number }[]; stratified: Set<string>; df: Map<string, number> }> {
  const { doc, resolvers, vStudies } = c;
  const declared = [...new Set((await Promise.all(vStudies.map((st) => resolvers[st].survivalEndpoints().catch(() => [] as string[])))).flat())]
    .filter((e) => /^[A-Z][A-Z0-9_]{0,39}$/.test(e)).sort();
  if (!declared.includes(drawn)) declared.unshift(drawn);
  const { ok } = answering(c);
  const meta = new Map<string, { label: string; priority: number }>();
  for (const rows of await Promise.all(Object.values(ok).map((r) => r.viewMeta("survivalStatusMeta", (st, db) => survivalStatusMetaSql(st, db)).catch(() => []))))
    for (const r of rows) if (!meta.has(String(r.a))) meta.set(String(r.a), { label: String(r.label || ""), priority: Number(r.priority) || 0 });
  const rowsFor = async (e: string) => {
    if (e === drawn) return drawnRows;
    if (partsFor) return partsFor(e);
    const per = new Map<string, Map<string, SurvivalCount[]>>(names.map((n) => [n, new Map()]));
    for (const { cohort, study, answer } of await askEachSite(c, resolvers, (n, _st, r) => r.survivalCounts(doc.cohorts[n], e, null, undefined)))
      per.get(cohort)!.set(study, answer);
    return per;
  };
  const rows: { endpoint: string; cohort: string; study: string; months: number; event: number; n: number }[] = [];
  const stratified = new Set<string>();
  const df = new Map<string, number>();
  const out = await Promise.all(declared.map(async (e): Promise<SurvivalType> => {
    const per = await rowsFor(e);
    for (const [cohort, byStudy] of per) for (const [study, rs] of byStudy) for (const r of rs) rows.push({ endpoint: e, cohort, study, months: r.months, event: r.event, n: r.n });
    const countsFor = (n: string, st?: string): SurvCount[] => (st ? (per.get(n)!.get(st) || []) : [...per.get(n)!.values()].flat())
      .map((r) => r.entry == null ? { t: r.months, event: r.event, n: r.n } : { t: r.months, event: r.event, entry: r.entry, n: r.n });
    const groups = names.map((n) => { const km = kaplanMeierCounts(countsFor(n)); return { cohort: n, n: km.n, events: km.events, median: km.median }; });
    const label = meta.get(e + "_STATUS")?.label || "";
    const title = label.replace(/status|survival/gi, "").replace(/\s+/g, " ").trim() || e;
    const priority = TYPE_PRIORITY[e] ?? meta.get(e + "_STATUS")?.priority ?? 0;
    const base = { endpoint: e, title, priority, patients: groups.reduce((k, g) => k + g.n, 0), groups };
    const thin = groups.filter((g) => g.n < rule.minArm);
    const tested = groups.filter((g) => g.n > 0).map((g) => g.cohort);
    const why = names.length < 2 ? "one group"
      : thin.length ? thin.map((g) => g.cohort + " has " + g.n).join(", ") + " (under " + rule.minArm + ")"
      : tested.length < 2 ? "fewer than two groups have patients" : null;
    if (why) return { ...base, why };
    const t = logRankOf(tested, per, countsFor);
    df.set(e, tested.length - 1);
    if (t.logrankPooled || t.logrankKPooled) stratified.add(e);
    return { ...base, p: (t.logrank || t.logrankK)!.p };
  }));
  const tested = out.filter((t) => t.p != null);
  benjaminiHochberg(tested.map((t) => t.p!)).forEach((q, i) => { tested[i].q = q; });
  // the order the answers arrived in is not the rows' order
  const order = (r: typeof rows[number]) => [declared.indexOf(r.endpoint), names.indexOf(r.cohort)];
  rows.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1] || a.study.localeCompare(b.study) || a.months - b.months || a.event - b.event);
  return { types: out.sort((a, b) => b.priority - a.priority || a.endpoint.localeCompare(b.endpoint)), rows, stratified, df };
}

/** why a view whose groups have patients in fewer than two of them has no log-rank p */
const fewGroupsNote = (endpoint: string) => "No log-rank test: fewer than two groups have patients with " + endpoint + " data.";

/**
 * The view's patients split by which of its cohorts each is in, as cBioPortal's Include mode draws
 * survival: one group per combination present ("Only A", "Only A, C"), in the portal's order (fewer
 * cohorts first, then by the cohorts' order), with each group's count rows and patients per study.
 * A study only one cohort reaches holds that cohort's "Only" group alone, from its own counts.
 */
async function partitionCounts(c: ViewRun, endpoint: string): Promise<{
  names: string[]; perSite: Map<string, Map<string, SurvivalCount[]>>; sizes: Map<string, Map<string, number>> }> {
  const { ok } = answering(c);
  const { vNames, cohorts, doc } = c;
  const byMask = new Map<number, { rows: Map<string, SurvivalCount[]>; sizes: Map<string, number> }>();
  const at = (mask: number) => byMask.get(mask) || byMask.set(mask, { rows: new Map(), sizes: new Map() }).get(mask)!;
  await Promise.all(Object.keys(ok).map(async (st) => {
    const here = vNames.filter((n) => cohorts[n].studies.includes(st));
    if (here.length === 1) {
      const mask = 2 ** vNames.indexOf(here[0]);
      const rows = await ok[st].survivalCounts(doc.cohorts[here[0]], endpoint, null, undefined);
      at(mask).rows.set(st, rows);
      at(mask).sizes.set(st, cohorts[here[0]].perStudy[st]?.count || 0);
      return;
    }
    if (!here.length) return;
    const answer = await ok[st].viewAggregateMany("survival", here.map((n) => doc.cohorts[n]), (sqls, s2, db) => partitionSurvivalSql(sqls, s2, db, endpoint));
    for (const r of answer) {
      let mask = 0;
      here.forEach((n, i) => { if (Number(r.mask) & (2 ** i)) mask += 2 ** vNames.indexOf(n); });
      const g = at(mask), n = Number(r.n);
      g.sizes.set(st, (g.sizes.get(st) || 0) + n);
      if (r.m == null) continue;
      const list = g.rows.get(st) || g.rows.set(st, []).get(st)!;
      list.push({ months: Number(r.m), event: Number(r.ev), n });
    }
  }));
  const members = (mask: number) => vNames.map((_, i) => i).filter((i) => mask & (2 ** i));
  const masks = [...byMask.keys()].filter((m) => m > 0).sort((a, b) => {
    const x = members(a), y = members(b);
    return x.length - y.length || x.reduce((k, i) => k + i, 0) - y.reduce((k, i) => k + i, 0) || a - b;
  });
  const names = masks.map((m) => "Only " + members(m).map((i) => vNames[i]).join(", "));
  return {
    names,
    perSite: new Map(masks.map((m, i) => [names[i], byMask.get(m)!.rows])),
    sizes: new Map(masks.map((m, i) => [names[i], byMask.get(m)!.sizes])),
  };
}

/** patients in more than one of the view's cohorts, summed over the studies that can say, and the studies that cannot */
async function sharedPatients(c: ViewRun): Promise<{ shared: number; unchecked: string[] }> {
  const { ok, excluded } = answering(c);
  // only a study two of the cohorts reach can hold a shared patient
  const sites = Object.keys(ok).map((st) => ({ st, here: c.vNames.filter((n) => c.cohorts[n].studies.includes(st)) })).filter((x) => x.here.length >= 2);
  const answers = await Promise.all(sites.map(({ st, here }) => ok[st].viewAggregateMany("survival", here.map((n) => c.doc.cohorts[n]), sharedPatientsSql)));
  const shared = answers.reduce((k, rows) => k + Number(rows[0]?.n || 0), 0);
  const unchecked = excluded.filter((e) => c.vNames.filter((n) => c.cohorts[n].studies.includes(e.study)).length >= 2).map((e) => e.study);
  return { shared, unchecked };
}
