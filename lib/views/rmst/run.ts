// Restricted mean survival time view: per cohort the area under the Kaplan–Meier curve up to τ —
// the mean months lived (or event-free) within the first τ — with its standard error, and between
// cohorts the difference and ratio of those means; optionally from landmarks, each restarting the
// clock among the patients still followed. Meaningful whether or not the hazards are proportional.
// Each participant returns id-free (entry, t, event, n) counts.
import type { ViewResult } from "../../types.ts";
import { txEndpointCountsSql, labTestsSql, CLOCK_SLACK_DAYS, type TxEndpointOpts } from "../../federation-views.ts";
import type { EndpointColumns } from "../../federation.ts";
import { expandSurvivalCounts } from "../../federation.ts";
import { kaplanMeier, rmst, atRiskAtTimes, normalP, Z_975, type SurvRecord } from "../../stats.ts";
import { DEFAULT_LINE_GAP, TREATMENT_EVENT } from "../../treatment-lines.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, refuse, plural, ATTR_NAME } from "../shared.ts";
import { treatmentAnchor, noAnchorMessage, clockFailures, CLOCK_TOLERANCE, type TreatmentAnchor } from "../../timeline-endpoints.ts";
import type { RmstView, RmstPanel, RmstCurve, RmstComparison } from "./types.ts";
import { DAYS_PER_MONTH } from "../../time-units.ts";

const RMST_COHORT_LIMIT = 6;
const RMST_LANDMARK_LIMIT = 4;
/** the default τ: the largest time at which every cohort still has this many at risk */
const RMST_MIN_AT_RISK = 10;

/** the largest exit time at which at least `k` records are at risk, 0 when none */
function lastTimeWithAtRisk(recs: SurvRecord[], k: number): number {
  const times = [...new Set(recs.map((r) => r.t))].sort((a, b) => a - b);
  const n = atRiskAtTimes(recs, times);
  for (let i = times.length - 1; i >= 0; i--) if (n[i] >= k) return times[i];
  return 0;
}

/** the records still followed at `L` (alive and uncensored: t > L), on a clock restarted there */
export function fromLandmark(recs: SurvRecord[], L: number): SurvRecord[] {
  if (!(L > 0)) return recs;
  return recs.filter((r) => r.t > L).map((r) => (r.entry != null && r.entry > L ? { t: r.t - L, event: r.event, entry: r.entry - L } : { t: r.t - L, event: r.event }));
}

/** cohort `a` against `b`: the RMST difference and ratio (log scale), each with its Wald interval and p */
export function rmstContrast(a: { rmst: number; se: number }, b: { rmst: number; se: number }):
  Omit<RmstComparison, "cohort" | "vs"> {
  const diff = a.rmst - b.rmst, seD = Math.sqrt(a.se * a.se + b.se * b.se);
  const lr = Math.log(a.rmst / b.rmst), seR = Math.sqrt((a.se / a.rmst) ** 2 + (b.se / b.rmst) ** 2);
  return { diff, diffLo: diff - Z_975 * seD, diffHi: diff + Z_975 * seD, diffP: seD > 0 ? normalP(diff / seD) : 1,
    ratio: Math.exp(lr), ratioLo: Math.exp(lr - Z_975 * seR), ratioHi: Math.exp(lr + Z_975 * seR), ratioP: seR > 0 ? normalP(lr / seR) : 1 };
}

export async function runRmst(view: RmstView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = overLimit("an RMST view", RMST_COHORT_LIMIT, vNames.length); if (e) return refuse("rmst", ctx, e.replace("at most " + RMST_COHORT_LIMIT, "at most " + RMST_COHORT_LIMIT + " cohorts")); }
  const endpoint = String(view.endpoint || "OS").toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) return refuse("rmst", ctx, "bad endpoint '" + endpoint.slice(0, 40) + "'");
  if (!!view.monthsAttribute !== !!view.statusAttribute) return refuse("rmst", ctx, "monthsAttribute and statusAttribute go together");
  for (const a of [view.monthsAttribute, view.statusAttribute]) if (a != null && !ATTR_NAME.test(String(a))) return refuse("rmst", ctx, "“" + String(a).slice(0, 40) + "” is not an attribute name");
  const columns: EndpointColumns | undefined = view.monthsAttribute ? { months: String(view.monthsAttribute), status: String(view.statusAttribute) } : undefined;
  let anchor: TreatmentAnchor | null = null, anchoredTo: string | undefined;
  if (view.anchor != null) {
    const an = treatmentAnchor(view.anchor, "an RMST view's anchor");
    if ("error" in an) return refuse("rmst", ctx, an.error);
    if (endpoint !== "OS" || columns) return refuse("rmst", ctx, "an anchor measures overall survival from the treatment on the timeline's clock (OS_MONTHS / OS_STATUS); drop endpoint / monthsAttribute to use it");
    ({ anchor, anchoredTo } = an);
  }
  const landmarks = (view.landmarkMonths == null ? [0] : view.landmarkMonths).map(Number);
  if (!Array.isArray(view.landmarkMonths ?? []) || !landmarks.length || landmarks.length > RMST_LANDMARK_LIMIT || landmarks.some((l) => !(Number.isFinite(l) && l >= 0 && l <= 120)) ||
    landmarks.some((l, i) => i > 0 && !(l > landmarks[i - 1])))
    return refuse("rmst", ctx, "landmarkMonths is 1 to " + RMST_LANDMARK_LIMIT + " increasing month values from 0 to 120, e.g. [0, 6, 12]");
  let tauSet: number | null = null;
  if (view.tau != null) {
    const t = Number(view.tau);
    if (!(Number.isFinite(t) && t > 0 && t <= 600)) return refuse("rmst", ctx, "tau is a positive number of months (at most 600)");
    tauSet = t;
  }
  const endpointLabel = anchor ? "OS from " + anchoredTo : columns ? columns.months + "/" + columns.status : endpoint;

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("rmst", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const recsBy = new Map<string, SurvRecord[]>();
  const tally: RmstResultCohort[] = [];
  const lateBy = new Map<string, { late: number; anchored: number }>();
  const opts: TxEndpointOpts | null = anchor ? { endpoint: "os", anchor, lines: { gap: DEFAULT_LINE_GAP, eventType: TREATMENT_EVENT } } : null;
  for (const n of vNames) {
    const recs: SurvRecord[] = [];
    let cohortN = 0, noFollowup = 0, anchored = 0;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      cohortN += cohorts[n].perStudy[st]?.count || 0;
      if (!opts) {
        const counts = await ok[st].survivalCounts(doc.cohorts[n], endpoint, null, columns);
        recs.push(...expandSurvivalCounts(counts));
        return;
      }
      const rows = await ok[st].viewAggregate("rmst:anchor:" + n, doc.cohorts[n], (c, s, d) => txEndpointCountsSql(c, s, d, opts));
      let siteLate = 0, siteAnch = 0;
      for (const r of rows) {
        const cnt = Number(r.n);
        anchored += cnt; siteAnch += cnt;
        if (Number(r.late)) siteLate += cnt;
        if (String(r.kind) !== "record") { noFollowup += cnt; continue; }
        const entry = Number(r.entry), t = Number(r.t), event = Number(r.ev);
        for (let i = 0; i < cnt; i++) recs.push(entry > 0 ? { t, event, entry } : { t, event });
      }
      const L = lateBy.get(st) || { late: 0, anchored: 0 };
      lateBy.set(st, { late: L.late + siteLate, anchored: L.anchored + siteAnch });
    }));
    recs.sort((x, y) => x.t - y.t || x.event - y.event || (x.entry ?? 0) - (y.entry ?? 0));
    recsBy.set(n, recs);
    tally.push({ cohort: n, cohortPatients: cohortN, n: recs.length, noFollowup: opts ? noFollowup : cohortN - recs.length, noAnchor: opts ? Math.max(0, cohortN - anchored) : 0 });
  }
  const badClock = clockFailures(lateBy);
  if (badClock.length)
    return refuse("rmst", ctx, "the timeline and OS_MONTHS do not share a clock in " + badClock.map(([st, x]) => st + " (" + plural(x.late, "anchored patient") + " of " +
      x.anchored.toLocaleString("en-US") + " have timeline events more than " + CLOCK_SLACK_DAYS + " days after OS_MONTHS)").join(", ") + ", so survival cannot be measured from the treatment");
  if (anchor && tally.every((c) => c.noAnchor === c.cohortPatients)) {
    const first = Object.keys(ok)[0];
    const vals = anchor.key ? await ok[first].viewAggregate("rmst:anchor-values", doc.cohorts[vNames[0]], (c, s, d) => labTestsSql(c, s, d, anchor.eventType, anchor.key!)).catch(() => []) : [];
    return refuse("rmst", ctx, noAnchorMessage(anchor, vNames, vals));
  }
  if (tally.every((c) => !c.n)) {
    if (tally.every((c) => !c.cohortPatients)) return refuse("rmst", ctx, "nothing to estimate: the cohorts are empty");
    const eps = await Promise.all(Object.entries(ok).map(async ([st, r]) => st + ": " + ((await r.survivalEndpoints().catch(() => [] as string[])).join(", ") || "none declared")));
    return refuse("rmst", ctx, "no patient of these cohorts has " + (columns ? columns.months + "/" + columns.status : endpoint + "_MONTHS/" + endpoint + "_STATUS") +
      (anchor ? " follow-up after the anchor" : "") + ". Endpoints declared: " + eps.join("; "));
  }

  const panels: RmstPanel[] = [];
  for (const L of landmarks) {
    const at = new Map(vNames.map((n) => [n, fromLandmark(recsBy.get(n)!, L)]));
    const lastT = vNames.map((n) => Math.max(0, ...at.get(n)!.map((r) => r.t)));
    let tau: number;
    if (tauSet != null) {
      const short = vNames.filter((_, i) => lastT[i] < tauSet!);
      if (short.length) return refuse("rmst", ctx, "tau = " + tauSet + " months is past the last follow-up" + (L > 0 ? " from the " + L + "-month landmark" : "") + " of " +
        short.map((n) => n + " (" + (Math.round(lastT[vNames.indexOf(n)] * 10) / 10) + " months)").join(", ") + ": the curve is unknown there, so its area is too — choose a smaller tau");
      tau = tauSet;
    } else {
      const each = vNames.map((n) => lastTimeWithAtRisk(at.get(n)!, RMST_MIN_AT_RISK));
      tau = Math.floor(Math.min(...each) * 10) / 10;
      if (!(tau > 0)) return refuse("rmst", ctx, "every cohort needs at least " + RMST_MIN_AT_RISK + " patients at risk" + (L > 0 ? " after the " + L + "-month landmark" : "") +
        " to set tau; " + vNames.filter((_, i) => !(each[i] > 0)).join(", ") + " " + (vNames.filter((_, i) => !(each[i] > 0)).length === 1 ? "has" : "have") + " fewer — set tau, or drop the landmark");
    }
    const curves: RmstCurve[] = vNames.map((n) => {
      const recs = at.get(n)!, r = rmst(recs, tau);
      return { cohort: n, ...kaplanMeier(recs), rmst: r.rmst, se: r.se, lo: r.lo, hi: r.hi, atRiskTau: atRiskAtTimes(recs, [tau])[0], beforeLandmark: recsBy.get(n)!.length - recs.length };
    });
    const ref = curves[0];
    const comparisons: RmstComparison[] = curves.slice(1).filter((c) => c.n && ref.n).map((c) => ({ cohort: c.cohort, vs: ref.cohort, ...rmstContrast(c, ref) }));
    panels.push({ landmark: L, tau, tauSet: tauSet != null, curves, comparisons });
  }

  const multi = ctx.vStudies.length > 1;
  const lateTotal = [...lateBy.values()].reduce((a, x) => a + x.late, 0), anchTotal = [...lateBy.values()].reduce((a, x) => a + x.anchored, 0);
  const tauWords = tauSet != null ? "τ = " + tauSet + " months, as set"
    : "τ by default the largest time at which every cohort still has " + RMST_MIN_AT_RISK + " patients at risk (" + panels.map((p) => (p.landmark ? p.landmark + "-month landmark: " : "") + p.tau + " months").join("; ") + ")";
  return {
    kind: "rmst", cohorts: vNames,
    rmst: { endpointLabel, ...(anchoredTo ? { anchoredTo } : {}), panels, cohorts: tally, ...(excluded.length ? { excludedStudies: excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Restricted mean survival time: the area under each cohort's Kaplan–Meier curve from 0 to τ — the mean months " + (endpoint === "OS" ? "lived" : "free of the event") +
      " within the first τ — with " + tauWords + ". Its standard error is the Greenwood-type variance of that area (Klein & Moeschberger; R survRM2); differences and ratios against " + vNames[0] +
      " use Wald intervals (the ratio on the log scale) and two-sided normal p. Unlike a hazard ratio, RMST needs no proportional hazards, so it stays interpretable when curves cross or separate late, as on immunotherapy. " +
      (anchor ? "The clock starts at each patient's " + anchoredTo + " record; death is OS_STATUS 1:DECEASED, censoring at the last follow-up (OS_MONTHS × " + DAYS_PER_MONTH +
        " days on the timeline's clock; checked: " + lateTotal.toLocaleString("en-US") + " of " + anchTotal.toLocaleString("en-US") + " anchored patients have a timeline event more than " + CLOCK_SLACK_DAYS +
        " days past it, a study above " + Math.round(CLOCK_TOLERANCE * 100) + "% is refused); an anchor before day 0 enters the risk set at day 0 (left truncation). " +
        "Left out: " + tally.reduce((a, c) => a + c.noAnchor, 0).toLocaleString("en-US") + " without the anchor, " : "Endpoint " + endpointLabel + " from the study's day 0. Left out: ") +
      tally.reduce((a, c) => a + c.noFollowup, 0).toLocaleString("en-US") + " without follow-up. " +
      (landmarks.some((l) => l > 0) ? "A landmark keeps only the patients alive and still followed at it and restarts their clock there, so each later panel answers “for those who got this far” and is free of the guarantee-time bias of grouping by what happens after the start; its patients are fewer, and its τ is counted from the landmark. " : "") +
      "Records are pooled across a cohort's studies without stratification" + (multi ? " (" + ctx.vStudies.length + " studies here, whose day 0 need not match)" : "") + ". " +
      "The cohorts are not randomised, so a difference is an association. " +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + ". " : "") +
      "Each site sends only (entry, time, event) counts.",
  };
}

type RmstResultCohort = { cohort: string; cohortPatients: number; n: number; noFollowup: number; noAnchor: number };
