// Risk model view: an elastic-net Cox ensemble over the cohort's mutated genes, and its risk groups.
//
// Two stages. `fitRiskmodel` fetches each patient's row and fits the ensemble — seconds to tens of
// seconds — from `RiskFitArgs` alone, which carry the whole view but for the settings named in
// RISK_PRESENTATION_KEYS. `groupRiskmodel` cuts the
// held-out scores into risk groups and computes their curves and tests — milliseconds — from the
// fit alone. The routes cache the fit (lib/next-cache.ts `cachedRiskFit`), so a change to the
// groups refits nothing.
import type { ViewResult, CohortDef } from "../../types.ts";
import { hasViewAggregates, isPatientLevel, resolverFor, type PatientLevelCapable, type ViewAggregateCapable } from "../../federation.ts";
import { riskmodelRowsSql, riskmodelPanelGenesSql } from "../../federation-views.ts";
import { coxnetEnsemble, coxFit, concordance, type CoxSubject, type CoxDesign } from "../../coxnet.ts";
import { kaplanMeier, logRankK } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, refuse } from "../shared.ts";
import { RISK_LABEL_ABOVE, RISK_FIGURE_GENES, riskGroupNames } from "./figure.ts";
import { tableAttributesSql } from "../../clinical-table.ts";
import { riskExternal } from "./validate.ts";
import { buildTable1, table1DefaultCandidates, TABLE1_MAX_ATTRIBUTES, TABLE1_MAX_GENES, type Table1Patient } from "./table1.ts";
import type { RiskmodelView, RiskmodelResult } from "./types.ts";
import { riskmodelMethod } from "./method.ts";

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

/**
 * The view's settings that decide only how its groups are cut, drawn and described (Table 1, the external validation), never the model: the one
 * list a setting must be on to be left out of the fit's cache key. Everything else in the view —
 * including any setting added later — is in the key, so a setting nobody thought about costs at
 * worst a needless refit, never a fit served for a different model. A setting goes here only if
 * riskFitSpec does not read it (test/riskmodel-groups.test.ts checks each one).
 */
export const RISK_PRESENTATION_KEYS = ["groups", "cuts", "labelAbove", "note", "cohorts", "describe", "validateOn"] as const;

/** The view without its presentation settings, keys sorted: the part of the fit's key the view gives. */
export function riskModelView(view: RiskmodelView): RiskmodelView {
  const skip = new Set<string>(RISK_PRESENTATION_KEYS);
  return Object.fromEntries(Object.entries(view).filter(([k, v]) => !skip.has(k) && v !== undefined).sort(([a], [b]) => a.localeCompare(b))) as RiskmodelView;
}

/**
 * A fit's inputs, all plain data. They are `cachedRiskFit`'s cache key, and they are all a fit
 * reads (riskFitDirect is given nothing else), so nothing that decides a fit can be missing from
 * its key; the database and the code it runs are the cache's own (dataVersion(), the deployment).
 */
export interface RiskFitArgs {
  study: string;
  /** the cohort's definition as runAnalysis resolved it (parameters, splits and `extends` applied) */
  def: CohortDef;
  /** what the study's resolver compiles the cohort with, as runAnalysis builds it */
  compile: { oncokbPin: string | null; profiles: string[]; gaProfiles: string[] };
  /** the view, as riskModelView leaves it */
  view: RiskmodelView;
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

/** A modelled patient's row, as the fit reads it: by position, without any identifier. */
export interface RiskKeptRow { t: number; entry: number; ev: boolean; stratum: string; genes: string[]; panels: string[]; cov: string[]; half: number }

/**
 * Who of the rows `riskmodelRowsSql` returned is modelled, and who is left out and why — every
 * exclusion counted. The fit and Table 1 both read their patients through this, so the same rows
 * give the same patients in the same order. `at[k]` is kept patient k's position in `rows`.
 */
export function keepRiskRows(rows: Record<string, unknown>[], s: Pick<RiskFitSpec, "strata" | "covariates" | "anchor">) {
  let notProfiled = 0, noStratum = 0, noCovariate = 0, noAnchor = 0, anchorAfterStart = 0, noFollowUp = 0;
  const kept: RiskKeptRow[] = [], at: number[] = [];
  rows.forEach((x, row) => {
    const panels = ((x.panels as unknown as string[]) || []).map(String);
    if (!panels.length) { notProfiled++; return; }
    const st = s.strata ? String(x.stratum ?? "") : "";
    if (s.strata && !st) { noStratum++; return; }
    const cov = s.covariates.map((_, k) => String(x["c" + k] ?? ""));
    if (cov.some((v) => !v)) { noCovariate++; return; }
    let t = Number(x.m), entry = 0;
    if (s.anchor) {
      if (Number(x.anchored) !== 1) { noAnchor++; return; }
      const off = Number(x.anchor_months);
      if (off > 0) { anchorAfterStart++; return; }
      entry = -off; t = t - off;
      if (!(t > entry)) { noFollowUp++; return; }
    }
    kept.push({ t, entry, ev: Number(x.ev) === 1, stratum: st, genes: ((x.genes as unknown as string[]) || []).map(String), panels, cov, half: Number(x.half) });
    at.push(row);
  });
  return { kept, at, left: { notProfiled, noStratum, noCovariate, noAnchor, anchorAfterStart, noFollowUp } };
}

/** Fetch the cohort's rows and fit the ensemble. Throws RiskRefusal when the data cannot support a model. */
/** the resolver a fit reads through: a patient-level participant (viewRows) with view aggregates (viewMeta) */
export type RiskResolver = PatientLevelCapable & ViewAggregateCapable;

export async function fitRiskmodel(r: RiskResolver, args: RiskFitArgs): Promise<RiskFit> {
  const s = riskFitSpec(args.view, args.compile.oncokbPin);
  const mark = r.queries.length;
  const [rows, panelRows] = await riskViewRows(r, args);
  const logged = () => r.queries.slice(mark).map((q) => ({ label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) }));
  const panelGenes = new Map(panelRows.map((x) => [String(x.panel), new Set((x.genes as unknown as string[]) || [])] as const));
  const { kept, left: { notProfiled, noStratum, noCovariate, noAnchor, anchorAfterStart, noFollowUp } } = keepRiskRows(rows, s);
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

/**
 * The fit's two queries — and Table 1's, which are the same with its attributes added — through the
 * patient-level resolver alone (test/boundary.test.ts sweeps their SQL).
 */
export function riskViewRows(r: RiskResolver, args: RiskFitArgs, table1?: { describe: string[] }) {
  const s = riskFitSpec(args.view, args.compile.oncokbPin);
  return Promise.all([
    r.viewRows(table1 ? "riskmodel:table1" : "riskmodel:rows", args.def, (c, st, d) => riskmodelRowsSql(c, st, d, { endpoint: s.endpoint, columns: s.columns ?? undefined, strata: s.strata,
      covariates: s.covariates, driverPin: s.driverPin, anchor: s.anchor, ...(table1 ? { describe: table1.describe } : {}) })),
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
  percentiles: RiskmodelResult["percentiles"];
  /** patients of the pool never held out, so unscored and in no group */
  neverHeldOut: number;
  /** distinct held-out scores, and how many groups the cuts made */
  distinct: number; groupsMade: number;
  /** each group's patients, as positions in the fit's subjects (no identifiers); not part of the result */
  members: number[][];
}

/** The quantiles a view's groups are cut at: `n` equal groups, or the quantiles it names. */
export const groupQuantiles = (g: { groups: number } | { cuts: number[] }): number[] =>
  "cuts" in g ? g.cuts : Array.from({ length: g.groups - 1 }, (_, k) => (k + 1) / g.groups);

/**
 * Cut the fit's held-out scores at quantiles `qs` (groupQuantiles), and report the groups: on the
 * same patients, or with validation on the other half, cut at the discovery half's quantiles — so
 * nothing reported was used to train or to place the cuts. Pure: the fit alone decides it.
 */
export function groupRiskmodel(fit: RiskFit, qs: number[]): RiskGrouping {
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
  const cuts = [...new Set(qs.map(cutAt).filter((c): c is number => c != null))].sort((x, y) => x - y);
  const groupsMade = cuts.length + 1;
  const groupOf = (v: number) => { let g = 0; while (g < cuts.length && v > cuts[g]) g++; return g; };
  const reported = validate ? fit.validation : poolScored;
  const scoreOf = (i: number) => (validate ? fit.external[i] : fit.heldOut[i])!;
  const label = riskGroupNames(groupsMade);
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
    scale: { min: sorted[0], max: sorted[sorted.length - 1] },
    percentiles: Array.from({ length: 101 }, (_, k) => sorted[Math.min(sorted.length - 1, Math.floor(k / 100 * sorted.length))]),
    neverHeldOut: fit.pool.length - poolScored.length, distinct, groupsMade, members };
}

// ---- Table 1 ----------------------------------------------------------------------------------

/**
 * Table 1, the groups' clinical and genomic makeup (counted and tested by lib/views/riskmodel/table1.ts).
 * Reads the fit's own rows again with Table 1's attributes added and keeps them as the fit did, and
 * refuses unless they are the fit's patients in the fit's order — every survival time, entry and
 * event the same — so each group's members are exactly the patients its curve drew.
 */
export async function riskTable1(r: RiskResolver, args: RiskFitArgs, fit: RiskFit, g: RiskGrouping, describe: NonNullable<RiskmodelView["describe"]>) {
  const s = riskFitSpec(args.view, args.compile.oncokbPin), mark = r.queries.length;
  const logged = () => r.queries.slice(mark).map((q) => ({ label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) }));
  const metaRows = await r.viewMeta("riskmodel:table1-attributes", (st, d) => tableAttributesSql(st, d));
  const meta = new Map(metaRows.map((m) => [String(m.id), { id: String(m.id), numeric: String(m.datatype).toUpperCase() === "NUMBER", patient: Number(m.patient) === 1 }] as const));
  const attrs = describe.attributes ? [...new Set(describe.attributes)]
    : table1DefaultCandidates(metaRows.map((m) => String(m.id)), { covariates: s.covariates, strata: s.strata });
  const fetched = attrs.filter((a) => meta.has(a));
  const [rows, panelRows] = await riskViewRows(r, args, { describe: fetched });
  const { kept, at } = keepRiskRows(rows, s);
  const same = kept.length === fit.n && kept.every((k, i) => k.t === fit.subjects.time[i] && k.entry === fit.subjects.entry[i] && (k.ev ? 1 : 0) === fit.subjects.event[i]);
  if (!same) throw new RiskRefusal("Table 1 could not be matched to the model's patients: the cohort's rows changed after the model was fitted (" + kept.length + " patients now, " + fit.n + " then); run the view again", logged());
  const col = new Map(fetched.map((a, k) => [a, k] as const));
  const cell = (x: Record<string, unknown>, p: string, a: string) => col.has(a) ? x[p + col.get(a)] : undefined;
  const patients: Table1Patient[] = kept.map((k, i) => {
    const x = rows[at[i]];
    return { panels: k.panels, genes: k.genes, d: attrs.map((a) => String(cell(x, "d", a) ?? "")), r: attrs.map((a) => String(cell(x, "r", a) ?? "")), u: attrs.map((a) => Number(cell(x, "u", a) ?? 0)) };
  });
  const months = s.columns?.months ?? s.endpoint + "_MONTHS", status = s.columns?.status ?? s.endpoint + "_STATUS";
  const { table, histograms } = buildTable1({
    study: args.study, reportedOn: fit.validated ? "validation half" : "held-out scores", measure: s.measure,
    groups: g.groups.map((x, gi) => ({ name: x.name, members: g.members[gi] })), patients,
    attributes: attrs.map((name) => ({ name, meta: meta.get(name) ?? null })), attributesDefault: !describe.attributes,
    genes: describe.genes ? [...new Set(describe.genes)] : fit.features.slice(0, RISK_FIGURE_GENES).map((f) => f.gene), genesDefault: !describe.genes,
    panelGenes: new Map(panelRows.map((x) => [String(x.panel), new Set((x.genes as unknown as string[]) || [])] as const)),
    model: { genes: fit.features.map((f) => f.gene), covariates: s.covariates, strata: s.strata, outcome: [months, status] },
  });
  return { table, histograms, queries: logged() };
}

// ---- the view ---------------------------------------------------------------------------------

/** 0.8 → "80th", 0.333 → "33.3rd" */
function ordinalPct(q: number): string {
  const v = Math.round(q * 1000) / 10, n = Math.floor(v);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return v + suffix;
}

/**
 * The view's model settings as the fit reads them — defaults applied, names normalised. The fit
 * computes it from its own arguments; runRiskmodel computes it to validate them first.
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
  const cutsChosen = view.cuts == null ? null : view.cuts;
  if (cutsChosen) {
    if (view.groups != null) return refuse("riskmodel", ctx, "give groups (equal quantiles) or cuts (the quantiles to cut at), not both");
    if (!Array.isArray(cutsChosen) || cutsChosen.length < 1 || cutsChosen.length > 4 || !cutsChosen.every((c, k) => typeof c === "number" && c > 0 && c < 1 && (k === 0 || c > cutsChosen[k - 1])))
      return refuse("riskmodel", ctx, "cuts are 1 to 4 quantiles of the score, increasing, each strictly between 0 and 1 (e.g. [0.8] for the top fifth against the rest)");
  }
  const asked = cutsChosen ? cutsChosen.length + 1 : nGroups;
  if (!(Number.isInteger(minMutated) && minMutated >= 5)) return refuse("riskmodel", ctx, "minMutated is a whole number of patients, at least 5");
  if (!Number.isInteger(seed)) return refuse("riskmodel", ctx, "seed is a whole number");
  const labelAbove = num(view.labelAbove, RISK_LABEL_ABOVE);
  if (!(labelAbove >= 0 && labelAbove <= 1)) return refuse("riskmodel", ctx, "labelAbove is a share of runs, 0 to 1");
  for (const a of [strata, ...covNames]) if (a && !/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) return refuse("riskmodel", ctx, "“" + a.slice(0, 40) + "” is not a clinical attribute's name");
  { const e = overLimit("a risk model", RISK_MAX_COVARIATES, covNames.length); if (e) return refuse("riskmodel", ctx, e.replace("at most " + RISK_MAX_COVARIATES, "at most " + RISK_MAX_COVARIATES + " covariates")); }
  if (new Set(covNames).size !== covNames.length || (strata && covNames.includes(strata))) return refuse("riskmodel", ctx, "a covariate is listed twice, or is also the stratum");
  if (view.anchor && !view.anchor.eventType) return refuse("riskmodel", ctx, "anchor needs eventType, the timeline event each patient's clock starts at");
  const describe = view.describe;
  if (describe != null) {
    const isList = (x: unknown) => x == null || (Array.isArray(x) && x.every((v) => typeof v === "string"));
    if (typeof describe !== "object" || Array.isArray(describe) || !isList(describe.attributes) || !isList(describe.genes))
      return refuse("riskmodel", ctx, "describe is { attributes?: [names], genes?: [symbols] }, each list optional (left out, Table 1 uses its default)");
    for (const a of describe.attributes || []) if (!/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) return refuse("riskmodel", ctx, "“" + a.slice(0, 40) + "” is not a clinical attribute's name");
    for (const x of describe.genes || []) if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(x)) return refuse("riskmodel", ctx, "“" + x.slice(0, 40) + "” is not a gene symbol");
    const e = overLimit("Table 1", TABLE1_MAX_ATTRIBUTES, (describe.attributes || []).length) || overLimit("Table 1", TABLE1_MAX_GENES, (describe.genes || []).length);
    if (e) return refuse("riskmodel", ctx, e.replace("at most " + TABLE1_MAX_ATTRIBUTES, "at most " + TABLE1_MAX_ATTRIBUTES + ((describe.attributes || []).length > TABLE1_MAX_ATTRIBUTES ? " attributes" : " genes")));
  }
  const validateOn = view.validateOn == null ? null : String(view.validateOn);
  let vStudy: string | null = null;
  if (validateOn != null) {
    if (!Object.hasOwn(cohorts, validateOn)) return refuse("riskmodel", ctx, "validateOn names a cohort of this document; “" + validateOn.slice(0, 60) + "” is not one (it has " + Object.keys(cohorts).map((c) => "“" + c + "”").join(", ") + ")");
    if (validateOn === name) return refuse("riskmodel", ctx, "validateOn must name a different cohort from the one the model is fitted on");
    if (cohorts[validateOn].studies.length !== 1) return refuse("riskmodel", ctx, "a validation cohort is scored within one study; “" + validateOn + "” spans " + cohorts[validateOn].studies.length);
    vStudy = cohorts[validateOn].studies[0];
    const rv = ctx.resolvers[vStudy];
    if (!rv || !isPatientLevel(rv) || !hasViewAggregates(rv)) return refuse("riskmodel", ctx, vStudy + " answers in aggregate only; scoring “" + validateOn + "” needs each patient's rows, which only a patient-level participant returns");
    if (covNames.length) return refuse("riskmodel", ctx, "validateOn scores the genes alone; a model with covariates cannot be carried to another cohort yet — drop the covariates or validateOn");
  }
  if (cohorts[name].count * runs > RISK_WORK_LIMIT)
    return refuse("riskmodel", ctx, "a risk model fits at most " + RISK_WORK_LIMIT.toLocaleString("en-US") + " patients × runs in one request; “" + name + "” has " +
      cohorts[name].count.toLocaleString("en-US") + " patients, so at most " + Math.max(1, Math.floor(RISK_WORK_LIMIT / Math.max(1, cohorts[name].count))) + " runs (or narrow the cohort)");

  const { profiles, gaProfiles } = await ctx.studyProfiles(study);
  const args: RiskFitArgs = { study, def: doc.cohorts[name], compile: { oncokbPin: ctx.pin, profiles, gaProfiles }, view: riskModelView(view) };
  let fit: RiskFit;
  try { fit = await (ctx.riskFit ?? riskFitDirect)({ ...args, patients: cohorts[name].count }); }
  catch (e) {
    if (!(e instanceof RiskRefusal)) throw e;
    const out = refuse("riskmodel", ctx, (e.aboutCohort ? "“" + name + "” " : "") + e.message);
    return e.queries.length ? { ...out, queries: e.queries.map((q) => ({ study, ...q })) } : out;
  }
  const g = groupRiskmodel(fit, groupQuantiles(cutsChosen ? { cuts: cutsChosen } : { groups: nGroups }));
  let t1: Awaited<ReturnType<typeof riskTable1>> | null = null;
  if (describe) {
    try { t1 = await riskTable1(r, args, fit, g, describe); }
    catch (e) {
      if (!(e instanceof RiskRefusal)) throw e;
      return { ...refuse("riskmodel", ctx, e.message), queries: [...fit.queries, ...e.queries].map((q) => ({ study, ...q })) };
    }
  }

  let ext: Awaited<ReturnType<typeof riskExternal>> | null = null;
  if (validateOn != null && vStudy) {
    const rv = ctx.resolvers[vStudy] as typeof r;
    const vp = await ctx.studyProfiles(vStudy);
    try { ext = await riskExternal(rv, { ...args, study: vStudy, def: doc.cohorts[validateOn], compile: { oncokbPin: ctx.pin, profiles: vp.profiles, gaProfiles: vp.gaProfiles } }, validateOn, fit, g, seed); }
    catch (e) {
      if (!(e instanceof RiskRefusal)) throw e;
      return { ...refuse("riskmodel", ctx, e.message), queries: [...fit.queries.map((q) => ({ study, ...q })), ...e.queries.map((q) => ({ study: vStudy!, ...q }))] };
    }
    ext.external.cohortPatients = cohorts[validateOn].count;
  }

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
    features: fit.features, groups: g.groups, logrank: g.logrank, refit: g.refit, histogram: g.histogram, scale: g.scale, percentiles: g.percentiles, labelAbove, cutsChosen,
    ...(t1 ? { table1: t1.table } : {}),
    ...(ext ? { external: ext.external } : {}),
  };
  return {
    kind: "riskmodel", cohorts: vNames, riskmodel: result, queries: [...[...fit.queries, ...(t1 ? t1.queries : [])].map((q) => ({ study, ...q })), ...(ext ? ext.queries.map((q) => ({ study: vStudy!, ...q })) : [])],
    method: riskmodelMethod({ study, cohort: name, cohortPatients: cohorts[name].count, rowsReturned: fit.rowsReturned, r: result,
      lambdas: RISK_LAMBDAS, folds: RISK_FOLDS, testShare: RISK_TEST_SHARE, table1Histograms: t1 ? t1.histograms : [] }),
    participation: ctx.participationFor([study], true),
    caveat: "Association, not cause: a gene's weight is its link to " + endpoint + " with the other candidates" + (fit.covariates.length ? " and the covariates" : "") +
      " held fixed, in this cohort" + (strata ? ", within each " + strata : "") + ". " +
      (strata ? "" : "Without strata, a gene that marks a cancer type carries that type's prognosis; on a cohort of several cancer types, stratify by CANCER_TYPE. ") +
      (validate ? "The model was trained on the discovery half of the engine's fixed split only; the curves, table and refit are the validation half's, cut at the discovery half's quantiles. "
        : "Each patient is scored only by models that did not train on them. ") +
      (cutsChosen ? "The cuts were chosen in the view, at the " + cutsChosen.map(ordinalPct).join(", ") + " percentile" + (cutsChosen.length > 1 ? "s" : "") + " of the score" +
          (validate ? ". " : "; if they were placed while looking at these curves, the log-rank p and the hazard ratios overstate the separation — confirm a cut found that way on the validation half (validate). ")
        : "The group cuts are equal quantiles of the score, chosen without the outcome. ") +
      (anchor ? "The clock starts at " + result.anchoredTo + "; a patient enters the risk set only from the study's day 0 (delayed entry), so the time before their sequencing is not counted as survival. " : "") +
      "Genes outside the panels every patient was sequenced on are not candidates, so a patient is never counted as wild-type for a gene they were not tested for. " +
      (g.groupsMade < asked ? "Asked for " + asked + " groups, made " + g.groupsMade + ": the scores take only " + g.distinct + " distinct values, and patients with the same score stay in the same group. " : "") +
      (g.distinct < 20 && g.groupsMade === asked ? "The scores take only " + g.distinct + " distinct values, so the groups can be unequal in size: patients with the same score stay together. " : "") +
      (t1 ? "Table 1 describes the patients the curves draw; its rows marked “in the model” (the model's genes and covariates) and “outcome” differ between the groups by construction, so they get no q-value and are left out of the correction. " : "") +
      "The C-index ignores delayed entry. Seeded (seed " + seed + "): the same document gives the same model." +
      (ext ? " External validation on “" + validateOn + "” (" + vStudy + "): each patient scored with the ensemble's mean coefficients (every gene's coefficient averaged over all " + runs +
        " runs, zero where a run dropped it) and cut at the training thresholds; " + ext.external.notCovered + " patients on panels missing one of the model's " + ext.external.modelGenes +
        " weighted genes are left out rather than scored as wild-type. Harrell's C-index (within strata) with a seeded bootstrap interval (" + ext.external.bootstrap + " resamples). " +
        (vStudy === study ? "Both cohorts are in " + study + ": a patient in both is not removed from the validation, so overlap flatters it. " :
          "The two studies' baselines, panels and vocabularies are not harmonized, and a patient enrolled in both under different identifiers cannot be removed. ") : ""),
  };
}
