// External validation of a fitted risk model (RiskmodelView.validateOn): another cohort's patients
// scored with the ensemble's mean coefficients, cut at the training thresholds, and judged by
// Harrell's C-index, Kaplan–Meier curves by risk group, the log-rank test and each group's HR.
import type { RiskExternal } from "../types.ts";
import { concordance, type CoxSubject } from "../coxnet.ts";
import { kaplanMeier, logRankK, coxRegression, seededRandom } from "../stats.ts";
import { keepRiskRows, riskFitSpec, riskViewRows, RiskRefusal, type RiskFit, type RiskFitArgs, type RiskGrouping, type RiskResolver } from "./riskmodel.ts";

/** bootstrap resamples for the C-index interval */
export const RISK_EXTERNAL_BOOTSTRAP = 200;
const RISK_EXTERNAL_MIN = 30;

/**
 * Score the validation cohort's patients (`args` names its study and definition; the model's
 * settings are the fit's own) and report on them. Each patient's score is the ensemble's mean
 * linear predictor — every gene's coefficient averaged over all runs, zero where a run dropped it
 * (its share of runs kept × its mean where kept) — the same average the fit's own `validate` half
 * is scored with. A patient whose panels do not cover every gene the model weighs is left out and
 * counted, never scored as wild-type for a gene they were not tested for. Throws RiskRefusal when
 * too few patients remain.
 */
export async function riskExternal(r: RiskResolver, args: RiskFitArgs, cohort: string, fit: RiskFit, g: RiskGrouping, seed: number): Promise<{ external: RiskExternal; queries: RiskFit["queries"] }> {
  const s = riskFitSpec(args.view, args.compile.oncokbPin), mark = r.queries.length;
  const logged = () => r.queries.slice(mark).map((q) => ({ label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) }));
  const [rows, panelRows] = await riskViewRows(r, args);
  const panelGenes = new Map(panelRows.map((x) => [String(x.panel), new Set(((x.genes as unknown as string[]) || []).map(String))] as const));
  const { kept, left } = keepRiskRows(rows, s);
  const coef = new Map(fit.features.map((f) => [f.gene, f.selected * f.meanCoef] as const).filter(([, b]) => b !== 0));
  const model = [...coef.keys()];
  let notCovered = 0;
  const scored = kept.filter((k) => {
    const ok = k.panels.includes("WES") || model.every((gene) => k.panels.some((p) => panelGenes.get(p)?.has(gene)));
    if (!ok) notCovered++;
    return ok;
  });
  if (scored.length < RISK_EXTERNAL_MIN)
    throw new RiskRefusal("“" + cohort + "” has " + scored.length + " patients a validation can score (" + kept.length + " with a survival time, a panel" +
      (s.strata ? " and a stratum" : "") + "; " + notCovered + " of them on panels missing a gene the model weighs); validation needs at least " + RISK_EXTERNAL_MIN, logged());
  const strata = [...new Set(scored.map((k) => k.stratum))].sort();
  const sIndex = new Map(strata.map((v, i) => [v, i] as const));
  const subj: CoxSubject[] = scored.map((k) => ({ time: k.t, event: k.ev, entry: k.entry, stratum: sIndex.get(k.stratum)! }));
  const score = Float64Array.from(scored, (k) => k.genes.reduce((a, gene) => a + (coef.get(gene) ?? 0), 0));
  const all = Int32Array.from(scored, (_, i) => i);
  const cIndex = concordance(subj, all, score);
  const rand = seededRandom(seed), boots: number[] = [];
  for (let b = 0; b < RISK_EXTERNAL_BOOTSTRAP; b++) {
    const rowsB = Int32Array.from(all, () => Math.floor(rand() * all.length));
    const c = concordance(subj, rowsB, Float64Array.from(rowsB, (i) => score[i]));
    if (Number.isFinite(c)) boots.push(c);
  }
  boots.sort((x, y) => x - y);
  const q = (f: number) => boots.length ? boots[Math.min(boots.length - 1, Math.max(0, Math.round(f * (boots.length - 1))))] : NaN;
  const cuts = g.groups.slice(1).map((x) => x.from!).filter((c) => c != null);
  const groupOf = (v: number) => { let k = 0; while (k < cuts.length && v > cuts[k]) k++; return k; };
  const members: number[][] = g.groups.map(() => []);
  const gOf = Int32Array.from(score, (v) => groupOf(v));
  gOf.forEach((k, i) => members[k].push(i));
  const rec = (i: number) => ({ t: subj[i].time, event: subj[i].event ? 1 : 0, ...(fit.anchored ? { entry: subj[i].entry } : {}) });
  let hrs: { hr: number; ciLow: number; ciHigh: number; p: number }[] | null = null;
  const live = members.map((m, k) => k > 0 && m.length > 0);
  if (members[0].length && live.some(Boolean)) {
    try {
      const cols = members.map((_, k) => k).filter((k) => live[k]);
      const f = coxRegression(scored.map((_, i) => ({ t: subj[i].time, event: subj[i].event ? 1 : 0, x: cols.map((k) => gOf[i] === k ? 1 : 0), stratum: String(subj[i].stratum) })));
      hrs = members.map(() => null as unknown as { hr: number; ciLow: number; ciHigh: number; p: number });
      cols.forEach((k, j) => { hrs![k] = { hr: f.hr[j], ciLow: f.ciLow[j], ciHigh: f.ciHigh[j], p: f.p[j] }; });
    } catch { hrs = null; }
  }
  let logrank;
  try { logrank = logRankK(strata.map((_, st) => ({ groups: members.map((m) => m.filter((i) => subj[i].stratum === st).map(rec)) }))); } catch { logrank = null; }
  const external: RiskExternal = {
    cohort, study: args.study, n: scored.length, events: scored.filter((k) => k.ev).length, cohortPatients: 0, rowsReturned: rows.length,
    notProfiled: left.notProfiled, noStratum: left.noStratum, noAnchor: left.noAnchor, anchorAfterStart: left.anchorAfterStart, noFollowUp: left.noFollowUp,
    notCovered, modelGenes: model.length, cIndex, cIndexLo: q(0.025), cIndexHi: q(0.975), bootstrap: RISK_EXTERNAL_BOOTSTRAP, cuts,
    groups: g.groups.map((x, k) => ({ name: x.name, curve: kaplanMeier(members[k].map(rec)),
      hr: hrs?.[k]?.hr ?? null, ciLow: hrs?.[k]?.ciLow ?? null, ciHigh: hrs?.[k]?.ciHigh ?? null, p: hrs?.[k]?.p ?? null })),
    logrank,
  };
  return { external, queries: logged() };
}
