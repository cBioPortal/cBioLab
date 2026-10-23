// Compare view: per-gene alteration frequencies in each cohort, summed across participants
// (each answers with counts from its own database), with Fisher/chi-square tests and BH correction.
import { geneSymbols } from "../../gene-tracks.ts";
import { buildAnnotationIndex } from "../../annotation.ts";
import { fisherExact, benjaminiHochberg, chiSquareTest } from "../../stats.ts";
import type { ViewResult } from "../../types.ts";
import { isPatientLevel, type GeneCounts } from "../../federation.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { overLimit } from "../shared.ts";
import type { CompareRow, CompareCell, CompareView } from "./types.ts";
import { compareMethod } from "./method.ts";

/** the three alteration types a compare-view gene's "any alteration" figure combines */
export const ALTERATION_TYPES = ["mutation", "cna", "structuralVariant"] as const;
export type AlterationType = typeof ALTERATION_TYPES[number];

/**
 * Which alteration types were actually assayed anywhere in a compare view's rows, and which
 * contributed zero profiled patients everywhere despite at least one OTHER type being assayed —
 * the signal that a whole type (e.g. copy-number) was never checked in this study, not "checked,
 * found none". A gene's own byType.cna.profiled being 0 could just mean this one gene isn't on
 * the CNA panel; it is only a study-wide gap when EVERY gene in the view agrees. A pure
 * function, so it is testable without a database.
 */
export function missingAlterationTypes(rows: { cells: { byType: Record<AlterationType, { profiled: number; altered: number }> }[] }[]):
  { assayed: AlterationType[]; missing: AlterationType[] } {
  const total: Record<AlterationType, number> = { mutation: 0, cna: 0, structuralVariant: 0 };
  for (const r of rows) for (const c of r.cells) for (const t of ALTERATION_TYPES) total[t] += c.byType[t].profiled;
  return {
    assayed: ALTERATION_TYPES.filter((t) => total[t] > 0),
    missing: ALTERATION_TYPES.filter((t) => total[t] === 0)
  };
}

export async function runCompare(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, vStudies, participationFor, pin } = c;
  const genes = geneSymbols((view as CompareView).genes);
  if (!genes.length) return untimed({ kind: "compare", error: "compare view needs genes" });
  { const e = overLimit("a compare view", 20, genes.length); if (e) return untimed({ kind: "compare", error: e.replace("at most 20", "at most 20 genes") }); }
  // Every participant answers with per-gene counts computed in its own
  // database; the analysis layer only sums. Identical arithmetic whether the
  // instance is patient-level or aggregate-only — which is what makes mixed
  // federation possible at all.
  const zeroByType = () => ({ mutation: { profiled: 0, altered: 0 }, cna: { profiled: 0, altered: 0 }, structuralVariant: { profiled: 0, altered: 0 } });
  const zeroCounts = (gene: string): GeneCounts => ({ gene, profiled: 0, altered: 0, driver: 0, byType: zeroByType() });
  const tally = new Map<string, GeneCounts>(); // "cohort|gene" -> summed counts
  const perSite: { cohort: string; study: string; counts: GeneCounts[] }[] = [];
  await Promise.all(vNames.flatMap((n) =>
    cohorts[n].studies.map(async (st) => {
      const counts = await resolvers[st].geneCounts(doc.cohorts[n], genes);
      perSite.push({ cohort: n, study: st, counts });
      for (const c of counts) {
        const k = n + "|" + c.gene;
        const cur = tally.get(k) || zeroCounts(c.gene);
        cur.profiled += c.profiled; cur.altered += c.altered; cur.driver += c.driver;
        // an older MCP peer may not send byType yet — treat it as absent, not a crash
        for (const t of ALTERATION_TYPES) {
          cur.byType[t].profiled += c.byType?.[t]?.profiled ?? 0;
          cur.byType[t].altered += c.byType?.[t]?.altered ?? 0;
        }
        tally.set(k, cur);
      }
    })));
  // arrival order is whichever study answered first; fix it so the method record is stable
  perSite.sort((x, y) => vNames.indexOf(x.cohort) - vNames.indexOf(y.cohort) || (x.study < y.study ? -1 : 1));
  const aggOnly = vStudies.filter((st) => !isPatientLevel(resolvers[st]));
  const annSource = (await buildAnnotationIndex([], genes, vStudies.length === 1 ? vStudies[0] : vStudies)).source;
  const rows: CompareRow[] = genes.map((g) => {
    const cells: CompareCell[] = vNames.map((n) => {
      const t = tally.get(n + "|" + g) || zeroCounts(g);
      const profiled = t.profiled, any = t.altered, driver = t.driver;
      return { cohort: n, profiled, any, driver,
        anyPct: profiled ? Math.round(1000 * any / profiled) / 10 : null,
        driverPct: profiled ? Math.round(1000 * driver / profiled) / 10 : null,
        byType: t.byType };
    });
    const row: CompareRow = { gene: g, cells };
    if (vNames.length === 2) {
      const [x, y] = cells;
      row.pAny = fisherExact(x.any, x.profiled - x.any, y.any, y.profiled - y.any);
      row.pDriver = fisherExact(x.driver, x.profiled - x.driver, y.driver, y.profiled - y.driver);
    } else if (vNames.length > 2) {
      // Fisher exact is 2x2-only; an N>2-cohort comparison is a 2xN contingency
      // table (altered vs not, one column per cohort), so it gets a chi-squared
      // instead. minExpected — the classic "each cell should expect >=5" rule of
      // thumb — is disclosed via the note below rather than silently trusted.
      row.pAny = chiSquareTest(cells.map((c) => [c.any, c.profiled - c.any])).p;
      row.pDriver = chiSquareTest(cells.map((c) => [c.driver, c.profiled - c.driver])).p;
    }
    return row;
  });
  if (vNames.length >= 2) {
    rows.sort((a, b) => (a.pAny ?? 1) - (b.pAny ?? 1));
    // Two separate hypothesis families (any-alteration, driver-only) each get their
    // own Benjamini–Hochberg pass across the genes tested here — mixing the two
    // into one correction would understate significance for whichever family has
    // fewer real signals.
    const testedAny = rows.filter((r) => r.pAny != null);
    benjaminiHochberg(testedAny.map((r) => r.pAny!)).forEach((q, i) => { testedAny[i].qAny = q; });
    const testedDriver = rows.filter((r) => r.pDriver != null);
    benjaminiHochberg(testedDriver.map((r) => r.pDriver!)).forEach((q, i) => { testedDriver[i].qDriver = q; });
  }
  const noteParts: string[] = [];
  {
    // Disclosed once per view rather than per cell, since a whole missing alteration type is
    // a property of the participating studies' data, not of any one gene.
    const { assayed, missing } = missingAlterationTypes(rows);
    if (assayed.length && missing.length) {
      const label = { mutation: "mutation", cna: "copy-number", structuralVariant: "structural-variant" };
      noteParts.push("no " + missing.map((t) => label[t]).join("/") + " data exists for " +
        (vStudies.length === 1 ? vStudies[0] : "the participating studies") +
        " — altered% reflects only " + assayed.map((t) => label[t]).join("/") + " status, not a real negative for the missing type(s)");
    }
  }
  if (vNames.length > 2) {
    noteParts.push(vNames.length + " cohorts compared per gene with a Pearson chi-squared (2×" + vNames.length +
      " table: altered vs not, one column per cohort) — a two-cohort compare uses an exact Fisher test instead." +
      " q-values are Benjamini–Hochberg across the " + genes.length + " genes tested here, separately for any-alteration and driver-only");
  }
  if (vStudies.length > 1) {
    // "A stratified test would be more principled" only means something when a single
    // COHORT mixes patients from several studies — that is the situation a differing case
    // mix WITHIN one arm can confound. When every cohort is confined to its own one study
    // (a cross-study compare where each arm IS a study, e.g. UTUC vs a bladder TCGA study),
    // there is no within-arm mixing to stratify away: study already IS the grouping variable,
    // and the pooled test already only compares whole, homogeneous studies against each other.
    const eachCohortOneStudy = vNames.every((n) => cohorts[n].studies.length === 1);
    noteParts.push("cross-study comparison" + (vStudies.length <= 2 ? " (" + vStudies.join(", ") + ")" : " across " + vStudies.length + " studies") +
      ": denominators are per-study panel-aware; patient overlap across studies is NOT deduplicated" +
      (eachCohortOneStudy
        ? "; each cohort is confined to a single study, so there is no within-cohort study mixing for a stratified test to correct — this compares whole studies against each other, not a pooled-vs-stratified question"
        : "; counts are POOLED across studies, so the p-value is unstratified — site composition differences can invert a pooled association (Simpson's paradox), and a stratified test (Cochran–Mantel–Haenszel) would be the principled statistic") +
      (aggOnly.length ? "; " + aggOnly.join(", ") + " contributed aggregate counts only (no patient-level access)" : ""));
  }
  return { kind: "compare", cohorts: vNames, annotation: annSource, rows,
    method: compareMethod({
      oncokbPin: pin, cohorts: vNames, genes,
      perSite: perSite.map((p) => ({ cohort: p.cohort, study: p.study, cohortPatients: cohorts[p.cohort].perStudy[p.study]?.count || 0 })),
      counts: perSite.flatMap((p) => p.counts.map((c) => ({ cohort: p.cohort, study: p.study, gene: c.gene, profiled: c.profiled, altered: c.altered, driver: c.driver }))),
      results: rows.map((r) => ({ gene: r.gene, pAny: r.pAny, pDriver: r.pDriver, qAny: r.qAny, qDriver: r.qDriver })),
    }),
    participation: participationFor(vStudies, false),
    ...(vStudies.length > 1 ? { studies: vStudies } : {}),
    ...(noteParts.length ? { note: noteParts.join(". ") } : {}) };
}
