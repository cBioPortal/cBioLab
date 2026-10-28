// Cut-point view: the value of a numeric marker that best splits a cohort's survival, found by a
// scan of candidate cuts, with the maximum's p corrected for the scan by permutation. Fitted from
// per-patient (marker, time, event) rows inside each local patient-level study.
import type { ViewResult } from "../../types.ts";
import { hasViewAggregates, isPatientLevel } from "../../federation.ts";
import { kaplanMeier, logRank, coxRegression, seededRandom } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { refuse, plural, ATTR_NAME, PROFILE_NAME } from "../shared.ts";
import { ENTITY_RE, assayEntitySearchSql } from "../../generic-assay.ts";
import { entityShortName } from "../../profile-names.ts";
import type { CutpointView, CutpointScan, CutpointResult } from "./types.ts";
import { cutpointRowsSql } from "./sql.ts";

/** cuts are scanned between these quantiles of the marker, at most CUT_MAX_CANDIDATES of them */
export const CUT_LOW_Q = 0.1, CUT_HIGH_Q = 0.9, CUT_MAX_CANDIDATES = 100;
const CUT_MAX_STRATA = 8, CUT_MIN_N = 20;

export interface CutRec { v: number; t: number; ev: number }

/**
 * Maximally selected log-rank statistic (Lausen & Schumacher 1992; R maxstat's LogRank
 * statistic): the patients' log-rank scores (event minus the Nelson–Aalen hazard at their time),
 * summed over those at or below each candidate cut and standardized by its permutation variance,
 * squared. The candidates are the distinct marker values that leave between CUT_LOW_Q and
 * CUT_HIGH_Q of the patients at or below them (at most CUT_MAX_CANDIDATES, evenly spaced among
 * them). The maximum's p is the share of `permutations` seeded shuffles of the scores over the
 * patients' marker order whose own maximum reaches it ((1 + hits) / (1 + permutations)). `recs`
 * must come in a fixed order, since the shuffles are drawn over positions.
 */
export function scanCutpoints(recs: CutRec[], permutations: number, seed: number): CutpointScan | null {
  const n = recs.length;
  if (n < CUT_MIN_N) return null;
  // log-rank scores, in time order with ties grouped
  const byT = recs.map((_, i) => i).sort((a, b) => recs[a].t - recs[b].t || a - b);
  const score = new Float64Array(n);
  let H = 0;
  for (let i = 0; i < n;) {
    let j = i, d = 0;
    while (j < n && recs[byT[j]].t === recs[byT[i]].t) { d += recs[byT[j]].ev ? 1 : 0; j++; }
    H += d / (n - i);
    for (let k = i; k < j; k++) score[byT[k]] = (recs[byT[k]].ev ? 1 : 0) - H;
    i = j;
  }
  const byV = recs.map((_, i) => i).sort((a, b) => recs[a].v - recs[b].v || a - b);
  const a = Float64Array.from(byV, (i) => score[i]);
  const mean = a.reduce((x, y) => x + y, 0) / n;
  const s2 = a.reduce((x, y) => x + (y - mean) ** 2, 0);
  if (!(s2 > 0)) return null;
  // candidate cuts: the last position of each distinct value inside the quantile window
  let ks: number[] = [];
  for (let k = 1; k < n; k++) if (recs[byV[k]].v !== recs[byV[k - 1]].v && k >= CUT_LOW_Q * n && k <= CUT_HIGH_Q * n) ks.push(k);
  if (!ks.length) return null;
  if (ks.length > CUT_MAX_CANDIDATES) ks = Array.from({ length: CUT_MAX_CANDIDATES }, (_, j) => ks[Math.round(j * (ks.length - 1) / (CUT_MAX_CANDIDATES - 1))]);
  const varOf = ks.map((k) => k * (n - k) / (n * (n - 1)) * s2);
  const stats = (arr: Float64Array): number[] => {
    const out: number[] = [];
    let cum = 0, at = 0;
    for (let j = 0; j < ks.length; j++) {
      while (at < ks[j]) cum += arr[at++] - mean;
      out.push(cum * cum / varOf[j]);
    }
    return out;
  };
  const obs = stats(a);
  let best = 0;
  for (let j = 1; j < obs.length; j++) if (obs[j] > obs[best]) best = j;
  const maxStat = obs[best];
  const rand = seededRandom(seed), perm = Float64Array.from(a), maxima: number[] = [];
  let hits = 0;
  for (let b = 0; b < permutations; b++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const x = perm[i]; perm[i] = perm[j]; perm[j] = x; }
    const m = Math.max(...stats(perm));
    maxima.push(m);
    if (m >= maxStat - 1e-9) hits++;
  }
  maxima.sort((x, y) => x - y);
  const k = ks[best], cut = recs[byV[k - 1]].v;
  const low = byV.slice(0, k).map((i) => recs[i]), high = byV.slice(k).map((i) => recs[i]);
  const lr = logRank([{ a: low.map((r) => ({ t: r.t, event: r.ev })), b: high.map((r) => ({ t: r.t, event: r.ev })) }]);
  let hr: CutpointScan["hr"] = null;
  try {
    const f = coxRegression(recs.map((r) => ({ t: r.t, event: r.ev, x: [r.v > cut ? 1 : 0] })));
    if (Number.isFinite(f.hr[0])) hr = { hr: f.hr[0], ciLow: f.ciLow[0], ciHigh: f.ciHigh[0], p: f.p[0] };
  } catch { hr = null; }
  const side = (g: CutRec[]) => { const c = kaplanMeier(g.map((r) => ({ t: r.t, event: r.ev }))); return { n: c.n, events: c.events, median: c.median }; };
  return {
    n, events: recs.filter((r) => r.ev).length, cut, lowShare: k / n, maxStat, permP: (1 + hits) / (1 + permutations),
    naiveChi2: lr.chi2, naiveP: lr.p, critical95: maxima[Math.min(maxima.length - 1, Math.ceil(0.95 * maxima.length) - 1)] ?? NaN,
    hr, low: side(low), high: side(high),
    candidates: ks.map((kk, j) => ({ cut: recs[byV[kk - 1]].v, stat: Math.round(obs[j] * 1e4) / 1e4 })),
  };
}

const canon = (a: CutRec & { s?: string }, b: CutRec & { s?: string }) =>
  a.v - b.v || a.t - b.t || a.ev - b.ev || ((a.s ?? "") < (b.s ?? "") ? -1 : (a.s ?? "") > (b.s ?? "") ? 1 : 0);

export async function runCutpoint(view: CutpointView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length !== 1) return refuse("cutpoint", ctx, "a cut-point is found in one cohort; this view names " + vNames.length + " — choose one");
  const name = vNames[0];
  const assay = view.assay ? { profileType: String(view.assay.profileType || ""), entity: String(view.assay.entity || "") } : undefined;
  if (assay && (!PROFILE_NAME.test(assay.profileType) || !ENTITY_RE.test(assay.entity))) return refuse("cutpoint", ctx, "assay names a generic-assay profile and one of its entities");
  if (assay && view.attribute) return refuse("cutpoint", ctx, "the marker is an attribute or an assay entity, not both");
  let attribute = assay ? entityShortName(assay.entity, assay.profileType) : String(view.attribute || "TMB_NONSYNONYMOUS").trim();
  if (!assay && !ATTR_NAME.test(attribute)) return refuse("cutpoint", ctx, "“" + attribute.slice(0, 40) + "” is not a clinical attribute's name");
  const endpoint = String(view.endpoint || "OS").toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) return refuse("cutpoint", ctx, "endpoint is a name like OS or PFS");
  if (!!view.monthsAttribute !== !!view.statusAttribute) return refuse("cutpoint", ctx, "monthsAttribute and statusAttribute go together");
  const months = view.monthsAttribute ? String(view.monthsAttribute) : endpoint + "_MONTHS", status = view.statusAttribute ? String(view.statusAttribute) : endpoint + "_STATUS";
  for (const a of [months, status]) if (!ATTR_NAME.test(a)) return refuse("cutpoint", ctx, "“" + a.slice(0, 40) + "” is not an attribute name");
  const endpointLabel = view.monthsAttribute ? months + "/" + status : endpoint;
  const permutations = view.permutations == null ? 1000 : Number(view.permutations);
  if (!(Number.isInteger(permutations) && permutations >= 100 && permutations <= 5000)) return refuse("cutpoint", ctx, "permutations is a whole number, 100 to 5000");
  const seed = view.seed == null ? 1 : Number(view.seed);
  if (!Number.isInteger(seed)) return refuse("cutpoint", ctx, "seed is a whole number");
  const stratifyBy = view.stratifyBy ? String(view.stratifyBy).trim() : null;
  if (stratifyBy && !ATTR_NAME.test(stratifyBy)) return refuse("cutpoint", ctx, "“" + stratifyBy.slice(0, 40) + "” is not a clinical attribute's name");
  if (stratifyBy === attribute) return refuse("cutpoint", ctx, "stratifyBy must be a different attribute from the marker");
  const minStratum = view.minStratum == null ? 100 : Number(view.minStratum);
  if (!(Number.isInteger(minStratum) && minStratum >= CUT_MIN_N)) return refuse("cutpoint", ctx, "minStratum is a whole number of patients, at least " + CUT_MIN_N);

  const recs: (CutRec & { s?: string })[] = [];
  const queries: NonNullable<ViewResult["queries"]> = [];
  let noValue = 0;
  for (const st of cohorts[name].studies) {
    const r = ctx.resolvers[st];
    if (!isPatientLevel(r) || !hasViewAggregates(r)) return refuse("cutpoint", ctx, st + " answers in aggregate only; a permutation test needs each patient's (marker, time, event), which only a patient-level participant returns");
    const mark = r.queries.length;
    if (assay) {
      if (!(await ctx.studyProfiles(st)).gaProfiles.includes(assay.profileType)) return refuse("cutpoint", ctx, st + " has no generic-assay profile '" + assay.profileType + "'");
      const hits = await r.viewMeta("cutpoint:entity", (s, d) => assayEntitySearchSql(s, d, assay.profileType, assay.entity, 6));
      const hit = hits.find((h) => String(h.entity) === assay.entity);
      if (!hit) return refuse("cutpoint", ctx, st + "'s " + assay.profileType + " has no entity '" + assay.entity + "'" + (hits.length ? "; closest " + hits.map((h) => String(h.entity)).join(", ") : ""));
      if (hit.name && String(hit.name) !== assay.entity) attribute = String(hit.name);
    }
    const rows = await r.viewRows("cutpoint:rows", doc.cohorts[name], (c, s, d) => cutpointRowsSql(c, s, d, { attribute, months, status, stratum: stratifyBy, ...(assay ? { assay } : {}) }));
    for (const q of r.queries.slice(mark)) queries.push({ study: st, label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) });
    for (const x of rows) {
      const v = x.v == null ? NaN : Number(x.v);
      if (!Number.isFinite(v)) { noValue++; continue; }
      recs.push({ v, t: Number(x.m), ev: Number(x.ev) === 1 ? 1 : 0, ...(stratifyBy ? { s: String(x.s ?? "") } : {}) });
    }
  }
  if (!recs.length) return refuse("cutpoint", ctx, "no patient of “" + name + "” has both a " + endpointLabel + " time and a numeric " + attribute + " value" +
    (noValue ? " (" + plural(noValue, "patient") + " with a survival time have none)" : " — check that the study records " + attribute + " and " + months + "/" + status));
  recs.sort(canon);
  const overall = scanCutpoints(recs, permutations, seed);
  if (!overall) return refuse("cutpoint", ctx, "“" + name + "” has " + plural(recs.length, "patient") + " with a value, " + recs.filter((r) => r.ev).length +
    " events; a scan needs at least " + CUT_MIN_N + " patients, some events, and at least two distinct values of " + attribute + " between its 10th and 90th percentiles");
  const km = (g: CutRec[]) => kaplanMeier(g.map((r) => ({ t: r.t, event: r.ev })));
  const result: CutpointResult = { attribute, endpoint: endpointLabel, permutations, seed, noValue, ...overall,
    curves: { low: km(recs.filter((r) => r.v <= overall.cut)), high: km(recs.filter((r) => r.v > overall.cut)) } };
  if (stratifyBy) {
    const by = new Map<string, typeof recs>();
    for (const r of recs) { const k = r.s || ""; let l = by.get(k); if (!l) by.set(k, l = []); l.push(r); }
    const ranked = [...by].filter(([k]) => k).sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1));
    const kept = ranked.filter(([, l]) => l.length >= minStratum).slice(0, CUT_MAX_STRATA);
    const rows = kept.flatMap(([stratum, l]) => {
      const sc = scanCutpoints(l, permutations, seed);
      if (!sc) return [];
      const { candidates: _c, ...rest } = sc;
      return [{ stratum, ...rest }];
    });
    const keptSet = new Set(rows.map((x) => x.stratum));
    const omitted = [...by].filter(([k]) => !keptSet.has(k));
    result.strata = { attribute: stratifyBy, minStratum, rows, omitted: { values: omitted.length, patients: omitted.reduce((a, [, l]) => a + l.length, 0) } };
  }
  const pct = (x: number) => Math.round(x * 1000) / 10 + "%";
  return {
    kind: "cutpoint", cohorts: vNames, cutpoint: result, queries,
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "The cut was chosen from these patients to separate their " + endpointLabel + " as much as possible, so the split is optimistic in-sample: its naive log-rank p (" + overall.naiveP.toPrecision(2) +
      ") ignores the search and overstates the evidence, and the cut needs validation in an independent cohort before it is used. " +
      "Scanned: " + overall.candidates.length + " candidate cuts — the distinct values of " + attribute + " leaving between " + CUT_LOW_Q * 100 + "% and " + CUT_HIGH_Q * 100 + "% of patients at or below them" +
      " (at most " + CUT_MAX_CANDIDATES + ", evenly spaced) — by the maximally selected standardized log-rank statistic (Lausen & Schumacher; R maxstat). " +
      "The corrected p is from " + permutations + " permutations of the marker over the patients (seed " + seed + "): the share whose own best cut does as well. High is " + attribute + " > " + Number(overall.cut.toPrecision(4)) +
      " (" + pct(1 - overall.lowShare) + " of patients). " +
      (assay ? attribute + " (" + assay.entity + " of " + assay.profileType + ") is the patient's value, or that of the patient's first cohort sample with one, by sample id; "
        : attribute + " is the patient's value, or for a sample attribute the value of the patient's first cohort sample by sample id; ") + noValue + " patients with a survival time and no numeric value are left out. " +
      "The status '1:…' is an event, anything else censored; times from each study's own baseline" + (ctx.vStudies.length > 1 ? ", pooled across " + ctx.vStudies.length + " studies without harmonizing baselines or panels (a panel-dependent marker such as TMB is not comparable across panels)" : "") + ". " +
      (result.strata ? "Per " + stratifyBy + ": the largest " + CUT_MAX_STRATA + " values with at least " + minStratum + " patients each get their own scan and permutation test (same seed); " +
        result.strata.omitted.values + " other values (" + result.strata.omitted.patients + " patients) are not scanned. Each stratum's cut is as optimistic as the overall one. " : "") +
      "Computed from per-patient rows inside each patient-level study.",
  };
}
