// The predictive view's per-gene fit: pure, so it runs off the request thread (lib/compute-pool.ts)
// and is testable without a database.
import { coxRegression, type CoxRow, type CoxFit } from "../../stats.ts";
import type { PredictiveEffect } from "./types.ts";

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
