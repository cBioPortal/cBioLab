// Real-world treatment endpoints view: time to next treatment, time on treatment or real-world
// progression-free survival from a treatment anchor, as Kaplan–Meier curves per cohort with a
// log-rank test. Each participant returns id-free (entry, t, event, n) counts.
import type { ViewResult, TxendpointsView, TxendpointsCurve, LogRankK } from "../types.ts";
import { txEndpointCountsSql, labTestsSql, CLOCK_SLACK_DAYS, DAYS_PER_MONTH, type TxEndpointOpts } from "../federation-views.ts";
import { kaplanMeier, kmMedianCi, logRankK, applyCutoff, type SurvRecord } from "../stats.ts";
import { DEFAULT_LINE_GAP, TREATMENT_EVENT } from "../treatment-lines.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, refuse, plural } from "./shared.ts";

const TX_COHORT_LIMIT = 6;
/** below this many patients in a cohort the log-rank test is refused (the survival view's floor) */
const TX_MIN_ARM_N = 10;
/** a study whose timeline runs past OS follow-up for more than this share of anchored patients is refused */
const TX_CLOCK_TOLERANCE = 0.05;

const TX_ENDPOINT_LABELS = {
  ttnt: "time to next treatment", tot: "time on treatment", rwpfs: "real-world progression-free survival",
} as const;

export async function runTxendpoints(view: TxendpointsView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = overLimit("a treatment-endpoints view", TX_COHORT_LIMIT, vNames.length); if (e) return refuse("txendpoints", ctx, e.replace("at most " + TX_COHORT_LIMIT, "at most " + TX_COHORT_LIMIT + " cohorts")); }
  const endpoint = view.endpoint ?? "ttnt";
  if (!(endpoint in TX_ENDPOINT_LABELS)) return refuse("txendpoints", ctx, "endpoint is ttnt (time to next treatment), tot (time on treatment) or rwpfs (real-world PFS); got '" + String(endpoint).slice(0, 20) + "'");
  const a0 = view.anchor;
  if (!a0 || typeof a0 !== "object" || !String(a0.eventType || "").trim())
    return refuse("txendpoints", ctx, "a treatment-endpoints view needs anchor: {eventType, key?, value?} — the treatment whose start begins the clock, e.g. {eventType: \"Treatment\", key: \"SUBTYPE\", value: \"Immuno\"}");
  if (!!a0.key !== (a0.value != null && a0.value !== "")) return refuse("txendpoints", ctx, "anchor's key and value go together");
  const anchor = { eventType: String(a0.eventType).trim().slice(0, 120), ...(a0.key ? { key: String(a0.key).slice(0, 120), value: String(a0.value).slice(0, 200) } : {}),
    occurrence: a0.occurrence === "LAST" ? "LAST" as const : "FIRST" as const };
  const anchoredTo = (anchor.occurrence === "LAST" ? "last " : "first ") + anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "");
  const lineGap = view.lineGap == null ? DEFAULT_LINE_GAP : Number(view.lineGap);
  if (!(Number.isInteger(lineGap) && lineGap >= 1 && lineGap <= 3650)) return refuse("txendpoints", ctx, "lineGap is a whole number of days, 1 to 3650");
  const lc = view.lineClasses;
  if (lc != null && lc !== "systemic" && lc !== "all" && !(Array.isArray(lc) && lc.length && lc.length <= 40 && lc.every((c) => typeof c === "string" && c.trim())))
    return refuse("txendpoints", ctx, "lineClasses is \"systemic\" (default), \"all\", or a list of up to 40 treatment classes");
  const lineClasses = lc ?? "systemic";
  const pr0 = view.progression || {};
  const progression = {
    eventType: String(pr0.eventType || "Diagnosis").slice(0, 120), key: String(pr0.key || "PROGRESSION").slice(0, 120),
    values: (pr0.values && pr0.values.length ? pr0.values : ["Y", "Yes"]).map((v) => String(v).slice(0, 80)),
    ...(pr0.probabilityKey ? { probabilityKey: String(pr0.probabilityKey).slice(0, 120), minProbability: Number(pr0.minProbability) } : {}),
  };
  if (endpoint === "rwpfs") {
    if (progression.values.length > 10) return refuse("txendpoints", ctx, "progression.values takes at most 10 values");
    if (pr0.probabilityKey && !Number.isFinite(progression.minProbability)) return refuse("txendpoints", ctx, "progression.probabilityKey needs minProbability, the least probability counted as progression");
  }
  const ongoingDays = view.ongoingDays == null ? 30 : Number(view.ongoingDays);
  if (!(Number.isInteger(ongoingDays) && ongoingDays >= 0 && ongoingDays <= 365)) return refuse("txendpoints", ctx, "ongoingDays is a whole number of days, 0 to 365");
  let cutoffMonths: number | undefined;
  if (view.cutoffMonths != null) {
    const c = Number(view.cutoffMonths);
    if (!(Number.isFinite(c) && c > 0 && c <= 1200)) return refuse("txendpoints", ctx, "cutoffMonths is a positive number of months (at most 1200)");
    cutoffMonths = c;
  }

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("txendpoints", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const opts: TxEndpointOpts = { endpoint, anchor, lines: { gap: lineGap, eventType: TREATMENT_EVENT, classes: lineClasses },
    ...(endpoint === "rwpfs" ? { progression } : {}), ...(endpoint === "tot" ? { ongoingDays } : {}) };
  const perSite = new Map<string, Map<string, SurvRecord[]>>();
  const curves: TxendpointsCurve[] = [];
  const lateBy = new Map<string, { late: number; anchored: number }>();
  for (const n of vNames) {
    const sites = new Map<string, SurvRecord[]>();
    perSite.set(n, sites);
    const ex = { noAnchor: 0, noFollowup: 0, noStop: 0 };
    let late = 0, anchored = 0, cohortN = 0;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      cohortN += cohorts[n].perStudy[st]?.count || 0;
      const rows = await ok[st].viewAggregate("txendpoints:" + endpoint + ":" + n, doc.cohorts[n], (c, s, d) => txEndpointCountsSql(c, s, d, opts));
      const recs: SurvRecord[] = [];
      let siteLate = 0, siteAnch = 0;
      for (const r of rows) {
        const k = String(r.kind), cnt = Number(r.n);
        anchored += cnt; siteAnch += cnt;
        if (Number(r.late)) { late += cnt; siteLate += cnt; }
        if (k === "nofollowup") { ex.noFollowup += cnt; continue; }
        if (k === "nostop") { ex.noStop += cnt; continue; }
        const entry = Number(r.entry), t = Number(r.t), event = Number(r.ev);
        for (let i = 0; i < cnt; i++) recs.push(entry > 0 ? { t, event, entry } : { t, event });
      }
      const L = lateBy.get(st) || { late: 0, anchored: 0 };
      lateBy.set(st, { late: L.late + siteLate, anchored: L.anchored + siteAnch });
      recs.sort((x, y) => x.t - y.t || x.event - y.event || (x.entry ?? 0) - (y.entry ?? 0));
      sites.set(st, cutoffMonths != null ? applyCutoff(recs, cutoffMonths) : recs);
    }));
    ex.noAnchor = Math.max(0, cohortN - anchored);
    const all = [...sites.values()].flat();
    const km = kaplanMeier(all), ci = kmMedianCi(all);
    curves.push({ cohort: n, ...km, medianLo: ci.lo, medianHi: ci.hi, cohortPatients: cohortN, anchored, excluded: ex, late });
  }
  // the clock check: OS_MONTHS must be measured from the timeline's day 0, so that no event is recorded after the last follow-up
  const badClock = [...lateBy].filter(([, x]) => x.anchored > 0 && x.late / x.anchored > TX_CLOCK_TOLERANCE);
  if (badClock.length)
    return refuse("txendpoints", ctx, "the timeline and OS_MONTHS do not share a clock in " + badClock.map(([st, x]) => st + " (" + plural(x.late, "anchored patient") + " of " +
      x.anchored.toLocaleString("en-US") + " have timeline events more than " + CLOCK_SLACK_DAYS + " days after OS_MONTHS)").join(", ") +
      ", so follow-up and death cannot be placed on the treatment's clock");
  if (!curves.some((c) => c.anchored)) {
    const first = Object.keys(ok)[0];
    const vals = anchor.key ? await ok[first].viewAggregate("txendpoints:anchor-values", doc.cohorts[vNames[0]], (c, s, d) => labTestsSql(c, s, d, anchor.eventType, anchor.key!)).catch(() => []) : [];
    return refuse("txendpoints", ctx, "no patient of " + (vNames.length === 1 ? "“" + vNames[0] + "”" : "these cohorts") + " has a " + anchor.eventType + " event" +
      (anchor.key ? " with " + anchor.key + " = " + anchor.value : "") +
      (vals.length ? ". " + anchor.key + " takes: " + vals.slice(0, 20).map((v) => String(v.test) + " (" + Number(v.patients).toLocaleString("en-US") + " patients)").join(", ") : ""));
  }
  if (!curves.some((c) => c.n)) return refuse("txendpoints", ctx, "no anchored patient could enter the risk set: " + curves.map((c) =>
    c.cohort + " — " + c.excluded.noFollowup + " without follow-up after the anchor" + (endpoint === "tot" ? ", " + c.excluded.noStop + " without a stop date" : "")).join("; "));

  const thin = curves.filter((c) => c.n < TX_MIN_ARM_N).map((c) => c.cohort + " (n=" + c.n + ")");
  let logrank: LogRankK | null = null, noTest: string | undefined;
  if (vNames.length < 2) noTest = "a log-rank test needs at least two cohorts";
  else if (thin.length) noTest = "log-rank refused: " + thin.join(", ") + (thin.length === 1 ? " has" : " have") + " fewer than " + TX_MIN_ARM_N + " patients";
  else {
    const studies = [...new Set(vNames.flatMap((n) => [...perSite.get(n)!.keys()]))].sort();
    logrank = logRankK(studies.map((st) => ({ groups: vNames.map((n) => perSite.get(n)!.get(st) || []) })));
  }
  const tot = (k: keyof TxendpointsCurve["excluded"]) => curves.reduce((a, c) => a + c.excluded[k], 0);
  const unobserved = curves.reduce((a, c) => a + (c.unobserved || 0), 0);
  const lateTotal = curves.reduce((a, c) => a + c.late, 0), anchTotal = curves.reduce((a, c) => a + c.anchored, 0);
  const multi = ctx.vStudies.length > 1;
  const linesWord = "treatment lines as lib/treatment-lines.ts builds them (" + (lineClasses === "systemic" ? "systemic-therapy records" : lineClasses === "all" ? "every treatment record" : "records of class " + (lineClasses as string[]).join(", ")) +
    "; a record more than " + lineGap + " days after every earlier record's stop starts a new line)";
  const endpointWords = endpoint === "ttnt"
    ? "Time to next treatment: from the start of the " + anchoredTo + " record to the start of the next line after the anchor's own, " + linesWord + ", or death, whichever comes first. "
    : endpoint === "tot"
      ? "Time on treatment: from the start of the " + anchoredTo + " record to the latest stop date of the anchored records in the same line (" + linesWord + "), or death. A living patient whose stop is within " + ongoingDays +
        " days of their last follow-up is censored there as still on treatment. " + tot("noStop") + " anchored patients have an anchored record without a stop date and are left out: a missing stop cannot be told from an ongoing treatment. "
      : "Real-world progression-free survival: from the start of the " + anchoredTo + " record to the first " + progression.eventType + " event after it with " + progression.key + " in " + progression.values.join(" / ") +
        (progression.probabilityKey ? " and " + progression.probabilityKey + " ≥ " + progression.minProbability : "") + ", or death. Progression read from the record (in MSK-CHORD, from notes by NLP) is only as complete as that recording; events on the anchor's own day are not counted. ";
  return {
    kind: "txendpoints", cohorts: vNames,
    txendpoints: { endpoint, endpointLabel: TX_ENDPOINT_LABELS[endpoint], anchoredTo, lineGap, lineClasses: Array.isArray(lineClasses) ? lineClasses.join(", ") : lineClasses,
      ...(endpoint === "rwpfs" ? { progression } : {}), ...(endpoint === "tot" ? { ongoingDays } : {}), ...(cutoffMonths != null ? { cutoffMonths } : {}),
      curves, logrank, ...(noTest ? { noTest } : {}), ...(excluded.length ? { excludedStudies: excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: endpointWords +
      "Censored at the last follow-up, which is OS_MONTHS × " + DAYS_PER_MONTH + " days on the timeline's clock; death is OS_STATUS 1:DECEASED. That OS_MONTHS counts from the timeline's day 0 was checked on these patients: " +
      lateTotal.toLocaleString("en-US") + " of " + anchTotal.toLocaleString("en-US") + " anchored patients " + (lateTotal === 1 ? "has" : "have") + " a timeline event more than " + CLOCK_SLACK_DAYS +
      " days past it (a study above " + Math.round(TX_CLOCK_TOLERANCE * 100) + "% is refused). " +
      "Left truncation as in the survival view: a patient whose anchor falls before day 0 enters the risk set at day 0. Left out: " + tot("noAnchor") + " cohort patients with no " + anchoredTo.replace(/^(first|last) /, "") + " record, " +
      tot("noFollowup") + " with no follow-up after it" +
      (unobserved ? ", and " + unobserved.toLocaleString("en-US") + " anchored before day 0 whose endpoint also came before it, so were never at risk" : "") + ". " +
      (cutoffMonths != null ? "Administratively censored at " + cutoffMonths + " months. " : "") +
      "Medians with 95% intervals from the Greenwood band on the log scale. " +
      (logrank ? logrank.groups + "-group log-rank (" + logrank.df + " df)" + (logrank.strata > 1 ? ", stratified by study (" + logrank.strata + " strata)" : "") + ". " : noTest ? noTest.charAt(0).toUpperCase() + noTest.slice(1) + ". " : "") +
      "Treated patients are not randomised: the cohorts can differ in who was offered the treatment, when, and how sick they were, so a difference here is an association. " +
      (multi ? "Records are pooled across " + ctx.vStudies.length + " studies, whose day 0 and recording need not match. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + ". " : "") +
      "Each site sends only (entry, time, event) counts.",
  };
}

