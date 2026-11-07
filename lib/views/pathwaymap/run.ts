// PathwayMapper view: every library gene's altered % in each cohort (panel-aware, summed across
// participants), the library's pathways ranked for the query genes, and the pathway to draw.
import type { ViewResult } from "../../types.ts";
import type { GeneCounts } from "../../federation.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, askEachSite, refuse } from "../shared.ts";
import { LIBRARY_GENES, GENE_SYMBOL, PATHWAYS } from "./library.ts";
import { arrangeFor, round2 } from "./rank.ts";
import type { PathwayMapView, PathwayMapGene } from "./types.ts";
import { pathwayMapMethod } from "./method.ts";

const COHORT_LIMIT = 4;
const QUERY_LIMIT = 100;

export async function runPathwayMap(view: PathwayMapView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, resolvers, vNames, vStudies } = ctx;
  { const e = overLimit("a pathwaymap view", COHORT_LIMIT, vNames.length); if (e) return refuse("pathwaymap", ctx, e.replace("at most " + COHORT_LIMIT, "at most " + COHORT_LIMIT + " cohorts")); }
  let query: string[] | null = null;
  if (view.genes != null) {
    if (!Array.isArray(view.genes)) return refuse("pathwaymap", ctx, "genes is a list of gene symbols");
    const raw = view.genes.map((g) => typeof g === "string" ? g.trim().toUpperCase() : null);
    const bad = view.genes.filter((_, i) => raw[i] == null || !GENE_SYMBOL.test(raw[i]!));
    if (bad.length) return refuse("pathwaymap", ctx, "not a gene symbol: " + bad.slice(0, 5).map((b) => JSON.stringify(b).slice(0, 30)).join(", ") +
      " — a pathwaymap view matches plain gene symbols (no OQL, no merged rows)");
    query = [...new Set(raw as string[])];
    { const e = overLimit("a pathwaymap view", QUERY_LIMIT, query.length); if (e) return refuse("pathwaymap", ctx, e.replace("at most " + QUERY_LIMIT, "at most " + QUERY_LIMIT + " query genes")); }
  }
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return refuse("pathwaymap", ctx, "nothing to count: cohort " + empty.map((n) => "“" + n + "”").join(" and ") + (empty.length === 1 ? " is" : " are") + " empty");

  // every library gene, so the page can draw any pathway from this one answer; and the query's own
  const genes = [...new Set([...LIBRARY_GENES, ...(query || [])])];
  const perSite = (await askEachSite(ctx, resolvers, (n, _st, r) => r.geneCounts(doc.cohorts[n], genes)))
    .map(({ cohort, study, answer }) => ({ cohort, study, counts: answer as GeneCounts[] }));
  const tally = new Map<string, { profiled: number; altered: number }>();   // cohort|gene
  for (const { cohort, counts } of perSite) for (const g of counts) {
    const k = cohort + "|" + g.gene, cur = tally.get(k) || { profiled: 0, altered: 0 };
    cur.profiled += g.profiled; cur.altered += g.altered;
    tally.set(k, cur);
  }
  const rows: PathwayMapGene[] = genes.map((gene) => ({ gene, cells: vNames.map((cohort) => {
    const t = tally.get(cohort + "|" + gene) || { profiled: 0, altered: 0 };
    return { cohort, profiled: t.profiled, altered: t.altered, pct: t.profiled ? round2(100 * t.altered / t.profiled) : null };
  }) }));
  if (!rows.some((r) => r.cells.some((c) => c.profiled > 0)))
    return refuse("pathwaymap", ctx, "no sample in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " was profiled for any gene of PathwayMapper's pathways");
  const queryFrom = query ? "genes" as const : "altered" as const;
  const q = query || rows.filter((r) => r.cells.some((c) => c.altered > 0)).map((r) => r.gene);

  // a pathway or ranking setting the library cannot honour is refused by name; the counts still come back, so the page,
  // which applies those settings itself without a re-run, can draw once the document names one it can
  let arranged, problem: string | null = null;
  try { arranged = arrangeFor({ query: q, genes: rows }, view); }
  catch (e) { problem = (e as Error).message; arranged = arrangeFor({ query: q, genes: rows }, {}); }
  const drawn = PATHWAYS.find((p) => p.name === arranged.pathway)!;
  const multi = vStudies.length > 1;
  const result = {
    kind: "pathwaymap" as const, cohorts: vNames,
    pathwaymap: { query: q, queryFrom, genes: rows, ...arranged },
    method: pathwayMapMethod({
      cohorts: vNames, query: q, queryFrom, settings: arranged.settings,
      perSite: perSite.map((p) => ({ cohort: p.cohort, study: p.study, cohortPatients: cohorts[p.cohort].perStudy[p.study]?.count || 0 })),
      counts: perSite.flatMap((p) => p.counts.filter((c) => c.profiled || c.altered).map((c) => ({ cohort: p.cohort, study: p.study, gene: c.gene, profiled: c.profiled, altered: c.altered }))),
      genes: genes.length, ranked: arranged.ranked,
      pathways: PATHWAYS.filter((p) => !arranged.settings.pancanOnly || p.pancan).map((p) => ({ name: p.name, genes: p.genes })),
      drawn: drawn.genes.filter((g) => !arranged.labels.includes(g)),
    }),
    participation: ctx.participationFor(vStudies, false),
    ...(multi ? { studies: vStudies } : {}),
    caveat: "Each gene node's % is the share of the cohort's samples profiled for THAT gene (on a mutation, copy-number or structural-variant panel covering it) " +
      "with a mutation, a high-level copy-number change (amplification or deep deletion) or a structural variant in it; a sample whose panel omits the gene is not counted, and a gene no sample was profiled for reads N/P, never 0%. " +
      (queryFrom === "genes"
        ? "Pathways are ranked by how many of the " + q.length + " query gene" + (q.length === 1 ? "" : "s") + " each holds, as PathwayMapper ranks them. Every alteration of a gene counts here, whatever narrower OQL a query may give it. "
        : "Without query genes, the ranking matches the " + q.length + " library gene" + (q.length === 1 ? "" : "s") + " altered in the cohort. ") +
      (vNames.length > 1 ? "With several cohorts a gene's frequency weight is its highest across them. " : "") +
      "Pathway diagrams: PathwayMapper (i-Vis at Bilkent), " + PATHWAYS.length + " pathways from TCGA publications." +
      (multi ? " Counts are summed across " + vStudies.length + " studies; overlap is not deduplicated." : ""),
  };
  return problem ? { ...result, error: problem } : result;
}
