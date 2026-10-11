// Pathways view: oncogenic signalling pathways, per cohort
import type { ViewResult, PathwaysView, PathwayRow, PathwayCell } from "../types.ts";
import { SANCHEZ_VEGA_2018, PATHWAY_NAMES, type PathwayRole } from "../pathways.ts";
import { geneSetCountsSql } from "../federation-views.ts";
import { fisherExact, benjaminiHochberg } from "../stats.ts";
import { pathwaysMethod } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, refuse } from "./shared.ts";

const GENE_SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const PATHWAYS_COHORT_LIMIT = 4;

export async function runPathways(view: PathwaysView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  const lim = overLimit("a pathways view", PATHWAYS_COHORT_LIMIT, vNames.length);
  if (lim) return refuse("pathways", ctx, lim.replace("at most " + PATHWAYS_COHORT_LIMIT, "at most " + PATHWAYS_COHORT_LIMIT + " cohorts"));
  const measure: "driver" | "any" = view.measure === "any" ? "any" : "driver";
  if (view.measure != null && view.measure !== "any" && view.measure !== "driver")
    return refuse("pathways", ctx, "measure is \"driver\" or \"any\"; got " + JSON.stringify(view.measure).slice(0, 30));
  if (measure === "driver" && !pin)
    return refuse("pathways", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const topGenes = view.topGenes == null ? 6 : Math.floor(Number(view.topGenes));
  if (!(topGenes >= 1 && topGenes <= 12)) return refuse("pathways", ctx, "topGenes is 1 to 12; got " + String(view.topGenes).slice(0, 20));

  const chosen = view.pathways == null ? PATHWAY_NAMES : view.pathways.map(String);
  const unknown = chosen.filter((n) => !PATHWAY_NAMES.includes(n));
  if (unknown.length) return refuse("pathways", ctx, "unknown pathway " + unknown.map((u) => "“" + u.slice(0, 40) + "”").join(", ") +
    " — the canonical ten are " + PATHWAY_NAMES.join(", ") + "; use sets for your own");
  const sets = Array.isArray(view.sets) ? view.sets : [];
  { const e = overLimit("a pathways view", 4, sets.length); if (e) return refuse("pathways", ctx, e.replace("at most 4", "at most 4 custom sets")); }
  const custom: { name: string; genes: { gene: string; role: PathwayRole }[] }[] = [];
  for (const [i, x] of sets.entries()) {
    const name = String(x?.name || "").trim().slice(0, 60);
    const genes = [...new Set((Array.isArray(x?.genes) ? x.genes : []).map((g) => String(g).trim().toUpperCase()))];
    if (!name) return refuse("pathways", ctx, "set " + (i + 1) + " needs a name");
    if (!genes.length) return refuse("pathways", ctx, "set “" + name + "” has no genes");
    { const e = overLimit("a custom set", 40, genes.length); if (e) return refuse("pathways", ctx, e.replace("at most 40", "at most 40 genes") + " (set “" + name + "”)"); }
    const bad = genes.filter((g) => !GENE_SYMBOL.test(g));
    if (bad.length) return refuse("pathways", ctx, "not a gene symbol: " + bad.slice(0, 5).join(", ") + " (set “" + name + "”)");
    if (PATHWAY_NAMES.includes(name) || custom.some((c) => c.name === name)) return refuse("pathways", ctx, "two sets are named “" + name + "”");
    custom.push({ name, genes: genes.map((gene) => ({ gene, role: null })) });
  }
  const drawn = [
    ...SANCHEZ_VEGA_2018.filter((p) => chosen.includes(p.name)).map((p) => ({ ...p, source: "Sanchez-Vega 2018" as const })),
    ...custom.map((p) => ({ ...p, source: "document" as const }))
  ];
  if (!drawn.length) return refuse("pathways", ctx, "no pathway or set to draw");
  const allGenes = [...new Set(drawn.flatMap((p) => p.genes.map((g) => g.gene)))];

  const emptyCohorts = vNames.filter((n) => !cohorts[n].count);
  if (emptyCohorts.length) return refuse("pathways", ctx, "nothing to count: cohort " + emptyCohorts.map((n) => "“" + n + "”").join(" and ") +
    (emptyCohorts.length === 1 ? " is" : " are") + " empty — check its definition; the genes are not the problem");
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("pathways", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // per cohort: gene counts and set counts, summed across studies (both halves are additive)
  const geneTally = new Map<string, { profiled: number; altered: number }>();   // cohort|gene
  const setTally = new Map<string, { profiled: number; altered: number }>();    // cohort|set
  const bump = (m: Map<string, { profiled: number; altered: number }>, k: string, profiled: number, altered: number) => {
    const cur = m.get(k) || { profiled: 0, altered: 0 };
    cur.profiled += profiled; cur.altered += altered; m.set(k, cur);
  };
  await Promise.all(vNames.flatMap((n) => cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
    const def = doc.cohorts[n];
    const [gc, sc] = await Promise.all([
      ok[st].geneCounts(def, allGenes),
      ok[st].viewAggregate("pathways:sets:" + n, def, (c, s, d) =>
        geneSetCountsSql(c, drawn.map((p) => ({ name: p.name, genes: p.genes.map((g) => g.gene) })), s, pin, d))
    ]);
    for (const g of gc) bump(geneTally, n + "|" + g.gene, g.profiled, measure === "driver" ? g.driver : g.altered);
    for (const r of sc) bump(setTally, n + "|" + String(r.set_name), Number(r.profiled), Number(measure === "driver" ? r.driver : r.altered));
  })));
  const cell = (m: Map<string, { profiled: number; altered: number }>, n: string, key: string): PathwayCell => {
    const t = m.get(n + "|" + key) || { profiled: 0, altered: 0 };
    return { cohort: n, profiled: t.profiled, altered: t.altered, pct: t.profiled ? Math.round(1000 * t.altered / t.profiled) / 10 : null };
  };
  const two = vNames.length === 2;
  const fisher = (cs: PathwayCell[]): number | undefined =>
    two && cs[0].profiled && cs[1].profiled
      ? fisherExact(cs[0].altered, cs[0].profiled - cs[0].altered, cs[1].altered, cs[1].profiled - cs[1].altered) : undefined;

  const geneP = new Map<string, number>();
  const rows: PathwayRow[] = drawn.map((p) => {
    const cells = vNames.map((n) => cell(setTally, n, p.name));
    const members = p.genes.map((g) => {
      const cs = vNames.map((n) => cell(geneTally, n, g.gene));
      const gp = fisher(cs);
      if (gp != null) geneP.set(g.gene, gp);
      return { gene: g.gene, role: g.role, cells: cs };
    });
    const profiledMembers = members.filter((m) => m.cells.some((c) => c.profiled > 0));
    const ranked = profiledMembers.filter((m) => m.cells.some((c) => c.altered > 0))
      .sort((a, b) => Math.max(...b.cells.map((c) => c.pct ?? 0)) - Math.max(...a.cells.map((c) => c.pct ?? 0)) || (a.gene < b.gene ? -1 : 1));
    const top = ranked.slice(0, topGenes);
    const pp = fisher(cells);
    return { name: p.name, source: p.source, genes: p.genes.length, profiledGenes: profiledMembers.length, cells,
      ...(pp != null ? { p: pp } : {}), top, otherAltered: ranked.length - top.length,
      notProfiled: members.filter((m) => !m.cells.some((c) => c.profiled > 0)).map((m) => m.gene) };
  });
  if (two) {
    const tested = rows.filter((r) => r.p != null);
    benjaminiHochberg(tested.map((r) => r.p!)).forEach((q, i) => { tested[i].q = q; });
    // gene q-values over every member gene tested, once each (SCRIB sits in two pathways)
    const genes = [...geneP.keys()], gq = new Map<string, number>();
    benjaminiHochberg(genes.map((g) => geneP.get(g)!)).forEach((q, i) => gq.set(genes[i], q));
    for (const r of rows) for (const t of r.top) if (gq.has(t.gene)) t.q = gq.get(t.gene);
  }
  if (!rows.some((r) => r.cells.some((c) => c.profiled > 0)))
    return refuse("pathways", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " was profiled for any gene in these pathways");
  const multi = ctx.vStudies.length > 1;
  const unprofiled = rows.reduce((n, r) => n + r.notProfiled.length, 0);
  return {
    kind: "pathways", cohorts: vNames, annotation: pin ? "OncoKB " + pin : undefined,
    method: pathwaysMethod({ measure, oncokbPin: pin, cohorts: vNames,
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      sets: drawn.map((p) => ({ name: p.name, source: p.source, genes: p.genes.map((g) => g.gene) })),
      setCounts: vNames.flatMap((n) => drawn.map((p) => ({ cohort: n, set: p.name, ...(setTally.get(n + "|" + p.name) || { profiled: 0, altered: 0 }) }))),
      geneCounts: vNames.flatMap((n) => allGenes.map((g) => ({ cohort: n, gene: g, ...(geneTally.get(n + "|" + g) || { profiled: 0, altered: 0 }) }))),
      results: { pathways: rows.map((r) => ({ name: r.name, ...(r.p != null ? { p: r.p, q: r.q } : {}) })),
        genes: [...new Map(rows.flatMap((r) => r.top.filter((t) => t.q != null).map((t) => [t.gene, { gene: t.gene, q: t.q! }] as const))).values()] } }),
    pathways: { measure, rows, ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: (measure === "driver"
        ? "Share of patients with an OncoKB driver (" + pin + ") in at least one member gene — drivers only, as Sanchez-Vega et al. counted curated oncogenic events. "
        : "Share of patients with any alteration (mutation, high-level CNA, structural variant) in at least one member gene, drivers or not. ") +
      "A pathway's denominator is the patients profiled for at least one of its genes, so a panel that covers few members makes a pathway look rarer than a genome-wide assay would; " +
      "each member gene's own % is over the patients profiled for THAT gene. " +
      (unprofiled ? unprofiled + " member-gene slots were on no participating panel and are listed as not profiled rather than counted as unaltered. " : "") +
      "Pathway membership is the paper's Table S3; a gene's pathway role (oncogene / tumour suppressor) is not used in the count." +
      (two ? " Two-sided Fisher tests; q is Benjamini–Hochberg across the pathways drawn, and separately across every member gene tested." : "") +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
