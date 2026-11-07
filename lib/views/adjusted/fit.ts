// The adjusted view's fits: pure, so they run off the request thread (lib/compute-pool.ts) and are
// testable without a database.
import { logisticRegression, fisherExact, benjaminiHochberg, LOGISTIC_MAX_ITERATIONS, type LogisticRow } from "../../stats.ts";
import type { CoxCovariate } from "../../types.ts";
import type { AxisKind } from "../../plot.ts";
import { buildCoxColumns } from "../covariates.ts";
import type { AdjustedGene } from "./types.ts";

/** a gene's cohort term is reported only when its log-OR's standard error is below this (larger: separation) */
const ADJUSTED_MAX_SE = 5;

/** one patient as the fits read them: which cohort (1 = the first), the genes their panels cover (null: every gene), mutated genes, covariates */
export interface AdjustedPatient { group: 0 | 1; covers: Set<string> | null; genes: Set<string>; values: (number | string)[] }

/** numbers when every value parses as one, else categories */
export function covariateKinds(patients: { values: (number | string)[] }[], n: number): AxisKind[] {
  return Array.from({ length: n }, (_, k) => patients.every((r) => r.values[k] !== "" && Number.isFinite(Number(r.values[k]))) ? "num" : "cat");
}

/**
 * Per gene: the patients profiled for it, the raw 2×2 (Fisher), and the logistic fit of altered on
 * the cohort indicator and the covariates (coded within the gene's patients); genes whose fit does
 * not converge or separates are returned in `failed`, never dropped. q is BH over the genes fit.
 */
export function adjustedFit(patients: AdjustedPatient[], genes: string[], covariates: string[], kinds: AxisKind[]):
  { rows: AdjustedGene[]; failed: { gene: string; reason: string }[] } {
  const axes: CoxCovariate[] = covariates.map((a) => ({ source: "clinical", attribute: a }));
  const rows: AdjustedGene[] = [], failed: { gene: string; reason: string }[] = [];
  for (const gene of genes) {
    const pts = patients.filter((r) => !r.covers || r.covers.has(gene));
    const altered: [number, number] = [0, 0], profiled: [number, number] = [0, 0];
    for (const r of pts) { const i = r.group ? 0 : 1; profiled[i]++; if (r.genes.has(gene)) altered[i]++; }
    const [a, c] = altered, b = profiled[0] - a, d = profiled[1] - c;
    if (!profiled[0] || !profiled[1]) { failed.push({ gene, reason: "not profiled in one of the cohorts" }); continue; }
    const rawOr = b * c > 0 && a * d > 0 ? (a * d) / (b * c) : null;
    const fisherP = fisherExact(a, b, c, d);
    // a numeric covariate that does not vary has nothing to adjust; a category in which no patient (or
    // every patient) is mutated separates, so for this gene it joins the reference level
    let merged = false;
    const cols = buildCoxColumns(axes, kinds, pts).filter((col) => {
      if (kinds[col.axisIndex] === "num") return new Set(pts.map((r) => Number(r.values[col.axisIndex]))).size > 1;
      const at = pts.filter((r) => String(r.values[col.axisIndex]) === col.level), hit = at.filter((r) => r.genes.has(gene)).length;
      const keep = hit > 0 && hit < at.length;
      if (!keep) merged = true;
      return keep;
    });
    const input: LogisticRow[] = pts.map((r) => ({ y: r.genes.has(gene) ? 1 : 0,
      x: [r.group, ...cols.map((col) => kinds[col.axisIndex] === "num" ? Number(r.values[col.axisIndex]) : String(r.values[col.axisIndex]) === col.level ? 1 : 0)] }));
    let fit;
    try { fit = logisticRegression(input); }
    catch { fit = null; }
    if (!fit || fit.iterations >= LOGISTIC_MAX_ITERATIONS || !(fit.se[0] > 0 && fit.se[0] < ADJUSTED_MAX_SE) || !Number.isFinite(fit.beta[0])) {
      failed.push({ gene, reason: rawOr == null ? "an empty cell in the 2×2" : "the fit did not converge: a covariate nearly decides the alteration" });
      continue;
    }
    rows.push({ gene, altered, profiled, rawOr, fisherP, or: fit.or[0], ciLow: fit.ciLow[0], ciHigh: fit.ciHigh[0], p: fit.p[0], q: 1, ...(merged ? { merged } : {}) });
  }
  benjaminiHochberg(rows.map((g) => g.p)).forEach((q, i) => { rows[i].q = q; });
  rows.sort((x, y) => x.p - y.p || x.gene.localeCompare(y.gene));
  return { rows, failed };
}
