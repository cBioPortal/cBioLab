// Clinical view: compares clinical attributes' distributions across cohorts, from each
// participant's value counts and moments.
import { benjaminiHochberg, chiSquareTest, welchT, welchAnovaTest, varianceFromMoments, mannWhitneyU, kruskalWallis, quantilesFromHistogram } from "../../stats.ts";
import type { ViewResult } from "../../types.ts";
import type { AttrStats } from "../../federation.ts";
import { ATTR_NAME_RE } from "../../custom-data.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { overLimit } from "../shared.ts";
import type { ClinicalView, ClinicalRow } from "./types.ts";
import { clinicalMethod } from "./method.ts";

export async function runClinical(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, vStudies, participationFor } = c;
  const attrs = ((view as ClinicalView).attributes || [])
    .map((a) => String(a).trim()).filter((a) => ATTR_NAME_RE.test(a));
  if (!attrs.length) return untimed({ kind: "clinical", error: "clinical view needs attributes" });
  { const e = overLimit("a clinical view", 20, attrs.length); if (e) return untimed({ kind: "clinical", error: e.replace("at most 20", "at most 20 attributes") }); }
  if (vNames.length < 2) return untimed({ kind: "clinical", error: "clinical comparison needs at least 2 cohorts" });
  // cohort -> study -> that site's description of each attribute
  // A median or a rank sum is not additive the way (n, sum, sumsq) is — there is no honest
  // way to combine two sites' histograms into one — so the complete per-value histogram is
  // only ever requested when the whole view is confined to a single study, where "this
  // cohort's histogram" and "the view's histogram" are the same thing.
  const singleStudy = vStudies.length === 1;
  const stats = new Map<string, AttrStats[]>();  // "cohort|study"
  await Promise.all(vNames.flatMap((n) =>
    cohorts[n].studies.map(async (st) => {
      stats.set(n + "|" + st, await resolvers[st].attributeStats(doc.cohorts[n], attrs, { histograms: singleStudy }));
    })));
  const rows: ClinicalRow[] = [];
  for (const attribute of attrs) {
    const pick = (n: string, st: string) => (stats.get(n + "|" + st) || []).find((x) => x.attribute === attribute);
    const all = vNames.flatMap((n) => cohorts[n].studies.map((st) => pick(n, st))).filter((x): x is AttrStats => !!x);
    if (!all.length) { rows.push({ attribute, per: "patient", kind: "cat", cells: [], skipped: "no participating study reports this attribute" }); continue; }
    const refused = all.find((x) => x.skipped);
    if (refused) { rows.push({ attribute, per: refused.per, kind: refused.kind, cells: [], skipped: refused.skipped }); continue; }
    // Sites disagreeing on the TYPE of an attribute is a real possibility and
    // is refused, not resolved by majority — silently dropping the dissenting
    // study's patients would understate the cohort with no way to notice.
    const kinds = [...new Set(all.map((x) => x.kind))];
    if (kinds.length > 1) {
      rows.push({ attribute, per: all[0].per, kind: all[0].kind, cells: [],
        skipped: "the participating studies disagree on its type (" + kinds.join(" vs ") + "); comparing them would mean discarding one side's patients" });
      continue;
    }
    const kind = kinds[0], per = all[0].per;
    if (kind === "cat") {
      const cells = vNames.map((n) => {
        const merged = new Map<string, number>();
        for (const st of cohorts[n].studies)
          for (const v of pick(n, st)?.values || []) merged.set(v.v, (merged.get(v.v) || 0) + v.n);
        const values = [...merged].map(([v, c]) => ({ v, n: c })).sort((x, y) => y.n - x.n);
        return { cohort: n, n: values.reduce((s, x) => s + x.n, 0), top: values.slice(0, 5), values };
      });
      const vocab = [...new Set(cells.flatMap((c) => c.values.map((v) => v.v)))];
      const table = cells.map((c) => vocab.map((v) => c.values.find((x) => x.v === v)?.n || 0));
      const t = chiSquareTest(table);
      rows.push({ attribute, per, kind, test: "chi-squared",
        cells: cells.map(({ cohort, n, top }) => ({ cohort, n, top })),
        distinct: vocab.length, p: t.p, df: t.df, statistic: t.chi2, minExpected: t.minExpected, q: 1 });
    } else {
      const cells = vNames.map((n) => {
        let n0 = 0, sum = 0, sumsq = 0, mn = Infinity, mx = -Infinity;
        let valueCounts: { v: number; n: number }[] | null = null;
        let histogramTruncated = false;
        for (const st of cohorts[n].studies) {
          const s = pick(n, st); if (!s || !s.n) continue;
          n0 += s.n!; sum += s.sum!; sumsq += s.sumsq!;
          mn = Math.min(mn, s.min!); mx = Math.max(mx, s.max!);
          if (singleStudy && s.valueCounts) valueCounts = s.valueCounts;
          if (singleStudy && s.histogramTruncated) histogramTruncated = true;
        }
        const variance = varianceFromMoments(n0, sum, sumsq);
        const [median, q1, q3] = valueCounts ? quantilesFromHistogram(valueCounts, [0.5, 0.25, 0.75]) : [null, null, null];
        // the mean shown is rounded; the tests below use the exact one
        return { cohort: n, n: n0, mean: n0 ? Math.round((sum / n0) * 1e3) / 1e3 : null, exactMean: n0 ? sum / n0 : 0,
          sd: Math.round(Math.sqrt(variance) * 1e3) / 1e3,
          min: Number.isFinite(mn) ? mn : null, max: Number.isFinite(mx) ? mx : null, variance,
          median, q1, q3, histogramTruncated, valueCounts };
      });
      const row: ClinicalRow = { attribute, per, kind, q: 1,
        cells: cells.map(({ variance, valueCounts, exactMean, ...c }) => c) };
      if (vNames.length === 2) {
        const [x, y] = cells;
        const w = welchT(x.n, x.exactMean, x.variance, y.n, y.exactMean, y.variance);
        row.test = "Welch t"; row.statistic = w.t; row.df = w.df; row.p = w.p;
        if (x.valueCounts && y.valueCounts) {
          const rk = mannWhitneyU(x.valueCounts, y.valueCounts);
          row.rankStatistic = rk.u; row.rankP = rk.p;
        }
      } else {
        // Welch's ANOVA needs nothing beyond the same (n, mean, variance) moments Welch's t
        // already uses, so — unlike the median/rank tests below — it works at any study
        // count, the same reason chi-squared and the survival view's k-group log-rank do.
        const a = welchAnovaTest(cells.map((c) => ({ n: c.n, mean: c.exactMean, variance: c.variance })));
        row.test = "Welch ANOVA"; row.statistic = a.f; row.df = a.df1; row.df2 = a.df2; row.p = a.p;
        if (singleStudy && cells.every((c) => c.valueCounts)) {
          const kw = kruskalWallis(cells.map((c) => c.valueCounts!));
          row.rankStatistic = kw.h; row.rankP = kw.p;
        }
      }
      rows.push(row);
    }
  }
  const tested = rows.filter((r) => r.p != null);
  benjaminiHochberg(tested.map((r) => r.p!)).forEach((q, i) => { tested[i].q = q; });
  rows.sort((a, b) => (a.p ?? 2) - (b.p ?? 2));
  const siteKeys = vNames.flatMap((n) => [...cohorts[n].studies].sort().map((st) => ({ cohort: n, study: st })));
  const testedAttrs = new Set(rows.filter((r) => !r.skipped).map((r) => r.attribute));
  const siteStats = siteKeys.flatMap(({ cohort, study }) =>
    (stats.get(cohort + "|" + study) || []).filter((x) => testedAttrs.has(x.attribute)).map((x) => ({ cohort, study, x })));
  return { kind: "clinical", cohorts: vNames, clinical: rows, studies: vStudies,
    method: clinicalMethod({
      cohorts: vNames, singleStudy,
      perSite: siteKeys.map(({ cohort, study }) => ({ cohort, study, cohortPatients: cohorts[cohort].perStudy[study]?.count || 0 })),
      attributes: attrs.map((a) => rows.find((r) => r.attribute === a)!).map((r) => ({
        attribute: r.attribute, per: r.per, kind: r.kind, ...(r.skipped ? { skipped: r.skipped } : {}),
        test: r.test, statistic: r.statistic, df: r.df, df2: r.df2, p: r.p, q: r.q, rankStatistic: r.rankStatistic, rankP: r.rankP,
        distinct: r.distinct, minExpected: r.minExpected,
        histogramTruncated: r.cells.some((c) => (c as { histogramTruncated?: boolean }).histogramTruncated),
      })),
      categorical: siteStats.filter(({ x }) => x.kind === "cat").flatMap(({ cohort, study, x }) =>
        (x.values || []).map((v) => ({ cohort, study, attribute: x.attribute, value: v.v, n: v.n }))),
      numeric: siteStats.filter(({ x }) => x.kind === "num" && x.n).map(({ cohort, study, x }) =>
        ({ cohort, study, attribute: x.attribute, n: x.n!, sum: x.sum!, sumsq: x.sumsq! })),
      histograms: singleStudy ? siteStats.filter(({ x }) => x.kind === "num" && x.valueCounts).flatMap(({ cohort, x }) =>
        x.valueCounts!.map((h) => ({ cohort, attribute: x.attribute, value: h.v, n: h.n }))) : [],
      medians: rows.filter((r) => r.kind === "num" && !r.skipped).flatMap((r) => r.cells
        .filter((c: any) => c.median != null).map((c: any) => ({ attribute: r.attribute, cohort: c.cohort, median: c.median, q1: c.q1, q3: c.q3 }))),
    }),
    participation: participationFor(vStudies, false),
    note: "Categorical attributes are compared with a Pearson chi-squared over the full value vocabulary;" +
      " numeric ones with Welch's unequal-variance t-test (2 cohorts) or Welch's ANOVA (3+) computed from" +
      " (n, Σx, Σx²) per cohort — those totals are ADDITIVE across sites, so the pooled mean and variance are" +
      " exact from per-site aggregates and no individual value is ever transmitted. Counting unit follows the" +
      " attribute: patients for patient-level, samples for sample-level. q-values are Benjamini–Hochberg across" +
      " the " + tested.length + " tested attributes." +
      (vStudies.length > 1 ? " Counts are pooled across " + vStudies.length + " studies without harmonizing vocabularies; an attribute the studies type differently is refused rather than merged." :
        " Numeric attributes also show median/IQR and a rank-based test alongside the moment-based one — a" +
        " Mann-Whitney U for 2 cohorts, Kruskal-Wallis for 3+ (neither itself part of the q-value correction) —" +
        " computed from the attribute's complete value distribution, which is only exact and only requested" +
        " because this view is confined to a single study.") };
}
