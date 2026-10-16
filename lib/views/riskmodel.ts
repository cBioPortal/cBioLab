// Risk model view: an elastic-net Cox ensemble over the cohort's mutated genes, and its risk groups.
//
// Two stages. `fitRiskmodel` fetches each patient's row and fits the ensemble — seconds to tens of
// seconds — and depends only on what decides the model (`RiskFitArgs`). `groupRiskmodel` cuts the
// held-out scores into risk groups and computes their curves and tests — milliseconds — from the
// fit alone. The routes cache the fit (lib/next-cache.ts `cachedRiskFit`), so a change to the
// groups refits nothing.
import type { ViewResult, RiskmodelView, RiskmodelResult, CohortDef } from "../types.ts";
import { hasViewAggregates, isPatientLevel, resolverFor, type PatientLevelCapable, type ViewAggregateCapable } from "../federation.ts";
import { riskmodelRowsSql, riskmodelPanelGenesSql } from "../federation-views.ts";
import { coxnetEnsemble, coxFit, concordance, type CoxSubject, type CoxDesign } from "../coxnet.ts";
import { kaplanMeier, logRankK } from "../stats.ts";
import { riskmodelMethod } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, refuse } from "./shared.ts";
import { RISK_LABEL_ABOVE } from "../figures/riskmodel.ts";

const RISK_MAX_RUNS = 100;
/** patients x runs past which one request would not finish inside the analysis route's time limit */
const RISK_WORK_LIMIT = 300_000;
const RISK_LAMBDAS = 25, RISK_FOLDS = 3, RISK_TEST_SHARE = 1 / 3;

const RISK_MAX_COVARIATES = 6, RISK_MAX_LEVELS = 10;

// ---- the fit ----------------------------------------------------------------------------------

/** Everything that decides the model, and nothing that only decides its groups or its drawing. */
export interface RiskFitSpec {
  endpoint: string;
  columns: { months: string; status: string } | null;
  measure: "any" | "driver";
  /** the OncoKB pin a driver call is read at; null for "any" */
  driverPin: string | null;
  minMutated: number;
  strata: string | null;
  covariates: string[];
  anchor: { eventType: string; key?: string; value?: string; occurrence: "FIRST" | "LAST" } | null;
  validate: boolean;
  alpha: number; runs: number; seed: number;
}

/** A fit's inputs, all plain data: the cache key of `cachedRiskFit`, and what `riskFitDirect` fits from. */
export interface RiskFitArgs {
  study: string;
  /** the cohort's definition as runAnalysis resolved it (parameters, splits and `extends` applied) */
  def: CohortDef;
  /** what the study's resolver compiles the cohort with, as runAnalysis builds it */
  compile: { oncokbPin: string | null; profiles: string[]; gaProfiles: string[] };
  spec: RiskFitSpec;
}

/**
 * A fitted model, as plain JSON (it is cached, and the cache hands back no typed arrays and no
 * NaN). Per modelled patient, by position and without any identifier: their survival time,
 * entry, event and stratum, and their scores. Everything else is a summary.
 */
export interface RiskFit {
  /** the queries the fit ran, as the resolver logged them: the view's provenance */
  queries: { label: string; sql: string; ms?: number }[];
  rowsReturned: number;
  n: number; events: number;
  notProfiled: number; noStratum: number; noCovariate: number; noAnchor: number; anchorAfterStart: number; noFollowUp: number;
  genesCovered: number; candidates: number; strataLevels: number;
  /** the clock starts at a timeline event (entries are delayed), and the model was trained on the discovery half only */
  anchored: boolean; validated: boolean;
  subjects: { time: number[]; entry: number[]; event: (0 | 1)[]; stratum: number[] };
  /** the patients the runs split between training and testing (all, or the discovery half), and the validation half */
  pool: number[]; validation: number[];
  /** per patient: the mean of their held-out scores (null if never held out, or outside the pool) */
  heldOut: (number | null)[];
  /** per patient: the mean of every run's score, for the validation half only (null elsewhere) */
  external: (number | null)[];
  cIndexRuns: number[];
  validationCIndex: number | null;
  features: RiskmodelResult["features"];
  covariates: RiskmodelResult["covariates"];
}

/**
 * A request the data cannot answer, found while fitting. Thrown, so a cache never stores it
 * (invariant 11). It carries the queries that found it, for the view's provenance, and whether its
 * message reads after the cohort's name ("“NSCLC” has 12 patients …").
 */
export class RiskRefusal extends Error {
  queries: RiskFit["queries"];
  aboutCohort: boolean;
  constructor(message: string, queries: RiskFit["queries"], aboutCohort = false) {
    super(message);
    this.name = "RiskRefusal";
    this.queries = queries;
    this.aboutCohort = aboutCohort;
  }
}

/** Fetch the cohort's rows and fit the ensemble. Throws RiskRefusal when the data cannot support a model. */
/** the resolver a fit reads through: a patient-level participant (viewRows) with view aggregates (viewMeta) */
type RiskResolver = PatientLevelCapable & ViewAggregateCapable;

export async function fitRiskmodel(r: RiskResolver, args: RiskFitArgs): Promise<RiskFit> {
  const s = args.spec;
  const mark = r.queries.length;
  const [rows, panelRows] = await riskViewRows(r, args);
  const logged = () => r.queries.slice(mark).map((q) => ({ label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) }));
  const panelGenes = new Map(panelRows.map((x) => [String(x.panel), new Set((x.genes as unknown as string[]) || [])] as const));
  // who is modelled, and who is left out and why — every exclusion is counted
  let notProfiled = 0, noStratum = 0, noCovariate = 0, noAnchor = 0, anchorAfterStart = 0, noFollowUp = 0;
  const kept: { t: number; entry: number; ev: boolean; stratum: string; genes: string[]; panels: string[]; cov: string[]; half: number }[] = [];
  for (const x of rows) {
    const panels = ((x.panels as unknown as string[]) || []).map(String);
    if (!panels.length) { notProfiled++; continue; }
    const st = s.strata ? String(x.stratum ?? "") : "";
    if (s.strata && !st) { noStratum++; continue; }
    const cov = s.covariates.map((_, k) => String(x["c" + k] ?? ""));
    if (cov.some((v) => !v)) { noCovariate++; continue; }
    let t = Number(x.m), entry = 0;
    if (s.anchor) {
      if (Number(x.anchored) !== 1) { noAnchor++; continue; }
      const off = Number(x.anchor_months);
      if (off > 0) { anchorAfterStart++; continue; }
      entry = -off; t = t - off;
      if (!(t > entry)) { noFollowUp++; continue; }
    }
    kept.push({ t, entry, ev: Number(x.ev) === 1, stratum: st, genes: ((x.genes as unknown as string[]) || []).map(String), panels, cov, half: Number(x.half) });
  }
  if (kept.length < 50) throw new RiskRefusal("has " + kept.length + " patients with a survival time, a mutation panel and every covariate on record; a risk model needs at least 50", logged(), true);
  // candidates: genes every modelled patient's panels cover (WES covers all), mutated often enough
  let covered = null as Set<string> | null;
  for (const key of new Set(kept.map((k) => [...k.panels].sort().join("|")))) {
    const ps = key.split("|");
    if (ps.includes("WES")) continue;
    const union = new Set<string>();
    for (const p of ps) for (const g of panelGenes.get(p) || []) union.add(g);
    covered = covered ? new Set([...covered].filter((g) => union.has(g))) : union;
  }
  const mutated = new Map<string, number[]>();
  kept.forEach((k, i) => { for (const g of k.genes) if (!covered || covered.has(g)) { let l = mutated.get(g); if (!l) mutated.set(g, l = []); l.push(i); } });
  const cands = [...mutated].filter(([, l]) => l.length >= s.minMutated).sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]));
  if (!cands.length) throw new RiskRefusal("no gene covered for every patient is mutated in at least " + s.minMutated + " of them; lower minMutated", logged());
  // covariates: numbers as they are; categories as indicators against the commonest value
  const dense: CoxDesign["dense"] = [];
  for (let k = 0; k < s.covariates.length; k++) {
    const vals = kept.map((x) => x.cov[k]);
    const nums = vals.map(Number);
    if (nums.every(Number.isFinite)) { dense.push({ name: s.covariates[k], values: Float64Array.from(nums) }); continue; }
    const freq = new Map<string, number>(); for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
    const levels = [...freq].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([v]) => v);
    if (levels.length > RISK_MAX_LEVELS) throw new RiskRefusal(s.covariates[k] + " takes " + levels.length + " values among these patients; a categorical covariate takes at most " + RISK_MAX_LEVELS, logged());
    for (const lv of levels.slice(1)) dense.push({ name: s.covariates[k] + " = " + lv + " (vs " + levels[0] + ")", values: Float64Array.from(vals, (v) => v === lv ? 1 : 0) });
  }
  const strataLevels = [...new Set(kept.map((k) => k.stratum))].sort();
  const stratumIndex = new Map(strataLevels.map((v, i) => [v, i] as const));
  const subj: CoxSubject[] = kept.map((k) => ({ time: k.t, event: k.ev, entry: k.entry, stratum: stratumIndex.get(k.stratum)! }));
  const X: CoxDesign = { n: kept.length, binary: cands.map(([g, l]) => ({ name: g, rows: Int32Array.from(l) })), dense };
  const disc = Int32Array.from(kept.map((_, i) => i).filter((i) => !s.validate || kept[i].half === 0));
  const valid = s.validate ? Int32Array.from(kept.map((_, i) => i).filter((i) => kept[i].half === 1)) : new Int32Array(0);
  if (s.validate && (disc.length < 50 || valid.length < 50)) throw new RiskRefusal("validation needs at least 50 patients in each half; this cohort has " + disc.length + " and " + valid.length, logged());
  const fit = coxnetEnsemble(subj, X, { runs: s.runs, alpha: s.alpha, seed: s.seed, folds: RISK_FOLDS, testShare: RISK_TEST_SHARE, nLambda: RISK_LAMBDAS,
    unpenalized: dense.map((d) => d.name), pool: disc, ...(s.validate ? { alsoScore: valid } : {}) });
  const nb = X.binary.length;
  const orNull = (x: number) => Number.isNaN(x) ? null : x;
  return {
    queries: logged(), rowsReturned: rows.length, n: kept.length, events: kept.filter((k) => k.ev).length,
    notProfiled, noStratum, noCovariate, noAnchor, anchorAfterStart, noFollowUp,
    genesCovered: covered ? covered.size : -1, candidates: cands.length, strataLevels: strataLevels.length,
    anchored: s.anchor != null, validated: s.validate,
    subjects: { time: subj.map((x) => x.time), entry: subj.map((x) => x.entry ?? 0), event: subj.map((x) => x.event ? 1 : 0), stratum: subj.map((x) => x.stratum ?? 0) },
    pool: [...disc], validation: [...valid],
    heldOut: Array.from(fit.risk, orNull), external: Array.from(fit.external, orNull),
    cIndexRuns: fit.runs.map((x) => x.cIndex),
    validationCIndex: s.validate ? concordance(subj, valid, Float64Array.from(valid, (i) => fit.external[i])) : null,
    features: cands.map(([g, l], j) => ({ gene: g, selected: fit.selected[j], meanCoef: fit.meanCoef[j], hr: Math.exp(fit.meanCoef[j]), mutated: l.length }))
      .filter((f) => f.selected > 0).sort((x, y) => y.selected - x.selected || Math.abs(y.meanCoef) - Math.abs(x.meanCoef)),
    covariates: dense.map((d, j) => ({ name: d.name, meanCoef: fit.meanCoef[nb + j], hr: Math.exp(fit.meanCoef[nb + j]) })),
  };
}

/** The fit's two queries, through the patient-level resolver alone (test/boundary.test.ts sweeps their SQL). */
function riskViewRows(r: RiskResolver, args: RiskFitArgs) {
  const s = args.spec;
  return Promise.all([
    r.viewRows("riskmodel:rows", args.def, (c, st, d) => riskmodelRowsSql(c, st, d, { endpoint: s.endpoint, columns: s.columns ?? undefined, strata: s.strata,
      covariates: s.covariates, driverPin: s.driverPin, anchor: s.anchor })),
    r.viewMeta("riskmodel:panels", (st, d) => riskmodelPanelGenesSql(st, d)),
  ]);
}

/**
 * The fit, uncached: the study's resolver built as runAnalysis builds it, which must be a local
 * patient-level one — the rows a model needs never come from anywhere else.
 */
export async function riskFitDirect(args: RiskFitArgs): Promise<RiskFit> {
  const r = await resolverFor(args.study, args.compile);
  if (!isPatientLevel(r) || !hasViewAggregates(r) || r.instance.id === "peer")
    throw new RiskRefusal(args.study + " answers in aggregate only; a risk model needs each patient's rows, which only a patient-level participant returns", []);
  return fitRiskmodel(r, args);
}

// ---- the groups -------------------------------------------------------------------------------

/** Kaplan-Meier survival at month t: the last step at or before it; null past the curve's follow-up. */
function survivalAt(curve: { points: { t: number; s: number }[] }, followUp: number, t: number): number | null {
  if (t > followUp) return null;
  let s = 1;
  for (const q of curve.points) { if (q.t <= t) s = q.s; else break; }
  return s;
}

export interface RiskGrouping {
  groups: RiskmodelResult["groups"];
  logrank: RiskmodelResult["logrank"];
  refit: RiskmodelResult["refit"];
  histogram: RiskmodelResult["histogram"];
  scale: RiskmodelResult["scale"];
  /** patients of the pool never held out, so unscored and in no group */
  neverHeldOut: number;
  /** distinct held-out scores, and how many groups the cuts made */
  distinct: number; groupsMade: number;
}

/**
 * Cut the fit's held-out scores into `nGroups` groups at equal quantiles, and report them: on
 * the same patients, or with validation on the other half, cut at the discovery half's quantiles —
 * so nothing reported was used to train or to place the cuts. Pure: the fit alone decides it.
 */
export function groupRiskmodel(fit: RiskFit, nGroups: number): RiskGrouping {
  const validate = fit.validated, anchored = fit.anchored;
  const subj: CoxSubject[] = fit.subjects.time.map((time, i) => ({ time, event: fit.subjects.event[i] === 1, entry: fit.subjects.entry[i], stratum: fit.subjects.stratum[i] }));
  const poolScored = fit.pool.filter((i) => fit.heldOut[i] != null);
  const sorted = poolScored.map((i) => fit.heldOut[i]!).sort((x, y) => x - y);
  // cut at equal quantiles; patients with the same score stay together, so a cut that lands inside a
  // run of tied scores moves to that run's end, and cuts that end up equal (or leave a group empty)
  // merge — fewer groups, said in the caption, rather than splitting identical scores apart
  const distinct = new Set(sorted).size;
  // a cut is a boundary between two different scores: of the two edges of the run of ties at the
  // target rank, the one nearer an equal split
  const cutAt = (f: number): number | null => {
    const k = Math.min(sorted.length - 1, Math.floor(f * sorted.length));
    let lo = k, hi = k;
    while (lo > 0 && sorted[lo - 1] === sorted[k]) lo--;
    while (hi < sorted.length - 1 && sorted[hi + 1] === sorted[k]) hi++;
    const before = lo > 0 ? { at: lo, v: sorted[lo - 1] } : null, after = hi < sorted.length - 1 ? { at: hi + 1, v: sorted[hi] } : null;
    const pickEdge = !before ? after : !after ? before : Math.abs(before.at - f * sorted.length) <= Math.abs(after.at - f * sorted.length) ? before : after;
    return pickEdge ? pickEdge.v : null;
  };
  const cuts = [...new Set(Array.from({ length: nGroups - 1 }, (_, k) => cutAt((k + 1) / nGroups)).filter((c): c is number => c != null))]
    .sort((x, y) => x - y);
  const groupsMade = cuts.length + 1;
  const groupOf = (v: number) => { let g = 0; while (g < cuts.length && v > cuts[g]) g++; return g; };
  const reported = validate ? fit.validation : poolScored;
  const scoreOf = (i: number) => (validate ? fit.external[i] : fit.heldOut[i])!;
  const label = groupsMade === 1 ? ["All patients (the scores do not separate them)"] : groupsMade === 2 ? ["Low risk", "High risk"]
    : groupsMade === 3 ? ["Low risk", "Intermediate risk", "High risk"]
    : Array.from({ length: groupsMade }, (_, g) => "Risk group " + (g + 1) + " of " + groupsMade);
  const members: number[][] = Array.from({ length: groupsMade }, () => []);
  for (const i of reported) members[groupOf(scoreOf(i))].push(i);
  const rec = (i: number) => ({ t: subj[i].time, event: subj[i].event ? 1 : 0, ...(anchored ? { entry: subj[i].entry } : {}) });
  // hazard ratios: each group against the lowest, then the score alone (per SD), stratified as the model
  const repRows = Int32Array.from(reported);
  const nonEmpty = members.map((m) => m.length > 0);
  const n = subj.length;
  let groupFit: ReturnType<typeof coxFit> | null = null, refit: RiskmodelResult["refit"];
  try {
    const dummies = members.slice(1).map((_, g) => { const col = new Float64Array(n); for (const i of members[g + 1]) col[i] = 1; return col; })
      .filter((_, g) => nonEmpty[g + 1]);
    if (nonEmpty[0] && dummies.length) groupFit = coxFit(subj, repRows, dummies);
  } catch { groupFit = null; }
  try {
    const vals = reported.map(scoreOf), mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / vals.length) || 1;
    const col = new Float64Array(n); for (const i of reported) col[i] = (scoreOf(i) - mean) / sd;
    const f = coxFit(subj, repRows, [col]);
    refit = { hr: f.hr[0], ciLow: f.ciLow[0], ciHigh: f.ciHigh[0], p: f.p[0] };
  } catch { refit = null; }
  let gi = 0;
  const groups = members.map((m, g) => {
    const curve = kaplanMeier(m.map(rec));
    const followUp = Math.max(0, ...m.map((i) => subj[i].time));
    const fitIdx = g > 0 && nonEmpty[g] && groupFit ? gi++ : -1;
    return { name: label[g], from: g ? cuts[g - 1] : null, to: g < cuts.length ? cuts[g] : null, curve,
      at12: survivalAt(curve, followUp, 12), at36: survivalAt(curve, followUp, 36),
      hr: fitIdx >= 0 ? groupFit!.hr[fitIdx] : null, ciLow: fitIdx >= 0 ? groupFit!.ciLow[fitIdx] : null,
      ciHigh: fitIdx >= 0 ? groupFit!.ciHigh[fitIdx] : null, p: fitIdx >= 0 ? groupFit!.p[fitIdx] : null };
  });
  let logrank;
  try { logrank = logRankK(Array.from({ length: fit.strataLevels }, (_, s) => ({ groups: members.map((m) => m.filter((i) => subj[i].stratum === s).map(rec)) }))); } catch { logrank = null; }
  const hist = reported.map(scoreOf).sort((x, y) => x - y);
  const lo = hist[0], hi = hist[hist.length - 1], bins = 30, w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of hist) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  return { groups, logrank, refit, histogram: { edges: Array.from({ length: bins + 1 }, (_, k) => lo + k * w), counts },
    scale: { min: sorted[0], max: sorted[sorted.length - 1] }, neverHeldOut: fit.pool.length - poolScored.length, distinct, groupsMade };
}

// ---- the view ---------------------------------------------------------------------------------

/**
 * The view's model settings as the fit reads them — defaults applied, names normalised — and so
 * the fit's cache key. Settings that only decide the groups or the drawing (`groups`, `labelAbove`,
 * `note`) are not in it; test/riskmodel-groups.test.ts holds that line. runRiskmodel validates it.
 */
export function riskFitSpec(view: RiskmodelView, pin: string | null): RiskFitSpec {
  const num = (x: unknown, d: number) => x == null ? d : Number(x);
  const measure = view.measure === "driver" ? "driver" as const : "any" as const;
  const a = view.anchor;
  return {
    endpoint: String(view.endpoint || "OS").toUpperCase(),
    columns: view.monthsAttribute ? { months: String(view.monthsAttribute), status: String(view.statusAttribute) } : null,
    measure, driverPin: measure === "driver" ? pin : null,
    minMutated: num(view.minMutated, 30),
    strata: view.strata ? String(view.strata) : null,
    covariates: (view.covariates || []).map(String),
    anchor: a ? { eventType: String(a.eventType).slice(0, 120), ...(a.key ? { key: String(a.key).slice(0, 120), value: String(a.value ?? "") } : {}),
      occurrence: a.occurrence === "LAST" ? "LAST" as const : "FIRST" as const } : null,
    validate: !!view.validate,
    alpha: num(view.alpha, 0.5), runs: num(view.runs, 10), seed: num(view.seed, 1),
  };
}

export async function runRiskmodel(view: RiskmodelView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length !== 1) return refuse("riskmodel", ctx, "a risk model is fitted to one cohort; this view names " + vNames.length + " — choose one");
  const name = vNames[0];
  const studies = cohorts[name].studies;
  if (studies.length !== 1) return refuse("riskmodel", ctx, "a risk model is fitted within one study; “" + name + "” spans " + studies.length + " (" + studies.join(", ") + ")");
  const study = studies[0];
  const r = ctx.resolvers[study];
  if (!isPatientLevel(r) || !hasViewAggregates(r)) return refuse("riskmodel", ctx, study + " answers in aggregate only; a risk model needs each patient's rows, which only a patient-level participant returns");
  const spec = riskFitSpec(view, ctx.pin);
  const { endpoint, measure, minMutated, strata, covariates: covNames, anchor, validate, alpha, runs, seed } = spec;
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) return refuse("riskmodel", ctx, "endpoint is a name like OS or PFS");
  if (!!view.monthsAttribute !== !!view.statusAttribute) return refuse("riskmodel", ctx, "monthsAttribute and statusAttribute go together");
  if (measure === "driver" && !ctx.pin) return refuse("riskmodel", ctx, "measure \"driver\" needs the OncoKB annotation, which this server has no pinned version of");
  const num = (x: unknown, d: number) => x == null ? d : Number(x);
  const nGroups = num(view.groups, 3);
  if (!(alpha >= 0 && alpha <= 1)) return refuse("riskmodel", ctx, "alpha, the l1 share of the penalty, is 0 (ridge) to 1 (lasso)");
  if (!(Number.isInteger(runs) && runs >= 1 && runs <= RISK_MAX_RUNS)) return refuse("riskmodel", ctx, "runs is a whole number from 1 to " + RISK_MAX_RUNS);
  if (!(Number.isInteger(nGroups) && nGroups >= 2 && nGroups <= 5)) return refuse("riskmodel", ctx, "groups is 2 to 5");
  if (!(Number.isInteger(minMutated) && minMutated >= 5)) return refuse("riskmodel", ctx, "minMutated is a whole number of patients, at least 5");
  if (!Number.isInteger(seed)) return refuse("riskmodel", ctx, "seed is a whole number");
  const labelAbove = num(view.labelAbove, RISK_LABEL_ABOVE);
  if (!(labelAbove >= 0 && labelAbove <= 1)) return refuse("riskmodel", ctx, "labelAbove is a share of runs, 0 to 1");
  for (const a of [strata, ...covNames]) if (a && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) return refuse("riskmodel", ctx, "“" + a.slice(0, 40) + "” is not a clinical attribute's name");
  { const e = overLimit("a risk model", RISK_MAX_COVARIATES, covNames.length); if (e) return refuse("riskmodel", ctx, e.replace("at most " + RISK_MAX_COVARIATES, "at most " + RISK_MAX_COVARIATES + " covariates")); }
  if (new Set(covNames).size !== covNames.length || (strata && covNames.includes(strata))) return refuse("riskmodel", ctx, "a covariate is listed twice, or is also the stratum");
  if (view.anchor && !view.anchor.eventType) return refuse("riskmodel", ctx, "anchor needs eventType, the timeline event each patient's clock starts at");
  if (cohorts[name].count * runs > RISK_WORK_LIMIT)
    return refuse("riskmodel", ctx, "a risk model fits at most " + RISK_WORK_LIMIT.toLocaleString("en-US") + " patients × runs in one request; “" + name + "” has " +
      cohorts[name].count.toLocaleString("en-US") + " patients, so at most " + Math.max(1, Math.floor(RISK_WORK_LIMIT / Math.max(1, cohorts[name].count))) + " runs (or narrow the cohort)");

  const { profiles, gaProfiles } = await ctx.studyProfiles(study);
  const args: RiskFitArgs = { study, def: doc.cohorts[name], compile: { oncokbPin: ctx.pin, profiles, gaProfiles }, spec };
  let fit: RiskFit;
  try { fit = await (ctx.riskFit ?? riskFitDirect)({ ...args, patients: cohorts[name].count }); }
  catch (e) {
    if (!(e instanceof RiskRefusal)) throw e;
    const out = refuse("riskmodel", ctx, (e.aboutCohort ? "“" + name + "” " : "") + e.message);
    return e.queries.length ? { ...out, queries: e.queries.map((q) => ({ study, ...q })) } : out;
  }
  const g = groupRiskmodel(fit, nGroups);

  const cs = [...fit.cIndexRuns].filter((c) => Number.isFinite(c)).sort((x, y) => x - y);
  const pct = (f: number) => cs.length ? cs[Math.min(cs.length - 1, Math.round(f * (cs.length - 1)))] : NaN;
  const result: RiskmodelResult = {
    study, n: fit.n, events: fit.events, notProfiled: fit.notProfiled, noStratum: fit.noStratum, noCovariate: fit.noCovariate,
    noAnchor: fit.noAnchor, anchorAfterStart: fit.anchorAfterStart, noFollowUp: fit.noFollowUp,
    neverHeldOut: g.neverHeldOut, genesCovered: fit.genesCovered, candidates: fit.candidates, minMutated,
    strata, strataLevels: fit.strataLevels, alpha, runs, seed, measure,
    anchoredTo: anchor ? anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") + " (" + anchor.occurrence + ")" : null,
    covariates: fit.covariates, reportedOn: validate ? "validation half" : "held-out scores",
    validation: validate ? { discovery: fit.pool.length, validation: fit.validation.length,
      validationEvents: fit.validation.filter((i) => fit.subjects.event[i] === 1).length, cIndex: fit.validationCIndex! } : null,
    cIndex: { median: pct(0.5), q1: pct(0.25), q3: pct(0.75), values: fit.cIndexRuns },
    features: fit.features, groups: g.groups, logrank: g.logrank, refit: g.refit, histogram: g.histogram, scale: g.scale, labelAbove,
  };
  return {
    kind: "riskmodel", cohorts: vNames, riskmodel: result, queries: fit.queries.map((q) => ({ study, ...q })),
    method: riskmodelMethod({ study, cohort: name, cohortPatients: cohorts[name].count, rowsReturned: fit.rowsReturned, r: result,
      lambdas: RISK_LAMBDAS, folds: RISK_FOLDS, testShare: RISK_TEST_SHARE }),
    participation: ctx.participationFor([study], true),
    caveat: "Association, not cause: a gene's weight is its link to " + endpoint + " with the other candidates" + (fit.covariates.length ? " and the covariates" : "") +
      " held fixed, in this cohort" + (strata ? ", within each " + strata : "") + ". " +
      (strata ? "" : "Without strata, a gene that marks a cancer type carries that type's prognosis; on a cohort of several cancer types, stratify by CANCER_TYPE. ") +
      (validate ? "The model was trained on the discovery half of the engine's fixed split only; the curves, table and refit are the validation half's, cut at the discovery half's quantiles. "
        : "Each patient is scored only by models that did not train on them, and the group cuts are quantiles of the score, chosen without the outcome. ") +
      (anchor ? "The clock starts at " + result.anchoredTo + "; a patient enters the risk set only from the study's day 0 (delayed entry), so the time before their sequencing is not counted as survival. " : "") +
      "Genes outside the panels every patient was sequenced on are not candidates, so a patient is never counted as wild-type for a gene they were not tested for. " +
      (g.groupsMade < nGroups ? "Asked for " + nGroups + " groups, made " + g.groupsMade + ": the scores take only " + g.distinct + " distinct values, and patients with the same score stay in the same group. " : "") +
      (g.distinct < 20 && g.groupsMade === nGroups ? "The scores take only " + g.distinct + " distinct values, so the groups can be unequal in size: patients with the same score stay together. " : "") +
      "The C-index ignores delayed entry. Seeded (seed " + seed + "): the same document gives the same model.",
  };
}
