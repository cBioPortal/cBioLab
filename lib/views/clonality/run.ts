// Clonality view: FACETS clonal / subclonal calls, LOH, WGD, purity and ploidy
import type { ViewResult } from "../../types.ts";
import { hasViewAggregates } from "../../federation.ts";
import { ascnStudiesSql } from "../../federation-views.ts";
import { fisherExact, benjaminiHochberg } from "../../stats.ts";
import { geneSymbols } from "../../gene-tracks.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, refuse, type ViewResolver } from "../shared.ts";
import type { ClonalityView, ClonalityPanel } from "./types.ts";
import { clonalityGenesSql, facetsSummarySql, facetsHistogramSql } from "./sql.ts";
import { clonalityMethod } from "./method.ts";

export async function runClonality(view: ClonalityView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  { const e = overLimit("a clonality view", 3, vNames.length); if (e) return refuse("clonality", ctx, e.replace("at most 3", "at most 3 cohorts")); }
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("clonality", ctx, (e as Error).message); }
  if (!genes.length) return refuse("clonality", ctx, "a clonality view needs genes");
  { const e = overLimit("a clonality view", 12, genes.length); if (e) return refuse("clonality", ctx, e.replace("at most 12", "at most 12 genes")); }
  const measure: "driver" | "any" = view.measure === "any" ? "any" : "driver";
  if (measure === "driver" && !pin)
    return refuse("clonality", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const qc = view.qc !== false;

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("clonality", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // which of this view's studies hold allele-specific copy number at all
  const withAscn = new Set<string>();
  await Promise.all(Object.entries(ok).map(async ([st, r]) => {
    const rows = await r.viewMeta("clonality:ascn-studies", ascnStudiesSql);
    if (rows.some((x) => String(x.study) === st)) withAscn.add(st);
  }));
  for (const st of Object.keys(ok)) if (!withAscn.has(st)) { excluded.push({ study: st, reason: "no FACETS allele-specific copy number" }); delete ok[st]; }
  if (!Object.keys(ok).length) {
    const any = Object.values(ctx.resolvers).find((r) => hasViewAggregates(r)) as ViewResolver | undefined;
    const holders = any ? (await any.viewMeta("clonality:ascn-studies", ascnStudiesSql)).map((x) => String(x.study)) : [];
    return refuse("clonality", ctx, (ctx.vStudies.length === 1 ? ctx.vStudies[0] + " has no" : "none of " + ctx.vStudies.join(", ") + " has any") +
      " allele-specific copy number (FACETS) to call clonality from" + (holders.length ? " — the studies that do: " + holders.join(", ") : ""));
  }

  const panels: ClonalityPanel[] = [];
  for (const n of vNames) {
    const panel: ClonalityPanel = { cohort: n, samples: 0, ascnSamples: 0, qcPass: 0, qcFail: 0, wgd: { yes: 0, no: 0 },
      purity: new Array(20).fill(0), ploidy: new Array(32).fill(0),
      genes: genes.map((gene) => ({ gene, calls: 0, samples: 0, clonal: 0, subclonal: 0, indeterminate: 0, uncalled: 0, loh: 0, lohKnown: 0, ccf: new Array(10).fill(0) })) };
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n];
      const [sum, hist, rows] = await Promise.all([
        ok[st].viewAggregate("clonality:summary:" + n, def, (c, s, d) => facetsSummarySql(c, s, d, qc)),
        ok[st].viewAggregate("clonality:purity-ploidy:" + n, def, (c, s, d) => facetsHistogramSql(c, s, d, qc)),
        ok[st].viewAggregate("clonality:genes:" + n, def, (c, s, d) => clonalityGenesSql(c, s, d, genes, pin, measure, qc))
      ]);
      const x = sum[0] || {};
      panel.samples += Number(x.samples || 0); panel.ascnSamples += Number(x.ascn_samples || 0);
      panel.qcPass += Number(x.qc_pass || 0); panel.qcFail += Number(x.qc_fail || 0);
      panel.wgd.yes += Number(x.wgd_true || 0); panel.wgd.no += Number(x.wgd_false || 0);
      for (const h of hist) {
        const arr = String(h.attr) === "FACETS_PURITY" ? panel.purity : panel.ploidy;
        const b = Number(h.bin);
        if (b >= 0 && b < arr.length) arr[b] += Number(h.n);
      }
      for (const r of rows) {
        const g = panel.genes.find((z) => z.gene === String(r.gene));
        if (!g) continue;
        const calls = Number(r.calls), cl = Number(r.clonal), sc = Number(r.subclonal), ind = Number(r.indeterminate);
        g.calls += calls; g.samples += Number(r.samples); g.clonal += cl; g.subclonal += sc; g.indeterminate += ind;
        g.uncalled += calls - cl - sc - ind; g.loh += Number(r.loh); g.lohKnown += Number(r.loh_known);
        for (let i = 0; i < 10; i++) g.ccf[i] += Number(r["ccf" + i]);
      }
    }));
    panels.push(panel);
  }
  let wgdP: number | undefined;
  if (panels.length === 2) {
    const [A, B] = panels;
    const tested = genes.map((_, i) => ({ a: A.genes[i], b: B.genes[i] })).filter((t) => t.a.clonal + t.a.subclonal > 0 && t.b.clonal + t.b.subclonal > 0);
    const ps = tested.map((t) => fisherExact(t.a.clonal, t.a.subclonal, t.b.clonal, t.b.subclonal));
    benjaminiHochberg(ps).forEach((q, i) => { tested[i].a.p = ps[i]; tested[i].a.q = q; tested[i].b.p = ps[i]; tested[i].b.q = q; });
    if (A.wgd.yes + A.wgd.no && B.wgd.yes + B.wgd.no) wgdP = fisherExact(A.wgd.yes, A.wgd.no, B.wgd.yes, B.wgd.no);
  }
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "clonality", cohorts: vNames,
    method: clonalityMethod({ measure, oncokbPin: pin, qc,
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      panels: panels.map((pn) => ({ cohort: pn.cohort, samples: pn.samples, ascnSamples: pn.ascnSamples, qcPass: pn.qcPass, qcFail: pn.qcFail, wgdYes: pn.wgd.yes, wgdNo: pn.wgd.no })),
      genes: panels.flatMap((pn) => pn.genes.map((g) => ({ cohort: pn.cohort, gene: g.gene, calls: g.calls, clonal: g.clonal, subclonal: g.subclonal,
        indeterminate: g.indeterminate, loh: g.loh, lohKnown: g.lohKnown }))),
      results: { genes: panels.length === 2 ? panels[0].genes.filter((g) => g.p != null).map((g) => ({ gene: g.gene, p: g.p!, q: g.q! })) : [],
        ...(wgdP != null ? { wgdP } : {}) } }),
    clonality: { measure, qc, panels, ...(wgdP != null ? { wgdP } : {}), ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "FACETS allele-specific copy number: each " + (measure === "driver" ? "OncoKB driver (" + pin + ") " : "") + "mutation call — one mutation in one sample — is clonal, " +
      "subclonal or indeterminate as FACETS called it from its cancer-cell fraction; uncalled calls have an estimate but no call. " +
      "LOH at the locus is a minor copy number of 0 where one was estimated. " +
      (qc ? "Only samples whose FACETS_QC is Pass are used (" + panels.map((pn) => pn.cohort + ": " + pn.qcPass.toLocaleString("en-US") + " pass, " + pn.qcFail.toLocaleString("en-US") + " fail").join("; ") + "); qc: false uses every sample. "
        : "Every sample is used, FACETS_QC failures included. ") +
      "Whole-genome doubling, purity and ploidy are FACETS's own per-sample calls. Clonality is only as good as the purity estimate behind it: a low-purity sample's clonal mutation can be called subclonal, and a panel's handful of mutations per sample makes each estimate coarse." +
      (panels.length === 2 ? " Two cohorts: Fisher on clonal against subclonal calls per gene (BH across genes) and on WGD." : "") +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
