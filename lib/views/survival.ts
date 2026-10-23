// Survival view: Kaplan-Meier curves pooled exactly from each participant's id-free
// (months, event, n) counts, with log-rank tests.
import { kaplanMeier, logRank, logRankK, applyCutoff, toIncidence } from "../stats.ts";
import type { ViewResult, LogRank, LogRankK, SurvivalView } from "../types.ts";
import { expandSurvivalCounts, type SurvivalCount, type EndpointColumns } from "../federation.ts";
import { survivalMethod } from "../method.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "./run.ts";
import { ATTR_NAME, askEachSite } from "./shared.ts";

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
  // outright; the KM curves themselves still draw (they are descriptive, not a test).
  const MIN_ARM_N = 10;
  const thinArms = curves.filter((c) => c.n < MIN_ARM_N).map((c) => c.cohort + " (n=" + c.n + ")");
  let logrank: LogRank | undefined, logrankPooled: LogRank | undefined;
  let logrankK: LogRankK | undefined, logrankKPooled: LogRankK | undefined;
  if (thinArms.length === 0 && vNames.length === 2) {
    const [A, B] = vNames;
    const sites = [...new Set([...perSite.get(A)!.keys(), ...perSite.get(B)!.keys()])];
    const pooledTest = logRank([{ a: pointsFor(A), b: pointsFor(B) }]);
    if (sites.length > 1) {
      logrank = logRank(sites.map((st) => ({ a: pointsFor(A, st), b: pointsFor(B, st) })));
      logrankPooled = pooledTest;   // shown for contrast: the two can disagree
    } else {
      logrank = pooledTest;
    }
  } else if (thinArms.length === 0 && vNames.length >= 3) {
    const sites = [...new Set(vNames.flatMap((n) => [...perSite.get(n)!.keys()]))];
    const pooledTest = logRankK([{ groups: vNames.map((n) => pointsFor(n)) }]);
    if (sites.length > 1) {
      logrankK = logRankK(sites.map((st) => ({ groups: vNames.map((n) => pointsFor(n, st)) })));
      logrankKPooled = pooledTest;
    } else {
      logrankK = pooledTest;
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
  const unobservedTotal = curvesRaw.reduce((sum, c) => sum + (c.unobserved || 0), 0);
  const beyondCutoff = cutoffMonths != null
    ? vNames.reduce((sum, n) => sum + expandSurvivalCounts([...perSite.get(n)!.values()].flat())
        .filter((r) => r.t > cutoffMonths!).length, 0)
    : 0;
  return { kind: "survival", cohorts: vNames, curves, endpoint,
    ...(entryMonths ? { entryMonths } : {}),
    ...(anchor ? { anchoredTo: anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : ""), truncated: true } : {}),
    ...(cutoffMonths != null ? { cutoffMonths } : {}), ...(tickMonths != null ? { tickMonths } : {}),
    ...(display === "incidence" ? { display } : {}),
    participation: participationFor(vStudies, false),
    ...(logrank ? { logrank } : {}), ...(logrankPooled ? { logrankPooled } : {}),
    ...(logrankK ? { logrankK } : {}), ...(logrankKPooled ? { logrankKPooled } : {}),
    method: survivalMethod({
      endpoint, monthsColumn: columns ? columns.months : endpoint + "_MONTHS", statusColumn: columns ? columns.status : endpoint + "_STATUS",
      queryLabel: "survivalCounts:" + endpoint + (anchor ? "@" + anchor.eventType : ""),
      ...(anchor ? { anchor: anchor.occurrence!.toLowerCase() + " " + anchor.eventType + (anchor.key ? " where " + anchor.key + "=" + anchor.value : "") } : {}),
      ...(cutoffMonths != null ? { cutoffMonths } : {}), beyondCutoff, display,
      cohorts: curvesRaw.map((c) => ({
        name: c.cohort, n: c.n, events: c.events, median: c.median, ...(c.unobserved ? { unobserved: c.unobserved } : {}),
        perStudy: [...perSite.get(c.cohort)!.entries()].map(([st, rows]) => ({
          study: st, cohortPatients: cohorts[c.cohort].perStudy[st]?.count || 0,
          patients: rows.reduce((k, r) => k + r.n, 0), rows: rows.length })),
      })),
      counts: vNames.flatMap((n) => [...perSite.get(n)!.entries()].flatMap(([st, rows]) =>
        rows.map((r) => ({ cohort: n, study: st, months: r.months, event: r.event, n: r.n, ...(r.entry != null ? { entry: r.entry } : {}) })))),
      test: logrank
        ? { kind: "logrank", stratified: !!logrankPooled, strata: logrank.strata, chi2: logrank.chi2, df: logrank.df, p: logrank.p,
            ...(logrankPooled ? { pooled: { chi2: logrankPooled.chi2, p: logrankPooled.p } } : {}) }
        : logrankK
          ? { kind: "logrankK", stratified: !!logrankKPooled, strata: logrankK.strata, chi2: logrankK.chi2, df: logrankK.df, p: logrankK.p,
              ...(logrankKPooled ? { pooled: { chi2: logrankKPooled.chi2, p: logrankKPooled.p } } : {}) }
          : { kind: "none", reason: thinArms.length
              ? "Refused: " + thinArms.join(", ") + (thinArms.length === 1 ? " has" : " have") + " fewer than " + MIN_ARM_N + " patients."
              : "A log-rank test needs at least two cohorts." },
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
              : " Log-rank needs at least two cohorts.") };
}
