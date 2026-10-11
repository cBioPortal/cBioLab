// Incidence view: cumulative incidence with death as a competing risk
import type { ViewResult, IncidenceView, IncidenceCurve } from "../types.ts";
import { incidenceCountsSql } from "../federation-views.ts";
import { Z_975, aalenJohansen, cifAt, grayPermutationTest, kaplanMeier, type CrRecord } from "../stats.ts";
import { incidenceMethod, type IncidenceTrace } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, refuse } from "./shared.ts";

const INCIDENCE_COHORT_LIMIT = 6;

export async function runIncidence(view: IncidenceView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = overLimit("an incidence view", INCIDENCE_COHORT_LIMIT, vNames.length); if (e) return refuse("incidence", ctx, e.replace("at most " + INCIDENCE_COHORT_LIMIT, "at most " + INCIDENCE_COHORT_LIMIT + " cohorts")); }
  const ev = view.event;
  if (!ev || typeof ev.eventType !== "string" || !ev.eventType.trim())
    return refuse("incidence", ctx, "an incidence view needs event: {eventType, attrs?}, the timeline event whose incidence to estimate");
  const attrs = Array.isArray(ev.attrs) ? ev.attrs : [];
  if (attrs.length > 3) return refuse("incidence", ctx, "event takes at most 3 attrs; this asks for " + attrs.length);
  if (attrs.some((a) => !a || !a.key || a.value == null || a.value === ""))
    return refuse("incidence", ctx, "every event attr needs both a key and a value");
  const event = { eventType: ev.eventType.trim().slice(0, 120), attrs: attrs.map((a) => ({ key: String(a.key).slice(0, 120), value: String(a.value).slice(0, 200) })) };
  const eventLabel = (ev.label && String(ev.label).trim().slice(0, 80)) ||
    event.eventType + (event.attrs.length ? " [" + event.attrs.map((a) => a.key + "=" + a.value).join(", ") + "]" : "");
  const rawAnchor = view.anchor;
  const anchor = rawAnchor && rawAnchor.eventType
    ? { eventType: String(rawAnchor.eventType).slice(0, 120),
        ...(rawAnchor.key ? { key: String(rawAnchor.key).slice(0, 120), value: String(rawAnchor.value ?? "") } : {}),
        occurrence: rawAnchor.occurrence === "LAST" ? "LAST" as const : "FIRST" as const }
    : null;
  const horizons = (view.horizons == null ? [12, 24, 60] : view.horizons).map(Number);
  if (!horizons.length || horizons.length > 6 || horizons.some((h) => !(h > 0 && h <= 600)))
    return refuse("incidence", ctx, "horizons are 1 to 6 month values between 0 and 600");

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("incidence", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const recsBy: Record<string, CrRecord[]> = {};
  const curves: IncidenceCurve[] = [];
  const countRows: IncidenceTrace["counts"] = [];
  for (const n of vNames) {
    const recs: CrRecord[] = [];
    const ex = { prior: 0, unobserved: 0, noFollowup: 0, noAnchor: 0 };
    let late = 0, seen = 0, cohortN = 0;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      cohortN += cohorts[n].perStudy[st]?.count || 0;
      const rows = await ok[st].viewAggregate("incidence:" + n, doc.cohorts[n], (c, s, d) => incidenceCountsSql(c, s, d, event, anchor));
      for (const r of rows) {
        const k = String(r.kind), cnt = Number(r.n);
        seen += cnt;
        if (k === "prior") { ex.prior += cnt; continue; }
        if (k === "unobserved") { ex.unobserved += cnt; continue; }
        if (k === "nofollowup") { ex.noFollowup += cnt; continue; }
        if (Number(r.late)) late += cnt;
        const entry = Number(r.entry), t = Number(r.t), cause = Number(r.cause) as 0 | 1 | 2;
        for (let i = 0; i < cnt; i++) recs.push(entry > 0 ? { t, cause, entry } : { t, cause });
        countRows.push({ cohort: n, study: st, entry, t, cause, n: cnt });
      }
    }));
    ex.noAnchor = Math.max(0, cohortN - seen);
    // a canonical order, independent of which study answered first or how the database ordered
    // tied rows: the permutation test shuffles labels by position, so its seeded p depends on it
    const entryKey = (r: CrRecord) => r.entry ?? -Infinity;
    recs.sort((x, y) => x.t - y.t || x.cause - y.cause || (entryKey(x) < entryKey(y) ? -1 : entryKey(x) > entryKey(y) ? 1 : 0));
    recsBy[n] = recs;
    const c = aalenJohansen(recs);
    curves.push({ cohort: n, n: c.n, events: c.events, competing: c.competing, censored: c.censored,
      points: c.points.map((pt) => ({ t: pt.t, f1: Math.round(pt.f1 * 1e5) / 1e5, f2: Math.round(pt.f2 * 1e5) / 1e5,
        se1: Math.round(pt.se1 * 1e5) / 1e5, atRisk: pt.atRisk })), excluded: ex, late });
  }
  if (!curves.some((c) => c.n))
    return refuse("incidence", ctx, "no patient could enter the risk set: " + curves.map((c) => c.cohort + " — " +
      c.excluded.prior + " already had " + eventLabel + (anchor ? " at or before the anchor" : " by day 0") + ", " + c.excluded.noFollowup + " without follow-up" +
      (anchor ? ", " + c.excluded.noAnchor + " without a " + anchor.eventType + " event" : "") + (c.excluded.unobserved ? ", " + c.excluded.unobserved + " before observation began" : "")).join("; "));

  // incidence at each horizon, beside the naive 1 − KM that censors the dead
  const hz = horizons.map((months) => ({ months, cells: curves.map((c) => {
    const recs = recsBy[c.cohort];
    const cif = aalenJohansen(recs), at = cifAt(cif, months);
    const km = kaplanMeier(recs.map((r) => ({ t: r.t, event: r.cause === 1 ? 1 : 0, ...(r.entry != null ? { entry: r.entry } : {}) })));
    let s = 1;
    for (const pt of km.points) { if (pt.t > months) break; s = pt.s; }
    const atRisk = recs.filter((r) => (r.entry ?? -Infinity) < months && r.t >= months).length;
    return { cohort: c.cohort, f1: at.f1, lo: Math.max(0, at.f1 - Z_975 * at.se1), hi: Math.min(1, at.f1 + Z_975 * at.se1), naive: 1 - s, atRisk };
  }) }));
  let gray: ReturnType<typeof grayPermutationTest> | undefined;
  const live = curves.filter((c) => c.n);
  const nAll = live.reduce((a, c) => a + c.n, 0);
  const perms = nAll > 50000 ? 500 : 2000;
  if (live.length >= 2) gray = grayPermutationTest(live.map((c) => recsBy[c.cohort]), perms, 1);
  const multi = ctx.vStudies.length > 1;
  const exTotal = (k: keyof IncidenceCurve["excluded"]) => curves.reduce((a, c) => a + c.excluded[k], 0);
  return {
    kind: "incidence", cohorts: vNames,
    method: incidenceMethod({
      eventLabel, horizons,
      ...(anchor ? { anchor: (anchor.occurrence === "LAST" ? "last " : "first ") + anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") } : {}),
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      cohorts: curves.map((c) => ({ name: c.cohort, n: c.n, events: c.events, competing: c.competing, censored: c.censored, late: c.late, excluded: c.excluded })),
      counts: countRows.sort((x, y) => vNames.indexOf(x.cohort) - vNames.indexOf(y.cohort) || (x.study < y.study ? -1 : x.study > y.study ? 1 : 0) ||
        x.t - y.t || x.cause - y.cause || x.entry - y.entry),
      ...(gray ? { gray: { statistic: gray.statistic, p: gray.p, permutations: gray.permutations } } : {}),
      horizonResults: hz.flatMap((h) => h.cells.filter((c) => curves.find((x) => x.cohort === c.cohort)!.n > 0)
        .map((c) => ({ cohort: c.cohort, months: h.months, f1: c.f1, lo: c.lo, hi: c.hi }))),
    }),
    incidence: { eventLabel, ...(anchor ? { anchoredTo: anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") } : {}),
      curves, horizons: hz, ...(gray ? { gray } : {}), ...(excluded.length ? { excludedStudies: excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Cumulative incidence of the first " + eventLabel + " after " + (anchor ? (anchor.occurrence === "LAST" ? "the last " : "the first ") + anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") : "the study's day 0") +
      ", with death (OS_STATUS) as a competing risk: Aalen–Johansen, 95% intervals from its delta-method standard error. " +
      "It is not 1 − Kaplan–Meier: that treats the dead as still at risk of the event and overstates incidence whenever death is common — the table sets the two side by side. " +
      (anchor ? "Left truncation as in the survival view: a patient anchored before day 0 enters the risk set at day 0, not at the anchor. " : "") +
      "Excluded rather than counted as event-free: " + exTotal("prior") + " who already had it " + (anchor ? "at or before the anchor" : "by day 0") +
      (exTotal("unobserved") ? ", " + exTotal("unobserved") + " who had it after the anchor but before observation began" : "") +
      ", " + exTotal("noFollowup") + " without follow-up" + (anchor ? ", " + exTotal("noAnchor") + " with no " + anchor.eventType + " event" : "") + ". " +
      (curves.some((c) => c.late) ? curves.reduce((a, c) => a + c.late, 0) + " had their first event recorded after their last follow-up and are kept as censored or dead at follow-up. " : "") +
      (gray ? "Gray's test (weight 1) by permutation of cohort labels, " + gray.permutations + " shuffles, seeded; exact under the null that the cohorts share one distribution, entry times included. " : "") +
      "An event recorded from notes or registries is only as complete as the recording." +
      (multi ? " Records are pooled across " + ctx.vStudies.length + " studies, whose day 0 need not mean the same thing." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
