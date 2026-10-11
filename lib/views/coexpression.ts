// Coexpression view: pairwise correlation of genes' profile values within one cohort,
// pooled from each participant's moments.
import { geneSymbols } from "../gene-tracks.ts";
import { benjaminiHochberg, pearsonFromMoments, pearsonR, fisherZMeta } from "../stats.ts";
import type { ViewResult, CoexpressionView, CoexprRow } from "../types.ts";
import type { PairMoments } from "../federation.ts";
import { coexpressionMethod } from "../method.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "./run.ts";
import { overLimit, COOCCUR_GENE_LIMIT } from "./shared.ts";

export async function runCoexpression(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, participationFor } = c;
  const v = view as CoexpressionView;
  const profileType = String(v.profileType || "").trim();
  const uniq = geneSymbols(v.genes);
  { const e = overLimit("a coexpression view", COOCCUR_GENE_LIMIT, uniq.length);
    if (e) return untimed({ kind: "coexpression", error: e.replace("at most " + COOCCUR_GENE_LIMIT, "at most " + COOCCUR_GENE_LIMIT + " genes") }); }
  if (!profileType) return untimed({ kind: "coexpression", error: "coexpression view needs a profileType (e.g. rna_seq_v2_mrna_median_Zscores)" });
  if (uniq.length < 2) return untimed({ kind: "coexpression", error: "coexpression needs at least 2 distinct genes" });
  const pairs: [string, string][] = [];
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) pairs.push([uniq[i], uniq[j]]);
  const cn = vNames[0];
  const byStudy = new Map<string, PairMoments[]>();
  await Promise.all(cohorts[cn].studies.map(async (st) => {
    // a failed study fails the view, rather than leaving its patients silently out of every correlation
    byStudy.set(st, await resolvers[st].pairMoments(doc.cohorts[cn], pairs, profileType));
  }));
  const sites = [...byStudy.keys()];
  const rows: CoexprRow[] = pairs.map(([a, b]) => {
    const parts = sites
      .map((st) => ({ st, m: (byStudy.get(st) || []).find((x) => x.a === a && x.b === b) }))
      .filter((x): x is { st: string; m: PairMoments } => !!x.m && x.m.n > 0);
    const total = parts.reduce((acc, { m }) => ({
      n: acc.n + m.n, sx: acc.sx + m.sx, sy: acc.sy + m.sy,
      sxy: acc.sxy + m.sxy, sxx: acc.sxx + m.sxx, syy: acc.syy + m.syy
    }), { n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 });
    const pooled = pearsonFromMoments(total);
    const row: CoexprRow = { a, b, r: pooled.r, n: pooled.n, p: pooled.p, q: 1 };
    if (parts.length > 1) {
      const per = parts.map(({ st, m }) => ({ study: st, ...pearsonFromMoments(m) }));
      // the meta-analysis takes each study's exact r; the r shown per study is rounded
      const meta = fisherZMeta(parts.map(({ m }) => ({ r: pearsonR(m), n: m.n })));
      row.perStudy = per.map((x) => ({ study: x.study, r: x.r, n: x.n }));
      row.rMeta = meta.r; row.pMeta = meta.p; row.sites = meta.sites;
    }
    return row;
  });
  const tested = rows.filter((r) => r.r != null);
  benjaminiHochberg(tested.map((r) => r.pMeta ?? r.p)).forEach((q, i) => { tested[i].q = q; });
  rows.sort((x, y) => Math.abs(y.r ?? 0) - Math.abs(x.r ?? 0));
  return { kind: "coexpression", cohorts: [cn], coexpression: rows, studies: cohorts[cn].studies,
    method: coexpressionMethod({
      cohort: cn, profileType, pairs: pairs.length, tested: tested.length,
      cohortPatients: [...sites].sort().map((st) => ({ study: st, patients: cohorts[cn].perStudy[st]?.count || 0 })),
      sums: [...sites].sort().flatMap((st) => (byStudy.get(st) || []).filter((m) => m.n > 0)
        .map((m) => ({ study: st, a: m.a, b: m.b, n: m.n, sx: m.sx, sy: m.sy, sxy: m.sxy, sxx: m.sxx, syy: m.syy }))),
      results: rows.map((r) => ({ a: r.a, b: r.b, r: r.r, p: r.p, q: r.q, ...(r.pMeta != null ? { pMeta: r.pMeta } : {}) })),
    }),
    participation: participationFor(cohorts[cn].studies, false),
    note: "Pearson correlation on “" + profileType + "” within “" + cn + "”, over the patients with BOTH values" +
      " (values averaged per patient, matching the heatmap convention). Each site reports six sums — n, Σx, Σy," +
      " Σxy, Σx², Σy² — and nothing else; those sums are additive, so the pooled correlation is EXACT rather than" +
      " an approximation of a centralized one." +
      (sites.length > 1
        ? " Two answers are given because they ask different questions: r pools every patient into one population," +
          " while r(meta) combines the per-study correlations by Fisher z, weighted by study size — the latter asks" +
          " whether the genes move together WITHIN a study, which differing study means can otherwise mask."
        : "") +
      " q-values are Benjamini–Hochberg across the " + tested.length + " pairs with a defined correlation." };
}
