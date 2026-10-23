// Forest view: one exposure's hazard ratio within each stratum (cancer type, study or cohort), each
// from its own Cox fit on per-patient rows inside each local study, pooled by a DerSimonian–Laird
// random-effects meta-analysis. Covariates are coded by ./covariates.ts, as the cox view codes them.
import { coxRegression, dersimonianLaird, COX_MAX_ITERATIONS, type CoxRow } from "../stats.ts";
import type { ViewResult, ForestView, ForestRow, ForestResult, ForestPooled, CoxCovariate, PlotAxis } from "../types.ts";
import { isPatientLevel, type EndpointColumns } from "../federation.ts";
import { validateAxis, axisLabel, isAbsent, OQL_NOT_PROFILED, MULTIPLE, type AxisKind } from "../plot.ts";
import { resolveProfileAxis } from "../plot-profile.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, refuse, studyCatalogs, plural, ATTR_NAME } from "./shared.ts";
import { buildCoxColumns, notProfiledNote } from "./covariates.ts";

export const FOREST_MIN_PATIENTS = 30, FOREST_MIN_EVENTS = 10, FOREST_MAX_STRATA = 30, FOREST_MAX_COVARIATES = 4;
/** a stratum's fit is reported only when its log-HR's standard error is below this (larger: separation) */
const FOREST_MAX_SE = 5;
export const FOREST_OTHER = "Other";

/** one patient as the fit reads them: time, event, exposed or not, stratum, covariate values */
export interface ForestPatient { t: number; event: number; exposed: 0 | 1; stratum: string; values: (number | string)[] }
export interface ForestOpts { minPatients: number; minEvents: number; maxStrata: number; small: "pool" | "drop" }

/** the pooled estimate on the hazard-ratio scale */
const toHr = (e: { beta: number; se: number; ciLow: number; ciHigh: number; p: number }): ForestPooled =>
  ({ beta: e.beta, se: e.se, hr: Math.exp(e.beta), ciLow: Math.exp(e.ciLow), ciHigh: Math.exp(e.ciHigh), p: e.p });

/**
 * The forest's rows from its patients: strata by size, the small ones (and any past `maxStrata`)
 * pooled into "Other" (each keeping its own baseline hazard there) or left out; one Cox fit per
 * row, exposure first; rows that cannot be estimated listed with the reason; then the fixed- and
 * random-effects pools. Pure, so it is testable without a database.
 */
export function forestFit(patients: ForestPatient[], covariates: CoxCovariate[], kinds: AxisKind[], o: ForestOpts):
  Pick<ForestResult, "rows" | "left" | "fixed" | "random" | "tau2" | "q" | "qDf" | "qP" | "i2"> {
  const by = new Map<string, ForestPatient[]>();
  for (const r of patients) { const g = by.get(r.stratum); if (g) g.push(r); else by.set(r.stratum, [r]); }
  const events = (rs: ForestPatient[]) => rs.reduce((n, r) => n + r.event, 0);
  const groups = [...by].map(([label, rs]) => ({ label, rs, events: events(rs) }))
    .sort((a, b) => b.rs.length - a.rs.length || a.label.localeCompare(b.label));
  const big = (g: { rs: ForestPatient[]; events: number }) => g.rs.length >= o.minPatients && g.events >= o.minEvents;
  const kept = groups.filter((g, i) => big(g) && i < o.maxStrata), keptSet = new Set(kept);
  const small = groups.filter((g) => !keptSet.has(g));
  const left: ForestResult["left"] = [];
  const reasonSmall = (g: { rs: ForestPatient[]; events: number }) => big(g) ? "past the " + o.maxStrata + " largest strata"
    : "fewer than " + o.minPatients + " patients or " + o.minEvents + " events";
  const candidates: { label: string; rs: ForestPatient[]; pooled?: string[] }[] = kept.map((g) => ({ label: g.label, rs: g.rs }));
  if (small.length && o.small === "pool") {
    const rs = small.flatMap((g) => g.rs);
    const other = { label: FOREST_OTHER + " (" + small.length + " strata)", rs, pooled: small.map((g) => g.label) };
    if (big({ rs, events: events(rs) })) candidates.push(other);
    else left.push({ label: other.label, n: rs.length, events: events(rs), reason: "pooled, the small strata still have fewer than " + o.minPatients + " patients or " + o.minEvents + " events" });
  } else for (const g of small) left.push({ label: g.label, n: g.rs.length, events: g.events, reason: reasonSmall(g) });

  const rows: ForestRow[] = [];
  for (const c of candidates) {
    const n = c.rs.length, ev = events(c.rs);
    const exp = c.rs.filter((r) => r.exposed), expEv = events(exp);
    const unexpEv = ev - expEv;
    if (!exp.length || exp.length === n || !expEv || !unexpEv) {
      left.push({ label: c.label, n, events: ev, reason: !exp.length ? "no exposed patient" : exp.length === n ? "no unexposed patient" : "no event among the " + (!expEv ? "exposed" : "unexposed") });
      continue;
    }
    // covariates coded within the row; a numeric one that does not vary there has nothing to adjust
    const cols = buildCoxColumns(covariates, kinds, c.rs).filter((col) => kinds[col.axisIndex] !== "num" ||
      new Set(c.rs.map((r) => Number(r.values[col.axisIndex]))).size > 1);
    const input: CoxRow[] = c.rs.map((r) => ({ t: r.t, event: r.event,
      x: [r.exposed, ...cols.map((col) => kinds[col.axisIndex] === "num" ? Number(r.values[col.axisIndex]) : String(r.values[col.axisIndex]) === col.level ? 1 : 0)],
      ...(c.pooled ? { stratum: r.stratum } : {}) }));
    let fit;
    try { fit = coxRegression(input); }
    catch { fit = null; }
    if (!fit || fit.iterations >= COX_MAX_ITERATIONS || !(fit.se[0] > 0 && fit.se[0] < FOREST_MAX_SE) || !Number.isFinite(fit.beta[0])) {
      left.push({ label: c.label, n, events: ev, reason: "the Cox fit did not converge (separation: the exposure, or a covariate, nearly decides the events here)" });
      continue;
    }
    rows.push({ label: c.label, n, events: ev, exposed: exp.length, exposedEvents: expEv,
      beta: fit.beta[0], se: fit.se[0], hr: fit.hr[0], ciLow: fit.ciLow[0], ciHigh: fit.ciHigh[0], p: fit.p[0], weight: 0,
      ...(c.pooled ? { pooled: c.pooled } : {}) });
  }
  if (rows.length < 2) return { rows, left, fixed: null, random: null, tau2: 0, q: 0, qDf: 0, qP: 1, i2: 0 };
  const m = dersimonianLaird(rows);
  m.weights.forEach((w, i) => { rows[i].weight = w; });
  return { rows, left, fixed: toHr(m.fixed), random: toHr(m.random), tau2: m.tau2, q: m.q, qDf: m.df, qP: m.qP, i2: m.i2 };
}

/** an exposure value to 0/1, or null when it cannot be coded */
function exposureCoder(kind: AxisKind, threshold: number | undefined, exposed: string | undefined): (v: number | string) => 0 | 1 | null {
  if (kind === "num") return (v) => Number.isFinite(Number(v)) ? (Number(v) >= threshold! ? 1 : 0) : null;
  if (exposed != null) return (v) => String(v) === exposed ? 1 : 0;
  return (v) => String(v) === OQL_NOT_PROFILED ? null : isAbsent(String(v)) ? 0 : 1;
}

/** "TP53 mutated", "ERBB2 amplified or deleted", "KRAS or NRAS mutated" */
function alterationName(a: { gene?: string; genes?: string[]; by?: string }): string {
  const genes = (a.genes?.length ? a.genes : [a.gene || ""]).map((g) => String(g).toUpperCase()).join(" or ");
  return genes + (a.by === "cna" ? " amplified or deeply deleted" : a.by === "sv" ? " with a structural variant" : " mutated");
}

export async function runForest(view: ForestView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, resolvers, vNames, vStudies } = ctx;
  const no = (e: string) => refuse("forest", ctx, e);
  const endpoint = String(view.endpoint || "OS").toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) return no("bad survival endpoint '" + endpoint.slice(0, 40) + "'");
  let endpointColumns: EndpointColumns | undefined;
  if (view.monthsAttribute != null || view.statusAttribute != null) {
    const m = String(view.monthsAttribute || "").trim(), s = String(view.statusAttribute || "").trim();
    if (!ATTR_NAME.test(m) || !ATTR_NAME.test(s)) return no("monthsAttribute and statusAttribute must both be given as attribute names (a study attribute, or an uploaded column as custom:<dataset>/<COLUMN>)");
    endpointColumns = { months: m, status: s };
  }
  const endpointLabel = endpointColumns ? endpointColumns.months + "/" + endpointColumns.status : endpoint;
  if (!view.exposure) return no("a forest view needs an exposure: a gene's alteration ({source:\"alteration\", gene}), or an attribute with a threshold or a level");
  const covIn = Array.isArray(view.covariates) ? view.covariates : [];
  { const e = overLimit("a forest view", FOREST_MAX_COVARIATES, covIn.length); if (e) return no(e.replace("at most " + FOREST_MAX_COVARIATES, "at most " + FOREST_MAX_COVARIATES + " covariates")); }
  const strata = String(view.strata ?? "CANCER_TYPE").trim();
  const byStudy = strata.toLowerCase() === "study", byCohort = strata.toLowerCase() === "cohort";
  if (!byStudy && !byCohort && !ATTR_NAME.test(strata)) return no("strata is a categorical attribute, \"study\" or \"cohort\"; got " + JSON.stringify(view.strata).slice(0, 40));
  if (byStudy && vStudies.length < 2) return no("strata \"study\" needs cohorts spanning two or more studies; these span " + vStudies.join(", "));
  if (byCohort && vNames.length < 2) return no("strata \"cohort\" needs two or more cohorts; this view draws " + vNames.length);
  const num = (x: unknown, d: number, lo: number, hi: number, what: string): number => {
    const n = x == null ? d : Math.floor(Number(x));
    if (!(n >= lo && n <= hi)) throw new Error(what + " is " + lo + " to " + hi);
    return n;
  };
  let o: ForestOpts;
  try {
    o = { minPatients: num(view.minPatients, FOREST_MIN_PATIENTS, 5, 100000, "minPatients"), minEvents: num(view.minEvents, FOREST_MIN_EVENTS, 1, 100000, "minEvents"),
      maxStrata: num(view.maxStrata, FOREST_MAX_STRATA, 2, 60, "maxStrata"), small: view.small === "drop" ? "drop" : "pool" };
  } catch (e) { return no((e as Error).message); }
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length === vNames.length) return no("nothing to fit: " + (vNames.length === 1 ? "the cohort is" : "every cohort is") + " empty");

  let exposure: PlotAxis, covariates: CoxCovariate[];
  try {
    const catalogs = await studyCatalogs(ctx, vStudies);
    exposure = resolveProfileAxis(view.exposure, "exposure", catalogs);
    validateAxis(exposure, "exposure");
    covariates = covIn.map((cv, i) => ({ ...resolveProfileAxis(cv, "covariate " + (i + 1), catalogs), ...(cv.reference != null ? { reference: cv.reference } : {}) }));
    covariates.forEach((cv, i) => validateAxis(cv, "covariate " + (i + 1)));
  } catch (e) { return no((e as Error).message); }
  if (exposure.source === "none") return no("the exposure axis is \"none\"; name a gene's alteration or an attribute");
  const stratumAxis: PlotAxis[] = byStudy || byCohort ? [] : [{ source: "clinical", attribute: strata }];
  const axes: PlotAxis[] = [exposure, ...stratumAxis, ...covariates];
  const covAt = 1 + stratumAxis.length;

  // per-patient rows from every patient-level participant; the stratum is the attribute, the study or the cohort
  const excludedRemote: { study: string; patients: number }[] = [];
  const raw: { t: number; event: number; values: (number | string)[]; stratum: string }[] = [];
  let kinds: AxisKind[] | null = null, notProfiled = 0, patientLevelTotal = 0;
  const parts = byCohort ? vNames.map((n) => [n]) : [vNames];
  for (const names of parts) for (const n of names) for (const st of cohorts[n].studies) {
    const res = resolvers[st], count = cohorts[n].perStudy[st]?.count || 0;
    if (!isPatientLevel(res)) { excludedRemote.push({ study: st, patients: count }); continue; }
    patientLevelTotal += count;
    const r = await res.coxRows(doc.cohorts[n], endpoint, axes, endpointColumns);
    if (!kinds) kinds = r.kinds;
    notProfiled += r.notProfiled;
    for (const x of r.rows) raw.push({ t: x.t, event: x.event, values: x.values,
      stratum: byCohort ? n : byStudy ? st : String(x.values[1]) });
  }
  if (!raw.length) return no(excludedRemote.length && !patientLevelTotal
    ? "no patient-level participant could answer: " + excludedRemote.map((e) => e.study).join(", ") + " answer" + (excludedRemote.length === 1 ? "s" : "") + " with counts only, and a Cox fit needs patient rows"
    : "no patient had a " + endpointLabel + " time, the exposure" + (stratumAxis.length ? ", a " + strata : "") + (covariates.length ? " and every covariate" : "") + " on record");
  const k = kinds!;
  if (stratumAxis.length && k[1] === "num") return no(strata + " is numeric; strata is a categorical attribute, \"study\" or \"cohort\"");
  const threshold = view.threshold == null ? undefined : Number(view.threshold);
  if (k[0] === "num" && !Number.isFinite(threshold)) return no(axisLabel(exposure) + " is numeric: give a threshold, and patients at or above it are the exposed");
  if (k[0] !== "num" && threshold != null) return no(axisLabel(exposure) + " is categorical: name the exposed level with exposed, not a threshold");
  const levels = [...new Set(raw.map((r) => String(r.values[0])))].sort();
  const exposedLevel = view.exposed == null ? undefined : String(view.exposed);
  if (k[0] !== "num" && exposure.source !== "alteration" && exposedLevel == null)
    return no(axisLabel(exposure) + " is categorical: name the level counted as exposed with exposed — it takes " + levels.slice(0, 20).join(", ") + (levels.length > 20 ? ", …" : ""));
  if (exposedLevel != null && !levels.includes(exposedLevel)) return no("exposed level '" + exposedLevel.slice(0, 40) + "' is not a value of " + axisLabel(exposure) + " here; it takes " + levels.slice(0, 20).join(", "));
  const code = exposureCoder(k[0], threshold, exposedLevel);
  const patients: ForestPatient[] = [];
  let uncoded = 0;
  for (const r of raw) {
    const e = code(r.values[0]);
    if (e == null || !Number.isFinite(r.t) || r.t < 0) { uncoded++; continue; }
    patients.push({ t: r.t, event: r.event, exposed: e, stratum: r.stratum, values: r.values.slice(covAt) });
  }
  // a patient whose samples carry different values of the stratum attribute belongs to no one stratum
  const multiple = stratumAxis.length ? patients.filter((r) => r.stratum === MULTIPLE).length : 0;
  if (multiple) patients.splice(0, patients.length, ...patients.filter((r) => r.stratum !== MULTIPLE));
  const covKinds = k.slice(covAt);
  const fit = forestFit(patients, covariates, covKinds, o);
  if (!fit.rows.length) return no("no stratum could be estimated: " + fit.left.slice(0, 8).map((l) => l.label + " (" + l.reason + ")").join("; "));

  const exposedLabel = k[0] === "num" ? axisLabel(exposure) + " ≥ " + threshold : exposedLevel != null ? axisLabel(exposure) + " = " + exposedLevel
    : exposure.source === "alteration" && "oql" in exposure ? exposure.oql + " (altered)"
    : exposure.source === "alteration" ? alterationName(exposure) : axisLabel(exposure) + " altered";
  const n = patients.length, events = patients.reduce((a, r) => a + r.event, 0);
  const missing = Math.max(0, patientLevelTotal - raw.length - notProfiled);
  const stratWord = byStudy ? "study" : byCohort ? "cohort" : strata;
  const covNames = covariates.map((c) => axisLabel(c));
  const result: ForestResult = { exposure: axisLabel(exposure), exposedLabel, endpoint: endpointLabel, strata: stratWord, covariates: covNames,
    ...fit, n, events, notProfiled, missing, ...(excludedRemote.length ? { excludedRemote } : {}) };
  const pct = (x: number) => (100 * x).toFixed(0) + "%";
  const pooledRow = fit.rows.find((r) => r.pooled);
  return {
    kind: "forest", cohorts: vNames, forest: result,
    participation: ctx.participationFor(vStudies, true),
    ...(vStudies.length > 1 ? { studies: vStudies } : {}),
    caveat: "Hazard ratio of " + endpointLabel + " for " + exposedLabel + " (exposed) against the rest, fit by Cox regression (Efron ties) within each " + stratWord +
      (covNames.length ? ", adjusted there for " + covNames.join(", ") + " (coded as the cox view codes covariates, within each row)" : ", univariate") + ". " +
      plural(n, "patient") + " and " + plural(events, "event") + " had a time, the exposure" + (stratumAxis.length ? " and a " + strata : "") + (covNames.length ? " and every covariate" : "") + "; " +
      fit.rows.length + " " + (fit.rows.length === 1 ? "row was" : "rows were") + " estimated. " +
      (exposure.source === "alteration" ? "Panel-aware: a patient not profiled for the gene is left out, never counted as unaltered." + notProfiledNote(notProfiled) + " " : "") +
      (missing ? plural(missing, "patient") + " lacked the endpoint, the stratum or a covariate and were left out. " : "") +
      (multiple ? plural(multiple, "patient") + " whose samples carry different values of " + strata + " were left out: they belong to no one stratum. " : "") +
      (uncoded ? plural(uncoded, "patient") + " had an exposure value that could not be coded and were left out. " : "") +
      (pooledRow ? "“" + pooledRow.label + "” pools " + (pooledRow.pooled!.length <= 12 ? pooledRow.pooled!.join(", ") : pooledRow.pooled!.length + " strata") + " (each under " + o.minPatients + " patients or " + o.minEvents + " events, or past the " + o.maxStrata + " largest), fit with a baseline hazard of its own per stratum. " : "") +
      (fit.left.length ? "Not estimated: " + fit.left.slice(0, 12).map((l) => l.label + " (" + l.reason + ")").join("; ") + (fit.left.length > 12 ? "; and " + (fit.left.length - 12) + " more" : "") + ". " : "") +
      (fit.random
        ? "Pooled by inverse variance: fixed effect, and DerSimonian–Laird random effects (τ² " + fit.tau2.toFixed(3) + ", I² " + pct(fit.i2) + ", Cochran's Q " + fit.q.toFixed(1) + " on " + fit.qDf + " df, p " + (fit.qP < 1e-4 ? fit.qP.toExponential(1) : fit.qP.toFixed(3)) + "). " +
          "A high I² says the strata disagree beyond chance: the pooled estimate is then an average over different effects, not one effect. "
        : "Only one row could be estimated, so nothing is pooled. ") +
      (byCohort ? "Cohorts may share patients; a patient in two cohorts counts in both rows, which the pooling treats as independent. " : "") +
      (vStudies.length > 1 ? "Clinical vocabularies are not harmonized across studies. " : "") +
      "Association, not cause: the exposure travels with stage, treatment and other prognostic factors not adjusted for. Proportional hazards within each row is assumed, not checked." +
      (excludedRemote.length ? " Left out: " + excludedRemote.map((e) => e.study + " (" + e.patients + " patients, aggregate-only)").join(", ") + "." : "")
  };
}
