// PathwayMapper view: every library gene's altered % in each cohort (panel-aware, summed across
// participants), the library's pathways ranked for the query genes, and the pathway to draw.
import type { ViewResult } from "../../types.ts";
import type { GeneCounts } from "../../federation.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, askEachSite, answering, refuse } from "../shared.ts";
import { LIBRARY_GENES, GENE_SYMBOL, PATHWAYS } from "./library.ts";
import { arrangeFor, round2 } from "./rank.ts";
import type { PathwayMapView, PathwayMapGene } from "./types.ts";
import { pathwayMapMethod } from "./method.ts";
import { lineCountsSql } from "./sql.ts";
import { parseOql } from "../../oql-parse.ts";
import { hasOql } from "../../oql-match.ts";
import { resolveDrivers } from "../../driver-settings.ts";
import { variantPins } from "../../variant-annotation.ts";

const COHORT_LIMIT = 4;
const QUERY_LIMIT = 100;

export async function runPathwayMap(view: PathwayMapView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, resolvers, vNames, vStudies } = ctx;
  { const e = overLimit("a pathwaymap view", COHORT_LIMIT, vNames.length); if (e) return refuse("pathwaymap", ctx, e.replace("at most " + COHORT_LIMIT, "at most " + COHORT_LIMIT + " cohorts")); }
  let query: string[] | null = null;
  let lines: string[] | null = null;
  if (view.oql !== undefined) {
    if (!Array.isArray(view.oql) || !view.oql.length || view.oql.some((l) => typeof l !== "string" || !l.trim()))
      return refuse("pathwaymap", ctx, "oql is a list of OQL lines, one gene each");
    try {
      query = [...new Set(view.oql.map((l) => { const e = parseOql(l); if (e.length !== 1) throw new Error("'" + l.slice(0, 40) + "' names " + e.length + " genes; give each its own line"); return e[0].gene; }))];
      if (view.drivers !== undefined) resolveDrivers(view.drivers);
    } catch (e) { return refuse("pathwaymap", ctx, "oql: " + (e as Error).message); }
    lines = view.oql;
    { const e = overLimit("a pathwaymap view", QUERY_LIMIT, query.length); if (e) return refuse("pathwaymap", ctx, e.replace("at most " + QUERY_LIMIT, "at most " + QUERY_LIMIT + " query genes")); }
  } else if (view.genes != null) {
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
  // a query gene whose line carries OQL is altered where its lines match, at each site
  const oqlGenes = new Set((lines || []).flatMap((l) => parseOql(l)).filter((e) => hasOql(e.specs)).map((e) => e.gene));
  const lineAltered = new Map<string, number>();   // cohort|gene
  const siteLineAltered = new Map<string, number>();   // cohort|study|gene
  if (oqlGenes.size) {
    const pins = { ...(view.exp ? { EXP: view.exp } : {}), ...(view.prot ? { PROT: view.prot } : {}), ...(view.ifHeld ? { ifHeld: true } : {}) };
    const hotspotPins = view.drivers !== undefined ? await variantPins() : undefined;
    // a line's count is each study's own: a study that cannot answer it is named, never counted as every alteration
    const { ok, excluded } = answering(ctx);
    if (excluded.length) return refuse("pathwaymap", ctx, "a query line with OQL is counted by each study itself, and " +
      excluded.map((e) => e.study + " is " + e.reason).join("; "));
    const answers = await askEachSite(ctx, ok, async (n, st, r) => {
      const profiles = (await ctx.studyProfiles(st)).profiles;
      return r.viewAggregate("pathwaymap:lines:" + n, doc.cohorts[n], (c, s, d) => lineCountsSql(c, s, d, lines!, { oncokbPin: ctx.pin, profiles, pins,
        ...(view.drivers !== undefined ? { drivers: view.drivers, hotspotPins } : {}) }));
    });
    for (const { cohort, study, answer } of answers) for (const row of answer as { gene: string; altered: number | string }[]) {
      const k = cohort + "|" + row.gene;
      lineAltered.set(k, (lineAltered.get(k) || 0) + Number(row.altered));
      siteLineAltered.set(cohort + "|" + study + "|" + row.gene, Number(row.altered));
    }
  }
  const tally = new Map<string, { profiled: number; altered: number }>();   // cohort|gene
  for (const { cohort, counts } of perSite) for (const g of counts) {
    const k = cohort + "|" + g.gene, cur = tally.get(k) || { profiled: 0, altered: 0 };
    cur.profiled += g.profiled; cur.altered += oqlGenes.has(g.gene) ? 0 : g.altered;
    tally.set(k, cur);
  }
  for (const [k, n] of lineAltered) { const cur = tally.get(k); if (cur) cur.altered += n; }
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
      counts: perSite.flatMap((p) => p.counts.map((c) => ({ cohort: p.cohort, study: p.study, gene: c.gene, profiled: c.profiled,
        altered: oqlGenes.has(c.gene) ? siteLineAltered.get(p.cohort + "|" + p.study + "|" + c.gene) || 0 : c.altered })).filter((c) => c.profiled || c.altered)),
      genes: genes.length, ranked: arranged.ranked,
      pathways: PATHWAYS.filter((p) => !arranged.settings.pancanOnly || p.pancan).map((p) => ({ name: p.name, genes: p.genes })),
      drawn: drawn.genes.filter((g) => !arranged.labels.includes(g)),
    }),
    participation: ctx.participationFor(vStudies, false),
    ...(multi ? { studies: vStudies } : {}),
    caveat: "Each gene node's % is the share of the cohort's samples profiled for THAT gene (on a mutation, copy-number or structural-variant panel covering it) " +
      "with a mutation, a high-level copy-number change (amplification or deep deletion) or a structural variant in it; a sample whose panel omits the gene is not counted, and a gene no sample was profiled for reads N/P, never 0%. " +
      (queryFrom === "genes"
        ? "Pathways are ranked by how many of the " + q.length + " query gene" + (q.length === 1 ? "" : "s") + " each holds, as PathwayMapper ranks them. " +
          (oqlGenes.size ? "A query gene whose line carries OQL (" + [...oqlGenes].join(", ") + ") counts only what its lines match; every other gene, every alteration. " : "Every alteration of a gene counts here. ")
        : "Without query genes, the ranking matches the " + q.length + " library gene" + (q.length === 1 ? "" : "s") + " altered in the cohort. ") +
      (vNames.length > 1 ? "With several cohorts a gene's frequency weight is its highest across them. " : "") +
      "Pathway diagrams: PathwayMapper (i-Vis at Bilkent), " + PATHWAYS.length + " pathways from TCGA publications." +
      (multi ? " Counts are summed across " + vStudies.length + " studies; overlap is not deduplicated." : ""),
  };
  return problem ? { ...result, error: problem } : result;
}
