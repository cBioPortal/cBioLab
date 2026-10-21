// How the model views (cox, logistic) turn their covariates into fit columns, and what their
// captions say about the patients a covariate could not place.
import type { CoxCovariate } from "../types.ts";
import { axisLabel, OQL_UNALTERED, type AxisKind } from "../plot.ts";

export interface CoxColumn { axisIndex: number; label: string; reference?: string; level?: string }
/**
 * Dummy-codes Cox covariates into fit columns: a numeric covariate (clinical number, or a
 * molecular value) is a single column as-is. A categorical one becomes one column per
 * non-reference level, where the reference is the covariate's declared `reference` (see
 * CoxCovariate) if it names an observed level, else the most-frequent one — same rule either
 * way, just which level goes first. A pure function, so it
 * is testable without a database.
 */
export function buildCoxColumns(covariates: CoxCovariate[], kindsFinal: AxisKind[], rows: { values: (number | string)[] }[]): CoxColumn[] {
  const columns: CoxColumn[] = [];
  covariates.forEach((cov, ci) => {
    if (kindsFinal[ci] === "num") {
      columns.push({ axisIndex: ci, label: axisLabel(cov) });
    } else {
      const counts = new Map<string, number>();
      for (const r of rows) { const v = String(r.values[ci]); counts.set(v, (counts.get(v) || 0) + 1); }
      const byFreq = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || (a < b ? -1 : 1));
      // A declared reference (must be an observed level, or it's ignored rather than
      // silently matching nothing) goes first; everything else keeps its frequency order.
      // An alteration mutated-vs-not covariate defaults to "Not mutated" as the reference
      // regardless of which side is more frequent: without this, a gene altered in a minority
      // of patients reports "wild-type vs mutated" while one altered in a majority reports the
      // opposite, purely from how common each gene's alteration happens to be, not from any
      // real change in convention — the exact TP53-vs-APC inconsistency this fixes.
      // an OQL axis is the same yes/no question, so "Unaltered" is its reference for the same reason
      const absentLevel = cov.source !== "alteration" ? undefined
        : "oql" in cov ? OQL_UNALTERED : (cov.by === "mutated" || cov.by === undefined) ? "Not mutated" : undefined;
      const implicitDefault = absentLevel && counts.has(absentLevel) ? absentLevel : undefined;
      const declared = cov.reference && counts.has(cov.reference) ? cov.reference : implicitDefault;
      const levels = declared ? [declared, ...byFreq.filter((l) => l !== declared)] : byFreq;
      const reference = levels[0];
      for (const level of levels.slice(1)) columns.push({ axisIndex: ci, label: axisLabel(cov) + ": " + level, reference, level });
    }
  });
  return columns;
}

/** what a model's caption says about the patients it left out as not profiled for a covariate's gene */
export function notProfiledNote(n: number): string {
  return n > 0 ? " " + n.toLocaleString("en-US") + " patient" + (n === 1 ? " was" : "s were") + " not profiled for the gene of a covariate and " +
    (n === 1 ? "was" : "were") + " left out: an unknown alteration status is not wild type, and not a level to fit." : "";
}
