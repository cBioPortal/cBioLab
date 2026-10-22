// Enrichment view: every gene's alteration frequency, compared between cohorts
import type { ViewResult, EnrichmentView, EnrichmentGene, ViewResultOf } from "../types.ts";
import { enrichAlteredSql, enrichPanelProfiledSql, enrichWesSql, type EnrichAlteration } from "../federation-views.ts";
import { fisherExact, chiSquareTest, benjaminiHochberg } from "../stats.ts";
import { enrichmentMethod } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, cytobands, answering, refuse, niceCeil } from "./shared.ts";

const ENRICH_ROWS = 300;
const ALTERATION_WORD: Record<EnrichAlteration, string> = {
  mutation: "mutation", cna: "amplification or deep deletion", amp: "amplification", homdel: "deep deletion", sv: "structural variant"
};

export async function runEnrichment(view: EnrichmentView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  if (vNames.length < 2) return refuse("enrichment", ctx, "an enrichment view compares two or more cohorts; this one draws " + vNames.length);
  { const e = overLimit("an enrichment view", 6, vNames.length); if (e) return refuse("enrichment", ctx, e.replace("at most 6", "at most 6 cohorts")); }
  const alteration = (view.alteration || "mutation") as EnrichAlteration;
  if (!(alteration in ALTERATION_WORD)) return refuse("enrichment", ctx, "alteration is mutation, cna, amp, homdel or sv; got " + JSON.stringify(view.alteration).slice(0, 30));
  const measure: "driver" | "any" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin) return refuse("enrichment", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const minAltered = view.minAltered == null ? 5 : Math.floor(Number(view.minAltered));
  if (!(minAltered >= 1 && minAltered <= 10000)) return refuse("enrichment", ctx, "minAltered is 1 to 10000");
  const label = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(label >= 0 && label <= 40)) return refuse("enrichment", ctx, "label is 0 to 40 genes");
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return refuse("enrichment", ctx, "nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") + (empty.length === 1 ? " is" : " are") + " empty");

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("enrichment", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // per cohort and gene: altered samples, and samples profiled (panel samples + whole-exome samples)
  const altered = new Map<string, number>(), panel = new Map<string, number>(), wes = new Map<string, number>();
  const genes = new Set<string>();
  const perSite: { cohort: string; study: string; genes: number; wes: number }[] = [];
  await Promise.all(vNames.flatMap((n) => cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
    const def = doc.cohorts[n];
    const [a, pr, w] = await Promise.all([
      ok[st].viewAggregate("enrichment:altered:" + n, def, (c, s, d) => enrichAlteredSql(c, s, d, alteration, pin, measure === "driver")),
      ok[st].viewAggregate("enrichment:panels:" + n, def, (c, s, d) => enrichPanelProfiledSql(c, s, d, alteration)),
      ok[st].viewAggregate("enrichment:wes:" + n, def, (c, s, d) => enrichWesSql(c, s, d, alteration))
    ]);
    for (const r of a) { const k = n + "\t" + r.gene; altered.set(k, (altered.get(k) || 0) + Number(r.altered)); genes.add(String(r.gene)); }
    for (const r of pr) { const k = n + "\t" + r.gene; panel.set(k, (panel.get(k) || 0) + Number(r.profiled)); }
    const wn = Number(w[0]?.n || 0);
    wes.set(n, (wes.get(n) || 0) + wn);
    perSite.push({ cohort: n, study: st, genes: a.length, wes: wn });
  })));
  const two = vNames.length === 2;
  const tested: EnrichmentGene[] = [];
  let untested = 0;
  for (const g of genes) {
    const cells = vNames.map((n) => {
      const alt = altered.get(n + "\t" + g) || 0;
      // a sample can be altered in a gene its panel does not list (an off-panel call): it was measured
      const profiled = Math.max(alt, (panel.get(n + "\t" + g) || 0) + (wes.get(n) || 0));
      return { cohort: n, altered: alt, profiled, pct: profiled ? Math.round(1000 * alt / profiled) / 10 : null };
    });
    const total = cells.reduce((a, c) => a + c.altered, 0);
    if (total < minAltered || cells.some((c) => !c.profiled)) { untested++; continue; }
    const p = two
      ? fisherExact(cells[0].altered, cells[0].profiled - cells[0].altered, cells[1].altered, cells[1].profiled - cells[1].altered)
      : chiSquareTest(cells.map((c) => [c.altered, c.profiled - c.altered])).p;
    const shares = cells.map((c) => c.altered / c.profiled);
    const best = shares.indexOf(Math.max(...shares));
    tested.push({ gene: g, cells, ...(two ? { log2Ratio: shares[0] > 0 && shares[1] > 0 ? Math.log2(shares[0] / shares[1]) : null } : {}),
      p, q: 1, enrichedIn: vNames[best] });
  }
  if (!tested.length) return refuse("enrichment", ctx, "no gene had at least " + minAltered + " altered samples (" + ALTERATION_WORD[alteration] + ") across these cohorts, profiled in each of them");
  benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
  tested.sort((a, b) => a.p - b.p || a.gene.localeCompare(b.gene));
  const rows = tested.slice(0, ENRICH_ROWS);
  const bands = await cytobands(ok, rows.map((g) => g.gene));
  for (const g of rows) { const b = bands.get(g.gene); if (b) g.cytoband = b; }
  const labels = rows.slice(0, label).map((g) => g.gene);
  let grid: NonNullable<ViewResultOf<"enrichment">["enrichment"]>["grid"];
  if (two) {
    const lp = (p: number) => -Math.log10(Math.max(1e-300, p));
    const finite = tested.map((g) => g.log2Ratio).filter((x): x is number => x != null);
    const xMax = niceCeil(Math.max(1, ...finite.map(Math.abs)));
    const yMax = niceCeil(Math.max(1, ...tested.map((g) => lp(g.p))));
    const nx = 80, ny = 50, cells = new Map<string, number>();
    for (const g of tested.slice(ENRICH_ROWS)) {
      const x = g.log2Ratio == null ? (g.cells[0].altered ? xMax : -xMax) : g.log2Ratio;
      const bx = Math.min(nx - 1, Math.max(0, Math.floor((x + xMax) / (2 * xMax) * nx)));
      const by = Math.min(ny - 1, Math.floor(lp(g.p) / yMax * ny));
      cells.set(bx + "," + by, (cells.get(bx + "," + by) || 0) + 1);
    }
    grid = { xMax, yMax, nx, ny, cells: [...cells].map(([k, c]) => { const [x, y] = k.split(",").map(Number); return [x, y, c] as [number, number, number]; }) };
  }
  const significant = tested.filter((g) => g.q < 0.05).length;
  const test = two ? "two-sided Fisher's exact test" : "Pearson chi-squared test (altered vs not × cohort)";
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "enrichment", cohorts: vNames,
    enrichment: { alteration: ALTERATION_WORD[alteration], measure, groups: vNames, tested: tested.length, untested, significant, minAltered, test,
      rows, ...(grid ? { grid } : {}), labels, ...(excluded.length ? { excluded } : {}) },
    method: enrichmentMethod({ alteration: ALTERATION_WORD[alteration], measure, oncokbPin: pin, cohorts: vNames, minAltered, test, two, perSite,
      tested: tested.length, untested, results: rows.map((g) => ({ gene: g.gene, p: g.p, q: g.q })) }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Every gene's " + ALTERATION_WORD[alteration] + " frequency in each cohort, counted in SAMPLES over the samples profiled for that gene " +
      "(a panel that lists it, or whole-exome; a sample altered off-panel counts as measured)" +
      (alteration === "mutation" ? ", uncalled mutations excluded as the portal excludes them" : alteration === "sv" ? "" : ", high-level copy number only") + ". " +
      (measure === "driver" ? "Only OncoKB drivers (" + pin + ") count. " : "") +
      tested.length.toLocaleString("en-US") + " genes tested with a " + test + "; q is Benjamini–Hochberg across all of them. " +
      untested.toLocaleString("en-US") + " altered genes were not tested: fewer than " + minAltered + " altered samples across the cohorts, or not profiled in one of them. " +
      (two ? "The log ratio is log2 of the first cohort's altered share over the second's, undefined (drawn at the edge) when either is zero. " : "") +
      "A gene enriched here is more often altered, not necessarily more important: a cohort holding hypermutated tumours (MSI-high, POLE) is enriched for mutations in almost every gene at once — exclude them in the cohort definition to see past that. " +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
