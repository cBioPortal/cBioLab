// Predictive biomarker view: for each gene, a Cox model of survival on the gene, a treatment
// exposure and their interaction — does the gene's prognosis differ between the treated and the
// untreated? Fitted from per-patient rows inside each local patient-level study; a patient not
// profiled for a gene is left out of that gene's fit, never counted as wild-type.
import type { ViewResult, CoxCovariate } from "../../types.ts";
import { hasViewAggregates, isPatientLevel } from "../../federation.ts";
import { riskmodelRowsSql, riskmodelPanelGenesSql } from "../../federation-views.ts";
import { coxRegression, benjaminiHochberg, type CoxRow, type CoxFit } from "../../stats.ts";
import type { AxisKind } from "../../plot.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, refuse, plural, ATTR_NAME } from "../shared.ts";
import { buildCoxColumns } from "../covariates.ts";
import type { PredictiveView, PredictiveGene, PredictiveEffect } from "./types.ts";

const PRED_MAX_GENES = 20, PRED_MAX_COVARIATES = 6;

interface PredRow { t: number; ev: number; exposed: boolean; genes: Set<string>; panels: string[]; cov: string[]; stratum: string; study: string }

/** effect k of a fit, as a hazard ratio with its interval and p */
const effect = (f: CoxFit, k: number): PredictiveEffect => ({ hr: f.hr[k], ciLow: f.ciLow[k], ciHigh: f.ciHigh[k], p: f.p[k] });

/**
 * One gene's fits over the rows profiled for it. The model is gene + exposed + gene×exposed (+
 * covariates); it is fitted twice, coded two ways — the interaction as gene×exposed, then as
 * gene×unexposed — so the gene's own coefficient is first its effect among the unexposed, then
 * among the exposed. The two codings are the same model (same likelihood), so both contrasts and
 * the interaction come from one fit's estimates and standard errors.
 */
export function fitPredictiveGene(rows: { t: number; ev: number; exposed: boolean; mutated: boolean; x: number[]; stratum?: string }[]) {
  const coded = (inter: (r: typeof rows[number]) => number): CoxRow[] => rows.map((r) => ({ t: r.t, event: r.ev,
    x: [r.mutated ? 1 : 0, r.exposed ? 1 : 0, (r.mutated ? 1 : 0) * inter(r), ...r.x], ...(r.stratum ? { stratum: r.stratum } : {}) }));
  const u = coxRegression(coded((r) => r.exposed ? 1 : 0));
  const e = coxRegression(coded((r) => r.exposed ? 0 : 1));
  return { inUnexposed: effect(u, 0), inExposed: effect(e, 0), interaction: effect(u, 2), n: u.n, events: u.events, converged: u.iterations > 0 && e.iterations > 0 };
}

export async function runPredictive(view: PredictiveView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length < 1 || vNames.length > 2) return refuse("predictive", ctx, "a predictive-biomarker view reads one or two cohorts' patients, pooled; this names " + vNames.length);
  const ex0 = view.exposure;
  if (!ex0 || typeof ex0 !== "object" || !String(ex0.eventType || "").trim())
    return refuse("predictive", ctx, "a predictive-biomarker view needs exposure: {eventType, key?, value?} — e.g. {eventType: \"Treatment\", key: \"SUBTYPE\", value: \"Immuno\"}");
  if (!!ex0.key !== (ex0.value != null && ex0.value !== "")) return refuse("predictive", ctx, "exposure's key and value go together");
  const exposure = { eventType: String(ex0.eventType).trim().slice(0, 120), ...(ex0.key ? { key: String(ex0.key).slice(0, 120), value: String(ex0.value).slice(0, 200) } : {}), occurrence: "FIRST" as const };
  const exposureLabel = exposure.eventType + (exposure.key ? " [" + exposure.key + "=" + exposure.value + "]" : "");
  const genes = [...new Set((Array.isArray(view.genes) ? view.genes : []).map((g) => String(g).trim().toUpperCase()).filter(Boolean))];
  if (!genes.length) return refuse("predictive", ctx, "a predictive-biomarker view needs genes, the candidate biomarkers (at most " + PRED_MAX_GENES + ")");
  { const e = overLimit("a predictive-biomarker view", PRED_MAX_GENES, genes.length); if (e) return refuse("predictive", ctx, e.replace("at most " + PRED_MAX_GENES, "at most " + PRED_MAX_GENES + " genes")); }
  for (const g of genes) if (!/^[A-Z0-9][A-Z0-9_.-]{0,39}$/.test(g)) return refuse("predictive", ctx, "“" + g.slice(0, 40) + "” is not a gene symbol");
  const endpoint = String(view.endpoint || "OS").toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint)) return refuse("predictive", ctx, "endpoint is a name like OS or PFS");
  if (!!view.monthsAttribute !== !!view.statusAttribute) return refuse("predictive", ctx, "monthsAttribute and statusAttribute go together");
  for (const a of [view.monthsAttribute, view.statusAttribute]) if (a != null && !ATTR_NAME.test(String(a))) return refuse("predictive", ctx, "“" + String(a).slice(0, 40) + "” is not an attribute name");
  const columns = view.monthsAttribute ? { months: String(view.monthsAttribute), status: String(view.statusAttribute) } : undefined;
  const endpointLabel = columns ? columns.months + "/" + columns.status : endpoint;
  const measure = view.measure === "driver" ? "driver" as const : "any" as const;
  if (measure === "driver" && !ctx.pin) return refuse("predictive", ctx, "measure \"driver\" needs the OncoKB annotation, which this server has no pinned version of");
  const covNames = (view.covariates || []).map(String);
  { const e = overLimit("a predictive-biomarker view", PRED_MAX_COVARIATES, covNames.length); if (e) return refuse("predictive", ctx, e.replace("at most " + PRED_MAX_COVARIATES, "at most " + PRED_MAX_COVARIATES + " covariates")); }
  for (const a of covNames) if (!/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) return refuse("predictive", ctx, "“" + a.slice(0, 40) + "” is not a clinical attribute's name");
  if (new Set(covNames).size !== covNames.length) return refuse("predictive", ctx, "a covariate is listed twice");
  const minMutated = view.minMutated == null ? 5 : Number(view.minMutated);
  if (!(Number.isInteger(minMutated) && minMutated >= 1 && minMutated <= 1000)) return refuse("predictive", ctx, "minMutated is a whole number of patients, 1 to 1000");

  // per-patient rows from each patient-level study; any other participant is refused by view coverage
  const rows: PredRow[] = [];
  const queries: NonNullable<ViewResult["queries"]> = [];
  let notProfiled = 0, noCovariate = 0;
  const panelGenes = new Map<string, Map<string, Set<string>>>();
  for (const n of vNames) {
    for (const st of cohorts[n].studies) {
      const r = ctx.resolvers[st];
      if (!isPatientLevel(r) || !hasViewAggregates(r)) return refuse("predictive", ctx, st + " answers in aggregate only; a per-gene Cox model needs each patient's rows, which only a patient-level participant returns");
      const mark = r.queries.length;
      const [got, panels] = await Promise.all([
        r.viewRows("predictive:rows", doc.cohorts[n], (c, s, d) => riskmodelRowsSql(c, s, d, { endpoint, columns, covariates: covNames, driverPin: measure === "driver" ? ctx.pin : null, anchor: exposure })),
        panelGenes.has(st) ? Promise.resolve(null) : r.viewMeta("predictive:panels", (s, d) => riskmodelPanelGenesSql(s, d)),
      ]);
      for (const q of r.queries.slice(mark)) queries.push({ study: st, label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) });
      if (panels) panelGenes.set(st, new Map(panels.map((x) => [String(x.panel), new Set(((x.genes as unknown as string[]) || []).map(String))] as const)));
      for (const x of got) {
        const pan = ((x.panels as unknown as string[]) || []).map(String);
        if (!pan.length) { notProfiled++; continue; }
        const cov = covNames.map((_, k) => String(x["c" + k] ?? ""));
        if (cov.some((v) => !v)) { noCovariate++; continue; }
        rows.push({ t: Number(x.m), ev: Number(x.ev) === 1 ? 1 : 0, exposed: Number(x.anchored) === 1, genes: new Set(((x.genes as unknown as string[]) || []).map(String)),
          panels: pan, cov, stratum: (vNames.length > 1 ? n : "") + "|" + st, study: st });
      }
    }
  }
  const exposedN = rows.filter((r) => r.exposed).length;
  if (rows.length < 20) return refuse("predictive", ctx, "only " + rows.length + " patients have a " + endpointLabel + " time, a mutation panel and every covariate; the model needs at least 20");
  if (!exposedN || exposedN === rows.length)
    return refuse("predictive", ctx, (exposedN ? "every" : "no") + " patient of " + plural(rows.length, "patient") + " with a survival time has a " + exposureLabel + " event, so there is no " + (exposedN ? "unexposed" : "exposed") + " group to compare");

  // covariates coded as the cox view codes them
  const covAxes: CoxCovariate[] = covNames.map((a) => ({ source: "clinical", attribute: a }));
  const kinds: AxisKind[] = covNames.map((_, k) => rows.every((r) => Number.isFinite(Number(r.cov[k]))) ? "num" : "cat");
  const values = rows.map((r) => ({ values: r.cov.map((v, k) => kinds[k] === "num" ? Number(v) : v) }));
  const covCols = buildCoxColumns(covAxes, kinds, values);
  const xOf = (i: number) => covCols.map((c) => kinds[c.axisIndex] === "num" ? Number(values[i].values[c.axisIndex]) : (String(values[i].values[c.axisIndex]) === c.level ? 1 : 0));
  const stratified = new Set(rows.map((r) => r.stratum)).size > 1;
  const covered = (r: PredRow, g: string) => r.panels.some((p) => p === "WES" || panelGenes.get(r.study)?.get(p)?.has(g));

  const out: PredictiveGene[] = genes.map((gene) => {
    const idx = rows.map((r, i) => covered(r, gene) ? i : -1).filter((i) => i >= 0);
    const sub = idx.map((i) => ({ t: rows[i].t, ev: rows[i].ev, exposed: rows[i].exposed, mutated: rows[i].genes.has(gene), x: xOf(i), ...(stratified ? { stratum: rows[i].stratum } : {}) }));
    const base = { gene, exposed: sub.filter((r) => r.exposed).length, unexposed: sub.filter((r) => !r.exposed).length,
      mutatedExposed: sub.filter((r) => r.exposed && r.mutated).length, mutatedUnexposed: sub.filter((r) => !r.exposed && r.mutated).length,
      events: sub.filter((r) => r.ev).length, inExposed: null, inUnexposed: null, interaction: null, q: null };
    if (!sub.length) return { ...base, skipped: "no patient's panel covers it" };
    if (base.mutatedExposed < minMutated || base.mutatedUnexposed < minMutated)
      return { ...base, skipped: "mutated in " + base.mutatedExposed + " exposed and " + base.mutatedUnexposed + " unexposed patients; fitted only with at least " + minMutated + " in each" };
    if (base.mutatedExposed === base.exposed || base.mutatedUnexposed === base.unexposed) return { ...base, skipped: "every profiled patient of a group is mutated, so there is no wild-type to compare against" };
    try {
      const f = fitPredictiveGene(sub);
      if (![f.inExposed, f.inUnexposed, f.interaction].every((e) => Number.isFinite(e.hr) && Number.isFinite(e.ciHigh) && e.ciHigh < 1e6))
        return { ...base, skipped: "the fit did not converge (an estimate ran to infinity: the gene's patients may all have the same outcome)" };
      return { ...base, inExposed: f.inExposed, inUnexposed: f.inUnexposed, interaction: f.interaction };
    } catch (e) { return { ...base, skipped: "the fit failed: " + (e as Error).message }; }
  });
  const fitted = out.filter((g) => g.interaction);
  const qs = benjaminiHochberg(fitted.map((g) => g.interaction!.p));
  fitted.forEach((g, i) => { g.q = qs[i]; });
  const multi = ctx.vStudies.length > 1;
  const best = [...fitted].sort((a, b) => a.interaction!.p - b.interaction!.p)[0];
  return {
    kind: "predictive", cohorts: vNames, queries,
    predictive: { exposure: exposureLabel, endpoint: endpointLabel, measure, n: rows.length, exposed: exposedN, events: rows.filter((r) => r.ev).length,
      notProfiled, noCovariate, covariates: covCols.map((c) => c.label), minMutated, strata: new Set(rows.map((r) => r.stratum)).size, genes: out },
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "For each gene, a Cox model of " + endpointLabel + " (Efron ties) on the gene (" + (measure === "driver" ? "an OncoKB driver mutation" : "any mutation") + "), exposure to " + exposureLabel +
      " (any such timeline event) and their product" + (covCols.length ? ", adjusted for " + covNames.join(", ") + " (numbers as they are, categories against their commonest level)" : "") +
      (stratified ? ", the baseline hazard stratified by " + (vNames.length > 1 ? "cohort" + (multi ? " and study" : "") : "study") : "") + ". " +
      "The gene's hazard ratio among the exposed and among the unexposed are the same model's two contrasts (the interaction coded both ways), so they share its estimates; the interaction HR is their ratio, and its p asks whether the gene predicts " +
      "benefit rather than merely prognosis. q is Benjamini–Hochberg over the " + fitted.length + " genes fitted. " +
      "Each gene is fitted over the patients whose panel covers it: a patient not profiled for a gene is left out of that gene's fit, never counted as wild-type. " +
      "BIASES: exposure is defined from the whole record, after the clock's start — a patient must survive long enough to be treated, so the exposed group is credited with time before their treatment (immortal-time bias), " +
      "and treatment was not randomised but chosen for patients by their condition (confounding by indication). Both distort the exposure's own effect; the interaction is less exposed to them but not immune, " +
      "and an interaction found here is a hypothesis for a randomised or emulated-trial design, not evidence of benefit. " +
      "Left out: " + notProfiled + " patients with no mutation panel on record" + (covNames.length ? ", " + noCovariate + " missing a covariate" : "") + ". " +
      (best ? "Strongest interaction: " + best.gene + " (p " + best.interaction!.p.toPrecision(2) + ", q " + best.q!.toPrecision(2) + "). " : "No gene had enough mutated patients in both groups to fit. ") +
      "Computed from per-patient rows inside each patient-level study.",
  };
}
