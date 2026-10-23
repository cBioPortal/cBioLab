// Co-occurrence view: whether pairs of genes are altered together more or less often than
// chance within one cohort, with BH correction.
import { geneSymbols } from "../../gene-tracks.ts";
import { fisherExact, benjaminiHochberg, cochranMantelHaenszel, log2OddsRatio } from "../../stats.ts";
import type { ViewResult } from "../../types.ts";
import type { PairCounts } from "../../federation.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { overLimit, COOCCUR_GENE_LIMIT } from "../shared.ts";
import type { CooccurrenceView, CooccurRow } from "./types.ts";
import { cooccurrenceMethod } from "./method.ts";

export async function runCooccurrence(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, participationFor } = c;
  // Co-occurrence is a property of ONE cohort, not a comparison between two,
  // so it reads the first cohort in the view and says which.
  const uniq = geneSymbols((view as CooccurrenceView).genes);
  { const e = overLimit("a co-occurrence view", COOCCUR_GENE_LIMIT, uniq.length);
    if (e) return untimed({ kind: "cooccurrence", error: e.replace("at most " + COOCCUR_GENE_LIMIT, "at most " + COOCCUR_GENE_LIMIT + " genes") }); }
  if (uniq.length < 2) return untimed({ kind: "cooccurrence", error: "co-occurrence needs at least 2 distinct genes" });
  const pairs: [string, string][] = [];
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) pairs.push([uniq[i], uniq[j]]);
  const cn = vNames[0];
  const byStudy = new Map<string, PairCounts[]>();
  await Promise.all(cohorts[cn].studies.map(async (st) => {
    byStudy.set(st, await resolvers[st].pairCounts(doc.cohorts[cn], pairs));
  }));
  const sites = [...byStudy.keys()];
  const find = (st: string, a: string, b: string) =>
    (byStudy.get(st) || []).find((r) => r.a === a && r.b === b);
  const rows: CooccurRow[] = pairs.map(([a, b]) => {
    const parts = sites.map((st) => find(st, a, b)).filter((x): x is PairCounts => !!x);
    const sum = (f: (x: PairCounts) => number) => parts.reduce((n, x) => n + f(x), 0);
    const both = sum((x) => x.both), onlyA = sum((x) => x.onlyA),
          onlyB = sum((x) => x.onlyB), neither = sum((x) => x.neither);
    const row: CooccurRow = {
      a, b, both, onlyA, onlyB, neither, profiled: both + onlyA + onlyB + neither,
      log2Odds: log2OddsRatio(both, onlyA, onlyB, neither),
      p: fisherExact(both, onlyA, onlyB, neither),
      q: 1, tendency: null
    };
    if (sites.length > 1) {
      // Each site is a stratum: the association is asked WITHIN each study and
      // combined, so differing case mix cannot manufacture (or hide) a pair.
      const cmh = cochranMantelHaenszel(parts.map((x) => ({ a: x.both, b: x.onlyA, c: x.onlyB, d: x.neither })));
      row.pStratified = cmh.p; row.oddsRatioMH = cmh.oddsRatio; row.strata = cmh.tables;
    }
    const lor = row.oddsRatioMH != null ? Math.log2(row.oddsRatioMH) : row.log2Odds;
    row.tendency = lor == null || !Number.isFinite(lor) || lor === 0 ? null
      : lor > 0 ? "co-occurrence" : "mutual exclusivity";
    return row;
  });
  // A pair no panel covers is not a null result — it is an unasked question.
  // Drop it from the ranking (it would otherwise sit there as p=1 with four
  // zeros, indistinguishable from "tested, found nothing") and name it.
  const unassessable = rows.filter((r) => r.profiled === 0);
  const assessable = rows.filter((r) => r.profiled > 0);
  // multiplicity is real here: 12 genes is 66 simultaneous tests
  const primary = assessable.map((r) => r.pStratified ?? r.p);
  benjaminiHochberg(primary).forEach((q, i) => { assessable[i].q = q; });
  assessable.sort((x, y) => (x.pStratified ?? x.p) - (y.pStratified ?? y.p));
  rows.length = 0; rows.push(...assessable);
  return { kind: "cooccurrence", cohorts: [cn], pairs: rows,
    studies: cohorts[cn].studies,
    method: cooccurrenceMethod({
      cohort: cn, pairs: pairs.length, assessable: assessable.length,
      cohortPatients: [...sites].sort().map((st) => ({ study: st, patients: cohorts[cn].perStudy[st]?.count || 0 })),
      counts: [...sites].sort().flatMap((st) => pairs.map(([a, b]) => find(st, a, b)).filter((x): x is PairCounts => !!x)
        .map((x) => ({ study: st, a: x.a, b: x.b, both: x.both, onlyA: x.onlyA, onlyB: x.onlyB, neither: x.neither }))),
      results: rows.map((r) => ({ a: r.a, b: r.b, p: r.p, q: r.q, ...(r.pStratified != null ? { pStratified: r.pStratified } : {}) })),
    }),
    participation: participationFor(cohorts[cn].studies, false),
    note: "Pairwise co-occurrence within “" + cn + "”" +
      (vNames.length > 1 ? " (the first cohort in this view; co-occurrence describes one cohort, not a contrast)" : "") +
      ". Denominators are the patients profiled for BOTH genes, computed per study against that study's own panels" +
      " — a pair is never scored on patients whose panel could not have detected it." +
      (sites.length > 1
        ? " With " + sites.length + " studies the reported test is STRATIFIED by study (Cochran–Mantel–Haenszel):" +
          " each study contributes a 2×2 and the coordinator combines them, so a pair cannot be manufactured by" +
          " differing case mix between sites. The pooled Fisher p is shown alongside."
        : " Two-sided Fisher exact test.") +
      " q-values are Benjamini–Hochberg across the " + assessable.length + " assessable pairs." +
      (unassessable.length
        ? " " + unassessable.length + " of " + pairs.length + " pairs are NOT assessable here — no panel in this cohort" +
          " covers both genes, so there is no denominator to test on (" +
          unassessable.slice(0, 4).map((r) => r.a + "/" + r.b).join(", ") +
          (unassessable.length > 4 ? ", …" : "") + "). They are omitted rather than reported as a null result."
        : "") +
      " Every site returns four counts per pair and nothing else." };
}
