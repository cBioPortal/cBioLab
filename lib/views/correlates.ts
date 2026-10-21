// Correlates view: one gene's expression against every gene's
import type { ViewResult, CorrelatesView, CorrelatesGene } from "../types.ts";
import { correlatesMomentsSql } from "../federation-views.ts";
import { benjaminiHochberg, pearsonFromMoments, pearsonR, fisherZMeta } from "../stats.ts";
import { geneSymbols } from "../gene-tracks.ts";
import { correlatesMethod } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { cytobands, answering, refuse, PROFILE_NAME } from "./shared.ts";

const CORR_SHOW_MAX = 250;

export async function runCorrelates(view: CorrelatesView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length !== 1) return refuse("correlates", ctx, "a correlates view reads one cohort; this one draws " + vNames.length + " — name one in cohorts");
  const cn = vNames[0];
  const [gene] = geneSymbols([view.gene]);
  if (!gene) return refuse("correlates", ctx, "gene names the query gene, e.g. ESR1");
  const pt = String(view.profileType || ""), other = String(view.otherProfile || pt);
  if (!PROFILE_NAME.test(pt) || !PROFILE_NAME.test(other)) return refuse("correlates", ctx, "profileType names a continuous molecular profile, e.g. rna_seq_v2_mrna");
  const show = view.show == null ? 100 : Math.floor(Number(view.show));
  if (!(show >= 1 && show <= CORR_SHOW_MAX)) return refuse("correlates", ctx, "show is 1 to " + CORR_SHOW_MAX + " genes in each direction");
  const minN = view.minN == null ? 10 : Math.floor(Number(view.minN));
  if (!(minN >= 4 && minN <= 100000)) return refuse("correlates", ctx, "minN is 4 to 100000");
  if (!cohorts[cn].count) return refuse("correlates", ctx, "nothing to correlate: cohort “" + cn + "” is empty");

  const { ok, excluded } = answering(ctx);
  const inventory = await Promise.all(cohorts[cn].studies.filter((st) => ok[st]).map(async (st) => ({ st, profiles: (await ctx.studyProfiles(st)).profiles })));
  const holders = inventory.filter((x) => x.profiles.includes(pt) && x.profiles.includes(other)).map((x) => x.st);
  for (const x of inventory) if (!holders.includes(x.st)) excluded.push({ study: x.st, reason: "has no " + [pt, other].filter((p, i, a) => a.indexOf(p) === i && !x.profiles.includes(p)).join(" or ") + " profile" });
  if (!holders.length) {
    const avail = [...new Set(inventory.flatMap((x) => x.profiles))].filter((p) => p !== "cna").sort();
    return refuse("correlates", ctx, "no study in “" + cn + "” has “" + (pt === other ? pt : pt + "” and “" + other) + "” — " + (avail.length ? "available: " + avail.join(", ") : "these studies have no molecular profiles"));
  }
  type Sums = { n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number };
  const zero = (): Sums => ({ n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 });
  const pooled = new Map<string, Sums>();
  const perStudy = new Map<string, { study: string; m: Sums; rk: Sums }[]>();
  const rows: { study: string; gene: string; m: Sums; rk: Sums }[] = [];
  await Promise.all(holders.map(async (st) => {
    const out = await ok[st].viewAggregate("correlates:moments", doc.cohorts[cn], (c, s, d) => correlatesMomentsSql(c, s, d, gene, pt, other));
    for (const r of out) {
      const g = String(r.gene);
      const m = { n: Number(r.n), sx: Number(r.sx), sy: Number(r.sy), sxy: Number(r.sxy), sxx: Number(r.sxx), syy: Number(r.syy) };
      const rk = { n: Number(r.n), sx: Number(r.rsx), sy: Number(r.rsy), sxy: Number(r.rsxy), sxx: Number(r.rsxx), syy: Number(r.rsyy) };
      rows.push({ study: st, gene: g, m, rk });
      const t = pooled.get(g) || zero();
      for (const k of Object.keys(t) as (keyof Sums)[]) t[k] += m[k];
      pooled.set(g, t);
      perStudy.set(g, [...(perStudy.get(g) || []), { study: st, m, rk }]);
    }
  }));
  if (!pooled.size) return refuse("correlates", ctx, "no patient in “" + cn + "” has a value for " + gene + " on “" + pt + "”" + (excluded.length ? " in the studies that hold it" : ""));
  const multi = holders.length > 1;
  const tested: CorrelatesGene[] = [];
  let untested = 0;
  for (const [g, m] of pooled) {
    if (g === gene && pt === other) continue;   // a gene against itself is 1 by construction
    const pr = pearsonFromMoments(m);
    let rho: number | null, rhoP: number;
    if (multi) { const meta = fisherZMeta(perStudy.get(g)!.map((x) => ({ r: pearsonR(x.rk), n: x.rk.n }))); rho = meta.r; rhoP = meta.p; }
    else { const sp = pearsonFromMoments(perStudy.get(g)![0].rk); rho = sp.r; rhoP = sp.p; }
    if (m.n < minN || rho == null || pr.r == null) { untested++; continue; }
    tested.push({ gene: g, n: m.n, rho, rhoP, q: 1, r: pr.r, p: pr.p });
  }
  if (!tested.length) return refuse("correlates", ctx, "no gene had at least " + minN + " patients with a value for both it and " + gene + ", and any spread");
  benjaminiHochberg(tested.map((g) => g.rhoP)).forEach((q, i) => { tested[i].q = q; });
  tested.sort((a, b) => b.rho! - a.rho! || a.gene.localeCompare(b.gene));
  const positive = tested.filter((g) => g.rho! > 0).slice(0, show);
  const negative = tested.filter((g) => g.rho! < 0).reverse().slice(0, show);
  const bands = await cytobands(ok, [...positive, ...negative].map((g) => g.gene));
  for (const g of [...positive, ...negative]) { const b = bands.get(g.gene); if (b) g.cytoband = b; }
  const bins = new Map<number, number>();
  for (const g of tested) { const b = Math.min(39, Math.floor((g.rho! + 1) / 0.05)); bins.set(b, (bins.get(b) || 0) + 1); }
  const histogram = Array.from({ length: 40 }, (_, b) => [Math.round((-1 + b * 0.05) * 100) / 100, bins.get(b) || 0] as [number, number]);
  const significant = tested.filter((g) => g.q < 0.05).length;
  const reported = [...positive, ...negative];
  return {
    kind: "correlates", cohorts: [cn],
    correlates: { gene, profileType: pt, otherProfile: other, cohort: cn, tested: tested.length, untested, significant, minN, rhoFrom: multi ? "meta" : "rank",
      positive, negative, histogram, ...(excluded.length ? { excluded } : {}) },
    method: correlatesMethod({ gene, profileType: pt, otherProfile: other, cohort: cn, minN, multi, tested: tested.length, untested,
      perSite: holders.map((st) => ({ study: st, genes: rows.filter((r) => r.study === st).length, patients: cohorts[cn].perStudy[st]?.count || 0 })),
      sums: rows.map((r) => ({ study: r.study, gene: r.gene, ...r.m, rsx: r.rk.sx, rsy: r.rk.sy, rsxy: r.rk.sxy, rsxx: r.rk.sxx, rsyy: r.rk.syy })),
      results: reported.map((g) => ({ gene: g.gene, rho: g.rho!, rhoP: g.rhoP, q: g.q, r: g.r!, p: g.p })) }),
    participation: ctx.participationFor(cohorts[cn].studies, false),
    ...(cohorts[cn].studies.length > 1 ? { studies: cohorts[cn].studies } : {}),
    caveat: gene + " on “" + pt + "” against every gene on “" + other + "”, over the patients in “" + cn + "” with both values (a patient's samples averaged, as the heatmap takes them). " +
      "Ranked by Spearman's ρ, as the portal ranks, with Pearson's r beside it; q is Benjamini–Hochberg over ρ's p across all " + tested.length.toLocaleString("en-US") + " genes tested. " +
      (multi ? "Pearson's r pools every study's sums (exact); ρ is each study's own, combined by Fisher z weighted by size, since ranks do not add across studies. " : "") +
      "A correlation is not a regulatory link: genes that rise together across a cohort often both track a third thing — a subtype, the tumour's purity, proliferation. " +
      untested.toLocaleString("en-US") + " genes were not tested: fewer than " + minN + " patients with both values, or no spread." +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
