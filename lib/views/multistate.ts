// Multistate view: the illness–death model (start → progression → death, start → death) per cohort
// on the timeline's clock — transition rates, Nelson–Aalen cumulative hazards, Aalen–Johansen state
// occupation and a Cox hazard ratio per transition against the first cohort. Each participant
// returns id-free (prevalent, t_progression, t_end, dead, n) counts.
import type { ViewResult, MultistateView, MultistateCohort, MultistateCox, MultistateRate, MultistateTransitionKey } from "../types.ts";
import { multistateCountsSql, labTestsSql, CLOCK_SLACK_DAYS, DAYS_PER_MONTH, SEQUENCING_EVENT } from "../federation-views.ts";
import { illnessDeath, coxRegression, COX_MAX_ITERATIONS, Z_975, type IllnessDeathRecord, type CoxRow } from "../stats.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, refuse, plural } from "./shared.ts";
import { progressionEvent, progressionError, progressionCondition, clockFailures, CLOCK_TOLERANCE } from "../timeline-endpoints.ts";

const MS_COHORT_LIMIT = 4;
/** curves are drawn while at least this many of a cohort's patients are still followed */
const MS_MIN_FOLLOWED = 10;
/** a cohort with fewer events than this in a transition gets no hazard ratio for it */
const MS_MIN_EVENTS = 5;
/** day 0 is called first sequencing when at least this share of patients has a Sequencing event on it */
const MS_SEQ0_SHARE = 0.9;

const KEYS: MultistateTransitionKey[] = ["01", "02", "12"];
const rd = (x: number) => Math.round(x * 1e5) / 1e5;

/** the last time at least `k` records are still followed (the k-th largest end of follow-up) */
function followedTo(recs: IllnessDeathRecord[], k: number): number {
  const te = recs.map((r) => r.te).sort((a, b) => b - a);
  return te.length >= k ? te[k - 1] : 0;
}

export async function runMultistate(view: MultistateView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = overLimit("a multistate view", MS_COHORT_LIMIT, vNames.length); if (e) return refuse("multistate", ctx, e.replace("at most " + MS_COHORT_LIMIT, "at most " + MS_COHORT_LIMIT + " cohorts")); }
  const progression = progressionEvent(view.progression);
  { const e = progressionError(progression); if (e) return refuse("multistate", ctx, e); }
  const prevalentMode = view.prevalent === "exclude" ? "exclude" as const : "include" as const;
  if (view.prevalent != null && view.prevalent !== "include" && view.prevalent !== "exclude")
    return refuse("multistate", ctx, "prevalent is \"include\" (patients progressed by day 0 start in the progression state) or \"exclude\"");
  const horizons = (view.horizons == null ? [12, 24, 60] : view.horizons).map(Number);
  if (!horizons.length || horizons.length > 6 || horizons.some((h) => !(h > 0 && h <= 600)))
    return refuse("multistate", ctx, "horizons are 1 to 6 month values between 0 and 600");
  let cutoffMonths: number | undefined;
  if (view.cutoffMonths != null) {
    const c = Number(view.cutoffMonths);
    if (!(Number.isFinite(c) && c > 0 && c <= 1200)) return refuse("multistate", ctx, "cutoffMonths is a positive number of months (at most 1200)");
    cutoffMonths = c;
  }

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("multistate", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const perSite = new Map<string, Map<string, IllnessDeathRecord[]>>();
  const lateBy = new Map<string, { late: number; anchored: number }>();
  const tallies = new Map<string, { cohortN: number; noFollowup: number; prevalentOut: number; notAssessed: number; afterEnd: number; seq0: number; late: number; n: number }>();
  for (const n of vNames) {
    const sites = new Map<string, IllnessDeathRecord[]>();
    perSite.set(n, sites);
    const T = { cohortN: 0, noFollowup: 0, prevalentOut: 0, notAssessed: 0, afterEnd: 0, seq0: 0, late: 0, n: 0 };
    tallies.set(n, T);
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      T.cohortN += cohorts[n].perStudy[st]?.count || 0;
      const rows = await ok[st].viewAggregate("multistate:" + n, doc.cohorts[n], (c, s, d) => multistateCountsSql(c, s, d, progression));
      const recs: IllnessDeathRecord[] = [];
      let siteLate = 0, siteN = 0;
      for (const r of rows) {
        const cnt = Number(r.n);
        if (String(r.kind) === "nofollowup") { T.noFollowup += cnt; continue; }
        const prevalent = Number(r.prevalent) === 1;
        if (prevalent && prevalentMode === "exclude") { T.prevalentOut += cnt; continue; }
        siteN += cnt;
        if (Number(r.late)) siteLate += cnt;
        if (!Number(r.assessed)) T.notAssessed += cnt;
        if (Number(r.afterend)) T.afterEnd += cnt;
        if (Number(r.seq0)) T.seq0 += cnt;
        let tp: number | null = Number(r.tp) > 0 ? Number(r.tp) : null, te = Number(r.te), dead = Number(r.dead) === 1;
        if (cutoffMonths != null && te > cutoffMonths) { te = cutoffMonths; dead = false; if (tp != null && tp >= cutoffMonths) tp = null; }
        for (let i = 0; i < cnt; i++) recs.push({ prevalent, tp, te, dead });
      }
      T.late += siteLate; T.n += siteN;
      const L = lateBy.get(st) || { late: 0, anchored: 0 };
      lateBy.set(st, { late: L.late + siteLate, anchored: L.anchored + siteN });
      sites.set(st, recs);
    }));
  }
  const badClock = clockFailures(lateBy);
  if (badClock.length)
    return refuse("multistate", ctx, "the timeline and OS_MONTHS do not share a clock in " + badClock.map(([st, x]) => st + " (" + plural(x.late, "patient") + " of " +
      x.anchored.toLocaleString("en-US") + " have timeline events more than " + CLOCK_SLACK_DAYS + " days after OS_MONTHS)").join(", ") +
      ", so progression and death cannot be placed on one clock");
  const all = (n: string) => [...perSite.get(n)!.values()].flat();
  if (!vNames.some((n) => all(n).length))
    return refuse("multistate", ctx, "no patient of " + (vNames.length === 1 ? "“" + vNames[0] + "”" : "these cohorts") + " has follow-up (OS_MONTHS > 0 and OS_STATUS)" +
      (prevalentMode === "exclude" ? " without a progression by day 0" : ""));
  const assessedAny = vNames.some((n) => tallies.get(n)!.n > tallies.get(n)!.notAssessed);
  const fits = new Map(vNames.map((n) => [n, illnessDeath(all(n))]));
  if (!assessedAny || ![...fits.values()].some((f) => f.events["01"] + f.prevalent > 0)) {
    const first = Object.keys(ok)[0];
    const vals = await ok[first].viewAggregate("multistate:progression-values", doc.cohorts[vNames[0]], (c, s, d) => labTestsSql(c, s, d, progression.eventType, progression.key)).catch(() => []);
    return refuse("multistate", ctx, "no patient of " + (vNames.length === 1 ? "“" + vNames[0] + "”" : "these cohorts") + " has a " + progression.eventType + " event with " + progressionCondition(progression) +
      (vals.length ? ". " + progression.key + " takes: " + vals.slice(0, 20).map((v) => String(v.test) + " (" + Number(v.patients).toLocaleString("en-US") + " patients)").join(", ")
        : ". No " + progression.eventType + " event here carries " + progression.key + " — set progression.eventType and progression.key to where this study records progression"));
  }

  const out: MultistateCohort[] = vNames.map((n) => {
    const f = fits.get(n)!, recs = all(n), T = tallies.get(n)!;
    const drawnTo = followedTo(recs, MS_MIN_FOLLOWED);
    const pt = { "01": f.personTime.s0, "02": f.personTime.s0, "12": f.personTime.s1 };
    const rates: MultistateRate[] = KEYS.map((k) => {
      const d = f.events[k], pm = pt[k], rate = pm > 0 ? 100 * d / pm : 0;
      return { key: k, events: d, personMonths: Math.round(pm * 10) / 10, rate,
        lo: d > 0 ? rate * Math.exp(-Z_975 / Math.sqrt(d)) : null, hi: d > 0 ? rate * Math.exp(Z_975 / Math.sqrt(d)) : null };
    });
    const occ = f.occupation.filter((q) => q.t <= drawnTo);
    const at = (m: number) => {
      const atRisk = recs.filter((r) => r.te >= m).length;
      if (m > drawnTo) return { months: m, p0: null, p1: null, p2: null, atRisk };
      let q = f.occupation[0];
      for (const x of f.occupation) { if (x.t > m) break; q = x; }
      return { months: m, p0: rd(q.p0), p1: rd(q.p1), p2: rd(q.p2), atRisk };
    };
    const cumhaz = Object.fromEntries(KEYS.map((k) => [k, f.cumhaz[k].filter((q) => q.t <= drawnTo).map((q) => {
      const half = q.h > 0 ? Z_975 * Math.sqrt(q.v) / q.h : 0;
      return { t: q.t, h: rd(q.h), lo: rd(q.h * Math.exp(-half)), hi: rd(q.h * Math.exp(half)) };
    })])) as MultistateCohort["cumhaz"];
    return { cohort: n, cohortPatients: T.cohortN, n: f.n, prevalent: f.prevalent,
      excluded: { noFollowup: T.noFollowup, prevalent: T.prevalentOut, },
      notAssessed: T.notAssessed, afterEnd: T.afterEnd, seq0: T.seq0, late: T.late,
      censored: { start: f.events.c0, progression: f.events.c1 }, rates,
      occupation: occ.map((q) => ({ t: q.t, p0: rd(q.p0), p1: rd(q.p1), p2: rd(q.p2) })),
      cumhaz, drawnTo, atHorizon: horizons.map(at) };
  });

  // a Cox model per transition: the cohorts as indicators against the first, a baseline per study;
  // progression → death on the same clock (time since day 0), entering at the progression
  const cox: MultistateCox[] = [];
  const reference = vNames[0];
  if (vNames.length >= 2) {
    for (const k of KEYS) {
      const rows: CoxRow[] = [];
      vNames.forEach((n, ci) => {
        const x = vNames.slice(1).map((_, j) => (ci === j + 1 ? 1 : 0));
        for (const [st, recs] of perSite.get(n)!) for (const r of recs) {
          if (k === "12") {
            if (!(r.prevalent || r.tp != null)) continue;
            const entry = r.prevalent ? 0 : r.tp!;
            if (r.te <= entry) continue;
            rows.push(entry > 0 ? { t: r.te, event: r.dead ? 1 : 0, x, stratum: st, entry } : { t: r.te, event: r.dead ? 1 : 0, x, stratum: st });
          } else if (!r.prevalent) {
            const ev = k === "01" ? r.tp != null : r.tp == null && r.dead;
            rows.push({ t: r.tp ?? r.te, event: ev ? 1 : 0, x, stratum: st });
          }
        }
      });
      const events = rows.reduce((a, r) => a + r.event, 0);
      const thin = out.filter((c) => c.rates.find((q) => q.key === k)!.events < MS_MIN_EVENTS).map((c) => c.cohort);
      if (thin.length) { cox.push({ key: k, rows: [], n: rows.length, events, noFit: thin.join(", ") + (thin.length === 1 ? " has" : " have") + " fewer than " + MS_MIN_EVENTS + " events" }); continue; }
      try {
        const fit = coxRegression(rows);
        if (fit.iterations >= COX_MAX_ITERATIONS) { cox.push({ key: k, rows: [], n: rows.length, events, noFit: "the fit did not converge" }); continue; }
        cox.push({ key: k, n: rows.length, events, rows: vNames.slice(1).map((n, j) => ({ cohort: n, hr: fit.hr[j], lo: fit.ciLow[j], hi: fit.ciHigh[j], p: fit.p[j] })) });
      } catch (e) {
        cox.push({ key: k, rows: [], n: rows.length, events, noFit: (e as Error).message });
      }
    }
  }

  const inModel = out.reduce((a, c) => a + c.n, 0), seq0 = out.reduce((a, c) => a + c.seq0, 0);
  const origin = inModel && seq0 / inModel >= MS_SEQ0_SHARE ? "first sequencing" : "the timeline's day 0";
  const tMax = Math.max(1, ...out.map((c) => c.drawnTo));
  const sum = (f: (c: MultistateCohort) => number) => out.reduce((a, c) => a + f(c), 0);
  const multi = ctx.vStudies.length > 1;
  const lateTotal = sum((c) => c.late);
  return {
    kind: "multistate", cohorts: vNames,
    multistate: { progression, prevalent: prevalentMode, horizons, ...(cutoffMonths != null ? { cutoffMonths } : {}), tMax, origin,
      cohorts: out, reference, cox, ...(excluded.length ? { excludedStudies: excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "An illness–death model (Rueda et al., Nature 2019) on one clock: months from the timeline's day 0, which is " +
      (origin === "first sequencing" ? "the day of a " + SEQUENCING_EVENT + " event for " + plural(seq0, "patient") + " of " + inModel.toLocaleString("en-US") + " (day 0 = first sequencing), so the start state is “sequenced, not yet progressed”. "
        : "a " + SEQUENCING_EVENT + " day for only " + plural(seq0, "patient") + " of " + inModel.toLocaleString("en-US") + ": the start state is “at the study's day 0, not yet progressed”, and patients sequenced later had to survive to it, so early death is understated. ") +
      "Progression is the first " + progression.eventType + " event with " + progressionCondition(progression) + " after day 0; death and the end of follow-up are OS_STATUS / OS_MONTHS (OS_MONTHS × " + DAYS_PER_MONTH +
      " days on the timeline's clock; checked: " + plural(lateTotal, "patient") + " of " + inModel.toLocaleString("en-US") + " with a timeline event more than " + CLOCK_SLACK_DAYS +
      " days past it, a study above " + Math.round(CLOCK_TOLERANCE * 100) + "% is refused). " +
      (prevalentMode === "include"
        ? sum((c) => c.prevalent).toLocaleString("en-US") + " patients had a progression on or before day 0 and start in the progression state. "
        : sum((c) => c.excluded.prevalent).toLocaleString("en-US") + " patients with a progression on or before day 0 are left out. ") +
      "Markov, clock-forward: every transition's hazard is a function of time since day 0, progression → death included (a patient enters that risk set at their progression), so time already spent progressed does not enter the model. " +
      "Rates are events per 100 person-months in the state left (95% interval, Poisson); cumulative hazards Nelson–Aalen (95% interval, log scale); state occupation Aalen–Johansen from the transitions, drawn without intervals while at least " +
      MS_MIN_FOLLOWED + " of a cohort's patients are followed. " +
      (cox.length ? "Hazard ratios: one Cox model per transition (Efron ties), each cohort against " + reference + (multi ? ", a baseline hazard per study" : "") + "; a cohort with fewer than " + MS_MIN_EVENTS + " events in a transition gets none. " : "") +
      "Progression here is a reading of the record: in MSK-CHORD an NLP model's call on each radiology report, so it is probabilistic and only as dense as the imaging — " +
      plural(sum((c) => c.notAssessed), "patient") + " in the model have no " + progression.key + " record at all and could never be seen to progress, and their deaths count as death without progression. " +
      (sum((c) => c.afterEnd) ? sum((c) => c.afterEnd).toLocaleString("en-US") + " with a progression only on or after their end of follow-up count as not progressed. " : "") +
      "Left out: " + sum((c) => c.excluded.noFollowup).toLocaleString("en-US") + " without follow-up. " +
      (cutoffMonths != null ? "Administratively censored at " + cutoffMonths + " months. " : "") +
      "The cohorts are not randomised, so differences are associations. " +
      (multi ? "Records are pooled across " + ctx.vStudies.length + " studies, whose day 0 and recording need not match. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + ". " : "") +
      "Each site sends only (prevalent, progression time, end time, dead) counts.",
  };
}
