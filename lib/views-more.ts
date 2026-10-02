// View kinds beyond the original thirteen: attrition, genome, pathways, diffexpr, paired,
// clonality, incidence and labs. runAnalysis (lib/analysis.ts) evaluates the cohorts and
// resolvers exactly as for every other view and hands them here, so these views count,
// federate and disclose under the same rules — they just live in their own module rather
// than growing that file's if/else chain further.
import type { AnalysisDoc, CohortDef, ViewResult, ViewParticipation, AttritionView, AttritionPanel,
  GenomeView, GenomeSeries, PathwaysView, PathwayRow, PathwayCell, DiffexprView, DiffexprGene,
  PairedView, PairedPanel, ClonalityView, ClonalityPanel, IncidenceView, IncidenceCurve,
  LabsView, LabsPanel } from "./types.ts";
import { SANCHEZ_VEGA_2018, PATHWAY_NAMES, type PathwayRole } from "./pathways.ts";
import { cohortClauses, describeClause } from "./cohort2.ts";
import { hasMoreAggregates, isPatientLevel, type Resolver, type MoreAggregateCapable } from "./federation.ts";
import { genomeBinsSql, genomeCoverageSql, studyGenomeSql, geneSetCountsSql, profileMomentsAllSql, genesetMembersSql,
  pairedCountsSql, pairedPatientsSql, sampleAttributeValuesSql,
  clonalityGenesSql, facetsSummarySql, facetsHistogramSql, ascnStudiesSql, incidenceCountsSql,
  labCourseSql, labBestSql, labWaterfallSql, labTestsSql, LAB_PCT_BIN, LAB_PCT_MIN, LAB_PCT_BINS,
  CHROM_LENGTHS, GENOME_CHROMS } from "./federation-more.ts";
import { fisherExact, benjaminiHochberg, varianceFromMoments, welchT, preRankedGsea, mcnemarExact, Z_975,
  aalenJohansen, cifAt, grayPermutationTest, kaplanMeier, quantilesFromHistogram, type CrRecord } from "./stats.ts";
import { geneSymbols } from "./gene-tracks.ts";
import { viewToSvg } from "./view-svg.ts";
import { diffexprMethod, incidenceMethod, type IncidenceTrace } from "./method.ts";

export interface EvaluatedCohort {
  studies: string[];
  perStudy: Record<string, { sql: string; count: number; mode: string }>;
  count: number;
  text: string;
}

/** Everything a view runner needs from runAnalysis, and nothing it could use to bypass it. */
export interface ViewCtx {
  doc: AnalysisDoc;
  cohorts: Record<string, EvaluatedCohort>;
  resolvers: Record<string, Resolver>;
  /** the cohorts this view reads, in document order */
  vNames: string[];
  /** every study those cohorts span */
  vStudies: string[];
  participationFor: (studies: string[], requiresPatientLevel: boolean) => ViewParticipation;
  pin: string | null;
  /** the molecular and generic-assay profiles a study holds (runAnalysis's cached inventory) */
  studyProfiles: (study: string) => Promise<{ profiles: string[]; gaProfiles: string[] }>;
  overLimit: (what: string, max: number, given: number) => string | null;
}

export const MORE_VIEW_KINDS = ["attrition", "genome", "pathways", "diffexpr", "paired", "clonality", "incidence", "labs"] as const;

export function isMoreViewKind(kind: unknown): boolean {
  return (MORE_VIEW_KINDS as readonly string[]).includes(String(kind));
}

export async function runMoreView(view: { kind: string }, ctx: ViewCtx): Promise<ViewResult> {
  let r: ViewResult;
  try {
    if (view.kind === "attrition") r = await attritionView(view as AttritionView, ctx);
    else if (view.kind === "genome") r = await genomeView(view as GenomeView, ctx);
    else if (view.kind === "pathways") r = await pathwaysView(view as PathwaysView, ctx);
    else if (view.kind === "diffexpr") r = await diffexprView(view as DiffexprView, ctx);
    else if (view.kind === "paired") r = await pairedView(view as PairedView, ctx);
    else if (view.kind === "clonality") r = await clonalityView(view as ClonalityView, ctx);
    else if (view.kind === "incidence") r = await incidenceView(view as IncidenceView, ctx);
    else if (view.kind === "labs") r = await labsView(view as LabsView, ctx);
    else r = { kind: view.kind, error: "unknown view kind" };
  } catch (e) {
    r = { kind: view.kind, cohorts: ctx.vNames, error: (e as Error).message };
  }
  if (!r.error && !r.svg) r.svg = viewToSvg(r) || undefined;
  return r;
}

// ---------------------------------------------------------------------------
// attrition: how each cohort's clauses narrow the study, one step at a time

const ATTRITION_COHORT_LIMIT = 6;

/**
 * Every clause of `all` is ANDed, so the running count after the first k clauses is the cohort
 * a reader would get by stopping there. Each prefix is evaluated as its own cohort definition —
 * the same compiler, the same per-study counts — so the last step is the cohort's own count by
 * construction, not a separate calculation that could disagree with it.
 */
async function attritionView(view: AttritionView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, resolvers, vNames, vStudies } = ctx;
  const e = ctx.overLimit("an attrition view", ATTRITION_COHORT_LIMIT, vNames.length);
  if (e) return { kind: "attrition", error: e.replace("at most " + ATTRITION_COHORT_LIMIT, "at most " + ATTRITION_COHORT_LIMIT + " cohorts") };
  const queries: NonNullable<ViewResult["queries"]> = [];
  const panels: AttritionPanel[] = await Promise.all(vNames.map(async (name) => {
    const def = doc.cohorts[name];
    const clauses = cohortClauses(def);
    const prefix = (k: number): CohortDef => ({ ...(def || {}), all: clauses.slice(0, k), a: undefined, b: undefined, rel: undefined });
    const studies = cohorts[name].studies;
    const countAt = async (k: number): Promise<number> => {
      const per = await Promise.all(studies.map(async (st) => {
        const n = await resolvers[st].count(prefix(k));
        // count() is not a logged aggregate (cohort sizes are provenance of their own), so the
        // step's query is recorded here — after the count, because a remote peer only reports
        // its compiled SQL once it has answered.
        queries.push({ study: st, label: "attrition:" + name + ":step " + k,
          sql: "SELECT count() AS n FROM (" + resolvers[st].cohortSql(prefix(k)) + ")",
          ...(resolvers[st].instance.id === "peer" ? { remote: true } : {}) });
        return n;
      }));
      return per.reduce((a, b) => a + b, 0);
    };
    const counts = await Promise.all([0, ...clauses.map((_, i) => i + 1)].map(countAt));
    const base = counts[0];
    const steps = clauses.map((c, i) => ({
      label: describeClause(c),
      n: counts[i + 1],
      excluded: counts[i] - counts[i + 1],
      pctOfBase: base ? Math.round(1000 * counts[i + 1] / base) / 10 : null
    }));
    return { cohort: name, base, steps, studies };
  }));
  const mismatched = panels.filter((p) => (p.steps.length ? p.steps[p.steps.length - 1].n : p.base) !== cohorts[p.cohort].count);
  const multi = vStudies.length > 1;
  return {
    kind: "attrition", cohorts: vNames, attrition: panels,
    queries: queries.sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })),
    participation: ctx.participationFor(vStudies, false),
    ...(multi ? { studies: vStudies } : {}),
    caveat: "Each step counts the patients left after ANDing that clause onto every clause above it, in the order the " +
      "cohort lists them. The order changes the path, never the final count: reorder the clauses to see a different " +
      "attrition sequence. Each view further drops patients who lack its own data (survival without follow-up, genes " +
      "never profiled), and says how many in its own caption." +
      (multi ? " Counts are summed across " + vStudies.length + " studies; patient overlap across studies is NOT deduplicated." : "") +
      (mismatched.length ? " WARNING: the last step for " + mismatched.map((p) => p.cohort).join(", ") +
        " does not equal that cohort's own count — the definition was evaluated twice and gave two answers." : "")
  };
}

// ---------------------------------------------------------------------------
// shared: which participants can answer a lib/federation-more.ts aggregate

type MoreResolver = Resolver & MoreAggregateCapable;

/**
 * Split the view's studies into those that can answer (every local participant) and those that
 * cannot (a remote MCP peer, which does not serve these aggregates yet). The second list is
 * reported by the view, never silently dropped.
 */
function answering(ctx: ViewCtx): { ok: Record<string, MoreResolver>; excluded: { study: string; reason: string }[] } {
  const ok: Record<string, MoreResolver> = {};
  const excluded: { study: string; reason: string }[] = [];
  for (const st of ctx.vStudies) {
    const r = ctx.resolvers[st];
    if (hasMoreAggregates(r)) ok[st] = r;
    else excluded.push({ study: st, reason: "a remote peer, which does not serve this view's aggregates yet" });
  }
  return { ok, excluded };
}

const plural = (n: number, one: string, many = one + "s") => n.toLocaleString("en-US") + " " + (n === 1 ? one : many);

/** A view-level refusal: past a limit, or nothing that can answer. */
const refuse = (kind: string, ctx: ViewCtx, error: string): ViewResult => ({ kind, cohorts: ctx.vNames, error });

// ---------------------------------------------------------------------------
// genome: genome-wide copy-number frequency from segments

const GENOME_COHORT_LIMIT = 4;

async function genomeView(view: GenomeView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  const lim = ctx.overLimit("a genome view", GENOME_COHORT_LIMIT, vNames.length);
  if (lim) return refuse("genome", ctx, lim.replace("at most " + GENOME_COHORT_LIMIT, "at most " + GENOME_COHORT_LIMIT + " cohorts"));
  const binMb = view.binMb == null ? 2 : Number(view.binMb);
  if (!Number.isFinite(binMb) || binMb < 1 || binMb > 50)
    return refuse("genome", ctx, "binMb must be a number of megabases from 1 to 50; got " + String(view.binMb).slice(0, 20));
  const threshold = view.threshold == null ? 0.2 : Number(view.threshold);
  if (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 2)
    return refuse("genome", ctx, "threshold is a |log2 segment mean| from 0.05 to 2; got " + String(view.threshold).slice(0, 20));
  const includeX = view.includeX === true;
  const binBp = Math.round(binMb * 1e6);

  const { ok, excluded } = answering(ctx);
  // Bins are genome coordinates, and hg19 and hg38 put the same base in different places, so
  // two builds cannot share one axis: refused, naming which study is on which.
  const builds: Record<string, string> = {};
  await Promise.all(Object.entries(ok).map(async ([st, r]) => {
    const rows = await r.moreMeta("genome:build", studyGenomeSql);
    builds[st] = String(rows[0]?.build || "unknown");
  }));
  const distinct = [...new Set(Object.values(builds))];
  if (distinct.some((b) => b !== "hg19" && b !== "hg38"))
    return refuse("genome", ctx, "no chromosome lengths for reference genome " +
      Object.entries(builds).filter(([, b]) => b !== "hg19" && b !== "hg38").map(([st, b]) => st + " (" + b + ")").join(", "));
  if (distinct.length > 1)
    return refuse("genome", ctx, "these studies are on different reference genomes, so their bins are not the same places: " +
      Object.entries(builds).map(([st, b]) => st + " " + b).join(", ") + " — draw each build in its own view");
  const build = (distinct[0] || "hg19") as "hg19" | "hg38";

  // the shared bin axis
  const chroms = GENOME_CHROMS.filter((c) => includeX || c !== "X");
  const bins: { chrom: string; start: number }[] = [];
  const offset: Record<string, number> = {}, nBins: Record<string, number> = {};
  for (const c of chroms) {
    offset[c] = bins.length;
    nBins[c] = Math.ceil(CHROM_LENGTHS[build][c] / binBp);
    for (let k = 0; k < nBins[c]; k++) bins.push({ chrom: c, start: k * binBp });
  }

  let pastEnd = 0;
  const series: GenomeSeries[] = [];
  const noSegments: string[] = [];
  for (const name of vNames) {
    const ser: GenomeSeries = { cohort: name, samples: 0, segmented: 0,
      profiled: new Array(bins.length).fill(0), gain: new Array(bins.length).fill(0), loss: new Array(bins.length).fill(0) };
    await Promise.all(cohorts[name].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[name];
      const [cov, rows] = await Promise.all([
        ok[st].moreAggregate("genome:coverage:" + name, def, genomeCoverageSql),
        ok[st].moreAggregate("genome:bins:" + name, def, (c, s, d) => genomeBinsSql(c, s, d, { binBp, threshold, includeX }))
      ]);
      ser.samples += Number(cov[0]?.samples || 0);
      const segd = Number(cov[0]?.segmented || 0);
      ser.segmented += segd;
      if (!segd && (cohorts[name].perStudy[st]?.count || 0) > 0) noSegments.push(st);
      for (const row of rows) {
        const c = String(row.chrom), k = Number(row.bin);
        if (!(c in offset)) continue;
        if (k >= nBins[c]) { pastEnd++; continue; }
        const i = offset[c] + k;
        ser.profiled[i] += Number(row.profiled); ser.gain[i] += Number(row.gain); ser.loss[i] += Number(row.loss);
      }
    }));
    series.push(ser);
  }
  for (const st of [...new Set(noSegments)]) excluded.push({ study: st, reason: "no copy-number segments" });
  if (!series.some((s) => s.segmented))
    return refuse("genome", ctx, "no sample in " + (vNames.length === 1 ? "this cohort" : "these cohorts") +
      " has copy-number segments" + (excluded.length ? " (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")" : "") +
      " — segments exist for 311 of the warehouse's studies, not every one");

  let test: { gainQ: (number | null)[]; lossQ: (number | null)[]; significantGain: number; significantLoss: number } | undefined;
  if (series.length === 2) {
    const [A, B] = series;
    const qFor = (which: "gain" | "loss"): (number | null)[] => {
      const idx: number[] = [], ps: number[] = [];
      for (let i = 0; i < bins.length; i++) {
        if (!A.profiled[i] || !B.profiled[i]) continue;
        const a = A[which][i], c = B[which][i];
        idx.push(i); ps.push(fisherExact(a, A.profiled[i] - a, c, B.profiled[i] - c));
      }
      const q: (number | null)[] = new Array(bins.length).fill(null);
      benjaminiHochberg(ps).forEach((v, j) => { q[idx[j]] = v; });
      return q;
    };
    const gainQ = qFor("gain"), lossQ = qFor("loss");
    test = { gainQ, lossQ,
      significantGain: gainQ.filter((q) => q != null && q < 0.05).length,
      significantLoss: lossQ.filter((q) => q != null && q < 0.05).length };
  }

  const segmented = series.reduce((n, s) => n + s.segmented, 0), samples = series.reduce((n, s) => n + s.samples, 0);
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "genome", cohorts: vNames,
    genome: { build, binMb, threshold, includeX, bins, series, ...(test ? { test } : {}), ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Share of each cohort's segmented SAMPLES (not patients: a patient with two segmented samples counts twice) " +
      "gained (log2 segment mean ≥ " + threshold + ") or lost (≤ −" + threshold + ") in each " + binMb + " Mb bin, " + build + ". " +
      "Each bin's denominator is the samples whose segmentation covers it; a bin takes the value of the segment over its " +
      "midpoint, so an event narrower than " + binMb + " Mb can be missed — use a smaller binMb to find it. " +
      segmented.toLocaleString("en-US") + " of " + plural(samples, "sample") + " have segments." +
      " Thresholds on a log ratio are not purity- or ploidy-corrected: a low-purity tumour's real loss can sit inside ±" + threshold + "." +
      (includeX ? " Chromosome X is drawn, and in male patients its log ratio can read as a loss against a female reference." : " Chromosome X is not drawn (includeX: true adds it).") +
      (test ? " Per-bin two-sided Fisher tests, Benjamini–Hochberg across bins separately for gains and losses; adjacent bins are not independent, so read a run of significant bins as one region, not many findings." : "") +
      (pastEnd ? " " + plural(pastEnd, "segment bin") + " lay past a chromosome's end and were not drawn." : "") +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// pathways: oncogenic signalling pathways, per cohort

const GENE_SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const PATHWAYS_COHORT_LIMIT = 4;

async function pathwaysView(view: PathwaysView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  const lim = ctx.overLimit("a pathways view", PATHWAYS_COHORT_LIMIT, vNames.length);
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
  { const e = ctx.overLimit("a pathways view", 4, sets.length); if (e) return refuse("pathways", ctx, e.replace("at most 4", "at most 4 custom sets")); }
  const custom: { name: string; genes: { gene: string; role: PathwayRole }[] }[] = [];
  for (const [i, x] of sets.entries()) {
    const name = String(x?.name || "").trim().slice(0, 60);
    const genes = [...new Set((Array.isArray(x?.genes) ? x.genes : []).map((g) => String(g).trim().toUpperCase()))];
    if (!name) return refuse("pathways", ctx, "set " + (i + 1) + " needs a name");
    if (!genes.length) return refuse("pathways", ctx, "set “" + name + "” has no genes");
    { const e = ctx.overLimit("a custom set", 40, genes.length); if (e) return refuse("pathways", ctx, e.replace("at most 40", "at most 40 genes") + " (set “" + name + "”)"); }
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
      ok[st].moreAggregate("pathways:sets:" + n, def, (c, s, d) =>
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

// ---------------------------------------------------------------------------
// diffexpr: a volcano of every gene, and preranked GSEA of the same ranking

const DE_MIN_N = 3, DE_POINT_CAP = 1500, DE_PERMUTATIONS = 1000;
const SET_NAME = /^[A-Z0-9_]{3,120}$/;

/** The smallest 1, 2 or 5 × 10^k at or above x — an axis end a reader can read off. */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const k = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * k >= x - 1e-12) return m * k;
  return 10 * k;
}

/** RNA-seq counts/RSEM/TPM are compared on log2(v + 1); z-scores, protein and methylation as stored. */
export function defaultLog2(profileType: string): boolean {
  return /rna_seq|rnaseq|tpm|fpkm|rsem/i.test(profileType) && !/zscore|log/i.test(profileType);
}

async function diffexprView(view: DiffexprView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length !== 2)
    return refuse("diffexpr", ctx, "a diffexpr view compares exactly two cohorts; this one draws " + vNames.length +
      (vNames.length > 2 ? " — name two in its cohorts" : " — add a second cohort to compare against"));
  const profileType = String(view.profileType || "").trim();
  if (!profileType) return refuse("diffexpr", ctx, "a diffexpr view needs profileType, the molecular profile to compare on");
  const label = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(label >= 0 && label <= 40)) return refuse("diffexpr", ctx, "label is 0 to 40 genes; got " + String(view.label).slice(0, 20));
  const setNames = view.geneSets == null ? null : view.geneSets.map((x) => String(x).trim().toUpperCase());
  if (setNames) {
    const e = ctx.overLimit("a diffexpr view", 12, setNames.length);
    if (e) return refuse("diffexpr", ctx, e.replace("at most 12", "at most 12 gene sets"));
    const bad = setNames.filter((x) => !SET_NAME.test(x));
    if (bad.length) return refuse("diffexpr", ctx, "not an MSigDB set name: " + bad.slice(0, 3).join(", "));
  }
  const log2 = view.log2 == null ? defaultLog2(profileType) : view.log2 === true;
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return refuse("diffexpr", ctx, "nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") +
    (empty.length === 1 ? " is" : " are") + " empty — check its definition; the profile is not the problem");

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("diffexpr", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // the profile must exist wherever a cohort has patients — named, with what IS there, if not
  const missing: string[] = [];
  const offered = new Set<string>();
  for (const st of Object.keys(ok)) {
    if (!vNames.some((n) => (cohorts[n].perStudy[st]?.count || 0) > 0)) continue;
    const { profiles } = await ctx.studyProfiles(st);
    profiles.forEach((x) => offered.add(x));
    if (!profiles.includes(profileType)) missing.push(st);
  }
  if (missing.length)
    return refuse("diffexpr", ctx, (missing.length === 1 ? missing[0] + " has" : missing.join(", ") + " have") + " no " + profileType +
      " profile — available: " + ([...offered].sort().join(", ") || "none"));

  const moments = new Map<string, { n: number; sx: number; sxx: number }>(); // cohort|gene
  await Promise.all(vNames.flatMap((n) => cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
    const rows = await ok[st].moreAggregate("diffexpr:moments:" + n, doc.cohorts[n],
      (c, s, d) => profileMomentsAllSql(c, s, d, profileType, log2));
    for (const r of rows) {
      const k = n + "|" + String(r.gene), cur = moments.get(k) || { n: 0, sx: 0, sxx: 0 };
      cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx);
      moments.set(k, cur);
    }
  })));
  const [A, B] = vNames;
  const genes = [...new Set([...moments.keys()].map((k) => k.slice(k.indexOf("|") + 1)))];
  const tested: DiffexprGene[] = [];
  let skipped = 0;
  for (const g of genes) {
    const a = moments.get(A + "|" + g), b = moments.get(B + "|" + g);
    if (!a || !b || a.n < DE_MIN_N || b.n < DE_MIN_N) { skipped++; continue; }
    const va = varianceFromMoments(a.n, a.sx, a.sxx), vb = varianceFromMoments(b.n, b.sx, b.sxx);
    const ma = a.sx / a.n, mb = b.sx / b.n;
    // a constant gene's variance from Σv² − (Σv)²/n is rounding noise, whose sign depends on the
    // order the database happened to sum in — so "no variance" is judged to a relative tolerance,
    // or the same document would test a different number of genes on different runs
    if (!(va + vb > 1e-9 * (1 + ma * ma + mb * mb))) { skipped++; continue; }
    const w = welchT(a.n, ma, va, b.n, mb, vb);
    // the ranking uses the unrounded statistic; welchT's rounded one is for display
    const t = (ma - mb) / Math.sqrt(va / a.n + vb / b.n);
    tested.push({ gene: g, nA: a.n, nB: b.n, meanA: ma, meanB: mb, effect: ma - mb, t, p: w.p, q: 1 });
  }
  if (!tested.length)
    return refuse("diffexpr", ctx, "no gene had at least " + DE_MIN_N + " patients with a " + profileType + " value in both cohorts" +
      " (cohort sizes " + vNames.map((n) => n + " " + cohorts[n].count).join(", ") + ")");
  benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
  const sig = tested.filter((g) => g.q < 0.05);
  const up = sig.filter((g) => g.effect > 0).length, down = sig.length - up;
  const byP = [...tested].sort((x, y) => x.p - y.p || Math.abs(y.effect) - Math.abs(x.effect));
  // half the labels to each direction, so a lopsided comparison still names both sides
  const upFirst = byP.filter((g) => g.effect > 0), downFirst = byP.filter((g) => g.effect <= 0);
  const half = Math.ceil(label / 2);
  const labels = [...upFirst.slice(0, Math.max(half, label - downFirst.length)), ...downFirst.slice(0, Math.max(label - half, label - upFirst.length))]
    .slice(0, label).map((g) => g.gene);
  const pointSet = new Set([...labels, ...byP.filter((g) => g.q < 0.05).slice(0, DE_POINT_CAP).map((g) => g.gene)]);
  const points = byP.filter((g) => pointSet.has(g.gene));
  const P_FLOOR = 1e-300;
  const yOf = (p: number) => -Math.log10(Math.max(P_FLOOR, p));
  const xMax = niceCeil(Math.max(1e-9, ...tested.map((g) => Math.abs(g.effect))));
  const yMax = niceCeil(Math.max(1, ...tested.map((g) => yOf(g.p))));
  const nx = 90, ny = 60, cellMap = new Map<string, number>();
  for (const g of tested) {
    if (pointSet.has(g.gene)) continue;
    const bx = Math.min(nx - 1, Math.floor((g.effect + xMax) / (2 * xMax) * nx));
    const by = Math.min(ny - 1, Math.floor(yOf(g.p) / yMax * ny));
    const cls = g.q < 0.05 ? (g.effect > 0 ? 1 : 2) : 0;
    const k = bx + "," + by + "," + cls;
    cellMap.set(k, (cellMap.get(k) || 0) + 1);
  }
  const cells = [...cellMap].map(([k, c]) => {
    const [x, y, cls] = k.split(",").map(Number);
    return [x, y, c, cls as 0 | 1 | 2] as [number, number, number, 0 | 1 | 2];
  });

  // enrichment: rank by t, best (higher in the first cohort) first
  let gsea: NonNullable<ViewResult["diffexpr"]>["gsea"];
  let gseaSets: { name: string; genes: string[] }[] | undefined;
  if (!setNames || setNames.length) {
    const meta = ok[Object.keys(ok)[0]];
    const rows = await meta.moreMeta("diffexpr:genesets", (_s, d) => genesetMembersSql(setNames || [], setNames ? null : "HALLMARK_", d));
    const found = rows.map((r) => ({ name: String(r.set_name), genes: (r.genes as unknown as string[]).map(String) }));
    gseaSets = found;
    const absent = (setNames || []).filter((x) => !found.some((f) => f.name === x));
    if (absent.length) return refuse("diffexpr", ctx, "no MSigDB set named " + absent.slice(0, 3).join(", ") + " in this warehouse" +
      " (it holds the collections as named in MSigDB, e.g. HALLMARK_E2F_TARGETS, KEGG_…, REACTOME_…)");
    const ranked = [...tested].sort((x, y) => y.t - x.t).map((g) => ({ gene: g.gene, score: g.t }));
    const res = preRankedGsea(ranked, found, { permutations: DE_PERMUTATIONS });
    const qs = benjaminiHochberg(res.map((r) => r.p));
    // many sets reach the permutation floor together, so p alone cannot order them: q, then |NES|
    const sets = res.map((r, i) => ({ ...r, q: qs[i] })).sort((x, y) => x.q - y.q || Math.abs(y.nes) - Math.abs(x.nes));
    gsea = { ranking: "Welch t, " + A + " over " + B, permutations: DE_PERMUTATIONS, sets,
      skipped: found.filter((f) => !res.some((r) => r.name === f.name)).map((f) => f.name) };
  }
  const effectLabel = log2 ? "log2 fold change (difference of mean log2(v+1))"
    : /zscore/i.test(profileType) ? "difference in mean z-score" : "difference in mean value";
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "diffexpr", cohorts: vNames,
    method: diffexprMethod({
      profileType, log2, groups: [A, B], minN: DE_MIN_N, tested: tested.length, skipped,
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      moments: [...moments].map(([k, m]) => ({ cohort: k.slice(0, k.indexOf("|")), gene: k.slice(k.indexOf("|") + 1), n: m.n, sx: m.sx, sxx: m.sxx }))
        .sort((x, y) => vNames.indexOf(x.cohort) - vNames.indexOf(y.cohort) || (x.gene < y.gene ? -1 : x.gene > y.gene ? 1 : 0)),
      ...(gsea && gseaSets ? { gsea: { sets: gseaSets, tested: gsea.sets.length, skipped: gsea.skipped, permutations: DE_PERMUTATIONS, minSize: 10 } } : {}),
    }),
    diffexpr: { profileType, log2, effectLabel, groups: [A, B], tested: tested.length, skipped, up, down,
      points, grid: { xMax, yMax, nx, ny, cells }, pooledSignificant: sig.length - points.filter((g) => g.q < 0.05).length,
      labels, ...(gsea ? { gsea } : {}), ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Welch's t-test per gene on " + profileType + (log2 ? " as log2(v + 1)" : " as stored") + ", " + A + " minus " + B +
      ", each patient contributing the mean of their samples; computed from three running totals per gene and cohort, so it is exact across sites. " +
      tested.length.toLocaleString("en-US") + " genes tested" + (skipped ? ", " + skipped.toLocaleString("en-US") + " left out (fewer than " + DE_MIN_N + " patients with a value in a cohort, or no variance)" : "") +
      "; q is Benjamini–Hochberg across every gene tested. " +
      (sig.length > points.filter((g) => g.q < 0.05).length ? "The " + DE_POINT_CAP + " most significant genes are drawn as points, the rest as density. " : "") +
      (/zscore/i.test(profileType) ? "Z-scores are standardised within each study, so a difference is in study-specific units. " : "") +
      "A t-test on thousands of patients finds tiny differences significant — read the effect, not only the q. " +
      (gsea ? "Enrichment is preranked GSEA on the unrounded t (Subramanian et al. 2005, weight 1), significance from " + DE_PERMUTATIONS +
        " random sets of the same size drawn from the same ranking, seeded by the set's name so a shared link reproduces it; p = (b+1)/(m+1) over the same-sign nulls, q is Benjamini–Hochberg across the sets tested (not GSEA's own NES-based FDR). " +
        "Gene-set permutation ignores gene–gene correlation, so it is anti-conservative next to phenotype permutation, which needs patient-level values. " : "") +
      (multi ? "Values are pooled across " + ctx.vStudies.length + " studies with no batch correction. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// paired: primary against metastasis (or any two kinds of sample), within patients

const ATTR_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

async function pairedView(view: PairedView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  { const e = ctx.overLimit("a paired view", 3, vNames.length); if (e) return refuse("paired", ctx, e.replace("at most 3", "at most 3 cohorts")); }
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("paired", ctx, (e as Error).message); }
  if (!genes.length) return refuse("paired", ctx, "a paired view needs genes");
  { const e = ctx.overLimit("a paired view", 20, genes.length); if (e) return refuse("paired", ctx, e.replace("at most 20", "at most 20 genes")); }
  const measure: "driver" | "any" = view.measure === "any" ? "any" : "driver";
  if (measure === "driver" && !pin)
    return refuse("paired", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const raw = view.pairBy || { attribute: "SAMPLE_TYPE", a: "Primary", b: "Metastasis" };
  const list = (x: string | string[] | undefined) => (Array.isArray(x) ? x : x == null ? [] : [x]).map((v) => String(v).trim()).filter(Boolean);
  const by = { attribute: String(raw.attribute || "").trim(), a: list(raw.a), b: list(raw.b) };
  if (!ATTR_NAME.test(by.attribute)) return refuse("paired", ctx, "pairBy.attribute must be a sample attribute name; got " + JSON.stringify(by.attribute).slice(0, 40));
  if (!by.a.length || !by.b.length) return refuse("paired", ctx, "pairBy needs at least one value for each side, a and b");
  const fold = (v: string) => v.toLowerCase().trim();
  const overlap = by.a.filter((v) => by.b.map(fold).includes(fold(v)));
  if (overlap.length) return refuse("paired", ctx, "a value cannot be on both sides of a pair: " + overlap.join(", "));

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("paired", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const panels: PairedPanel[] = [];
  const tallies = new Map<string, { pairs: number; both: number; aOnly: number; bOnly: number }>();
  for (const n of vNames) {
    const panel: PairedPanel = { cohort: n, patients: 0, aSamples: 0, bSamples: 0, genes: [] };
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n];
      const [pp, rows] = await Promise.all([
        ok[st].moreAggregate("paired:patients:" + n, def, (c, s, d) => pairedPatientsSql(c, s, d, by)),
        ok[st].moreAggregate("paired:genes:" + n, def, (c, s, d) => pairedCountsSql(c, s, d, genes, by, pin, measure))
      ]);
      panel.patients += Number(pp[0]?.patients || 0);
      panel.aSamples += Number(pp[0]?.a_samples || 0); panel.bSamples += Number(pp[0]?.b_samples || 0);
      for (const r of rows) {
        const k = n + "|" + String(r.gene), cur = tallies.get(k) || { pairs: 0, both: 0, aOnly: 0, bOnly: 0 };
        cur.pairs += Number(r.pairs); cur.both += Number(r.both); cur.aOnly += Number(r.a_only); cur.bOnly += Number(r.b_only);
        tallies.set(k, cur);
      }
    }));
    panel.genes = genes.map((g) => {
      const t = tallies.get(n + "|" + g) || { pairs: 0, both: 0, aOnly: 0, bOnly: 0 };
      const anywhere = t.both + t.aOnly + t.bOnly;
      return { gene: g, ...t, neither: t.pairs - anywhere, concordance: anywhere ? Math.round(1000 * t.both / anywhere) / 1000 : null,
        p: mcnemarExact(t.aOnly, t.bOnly), q: 1 };
    });
    const tested = panel.genes.filter((g) => g.aOnly + g.bOnly > 0);
    benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
    panels.push(panel);
  }
  if (!panels.some((pn) => pn.patients)) {
    // say what the attribute actually holds here, so the fix is one edit away
    const st = Object.keys(ok)[0];
    const vals = await ok[st].moreAggregate("paired:values", doc.cohorts[vNames[0]], (c, s, d) => sampleAttributeValuesSql(c, s, d, by.attribute));
    return refuse("paired", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " has both a " +
      by.attribute + " = " + by.a.join("/") + " sample and a " + by.b.join("/") + " sample" +
      (vals.length ? " — " + by.attribute + " here takes: " + vals.map((v) => String(v.value) + " (" + Number(v.samples).toLocaleString("en-US") + ")").join(", ")
        : " — " + st + " has no sample attribute " + by.attribute));
  }
  const multi = ctx.vStudies.length > 1;
  const aL = by.a.join("/"), bL = by.b.join("/");
  return {
    kind: "paired", cohorts: vNames,
    paired: { pairBy: by, measure, panels, ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Within patients who have both a " + by.attribute + " = " + aL + " sample and a " + bL + " sample (" +
      panels.map((pn) => pn.cohort + ": " + plural(pn.patients, "patient")).join("; ") + "), per gene, among those profiled for it on BOTH sides by each side's own panels: " +
      (measure === "driver" ? "an OncoKB driver (" + pin + ")" : "any alteration") + " on both sides, on the " + aL + " side only, or the " + bL + " side only; " +
      "a patient with several samples on a side counts as altered there if any is. " +
      "Concordance is both ÷ altered anywhere. The exact McNemar test asks whether discordance runs one way; q is Benjamini–Hochberg across the genes of each cohort. " +
      "A sample's " + by.attribute + " records where the tissue came from, not when it was taken, so " + bL + "-only is not the same as \"acquired later\"; " +
      "and patients sampled twice are a selected group, typically with longer or harder disease courses." +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// clonality: FACETS clonal / subclonal calls, LOH, WGD, purity and ploidy

async function clonalityView(view: ClonalityView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  { const e = ctx.overLimit("a clonality view", 3, vNames.length); if (e) return refuse("clonality", ctx, e.replace("at most 3", "at most 3 cohorts")); }
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("clonality", ctx, (e as Error).message); }
  if (!genes.length) return refuse("clonality", ctx, "a clonality view needs genes");
  { const e = ctx.overLimit("a clonality view", 12, genes.length); if (e) return refuse("clonality", ctx, e.replace("at most 12", "at most 12 genes")); }
  const measure: "driver" | "any" = view.measure === "any" ? "any" : "driver";
  if (measure === "driver" && !pin)
    return refuse("clonality", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const qc = view.qc !== false;

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("clonality", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // which of this view's studies hold allele-specific copy number at all
  const withAscn = new Set<string>();
  await Promise.all(Object.entries(ok).map(async ([st, r]) => {
    const rows = await r.moreMeta("clonality:ascn-studies", ascnStudiesSql);
    if (rows.some((x) => String(x.study) === st)) withAscn.add(st);
  }));
  for (const st of Object.keys(ok)) if (!withAscn.has(st)) { excluded.push({ study: st, reason: "no FACETS allele-specific copy number" }); delete ok[st]; }
  if (!Object.keys(ok).length) {
    const any = Object.values(ctx.resolvers).find((r) => hasMoreAggregates(r)) as MoreResolver | undefined;
    const holders = any ? (await any.moreMeta("clonality:ascn-studies", ascnStudiesSql)).map((x) => String(x.study)) : [];
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
        ok[st].moreAggregate("clonality:summary:" + n, def, (c, s, d) => facetsSummarySql(c, s, d, qc)),
        ok[st].moreAggregate("clonality:purity-ploidy:" + n, def, (c, s, d) => facetsHistogramSql(c, s, d, qc)),
        ok[st].moreAggregate("clonality:genes:" + n, def, (c, s, d) => clonalityGenesSql(c, s, d, genes, pin, measure, qc))
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

// ---------------------------------------------------------------------------
// incidence: cumulative incidence with death as a competing risk

const INCIDENCE_COHORT_LIMIT = 6;

async function incidenceView(view: IncidenceView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = ctx.overLimit("an incidence view", INCIDENCE_COHORT_LIMIT, vNames.length); if (e) return refuse("incidence", ctx, e.replace("at most " + INCIDENCE_COHORT_LIMIT, "at most " + INCIDENCE_COHORT_LIMIT + " cohorts")); }
  const ev = view.event;
  if (!ev || typeof ev.eventType !== "string" || !ev.eventType.trim())
    return refuse("incidence", ctx, "an incidence view needs event: {eventType, attrs?}, the timeline event whose incidence to estimate");
  const attrs = Array.isArray(ev.attrs) ? ev.attrs : [];
  if (attrs.length > 3) return refuse("incidence", ctx, "event takes at most 3 attrs; this asks for " + attrs.length);
  if (attrs.some((a) => !a || !a.key || a.value == null || a.value === ""))
    return refuse("incidence", ctx, "every event attr needs both a key and a value");
  const event = { eventType: ev.eventType.trim().slice(0, 120), attrs: attrs.map((a) => ({ key: String(a.key).slice(0, 120), value: String(a.value).slice(0, 200) })) };
  const eventLabel = (ev.label && String(ev.label).trim().slice(0, 80)) ||
    event.eventType + (event.attrs.length ? " [" + event.attrs.map((a) => a.key + "=" + a.value).join(", ") + "]" : "");
  const rawAnchor = view.anchor;
  const anchor = rawAnchor && rawAnchor.eventType
    ? { eventType: String(rawAnchor.eventType).slice(0, 120),
        ...(rawAnchor.key ? { key: String(rawAnchor.key).slice(0, 120), value: String(rawAnchor.value ?? "") } : {}),
        occurrence: rawAnchor.occurrence === "LAST" ? "LAST" as const : "FIRST" as const }
    : null;
  const horizons = (view.horizons == null ? [12, 24, 60] : view.horizons).map(Number);
  if (!horizons.length || horizons.length > 6 || horizons.some((h) => !(h > 0 && h <= 600)))
    return refuse("incidence", ctx, "horizons are 1 to 6 month values between 0 and 600");

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("incidence", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const recsBy: Record<string, CrRecord[]> = {};
  const curves: IncidenceCurve[] = [];
  const countRows: IncidenceTrace["counts"] = [];
  for (const n of vNames) {
    const recs: CrRecord[] = [];
    const ex = { prior: 0, unobserved: 0, noFollowup: 0, noAnchor: 0 };
    let late = 0, seen = 0, cohortN = 0;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      cohortN += cohorts[n].perStudy[st]?.count || 0;
      const rows = await ok[st].moreAggregate("incidence:" + n, doc.cohorts[n], (c, s, d) => incidenceCountsSql(c, s, d, event, anchor));
      for (const r of rows) {
        const k = String(r.kind), cnt = Number(r.n);
        seen += cnt;
        if (k === "prior") { ex.prior += cnt; continue; }
        if (k === "unobserved") { ex.unobserved += cnt; continue; }
        if (k === "nofollowup") { ex.noFollowup += cnt; continue; }
        if (Number(r.late)) late += cnt;
        const entry = Number(r.entry), t = Number(r.t), cause = Number(r.cause) as 0 | 1 | 2;
        for (let i = 0; i < cnt; i++) recs.push(entry > 0 ? { t, cause, entry } : { t, cause });
        countRows.push({ cohort: n, study: st, entry, t, cause, n: cnt });
      }
    }));
    ex.noAnchor = Math.max(0, cohortN - seen);
    // a canonical order, independent of which study answered first or how the database ordered
    // tied rows: the permutation test shuffles labels by position, so its seeded p depends on it
    const entryKey = (r: CrRecord) => r.entry ?? -Infinity;
    recs.sort((x, y) => x.t - y.t || x.cause - y.cause || (entryKey(x) < entryKey(y) ? -1 : entryKey(x) > entryKey(y) ? 1 : 0));
    recsBy[n] = recs;
    const c = aalenJohansen(recs);
    curves.push({ cohort: n, n: c.n, events: c.events, competing: c.competing, censored: c.censored,
      points: c.points.map((pt) => ({ t: pt.t, f1: Math.round(pt.f1 * 1e5) / 1e5, f2: Math.round(pt.f2 * 1e5) / 1e5,
        se1: Math.round(pt.se1 * 1e5) / 1e5, atRisk: pt.atRisk })), excluded: ex, late });
  }
  if (!curves.some((c) => c.n))
    return refuse("incidence", ctx, "no patient could enter the risk set: " + curves.map((c) => c.cohort + " — " +
      c.excluded.prior + " already had " + eventLabel + (anchor ? " at or before the anchor" : " by day 0") + ", " + c.excluded.noFollowup + " without follow-up" +
      (anchor ? ", " + c.excluded.noAnchor + " without a " + anchor.eventType + " event" : "") + (c.excluded.unobserved ? ", " + c.excluded.unobserved + " before observation began" : "")).join("; "));

  // incidence at each horizon, beside the naive 1 − KM that censors the dead
  const hz = horizons.map((months) => ({ months, cells: curves.map((c) => {
    const recs = recsBy[c.cohort];
    const cif = aalenJohansen(recs), at = cifAt(cif, months);
    const km = kaplanMeier(recs.map((r) => ({ t: r.t, event: r.cause === 1 ? 1 : 0, ...(r.entry != null ? { entry: r.entry } : {}) })));
    let s = 1;
    for (const pt of km.points) { if (pt.t > months) break; s = pt.s; }
    const atRisk = recs.filter((r) => (r.entry ?? -Infinity) < months && r.t >= months).length;
    return { cohort: c.cohort, f1: at.f1, lo: Math.max(0, at.f1 - Z_975 * at.se1), hi: Math.min(1, at.f1 + Z_975 * at.se1), naive: 1 - s, atRisk };
  }) }));
  let gray: ReturnType<typeof grayPermutationTest> | undefined;
  const live = curves.filter((c) => c.n);
  const nAll = live.reduce((a, c) => a + c.n, 0);
  const perms = nAll > 50000 ? 500 : 2000;
  if (live.length >= 2) gray = grayPermutationTest(live.map((c) => recsBy[c.cohort]), perms, 1);
  const multi = ctx.vStudies.length > 1;
  const exTotal = (k: keyof IncidenceCurve["excluded"]) => curves.reduce((a, c) => a + c.excluded[k], 0);
  return {
    kind: "incidence", cohorts: vNames,
    method: incidenceMethod({
      eventLabel, horizons,
      ...(anchor ? { anchor: (anchor.occurrence === "LAST" ? "last " : "first ") + anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") } : {}),
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      cohorts: curves.map((c) => ({ name: c.cohort, n: c.n, events: c.events, competing: c.competing, censored: c.censored, late: c.late, excluded: c.excluded })),
      counts: countRows.sort((x, y) => vNames.indexOf(x.cohort) - vNames.indexOf(y.cohort) || (x.study < y.study ? -1 : x.study > y.study ? 1 : 0) ||
        x.t - y.t || x.cause - y.cause || x.entry - y.entry),
      ...(gray ? { gray: { statistic: gray.statistic, p: gray.p, permutations: gray.permutations } } : {}),
    }),
    incidence: { eventLabel, ...(anchor ? { anchoredTo: anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") } : {}),
      curves, horizons: hz, ...(gray ? { gray } : {}), ...(excluded.length ? { excludedStudies: excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Cumulative incidence of the first " + eventLabel + " after " + (anchor ? (anchor.occurrence === "LAST" ? "the last " : "the first ") + anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") : "the study's day 0") +
      ", with death (OS_STATUS) as a competing risk: Aalen–Johansen, 95% intervals from its delta-method standard error. " +
      "It is not 1 − Kaplan–Meier: that treats the dead as still at risk of the event and overstates incidence whenever death is common — the table sets the two side by side. " +
      (anchor ? "Left truncation as in the survival view: a patient anchored before day 0 enters the risk set at day 0, not at the anchor. " : "") +
      "Excluded rather than counted as event-free: " + exTotal("prior") + " who already had it " + (anchor ? "at or before the anchor" : "by day 0") +
      (exTotal("unobserved") ? ", " + exTotal("unobserved") + " who had it after the anchor but before observation began" : "") +
      ", " + exTotal("noFollowup") + " without follow-up" + (anchor ? ", " + exTotal("noAnchor") + " with no " + anchor.eventType + " event" : "") + ". " +
      (curves.some((c) => c.late) ? curves.reduce((a, c) => a + c.late, 0) + " had their first event recorded after their last follow-up and are kept as censored or dead at follow-up. " : "") +
      (gray ? "Gray's test (weight 1) by permutation of cohort labels, " + gray.permutations + " shuffles, seeded; exact under the null that the cohorts share one distribution, entry times included. " : "") +
      "An event recorded from notes or registries is only as complete as the recording." +
      (multi ? " Records are pooled across " + ctx.vStudies.length + " studies, whose day 0 need not mean the same thing." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// labs: a lab value's course and response from a treatment start

const WATERFALL_CAP = 5000;
const LAB_KEY = /^[A-Za-z0-9_ .\/-]{1,80}$/;

async function labsView(view: LabsView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = ctx.overLimit("a labs view", 4, vNames.length); if (e) return refuse("labs", ctx, e.replace("at most 4", "at most 4 cohorts")); }
  const test = String(view.test || "").trim();
  if (!test) return refuse("labs", ctx, "a labs view needs test, the lab test to follow (e.g. \"PSA\")");
  const lab = { eventType: String(view.eventType || "Lab_Test").trim(), testKey: String(view.testKey || "TEST").trim(), test,
    resultKey: String(view.resultKey || "RESULT").trim() };
  for (const [k, v] of Object.entries(lab)) if (!LAB_KEY.test(v)) return refuse("labs", ctx, k + " has characters a timeline attribute cannot: " + JSON.stringify(v).slice(0, 40));
  const a = view.anchor;
  if (!a || !a.eventType) return refuse("labs", ctx, "a labs view needs anchor, the treatment start the course is read from (e.g. {eventType: \"Treatment\", key: \"SUBTYPE\", value: \"Hormone\"})");
  const anchor = { eventType: String(a.eventType).slice(0, 120), ...(a.key ? { key: String(a.key).slice(0, 120), value: String(a.value ?? "") } : {}),
    occurrence: a.occurrence === "LAST" ? "LAST" as const : "FIRST" as const };
  const num = (x: unknown, d: number) => x == null ? d : Number(x);
  const baselineDays = num(view.baselineDays, 90), fromWeeks = num(view.fromWeeks, -12), toWeeks = num(view.toWeeks, 52), binWeeks = num(view.binWeeks, 4);
  const responseDrop = num(view.responseDrop, 50);
  if (!(baselineDays >= 0 && baselineDays <= 730)) return refuse("labs", ctx, "baselineDays is 0 to 730");
  if (!(fromWeeks <= 0 && fromWeeks >= -104 && toWeeks > 0 && toWeeks <= 520)) return refuse("labs", ctx, "fromWeeks is −104 to 0 and toWeeks 1 to 520");
  if (!(binWeeks >= 1 && binWeeks <= 26)) return refuse("labs", ctx, "binWeeks is 1 to 26");
  if (!(responseDrop > 0 && responseDrop <= 100)) return refuse("labs", ctx, "responseDrop is a fall in percent, above 0 and at most 100");
  const o = { baselineDays, fromDays: fromWeeks * 7, toDays: toWeeks * 7, binDays: binWeeks * 7 };

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("labs", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const nBins = LAB_PCT_BINS;
  const panels: LabsPanel[] = [];
  for (const n of vNames) {
    const panel: LabsPanel = { cohort: n, anchored: 0, baseline: 0, positiveBaseline: 0, evaluable: 0, course: [], best: new Array(nBins).fill(0), responders: 0 };
    const courseHist = new Map<number, Map<number, number>>();
    const bars: number[] = [];
    let withheld = 0;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n], r = ok[st];
      const [course, best] = await Promise.all([
        r.moreAggregate("labs:course:" + n, def, (c, s, d) => labCourseSql(c, s, d, lab, anchor, o)),
        r.moreAggregate("labs:best:" + n, def, (c, s, d) => labBestSql(c, s, d, lab, anchor, o, responseDrop))
      ]);
      for (const x of course) {
        const tb = Number(x.tbin), pb = Number(x.pbin);
        const m = courseHist.get(tb) || new Map<number, number>();
        m.set(pb, (m.get(pb) || 0) + Number(x.n)); courseHist.set(tb, m);
      }
      let evaluable = 0;
      for (const x of best) {
        const w = String(x.what), cnt = Number(x.n);
        if (w === "best") { const b = Number(x.pbin); if (b >= 0 && b < nBins) panel.best[b] += cnt; }
        else if (w === "responders") panel.responders += cnt;
        else if (w === "anchored") panel.anchored += cnt;
        else if (w === "baseline") panel.baseline += cnt;
        else if (w === "positive_baseline") panel.positiveBaseline += cnt;
        else if (w === "after") { panel.evaluable += cnt; evaluable = cnt; }
      }
      // the bars themselves are one patient's value each: only a patient-level participant is asked
      if (isPatientLevel(r) && evaluable) {
        const rows = await r.moreRows("labs:waterfall:" + n, def, (c, s, d) => labWaterfallSql(c, s, d, lab, anchor, o, WATERFALL_CAP));
        for (const x of rows) bars.push(Number(x.best));
        withheld += Math.max(0, evaluable - rows.length);
      } else withheld += evaluable;
    }));
    const mid = (pb: number) => LAB_PCT_MIN + pb * LAB_PCT_BIN;
    panel.course = [...courseHist.keys()].sort((x, y) => x - y).map((tb) => {
      const hist = [...courseHist.get(tb)!].map(([pb, c]) => ({ v: mid(pb), n: c }));
      const [q1, median, q3] = quantilesFromHistogram(hist, [0.25, 0.5, 0.75]);
      return { week: tb * binWeeks, n: hist.reduce((s2, h) => s2 + h.n, 0), q1, median, q3 };
    });
    if (bars.length) panel.waterfall = bars.sort((x, y) => x - y);
    if (withheld) panel.waterfallWithheld = withheld;
    panels.push(panel);
  }
  if (!panels.some((pn) => pn.anchored)) {
    return refuse("labs", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " has a " + anchor.eventType +
      (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "") + " event to start the clock from");
  }
  if (!panels.some((pn) => pn.evaluable)) {
    const st = Object.keys(ok)[0];
    const tests = await ok[st].moreAggregate("labs:tests", doc.cohorts[vNames[0]], (c, s, d) => labTestsSql(c, s, d, lab.eventType, lab.testKey));
    return refuse("labs", ctx, "no anchored patient has a " + test + " baseline within " + baselineDays + " days before the anchor and a value after it" +
      (tests.length ? " — " + lab.eventType + " " + lab.testKey + " here takes: " + tests.map((x) => String(x.test) + " (" + Number(x.patients).toLocaleString("en-US") + " patients)").join(", ")
        : " — " + st + " records no " + lab.eventType + " events with a " + lab.testKey + " attribute"));
  }
  let responseP: number | undefined;
  if (panels.length === 2 && panels.every((pn) => pn.evaluable))
    responseP = fisherExact(panels[0].responders, panels[0].evaluable - panels[0].responders, panels[1].responders, panels[1].evaluable - panels[1].responders);
  const anchoredTo = anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "");
  const withheld = panels.reduce((s2, pn) => s2 + (pn.waterfallWithheld || 0), 0);
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "labs", cohorts: vNames,
    labs: { test, anchoredTo, responseDrop, fromWeeks, toWeeks, binWeeks, baselineDays, panels, ...(responseP != null ? { responseP } : {}), ...(excluded.length ? { excluded } : {}) },
    // the course and the rate are aggregates; a drawn waterfall is one patient's value per bar
    participation: ctx.participationFor(ctx.vStudies, panels.some((pn) => pn.waterfall && pn.waterfall.length)),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: test + " as % change from each patient's baseline — the last value in the " + baselineDays + " days up to and including the " +
      (anchor.occurrence === "LAST" ? "last " : "first ") + anchoredTo + " — over " + fromWeeks + " to " + toWeeks + " weeks around it, in " + binWeeks + "-week bins; " +
      "a patient tested several times in a bin counts once, at their mean, and the baseline reading itself is not drawn. Median and interquartile band are read from 2-point histograms, so they are exact to within a point; " +
      "values above +300% share the top bin. Best response is each patient's lowest value after the anchor within the window; a responder fell by at least " + responseDrop + "%" +
      (responseDrop === 50 && /psa/i.test(test) ? " (PCWG3's PSA50)" : "") + ", counted exactly. " +
      "Denominators: " + panels.map((pn) => pn.cohort + " — " + pn.anchored.toLocaleString("en-US") + " anchored, " + pn.baseline.toLocaleString("en-US") + " with a baseline, " +
        pn.evaluable.toLocaleString("en-US") + " with a value after").join("; ") + ". " +
      "Patients tested more often are over-represented in any bin they appear in, and testing itself is more frequent when a value is moving; the course is of those measured, not of everyone. " +
      (withheld ? withheld.toLocaleString("en-US") + " patients' bars are not drawn in the waterfall: an aggregate-only participant cannot disclose one patient's value (they are in the histogram and the rate). " : "") +
      (responseP != null ? "Response rates compared with a two-sided Fisher test. " : "") +
      (multi ? "Pooled across " + ctx.vStudies.length + " studies; units and assays are not harmonised. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
